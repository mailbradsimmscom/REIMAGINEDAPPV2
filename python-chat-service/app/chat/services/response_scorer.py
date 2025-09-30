"""
Response quality scoring service
"""
from typing import Dict, Any, Optional
from ..models import ResponseScore, QueryClassification
import logging

logger = logging.getLogger(__name__)


class ResponseScorer:
    """
    Calculates response quality scores based on multiple factors
    """

    def calculate_score(
        self,
        merged_context: Dict[str, Any],
        classification: Optional[QueryClassification] = None
    ) -> ResponseScore:
        """
        Calculate response quality score (0-100) based on available data

        Args:
            merged_context: Merged results from all sources
            classification: Query classification for context

        Returns:
            ResponseScore with breakdown and confidence level
        """
        try:
            # Initialize breakdown
            breakdown = {
                "dip_structured": 0.0,      # 40% max
                "pinecone_context": 0.0,    # 30% max
                "source_reliability": 0.0,  # 15% max
                "query_match": 0.0          # 15% max
            }

            # 1. DIP Structured Data Score (40% weight)
            if merged_context.get("has_dip_results"):
                dip_score = self._score_dip_results(merged_context["dip_data"])
                breakdown["dip_structured"] = dip_score * 0.4

            # 2. Pinecone Context Score (30% weight)
            if merged_context.get("has_pinecone_results"):
                pinecone_score = self._score_pinecone_results(merged_context["pinecone_data"])
                breakdown["pinecone_context"] = pinecone_score * 0.3

            # 3. Source Reliability (15% weight)
            source_score = self._score_source_reliability(merged_context)
            breakdown["source_reliability"] = source_score * 0.15

            # 4. Query Match Quality (15% weight)
            match_score = self._score_query_match(classification)
            breakdown["query_match"] = match_score * 0.15

            # Calculate total score
            total_score = sum(breakdown.values())
            total_score = min(max(int(total_score), 0), 100)  # Clamp to 0-100

            # Determine confidence level
            confidence = self._get_confidence_level(total_score)
            confidence_emoji = self._get_confidence_emoji(confidence)

            # Generate reasoning
            reasoning = self._generate_reasoning(breakdown, total_score, merged_context)

            return ResponseScore(
                total_score=total_score,
                confidence=confidence,
                breakdown=breakdown,
                confidence_emoji=confidence_emoji,
                reasoning=reasoning
            )

        except Exception as e:
            logger.error(f"Response scoring failed: {e}")
            return self._default_score()

    def _score_dip_results(self, dip_data: list) -> float:
        """Score DIP table results quality (0.0-1.0)"""
        if not dip_data:
            return 0.0

        total_results = sum(table["count"] for table in dip_data)
        if total_results == 0:
            return 0.0

        # Base score on result count and diversity
        base_score = min(total_results / 10.0, 1.0)  # Scale to 1.0 at 10 results

        # Bonus for multiple table types
        table_count = len(dip_data)
        diversity_bonus = min(table_count / 4.0, 0.2)  # Up to 0.2 bonus for all 4 tables

        # Bonus for high-value tables
        high_value_bonus = 0.0
        for table in dip_data:
            if table["table"] == "intent_router" and table["count"] > 0:
                high_value_bonus += 0.1  # Intent router matches are valuable
            elif table["table"] == "spec_suggestions" and table["count"] >= 3:
                high_value_bonus += 0.1  # Multiple specs are valuable

        return min(base_score + diversity_bonus + high_value_bonus, 1.0)

    def _score_pinecone_results(self, pinecone_data: dict) -> float:
        """Score Pinecone vector search results (0.0-1.0)"""
        if not pinecone_data or pinecone_data.get("error"):
            return 0.0

        finalists = pinecone_data.get("finalists", [])
        if not finalists:
            return 0.0

        # Score based on number and relevance of results
        result_count = len(finalists)
        base_score = min(result_count / 5.0, 0.8)  # Scale to 0.8 at 5 results

        # Bonus for high-confidence matches (if available)
        # This would need integration with actual Pinecone relevance scores
        confidence_bonus = 0.2 if result_count > 3 else 0.1

        return min(base_score + confidence_bonus, 1.0)

    def _score_source_reliability(self, merged_context: dict) -> float:
        """Score source reliability (0.0-1.0)"""
        reliability_score = 0.0

        # DIP tables are highly reliable
        if merged_context.get("has_dip_results"):
            reliability_score += 0.6

        # Vector search from known documents is moderately reliable
        if merged_context.get("has_pinecone_results"):
            reliability_score += 0.3

        # Web search is less reliable
        if merged_context.get("has_web_results"):
            reliability_score += 0.1

        return min(reliability_score, 1.0)

    def _score_query_match(self, classification: Optional[QueryClassification]) -> float:
        """Score how well the query was understood and matched (0.0-1.0)"""
        if not classification:
            return 0.5  # Default middle score if no classification

        # Higher classification confidence = better query understanding
        base_score = classification.confidence

        # Bonus for clear intent categories
        if classification.primary in ["spec", "procedure", "troubleshooting"]:
            intent_bonus = 0.2  # These are clear, actionable intents
        else:
            intent_bonus = 0.1

        return min(base_score + intent_bonus, 1.0)

    def _get_confidence_level(self, total_score: int) -> str:
        """Convert total score to confidence level"""
        if total_score >= 85:
            return "high"
        elif total_score >= 65:
            return "medium"
        elif total_score >= 40:
            return "low"
        else:
            return "very_low"

    def _get_confidence_emoji(self, confidence: str) -> str:
        """Get emoji for confidence level"""
        emoji_map = {
            "high": "🟢",
            "medium": "🟡",
            "low": "🟠",
            "very_low": "🔴"
        }
        return emoji_map.get(confidence, "🔴")

    def _generate_reasoning(self, breakdown: dict, total_score: int, merged_context: dict) -> str:
        """Generate human-readable reasoning for the score"""
        reasons = []

        # DIP structured data contribution
        dip_points = int(breakdown["dip_structured"])
        if dip_points > 30:
            reasons.append(f"Strong structured data match (+{dip_points} pts)")
        elif dip_points > 15:
            reasons.append(f"Moderate structured data (+{dip_points} pts)")
        elif dip_points > 0:
            reasons.append(f"Limited structured data (+{dip_points} pts)")

        # Context contribution
        context_points = int(breakdown["pinecone_context"])
        if context_points > 20:
            reasons.append(f"Rich contextual information (+{context_points} pts)")
        elif context_points > 10:
            reasons.append(f"Some contextual support (+{context_points} pts)")

        # Source reliability
        reliability_points = int(breakdown["source_reliability"])
        if reliability_points > 10:
            reasons.append(f"Reliable sources (+{reliability_points} pts)")

        # Query understanding
        match_points = int(breakdown["query_match"])
        if match_points > 10:
            reasons.append(f"Clear query understanding (+{match_points} pts)")

        # Overall assessment
        if total_score >= 85:
            reasons.insert(0, "Comprehensive answer with multiple reliable sources")
        elif total_score >= 65:
            reasons.insert(0, "Good answer with adequate supporting information")
        elif total_score >= 40:
            reasons.insert(0, "Limited information available")
        else:
            reasons.insert(0, "Insufficient data for comprehensive answer")

        return ". ".join(reasons) + "."

    def _default_score(self) -> ResponseScore:
        """Return default score when calculation fails"""
        return ResponseScore(
            total_score=25,
            confidence="very_low",
            breakdown={
                "dip_structured": 0.0,
                "pinecone_context": 0.0,
                "source_reliability": 10.0,  # Base reliability
                "query_match": 15.0         # Base query processing
            },
            confidence_emoji="🔴",
            reasoning="Score calculation failed, using default low confidence score."
        )