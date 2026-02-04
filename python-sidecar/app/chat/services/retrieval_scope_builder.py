"""
Retrieval Scope Builder for v5 Chat Retrieval

Computes retrieval scope at chat-time:
- focus_assets: top 1-2 asset_uids inferred as main subject(s)
- focus_models: model keys for focus assets
- boat_models: all model keys in thread
- candidate_primary_doc_ids: docs where focus system is primary
- candidate_referencing_doc_ids: docs that reference focus system

See: .cursor/plans/v5_chat_retrieval_v5_tags_and_doc_scoping.plan.md
"""

import asyncio
import hashlib
import logging
import time
from typing import Any, Optional

from .base import BaseService
from ...utils.normalize import normalize_model_key as _normalize_model_key

logger = logging.getLogger(__name__)


def _compute_equipment_hash(asset_uids: list[str]) -> str:
    """Compute hash for cache key from sorted asset_uids."""
    sorted_uids = ",".join(sorted(uid for uid in asset_uids if uid))
    return hashlib.sha256(sorted_uids.encode()).hexdigest()[:16]


class RetrievalScopeBuilder(BaseService):
    """
    Builds retrieval scope for v5 chat retrieval.

    Extends BaseService to get self.supabase client.
    Implements per-thread caching with TTL.
    """

    # Cache TTL in seconds (tunable 60-180s, default 120s)
    CACHE_TTL_SECONDS = 120

    def __init__(self):
        super().__init__()
        # In-memory cache: key -> (result, timestamp, equipment_hash)
        self._cache: dict[str, tuple[dict, float, str]] = {}

    async def build_retrieval_scope(
        self,
        *,
        thread_id: str | None,
        systems_context: list[dict],
        primary_equipment: dict | None,
        resolved_model_aliases: list[str] | None = None,
    ) -> dict:
        """
        Build retrieval scope for v5 filtering.

        Args:
            thread_id: Optional thread ID for caching
            systems_context: Equipment list from Node (asset identity + display fields)
            primary_equipment: Focus equipment chosen by classifier (state["primary_equipment"])
            resolved_model_aliases: Canonical model keys resolved by Node from ref_model_synonyms

        Returns:
            {
                "focus_assets": list[str],              # 1-2 asset_uids
                "focus_models": list[str],              # canonical-ish model keys
                "boat_models": list[str],               # all model keys in thread
                "candidate_primary_doc_ids": list[str], # from document_systems
                "candidate_referencing_doc_ids": list[str], # from document_referenced_systems
                "candidate_doc_ids": list[str],         # union of above (for logging/DIP)
                "cache_hit": bool,                      # whether result was cached
                "duration_ms": int,                     # time to build scope
            }
        """
        start_time = time.time()

        # Extract focus asset(s)
        focus_assets = self._extract_focus_assets(systems_context, primary_equipment)

        # Check cache
        equipment_hash = _compute_equipment_hash([ctx.get("asset_uid", "") for ctx in systems_context])
        focus_asset_uid = focus_assets[0] if focus_assets else ""
        cache_key = f"{thread_id or 'no_thread'}:{focus_asset_uid}"

        cached = self._get_cached(cache_key, equipment_hash)
        if cached:
            cached["cache_hit"] = True
            cached["duration_ms"] = int((time.time() - start_time) * 1000)
            logger.info(f"✅ Retrieval scope cache HIT (key={cache_key[:20]}...)")
            return cached

        # Build scope from DB
        if not self.supabase:
            logger.warning("Supabase not available, returning empty scope")
            return self._empty_scope(start_time)

        try:
            # Parallelize independent DB reads
            focus_models, boat_models, primary_doc_ids, referencing_doc_ids = await asyncio.gather(
                self._get_focus_models(focus_assets),
                self._get_boat_models(systems_context),
                self._get_primary_doc_ids(focus_assets),
                self._get_referencing_doc_ids_for_focus(focus_assets, systems_context),
            )

            # Merge resolved_model_aliases into focus_models
            if resolved_model_aliases:
                merged_aliases = [_normalize_model_key(a) for a in resolved_model_aliases if a]
                if merged_aliases:
                    focus_models = list(set(focus_models + merged_aliases))
                    logger.info(
                        f"🔗 Merged {len(merged_aliases)} model alias(es) into focus_models: "
                        f"{merged_aliases}"
                    )

            # Dedupe doc_ids
            primary_doc_ids = list(set(primary_doc_ids))
            referencing_doc_ids = list(set(referencing_doc_ids))

            # Remove any overlap (if a doc is primary, don't also list as referencing)
            primary_set = set(primary_doc_ids)
            referencing_doc_ids = [d for d in referencing_doc_ids if d not in primary_set]

            # referenced_systems: model keys to query in DIP referenced_systems column
            # When focus equipment is referenced by other docs, use focus_models
            # This enables retrieval of DIP rows tagged with referenced_systems overlap
            referenced_systems = list(set(focus_models)) if referencing_doc_ids else []

            result = {
                "focus_assets": focus_assets,
                "focus_models": list(set(focus_models)),
                "boat_models": list(set(boat_models)),
                "candidate_primary_doc_ids": primary_doc_ids,
                "candidate_referencing_doc_ids": referencing_doc_ids,
                "candidate_doc_ids": primary_doc_ids + referencing_doc_ids,
                "referenced_systems": referenced_systems,  # for DIP referenced_systems filtering
                "cache_hit": False,
                "duration_ms": int((time.time() - start_time) * 1000),
            }

            # Cache result
            self._set_cached(cache_key, result, equipment_hash)

            logger.info(
                f"✅ Retrieval scope BUILT: "
                f"focus_assets={len(focus_assets)}, "
                f"focus_models={result['focus_models']}, "
                f"primary_docs={len(primary_doc_ids)}, "
                f"ref_docs={len(referencing_doc_ids)}, "
                f"duration={result['duration_ms']}ms"
            )

            return result

        except Exception as e:
            logger.error(f"Failed to build retrieval scope: {e}", exc_info=True)
            return self._empty_scope(start_time)

    def _extract_focus_assets(
        self,
        systems_context: list[dict],
        primary_equipment: dict | None,
    ) -> list[str]:
        """
        Extract focus asset_uid(s) from context.

        Uses primary_equipment if available (chosen by classifier),
        otherwise falls back to highest-ranked equipment.
        """
        if not systems_context:
            return []

        focus_assets = []

        # Primary focus from classifier
        if primary_equipment and primary_equipment.get("asset_uid"):
            focus_assets.append(primary_equipment["asset_uid"])
        else:
            # Fallback: highest ranked equipment
            sorted_ctx = sorted(
                systems_context,
                key=lambda x: x.get("rank", 0),
                reverse=True
            )
            if sorted_ctx and sorted_ctx[0].get("asset_uid"):
                focus_assets.append(sorted_ctx[0]["asset_uid"])

        # Optionally add secondary focus (for compare intent) - future enhancement
        # For now, just return primary focus

        return focus_assets

    async def _get_focus_models(self, focus_assets: list[str]) -> list[str]:
        """Get model keys for focus assets from systems table."""
        if not focus_assets or not self.supabase:
            return []

        try:
            result = self.supabase.table("systems").select(
                "asset_uid, model_norm"
            ).in_("asset_uid", focus_assets).execute()

            models = []
            for row in result.data or []:
                model_norm = row.get("model_norm")
                if model_norm:
                    # Apply lightweight normalization as guard
                    models.append(_normalize_model_key(model_norm))

            return models

        except Exception as e:
            logger.error(f"Failed to get focus models: {e}")
            return []

    async def _get_boat_models(self, systems_context: list[dict]) -> list[str]:
        """
        Get all model keys for equipment in thread.

        Uses model from systems_context directly (already has model field),
        then normalizes.
        """
        models = []
        for ctx in systems_context:
            # systems_context has 'model' field from Node
            model = ctx.get("model") or ctx.get("model_norm")
            if model:
                models.append(_normalize_model_key(model))

        return models

    async def _get_primary_doc_ids(self, focus_assets: list[str]) -> list[str]:
        """Get doc_ids where focus assets are primary (from document_systems)."""
        if not focus_assets or not self.supabase:
            return []

        try:
            result = self.supabase.table("document_systems").select(
                "doc_id, asset_uid"
            ).in_("asset_uid", focus_assets).execute()

            doc_ids = [row.get("doc_id") for row in result.data or [] if row.get("doc_id")]
            return doc_ids

        except Exception as e:
            logger.error(f"Failed to get primary doc_ids: {e}")
            return []

    async def _get_referencing_doc_ids_for_focus(
        self,
        focus_assets: list[str],
        systems_context: list[dict],
    ) -> list[str]:
        """
        Get doc_ids that reference the focus system's model.

        Looks up canonical_model in document_referenced_systems
        where canonical_model matches focus model keys.
        """
        if not focus_assets or not self.supabase:
            return []

        # First get the focus models
        focus_models = await self._get_focus_models(focus_assets)
        if not focus_models:
            return []

        try:
            # Query document_referenced_systems by canonical_model
            # Note: canonical_model should already be canonical, but normalize as guard
            normalized_focus = [_normalize_model_key(m) for m in focus_models if m]

            if not normalized_focus:
                return []

            result = self.supabase.table("document_referenced_systems").select(
                "doc_id, canonical_model"
            ).in_("canonical_model", normalized_focus).execute()

            doc_ids = [row.get("doc_id") for row in result.data or [] if row.get("doc_id")]
            return doc_ids

        except Exception as e:
            logger.error(f"Failed to get referencing doc_ids: {e}")
            return []

    def _get_cached(self, cache_key: str, equipment_hash: str) -> dict | None:
        """Get cached result if valid (not expired, same equipment hash)."""
        if cache_key not in self._cache:
            return None

        result, timestamp, cached_hash = self._cache[cache_key]

        # Check equipment hash (invalidate if equipment changed)
        if cached_hash != equipment_hash:
            del self._cache[cache_key]
            return None

        # Check TTL
        if time.time() - timestamp > self.CACHE_TTL_SECONDS:
            del self._cache[cache_key]
            return None

        # Return a copy to avoid mutation
        return dict(result)

    def _set_cached(self, cache_key: str, result: dict, equipment_hash: str) -> None:
        """Cache result with timestamp and equipment hash."""
        # Simple cache cleanup: remove expired entries if cache is large
        if len(self._cache) > 100:
            now = time.time()
            expired = [
                k for k, (_, ts, _) in self._cache.items()
                if now - ts > self.CACHE_TTL_SECONDS
            ]
            for k in expired:
                del self._cache[k]

        self._cache[cache_key] = (dict(result), time.time(), equipment_hash)

    def _empty_scope(self, start_time: float) -> dict:
        """Return empty scope result."""
        return {
            "focus_assets": [],
            "focus_models": [],
            "boat_models": [],
            "candidate_primary_doc_ids": [],
            "candidate_referencing_doc_ids": [],
            "candidate_doc_ids": [],
            "referenced_systems": [],  # for DIP referenced_systems filtering
            "cache_hit": False,
            "duration_ms": int((time.time() - start_time) * 1000),
        }

    def health_check(self) -> dict[str, Any]:
        """Health check for retrieval scope builder."""
        base_health = super().health_check()
        return {
            **base_health,
            "service": "RetrievalScopeBuilder",
            "cache_size": len(self._cache),
            "cache_ttl_seconds": self.CACHE_TTL_SECONDS,
        }
