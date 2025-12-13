"""
Sequential Chat Workflow (No LangGraph)

Replaces LangGraph StateGraph with simple sequential function calls.
Maintains all intelligence:
1. Query Classification (LLM keyword extraction)
2. Enhanced Data Retrieval (smart Pinecone search)
3. Response Synthesis (natural language generation)
4. Response Scoring (quality metrics)

TEMPORARY DEBUG LOGGING - Remove after migration complete
"""

from typing import Dict, Any, List, Optional, AsyncGenerator
from datetime import datetime
import logging
import os
import asyncio

from ..debug_logger import chat_debug
from ..services.perplexity_service import PerplexityService

logger = logging.getLogger(__name__)


class ChatWorkflowSequential:
    """Sequential chat workflow without LangGraph dependency"""

    def __init__(self, llm_service, dip_retriever, pinecone_client=None):
        """
        Initialize workflow with required services

        Args:
            llm_service: LLM service for classification and synthesis
            dip_retriever: DIP retriever (staging or production)
            pinecone_client: Optional Pinecone client for semantic search
        """
        self.llm_service = llm_service
        self.dip_retriever = dip_retriever
        self.pinecone_client = pinecone_client

        chat_debug.step('WORKFLOW_INIT', {
            'has_llm_service': llm_service is not None,
            'has_dip_retriever': dip_retriever is not None,
            'has_pinecone_client': pinecone_client is not None
        })

        logger.info("✅ Sequential chat workflow initialized (No LangGraph)")

    async def process_chat(self,
                          user_query: str,
                          systems_context: List[Dict[str, Any]],
                          thread_id: Optional[str] = None,
                          conversation_summary: Optional[str] = None,
                          memory_context: Optional[Dict[str, Any]] = None,
                          synthesis_model: Optional[str] = None) -> Dict[str, Any]:
        """
        Process chat query through sequential workflow

        Args:
            user_query: User's conversational query
            systems_context: Equipment found by Node.js systems search
            thread_id: Optional thread ID
            conversation_summary: Weighted conversation summary from Node.js
            memory_context: Memory context with weights and equipment transitions
            synthesis_model: Optional model override for synthesis (gpt-5 or gpt-4.1-mini)

        Returns:
            Dict with response, sources, metadata, etc.
        """
        start_time = datetime.now()

        logger.info("🚀 WORKFLOW ENTRY - ChatWorkflowSequential.process_chat() called")
        logger.info(f"  - Query: {user_query[:100]}")
        logger.info(f"  - Systems context count: {len(systems_context)}")
        logger.info(f"  - Thread ID: {thread_id}")

        chat_debug.step('PROCESS_CHAT_START', {
            'user_query': user_query[:100],
            'thread_id': thread_id,
            'systems_count': len(systems_context),
            'has_conversation_summary': conversation_summary is not None,
            'has_memory_context': memory_context is not None
        })

        try:
            # Initialize state (no LangGraph TypedDict, just a dict)
            state = {
                "user_query": user_query,
                "thread_id": thread_id,
                "systems_context": systems_context,
                "conversation_summary": conversation_summary,
                "memory_context": memory_context,
                "synthesis_model": synthesis_model,  # Model selection for synthesis
                "classification": None,
                "primary_equipment": None,
                "secondary_equipment": [],
                "dip_results": [],
                "pinecone_results": None,
                "final_response": None,
                "response_score": None,
                "processing_steps": [],
                "start_time": start_time,
                "error": None
            }

            chat_debug.state('INITIAL_STATE', {
                'query_length': len(user_query),
                'equipment_count': len(systems_context),
                'has_summary': bool(conversation_summary)
            })

            # ===== STEP 1: Query Classification =====
            logger.info("📌 STEP 1: Starting Query Classification")
            step_start = datetime.now()
            state = await self._classify_query(state)
            step_duration = (datetime.now() - step_start).total_seconds() * 1000
            state["classification_duration_ms"] = step_duration
            logger.info(f"✅ STEP 1 Complete: Classification took {step_duration:.2f}ms")
            chat_debug.timing('classify_query', step_duration, {
                'intent': (state.get('classification') or {}).get('intent', 'unknown'),
                'confidence': (state.get('classification') or {}).get('confidence', 0)
            })

            if state.get("error"):
                chat_debug.error('CLASSIFY_QUERY_FAILED', Exception(state["error"]), {
                    'query': user_query[:100]
                })
                return await self._fallback_processing(user_query, systems_context, thread_id)

            # ===== STEP 2: Data Retrieval =====
            logger.info("📌 STEP 2: Starting Data Retrieval")
            step_start = datetime.now()
            state = await self._retrieve_data(state)
            step_duration = (datetime.now() - step_start).total_seconds() * 1000
            state["data_retrieval_duration_ms"] = step_duration  # Total retrieval time
            logger.info(f"✅ STEP 2 Complete: Data retrieval took {step_duration:.2f}ms")
            chat_debug.timing('retrieve_data', step_duration, {
                'dip_results_count': len(state.get('dip_results', [])),
                'pinecone_success': (state.get('pinecone_results') or {}).get('success', False)
            })

            if state.get("error"):
                chat_debug.error('RETRIEVE_DATA_FAILED', Exception(state["error"]), {
                    'query': user_query[:100]
                })

            # ===== STEP 3: Parallel OpenAI + Perplexity =====
            logger.info("📌 STEP 3: Starting Parallel OpenAI + Perplexity")
            parallel_start = datetime.now()

            # Launch both tasks in parallel
            openai_task = asyncio.create_task(self._synthesize_response(state))
            perplexity_task = asyncio.create_task(self._query_perplexity(state))

            # Wait for both to complete (return_exceptions prevents one failure from breaking both)
            openai_result, perplexity_result = await asyncio.gather(
                openai_task,
                perplexity_task,
                return_exceptions=True
            )

            parallel_duration = (datetime.now() - parallel_start).total_seconds() * 1000
            state["parallel_duration_ms"] = int(parallel_duration)
            logger.info(f"✅ STEP 3 Complete: Parallel execution took {parallel_duration:.2f}ms")

            # ===== STEP 4: Assemble Response =====
            logger.info("📌 STEP 4: Assembling Response")
            assembly_start = datetime.now()
            state = await self._assemble_response(openai_result, perplexity_result, state)
            state["assembly_duration_ms"] = int((datetime.now() - assembly_start).total_seconds() * 1000)

            if not state.get("final_response"):
                chat_debug.error('ASSEMBLY_FAILED', Exception('No response generated'), {
                    'query': user_query[:100]
                })

            # ===== STEP 5: Response Scoring ===== DISABLED
            # step_start = datetime.now()
            # state = await self._score_response(state)
            # step_duration = (datetime.now() - step_start).total_seconds() * 1000
            # chat_debug.timing('score_response', step_duration, {
            #     'confidence': state.get('response_score', {}).get('confidence', 'unknown')
            # })

            # Format response
            processing_time = int((datetime.now() - state["start_time"]).total_seconds() * 1000)

            # Debug: Log state before metrics collection
            logger.info("🔍 DEBUG - State keys before metrics collection:")
            logger.info(f"  - classification exists: {'classification' in state}")
            logger.info(f"  - classification_duration_ms: {state.get('classification_duration_ms', 'MISSING')}")
            logger.info(f"  - pinecone_results exists: {'pinecone_results' in state}")
            logger.info(f"  - pinecone_duration_ms: {state.get('pinecone_duration_ms', 'MISSING')}")
            logger.info(f"  - synthesis_duration_ms: {state.get('synthesis_duration_ms', 'MISSING')}")
            logger.info(f"  - dip_results exists: {'dip_results' in state}")
            logger.info(f"  - final_response exists: {'final_response' in state}")

            # Log classification details if present
            if 'classification' in state:
                logger.info(f"  - classification content: {state['classification']}")

            # Collect detailed metrics for stats panel
            # Get all timing values
            classification_ms = state.get("classification_duration_ms", 0)
            dip_ms = state.get("dip_duration_ms", 0)
            pinecone_ms = state.get("pinecone_duration_ms", 0)
            ranking_ms = state.get("pinecone_complexity_filtering", {}).get("ranking_duration_ms", 0)
            synthesis_ms = state.get("synthesis_duration_ms", 0)
            perplexity_ms = state.get("perplexity_duration_ms", 0)
            assembly_ms = state.get("assembly_duration_ms", 0)

            # Calculate totals
            total_measured = classification_ms + dip_ms + pinecone_ms + ranking_ms + synthesis_ms + perplexity_ms + assembly_ms

            detailed_metrics = {
                "timing_summary": {
                    "total_processing_ms": processing_time,
                    "total_measured_ms": total_measured,
                    "unmeasured_ms": processing_time - total_measured,
                    "breakdown": {
                        "classification_ms": classification_ms,
                        "dip_retrieval_ms": dip_ms,
                        "pinecone_search_ms": pinecone_ms,
                        "chunk_ranking_ms": ranking_ms,
                        "synthesis_ms": synthesis_ms,
                        "perplexity_ms": perplexity_ms,
                        "assembly_ms": assembly_ms
                    }
                },
                "classification": {
                    "duration_ms": classification_ms,
                    "intent": state["classification"].get("intent", "unknown"),
                    "confidence": state["classification"].get("confidence", 0),
                    "complexity_score": state["classification"].get("complexity_score", 0),
                    "complexity": state["classification"].get("complexity", "unknown"),
                    "table_types_needed": state["classification"].get("table_types_needed", []),
                    "primary_equipment_index": state["classification"].get("primary_equipment_index")
                },
                "dip_retrieval": {
                    "duration_ms": dip_ms,
                    "tables_queried": len(state["dip_results"]),
                    "total_entries": sum(r.get('count', 0) for r in state["dip_results"])
                },
                "pinecone": {
                    "duration_ms": pinecone_ms,
                    "total_matches": (state.get("pinecone_results") or {}).get("total_matches", 0),
                    "filtered_matches": (state.get("pinecone_results") or {}).get("filtered_matches", 0),
                    "chunks": [],  # Will be populated below
                    "metadata_filter_used": (state.get("pinecone_results") or {}).get("metadata_filter_used", False),
                    "complexity_based_filtering": state.get("pinecone_complexity_filtering", {})
                },
                "chunk_ranking": {
                    "duration_ms": ranking_ms,
                    "original_count": state.get("pinecone_complexity_filtering", {}).get("original_count", 0),
                    "filtered_count": state.get("pinecone_complexity_filtering", {}).get("filtered_count", 0)
                },
                "synthesis": {
                    "duration_ms": synthesis_ms,
                    "reasoning_effort": state.get("reasoning_effort", "medium"),
                    "dip_tables_sent": len(state["dip_results"]),
                    "dip_entries_sent": sum(r.get('count', 0) for r in state["dip_results"]),
                    "pinecone_chunks_sent": len((state.get("pinecone_results") or {}).get("matches", [])),
                    "equipment_context": [
                        {
                            "manufacturer": eq.get("manufacturer", ""),
                            "model": eq.get("model", ""),
                            "rank": eq.get("rank", 0)
                        }
                        for eq in systems_context[:7]  # Top 7 equipment
                    ],
                    "token_usage": state.get("synthesis_token_usage", {}),
                    "model_used": state.get("synthesis_model_used", "unknown")
                },
                "perplexity": {
                    "duration_ms": perplexity_ms,
                    "enabled": os.getenv("PERPLEXITY_ENABLED", "false").lower() == "true",
                    "citations_count": len(state.get("perplexity_citations", []))
                },
                "assembly": {
                    "duration_ms": assembly_ms
                }
            }

            # Add Pinecone chunk details with relevance scores - show ALL matches
            if state.get("pinecone_results", {}):
                # Use all_matches if available (contains unfiltered results), otherwise fall back to matches
                all_chunks = state["pinecone_results"].get("all_matches", state["pinecone_results"].get("matches", []))

                # Add ALL chunks to show both used and unused
                for match in all_chunks[:10]:  # Limit to top 10
                    detailed_metrics["pinecone"]["chunks"].append({
                        "score": match.get("score", 0),
                        "content_preview": str(match.get("metadata", {}).get("text", ""))[:100],
                        "doc_type": match.get("metadata", {}).get("doc_type", "unknown")
                    })

            # Debug: Log timing summary
            logger.info("📊 TIMING SUMMARY:")
            logger.info(f"  - Total processing: {processing_time}ms")
            logger.info(f"  - Total measured: {total_measured}ms")
            logger.info(f"  - Unmeasured gap: {processing_time - total_measured}ms")
            logger.info("📊 BREAKDOWN:")
            logger.info(f"  - Classification: {classification_ms}ms")
            logger.info(f"  - DIP retrieval: {dip_ms}ms")
            logger.info(f"  - Pinecone search: {pinecone_ms}ms")
            logger.info(f"  - Chunk ranking: {ranking_ms}ms")
            logger.info(f"  - Synthesis: {synthesis_ms}ms")
            logger.info(f"  - Perplexity: {perplexity_ms}ms")
            logger.info(f"  - Assembly: {assembly_ms}ms")

            result = {
                "response": state["final_response"],
                "classification": state["classification"],
                "sources": self._format_sources(state),
                "score": state["response_score"],
                "processing_time_ms": processing_time,
                "detailed_metrics": detailed_metrics,  # NEW: Comprehensive metrics
                "metadata": {
                    "workflow": "sequential",  # Changed from "langgraph"
                    "processing_steps": state["processing_steps"],
                    "equipment_found": len(systems_context),
                    "dip_tables_queried": len(state["dip_results"]),
                    "total_results": sum(r.get('count', 0) for r in state["dip_results"])
                }
            }

            chat_debug.step('PROCESS_CHAT_COMPLETE', {
                'total_duration_ms': processing_time,
                'response_length': len(result["response"]),
                'sources_count': len(result["sources"]),
                'workflow': 'sequential'
            })

            # Final debug log
            logger.info(f"🎯 FINAL RESULT - Returning result with detailed_metrics: {bool(result.get('detailed_metrics'))}")
            logger.info(f"  - Result keys: {list(result.keys())}")

            return result

        except Exception as e:
            chat_debug.error('PROCESS_CHAT_EXCEPTION', e, {
                'query': user_query[:100],
                'thread_id': thread_id
            })
            logger.error(f"Sequential workflow failed: {e}", exc_info=True)
            return await self._fallback_processing(user_query, systems_context, thread_id)

    async def process_chat_streaming(
        self,
        user_query: str,
        systems_context: List[Dict[str, Any]],
        thread_id: Optional[str] = None,
        conversation_summary: Optional[str] = None,
        memory_context: Optional[Dict[str, Any]] = None,
        synthesis_model: Optional[str] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Streaming version of process_chat - yields events as they complete.

        Events:
        - synthesis: When OpenAI response is ready (~5s)
        - perplexity: When Perplexity response is ready (~10s)
        - done: Final metrics
        """
        start_time = datetime.now()

        logger.info("🚀 STREAMING WORKFLOW - process_chat_streaming() called")
        logger.info(f"  - Query: {user_query[:100]}")

        try:
            # Initialize state (same as process_chat)
            state = {
                "user_query": user_query,
                "thread_id": thread_id,
                "systems_context": systems_context,
                "conversation_summary": conversation_summary,
                "memory_context": memory_context,
                "synthesis_model": synthesis_model,
                "classification": None,
                "primary_equipment": None,
                "secondary_equipment": [],
                "dip_results": [],
                "pinecone_results": None,
                "final_response": None,
                "response_score": None,
                "processing_steps": [],
                "start_time": start_time,
                "error": None
            }

            # STEP 1: Classification (same as process_chat)
            step_start = datetime.now()
            state = await self._classify_query(state)
            state["classification_duration_ms"] = int((datetime.now() - step_start).total_seconds() * 1000)

            if state.get("error"):
                yield {"event": "error", "error": state["error"]}
                return

            # STEP 2: Data Retrieval (same as process_chat)
            step_start = datetime.now()
            state = await self._retrieve_data(state)
            state["data_retrieval_duration_ms"] = int((datetime.now() - step_start).total_seconds() * 1000)

            # STEP 3: STREAMING - Start both tasks but yield synthesis first
            logger.info("📌 STREAMING STEP 3: Starting parallel tasks (will yield synthesis first)")

            openai_task = asyncio.create_task(self._synthesize_response(state))
            perplexity_task = asyncio.create_task(self._query_perplexity(state))

            # Wait for synthesis first, yield immediately when ready
            openai_result = await openai_task
            synthesis_time = int((datetime.now() - start_time).total_seconds() * 1000)

            if isinstance(openai_result, dict) and openai_result.get("final_response"):
                logger.info(f"✅ STREAMING: Synthesis ready at {synthesis_time}ms - yielding immediately")

                # Format sources from state
                sources = self._format_sources(openai_result)

                yield {
                    "event": "synthesis",
                    "response": openai_result["final_response"],
                    "sources": sources,
                    "classification": state["classification"],
                    "thread_id": thread_id,
                    "synthesis_time_ms": synthesis_time
                }
            else:
                logger.warning("⚠️  STREAMING: Synthesis failed or empty")
                yield {
                    "event": "synthesis",
                    "response": "I encountered an issue processing your request.",
                    "sources": [],
                    "classification": state.get("classification"),
                    "thread_id": thread_id,
                    "synthesis_time_ms": synthesis_time
                }

            # Now wait for Perplexity (user already has synthesis displayed)
            perplexity_result = await perplexity_task
            perplexity_time = int((datetime.now() - start_time).total_seconds() * 1000)

            if perplexity_result and not isinstance(perplexity_result, Exception):
                if not perplexity_result.get("skipped"):
                    logger.info(f"✅ STREAMING: Perplexity ready at {perplexity_time}ms - yielding")
                    yield {
                        "event": "perplexity",
                        "answer": perplexity_result.get("answer", ""),
                        "citations": perplexity_result.get("citations", []),
                        "perplexity_time_ms": perplexity_time
                    }
                else:
                    logger.info(f"⏭️  STREAMING: Perplexity skipped - {perplexity_result.get('reason', 'unknown')}")

            # Final done event with FULL metrics (same structure as non-streaming)
            processing_time = int((datetime.now() - start_time).total_seconds() * 1000)

            # Collect timing values
            classification_ms = state.get("classification_duration_ms", 0)
            dip_ms = state.get("dip_duration_ms", 0)
            pinecone_ms = state.get("pinecone_duration_ms", 0)
            ranking_ms = state.get("pinecone_complexity_filtering", {}).get("ranking_duration_ms", 0)
            synthesis_ms = openai_result.get("synthesis_duration_ms", 0) if isinstance(openai_result, dict) else 0
            perplexity_ms = perplexity_result.get("duration_ms", 0) if perplexity_result and not isinstance(perplexity_result, Exception) else 0

            total_measured = classification_ms + dip_ms + pinecone_ms + ranking_ms + synthesis_ms + perplexity_ms

            # Build full detailed_metrics structure
            detailed_metrics = {
                "timing_summary": {
                    "total_processing_ms": processing_time,
                    "total_measured_ms": total_measured,
                    "unmeasured_ms": processing_time - total_measured,
                    "breakdown": {
                        "classification_ms": classification_ms,
                        "dip_retrieval_ms": dip_ms,
                        "pinecone_search_ms": pinecone_ms,
                        "chunk_ranking_ms": ranking_ms,
                        "synthesis_ms": synthesis_ms,
                        "perplexity_ms": perplexity_ms,
                        "assembly_ms": 0
                    }
                },
                "classification": {
                    "duration_ms": classification_ms,
                    "intent": state.get("classification", {}).get("intent", "unknown"),
                    "confidence": state.get("classification", {}).get("confidence", 0),
                    "complexity_score": state.get("classification", {}).get("complexity_score", 0),
                    "complexity": state.get("classification", {}).get("complexity", "unknown"),
                    "table_types_needed": state.get("classification", {}).get("table_types_needed", []),
                    "primary_equipment_index": state.get("classification", {}).get("primary_equipment_index")
                },
                "dip_retrieval": {
                    "duration_ms": dip_ms,
                    "tables_queried": len(state.get("dip_results", [])),
                    "total_entries": sum(r.get('count', 0) for r in state.get("dip_results", []))
                },
                "pinecone": {
                    "duration_ms": pinecone_ms,
                    "total_matches": (state.get("pinecone_results") or {}).get("total_matches", 0),
                    "filtered_matches": (state.get("pinecone_results") or {}).get("filtered_matches", 0),
                    "chunks": [],
                    "metadata_filter_used": (state.get("pinecone_results") or {}).get("metadata_filter_used", False),
                    "complexity_based_filtering": state.get("pinecone_complexity_filtering", {})
                },
                "chunk_ranking": {
                    "duration_ms": ranking_ms,
                    "original_count": state.get("pinecone_complexity_filtering", {}).get("original_count", 0),
                    "filtered_count": state.get("pinecone_complexity_filtering", {}).get("filtered_count", 0)
                },
                "synthesis": {
                    "duration_ms": synthesis_ms,
                    "reasoning_effort": state.get("reasoning_effort", "medium"),
                    "dip_tables_sent": len(state.get("dip_results", [])),
                    "dip_entries_sent": sum(r.get('count', 0) for r in state.get("dip_results", [])),
                    "pinecone_chunks_sent": len((state.get("pinecone_results") or {}).get("matches", [])),
                    "equipment_context": [
                        {"manufacturer": eq.get("manufacturer", ""), "model": eq.get("model", ""), "rank": eq.get("rank", 0)}
                        for eq in state.get("systems_context", [])[:7]
                    ],
                    "token_usage": state.get("synthesis_token_usage", {}),
                    "model_used": state.get("synthesis_model_used", state.get("synthesis_model", "unknown"))
                },
                "perplexity": {
                    "duration_ms": perplexity_ms,
                    "enabled": os.getenv("PERPLEXITY_ENABLED", "false").lower() == "true",
                    "citations_count": len(perplexity_result.get("citations", [])) if perplexity_result and not isinstance(perplexity_result, Exception) else 0
                },
                "assembly": {
                    "duration_ms": 0
                }
            }

            # Add Pinecone chunk details
            if state.get("pinecone_results"):
                all_chunks = state["pinecone_results"].get("all_matches", state["pinecone_results"].get("matches", []))
                for match in all_chunks[:10]:
                    detailed_metrics["pinecone"]["chunks"].append({
                        "score": match.get("score", 0),
                        "content_preview": str(match.get("metadata", {}).get("text", ""))[:100],
                        "doc_type": match.get("metadata", {}).get("doc_type", "unknown")
                    })

            yield {
                "event": "done",
                "processing_time_ms": processing_time,
                "detailed_metrics": detailed_metrics
            }

            logger.info(f"🎯 STREAMING COMPLETE - Total time: {processing_time}ms")

        except Exception as e:
            logger.error(f"Streaming workflow failed: {e}", exc_info=True)
            yield {"event": "error", "error": str(e)}

    # ========== STEP 1: QUERY CLASSIFICATION ==========
    async def _classify_query(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Classify user query and analyze equipment context
        INTELLIGENCE: LLM-powered intent detection and keyword extraction
        """
        try:
            state["processing_steps"].append("query_classification")

            chat_debug.workflow_node('classify_query', {
                'query': state["user_query"][:100],
                'equipment_count': len(state["systems_context"])
            })

            llm_start = datetime.now()

            # Use LLM to classify the query
            classification = await self.llm_service.classify_query(
                user_query=state["user_query"],
                systems_context=state["systems_context"]
            )

            llm_duration = (datetime.now() - llm_start).total_seconds() * 1000

            chat_debug.llm_call(
                model='classification',
                duration_ms=llm_duration,
                metadata={
                    'intent': classification.get('intent', 'unknown'),
                    'confidence': classification.get('confidence', 0),
                    'keywords_extracted': len(classification.get('search_keywords', []))
                }
            )

            # Store timing for detailed metrics
            state["classification_duration_ms"] = int(llm_duration)
            state["classification"] = classification

            # Determine primary and secondary equipment based on LLM analysis
            if state["systems_context"]:
                if classification.get("primary_equipment_index") is not None:
                    idx = classification["primary_equipment_index"]
                    # Handle both single int and array formats (LLM may return array for multi-equipment)
                    if isinstance(idx, list):
                        idx = idx[0] if idx else None
                    if idx is not None and 0 <= idx < len(state["systems_context"]):
                        state["primary_equipment"] = state["systems_context"][idx]
                        state["secondary_equipment"] = [
                            eq for i, eq in enumerate(state["systems_context"]) if i != idx
                        ]
                else:
                    # Default to highest ranked equipment
                    sorted_equipment = sorted(
                        state["systems_context"],
                        key=lambda x: x.get('rank', 0),
                        reverse=True
                    )
                    state["primary_equipment"] = sorted_equipment[0] if sorted_equipment else None
                    state["secondary_equipment"] = sorted_equipment[1:] if len(sorted_equipment) > 1 else []

            chat_debug.transform('equipment_classification',
                f"{len(state['systems_context'])} equipment",
                f"primary={(state.get('primary_equipment') or {}).get('model', 'none')}, secondary={len(state['secondary_equipment'])}"
            )

            logger.debug(f"Query classified: {classification.get('intent', 'unknown')}")

        except Exception as e:
            chat_debug.error('classify_query', e, {'query': state["user_query"][:100]})
            logger.error(f"Query classification failed: {e}", exc_info=True)
            state["error"] = f"Classification failed: {str(e)}"

        return state

    # ========== STEP 2: DATA RETRIEVAL ==========
    async def _retrieve_data(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Retrieve data from DIP tables and Pinecone
        INTELLIGENCE: Uses classified keywords, enhanced Pinecone search with equipment emphasis
        """
        try:
            state["processing_steps"].append("data_retrieval")

            chat_debug.workflow_node('retrieve_data', {
                'primary_equipment': (state.get('primary_equipment') or {}).get('model', 'none'),
                'classification_intent': (state.get('classification') or {}).get('intent', 'unknown')
            })

            # Determine table types based on classification
            classification = state.get("classification", {})
            table_types = classification.get("table_types_needed", ["spec", "routing"])

            # Query DIP tables for all equipment (prioritizing primary)
            equipment_to_query = []
            if state["primary_equipment"]:
                equipment_to_query.append(state["primary_equipment"])
            equipment_to_query.extend(state["secondary_equipment"])

            all_dip_results = []
            dip_start = datetime.now()

            for equipment in equipment_to_query:
                asset_uid = equipment.get("asset_uid")
                if not asset_uid:
                    continue

                # Create focused systems context for this equipment
                focused_context = [equipment]

                # INTELLIGENCE: Extract search keywords from classification
                search_query = state["user_query"]
                used_keywords = False
                if "classification" in state and state["classification"]:
                    keywords = state["classification"].get("search_keywords", [])
                    if keywords:
                        search_query = " ".join(keywords)
                        used_keywords = True

                equipment_name = f"{equipment.get('manufacturer', '')} {equipment.get('model', '')}".strip()

                chat_debug.step('DIP_SEARCH', {
                    'search_query': search_query,
                    'used_keywords': used_keywords,
                    'equipment': equipment_name,
                    'original_query': state['user_query']
                })

                logger.info(
                    f"🔍 DIP Search Query: '{search_query}' "
                    f"(keywords={used_keywords}, equipment={equipment_name}, original='{state['user_query']}')"
                )

                # Query DIP tables
                if hasattr(self.dip_retriever, 'query_production_dip_tables'):
                    equipment_results = await self.dip_retriever.query_production_dip_tables(
                        query=search_query,
                        table_types=table_types,
                        systems_context=focused_context
                    )
                else:
                    equipment_results = await self.dip_retriever.query_dip_tables(
                        query=search_query,
                        table_types=table_types,
                        systems_context=focused_context
                    )

                # Add equipment context to results
                for result in equipment_results:
                    result["equipment"] = equipment
                    all_dip_results.append(result)

                chat_debug.step('DIP_RESULTS', {
                    'equipment': equipment_name,
                    'results_count': len(equipment_results),
                    'total_entries': sum(r.get('count', 0) for r in equipment_results)
                })

            state["dip_results"] = all_dip_results
            state["dip_duration_ms"] = int((datetime.now() - dip_start).total_seconds() * 1000)

            # INTELLIGENCE: Enhanced Pinecone semantic search
            pinecone_query = state["user_query"]
            if "classification" in state and state["classification"]:
                keywords = state["classification"].get("search_keywords", [])
                if keywords:
                    pinecone_query = " ".join(keywords)

            pinecone_start = datetime.now()
            pinecone_results = await self._query_pinecone_for_equipment(
                query=pinecone_query,
                equipment_context=state["systems_context"],
                original_query=state["user_query"],
                complexity_score=state["classification"].get("complexity_score", 0.5)
            )
            pinecone_duration = (datetime.now() - pinecone_start).total_seconds() * 1000

            # Store Pinecone timing for detailed metrics
            state["pinecone_duration_ms"] = int(pinecone_duration)
            state["pinecone_results"] = pinecone_results

            # Store metadata filter info for metrics
            if pinecone_results:
                state["pinecone_results"]["metadata_filter_used"] = bool(pinecone_results.get("metadata_filter"))

            chat_debug.timing('pinecone_search', pinecone_duration, {
                'success': pinecone_results.get('success', False) if pinecone_results else False,
                'matches_count': pinecone_results.get('match_count', 0) if pinecone_results else 0
            })

            # Filter Pinecone chunks based on query complexity
            if pinecone_results and pinecone_results.get('success') and pinecone_results.get('matches'):
                complexity_score = state["classification"].get("complexity_score", 0.5)
                original_count = len(pinecone_results['matches'])

                ranking_start = datetime.now()

                # Store ALL matches before filtering for metrics display
                all_matches = pinecone_results['matches'].copy()

                filtered_matches = await self.llm_service.rank_chunks(
                    user_query=state["user_query"],
                    chunks=pinecone_results['matches'],
                    complexity_score=complexity_score
                )
                ranking_duration = (datetime.now() - ranking_start).total_seconds() * 1000

                # Update pinecone_results with filtered chunks
                pinecone_results['all_matches'] = all_matches  # Store original matches
                pinecone_results['matches'] = filtered_matches
                pinecone_results['match_count'] = len(filtered_matches)
                pinecone_results['filtered_matches'] = len(filtered_matches)
                pinecone_results['total_matches'] = len(all_matches)  # Update total count
                state["pinecone_results"] = pinecone_results

                # Store complexity filtering info for metrics
                state["pinecone_complexity_filtering"] = {
                    "original_count": original_count,
                    "filtered_count": len(filtered_matches),
                    "complexity_score": complexity_score,
                    "ranking_duration_ms": int(ranking_duration)
                }

                chat_debug.timing('chunk_ranking', ranking_duration, {
                    'original_count': original_count,
                    'filtered_count': len(filtered_matches),
                    'complexity_score': complexity_score
                })

            logger.debug(f"Retrieved data from {len(all_dip_results)} DIP table(s)")

        except Exception as e:
            chat_debug.error('retrieve_data', e, {'query': state["user_query"][:100]})
            logger.error(f"Data retrieval failed: {e}", exc_info=True)
            state["error"] = f"Retrieval failed: {str(e)}"

        return state

    # ========== STEP 3: RESPONSE SYNTHESIS ==========
    async def _synthesize_response(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Synthesize natural language response from retrieved data
        INTELLIGENCE: LLM-powered synthesis with personality and formatting
        """
        try:
            state["processing_steps"].append("response_synthesis")

            chat_debug.workflow_node('synthesize_response', {
                'dip_results_count': len(state.get('dip_results', [])),
                'pinecone_matches': (state.get('pinecone_results') or {}).get('match_count', 0),
                'has_conversation_summary': bool(state.get('conversation_summary'))
            })

            llm_start = datetime.now()

            # Determine actual model that will be used (for metrics)
            synthesis_model_used = state.get("synthesis_model") or self.llm_service.openai_model
            state["synthesis_model_used"] = synthesis_model_used

            # Determine reasoning_effort/temperature for metrics display
            complexity_score = (state.get("classification") or {}).get("complexity_score", 0.5)
            if "gpt-5" in synthesis_model_used.lower():
                # GPT-5.1: Show temperature (no reasoning_effort used)
                state["reasoning_effort"] = "temp=1"
            elif "gpt-4.1-mini" in synthesis_model_used.lower():
                # GPT-4.1-mini: Show temperature
                state["reasoning_effort"] = f"temp={os.getenv('OPENAI_TEMPERATURE', '0')}"
            else:
                # Other models: Show default
                state["reasoning_effort"] = "-"

            # Use LLM to generate natural response
            response = await self.llm_service.synthesize_response(
                user_query=state["user_query"],
                systems_context=state["systems_context"],
                classification=state["classification"],
                dip_results=state["dip_results"],
                pinecone_results=state["pinecone_results"],
                conversation_summary=state.get("conversation_summary"),
                synthesis_model=state.get("synthesis_model")
            )

            llm_duration = (datetime.now() - llm_start).total_seconds() * 1000

            # Store synthesis timing for detailed metrics
            state["synthesis_duration_ms"] = int(llm_duration)
            state["final_response"] = response

            chat_debug.llm_call(
                model='synthesis',
                duration_ms=llm_duration,
                metadata={
                    'response_length': len(response),
                    'sources_used': len(state["dip_results"])
                }
            )

            logger.debug("Response synthesized successfully")

        except Exception as e:
            chat_debug.error('synthesize_response', e, {'query': state["user_query"][:100]})
            logger.error(f"Response synthesis failed: {e}", exc_info=True)
            state["error"] = f"Synthesis failed: {str(e)}"
            # Fallback response
            state["final_response"] = self._generate_fallback_response(state)

        return state

    # ========== STEP 4: RESPONSE SCORING ==========
    async def _score_response(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """
        Score response quality and confidence
        INTELLIGENCE: LLM-powered quality metrics
        DISABLED: Too slow for production use
        """
        # SCORING DISABLED - skip entirely
        return state

        try:
            state["processing_steps"].append("response_scoring")

            chat_debug.workflow_node('score_response', {
                'response_length': len(state.get('final_response', ''))
            })

            llm_start = datetime.now()

            # Use LLM to score the response
            score = await self.llm_service.score_response(
                user_query=state["user_query"],
                response=state["final_response"],
                dip_results=state["dip_results"],
                systems_context=state["systems_context"]
            )

            llm_duration = (datetime.now() - llm_start).total_seconds() * 1000

            state["response_score"] = score

            chat_debug.llm_call(
                model='scoring',
                duration_ms=llm_duration,
                metadata={
                    'confidence': score.get('confidence', 'unknown'),
                    'total_score': score.get('total_score', 0)
                }
            )

            logger.debug(f"Response scored: {score.get('confidence', 'unknown')} confidence")

        except Exception as e:
            chat_debug.error('score_response', e, {'query': state["user_query"][:100]})
            logger.error(f"Response scoring failed: {e}", exc_info=True)
            # Continue without scoring

        return state

    # ========== PERPLEXITY INTEGRATION ==========
    async def _query_perplexity(self, state: Dict[str, Any]) -> Optional[Dict]:
        """
        Query Perplexity for real-world troubleshooting insights

        Returns None if disabled, API key missing, or on failure.
        All failures are graceful (no exceptions propagate).
        """
        # Check if enabled via feature flag
        if not os.getenv("PERPLEXITY_ENABLED", "false").lower() == "true":
            logger.info("⏭️  Perplexity disabled via PERPLEXITY_ENABLED flag, skipping")
            return None

        # Check if API key exists
        api_key = os.getenv("PERPLEXITY_API_KEY")
        if not api_key:
            logger.warning("⚠️  PERPLEXITY_API_KEY not set, skipping Perplexity search")
            return None

        try:
            # Initialize service
            timeout = int(os.getenv("PERPLEXITY_TIMEOUT", "45"))
            model = os.getenv("PERPLEXITY_MODEL", "sonar-pro")

            service = PerplexityService(
                api_key=api_key,
                model=model,
                timeout=timeout
            )

            # Build enhanced query from state
            enhanced_query = service.build_enhanced_query(
                user_query=state.get("user_query", ""),
                equipment=state.get("systems_context", []),
                pinecone_chunks=state.get("pinecone_results", {}).get("matches", []),
                system_context={
                    "vessel_type": "Balance 526 catamaran"
                },
                intent=state.get("classification", {}).get("intent", "general_information")
            )

            logger.info(f"🌐 Perplexity enhanced query: {enhanced_query}")

            # Query Perplexity API
            start_time = datetime.now()
            result = await service.query(enhanced_query)
            duration = (datetime.now() - start_time).total_seconds() * 1000

            if result:
                logger.info(f"✅ Perplexity success: {len(result['citations'])} citations in {duration:.0f}ms")
                result["duration_ms"] = int(duration)
                return result
            else:
                logger.warning("⚠️  Perplexity returned no results")
                return {"duration_ms": int(duration), "skipped": True, "reason": "no_results"}

        except Exception as e:
            logger.error(f"❌ Perplexity error: {str(e)}")
            return {"duration_ms": 0, "skipped": True, "reason": str(e)}

    async def _assemble_response(
        self,
        openai_result: Any,
        perplexity_result: Any,
        state: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Assemble final response from OpenAI + Perplexity

        Handles 4 cases:
        1. Both succeeded → Combine responses
        2. Only OpenAI succeeded → Use OpenAI only
        3. Only Perplexity succeeded → Use Perplexity only
        4. Both failed → Fallback message
        """
        # Handle exceptions from asyncio.gather(return_exceptions=True)
        if isinstance(openai_result, Exception):
            logger.error(f"OpenAI failed: {openai_result}")
            openai_result = None
        elif isinstance(openai_result, dict):
            # OpenAI returns state dict, extract response
            openai_response = openai_result.get("final_response")
            openai_metrics = {
                "duration_ms": openai_result.get("synthesis_duration_ms", 0),
                "model_used": openai_result.get("synthesis_model_used", "unknown"),
                "reasoning_effort": openai_result.get("reasoning_effort", "unknown")
            }
        else:
            openai_response = None
            openai_metrics = {}

        if isinstance(perplexity_result, Exception):
            logger.error(f"Perplexity failed: {perplexity_result}")
            state["perplexity_duration_ms"] = 0
            perplexity_result = None
        elif perplexity_result:
            state["perplexity_duration_ms"] = perplexity_result.get("duration_ms", 0)
        else:
            state["perplexity_duration_ms"] = 0

        # CASE 1: Both succeeded (ideal case)
        if openai_response and perplexity_result:
            logger.info("✅ Both OpenAI and Perplexity succeeded")

            # Append Perplexity section with actual answer
            perplexity_answer = perplexity_result.get("answer", "")
            perplexity_section = (
                "\n\n───────────────────────────────\n\n"
                "💡 **Real-World Resources from Boat Owners**\n\n"
                f"{perplexity_answer}\n\n"
                "───────────────────────────────\n\n"
                "*(View citations in sources below)*"
            )

            state["final_response"] = openai_response + perplexity_section
            state["perplexity_citations"] = perplexity_result.get("citations", [])
            state["perplexity_metrics"] = {
                "citations": len(perplexity_result.get("citations", [])),
                "model": perplexity_result.get("model", ""),
                "usage": perplexity_result.get("usage", {})
            }

            return state

        # CASE 2: Only OpenAI succeeded (Perplexity failed/disabled)
        elif openai_response:
            logger.warning("⚠️  Using OpenAI only (Perplexity failed or disabled)")
            state["final_response"] = openai_response
            state["perplexity_citations"] = []
            return state

        # CASE 3: Only Perplexity succeeded (OpenAI failed)
        elif perplexity_result:
            logger.warning("⚠️  Using Perplexity only (OpenAI failed)")
            state["final_response"] = perplexity_result.get("answer", "")
            state["perplexity_citations"] = perplexity_result.get("citations", [])
            state["perplexity_metrics"] = {
                "citations": len(perplexity_result.get("citations", [])),
                "model": perplexity_result.get("model", ""),
                "usage": perplexity_result.get("usage", {})
            }
            return state

        # CASE 4: Both failed (fallback message)
        else:
            logger.error("❌ Both OpenAI and Perplexity failed - using fallback")
            state["final_response"] = (
                "I apologize, but I'm having trouble processing your request "
                "right now. Please try again in a moment, or contact support "
                "if the issue persists."
            )
            state["perplexity_citations"] = []
            return state

    # ========== HELPER METHODS (Keep from original) ==========

    def _format_sources(self, state: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Format DIP results, Pinecone chunks, AND Perplexity citations for API response"""
        sources = []

        # Add DIP table sources
        dip_results = state.get("dip_results", [])
        for result in dip_results:
            sources.append({
                'type': result.get('table_type', 'unknown'),
                'count': result.get('count', 0),
                'equipment': result.get('equipment', {}),
                'data': result.get('results', [])[:3]  # Limit to top 3
            })

        # Add Pinecone chunks as a source
        pinecone_results = state.get("pinecone_results", {})
        if pinecone_results and pinecone_results.get("matches"):
            matches = pinecone_results["matches"]
            sources.append({
                'type': 'PINECONE',
                'count': len(matches),
                'equipment': {
                    'names': pinecone_results.get('equipment_context', [])
                },
                'data': [{
                    'score': m.get('score', 0),
                    'manufacturer': m.get('metadata', {}).get('manufacturer', ''),
                    'model': m.get('metadata', {}).get('model', ''),
                    'doc_type': m.get('metadata', {}).get('doc_type', 'unknown'),
                    'text_preview': str(m.get('metadata', {}).get('text', ''))[:100]
                } for m in matches[:3]]  # Limit to top 3
            })

        # Add Perplexity citations as a source
        perplexity_citations = state.get("perplexity_citations", [])
        if perplexity_citations and len(perplexity_citations) > 0:
            sources.append({
                'type': 'PERPLEXITY',
                'count': len(perplexity_citations),
                'equipment': {},  # Not equipment-specific
                'data': [
                    {'url': url} for url in perplexity_citations
                ]
            })

        return sources

    def _generate_fallback_response(self, state: Dict[str, Any]) -> str:
        """Generate fallback response when synthesis fails"""
        dip_count = len(state["dip_results"])
        total_results = sum(r.get('count', 0) for r in state["dip_results"])

        if dip_count > 0:
            equipment_names = []
            if state["primary_equipment"]:
                equipment_names.append(
                    f"{state['primary_equipment'].get('manufacturer', '')} "
                    f"{state['primary_equipment'].get('model', '')}".strip()
                )

            equipment_context = f" for your {equipment_names[0]}" if equipment_names else ""

            return (f"I found {total_results} relevant entries in {dip_count} table(s){equipment_context}. "
                   f"The information includes technical specifications and procedures.")
        else:
            return f"I couldn't find specific information for '{state['user_query']}' in the available data sources."

    async def _fallback_processing(self, user_query: str, systems_context: List[Dict[str, Any]],
                                  thread_id: Optional[str]) -> Dict[str, Any]:
        """Fallback processing when workflow fails"""
        chat_debug.step('FALLBACK_PROCESSING', {
            'query': user_query[:100],
            'thread_id': thread_id
        })

        logger.warning("Using fallback processing - workflow failed")

        try:
            # Simple DIP query
            table_types = ['spec', 'procedure', 'troubleshooting', 'routing']

            if hasattr(self.dip_retriever, 'query_production_dip_tables'):
                dip_results = await self.dip_retriever.query_production_dip_tables(
                    query=user_query,
                    table_types=table_types,
                    systems_context=systems_context
                )
            else:
                dip_results = await self.dip_retriever.query_dip_tables(
                    query=user_query,
                    table_types=table_types,
                    systems_context=systems_context
                )

            # Simple response
            if dip_results:
                response = f"I found information in {len(dip_results)} table(s). (Fallback mode - simplified response)"
            else:
                response = f"I couldn't find information for '{user_query}'. (Fallback mode)"

            return {
                "response": response,
                "classification": None,
                "sources": self._format_sources({"dip_results": dip_results, "pinecone_results": {}}),
                "score": None,
                "processing_time_ms": 0,
                "metadata": {
                    "workflow": "fallback",
                    "dip_tables_queried": len(dip_results),
                    "total_results": sum(r.get('count', 0) for r in dip_results)
                }
            }

        except Exception as e:
            chat_debug.error('fallback_processing', e, {'query': user_query[:100]})
            logger.error(f"Fallback processing failed: {e}", exc_info=True)
            return {
                "response": f"I encountered an error processing your request: {str(e)}",
                "classification": None,
                "sources": [],
                "score": None,
                "processing_time_ms": 0,
                "metadata": {"workflow": "error"}
            }

    async def _query_pinecone_for_equipment(self, query: str, equipment_context: List[Dict[str, Any]],
                                           original_query: str = None, complexity_score: float = 0.5) -> Optional[Dict[str, Any]]:
        """
        INTELLIGENCE: Multi-system Pinecone search with parallel execution

        Searches Pinecone for ALL equipment in context (not just first).
        Each equipment gets its own search with metadata filter.
        Results are combined, deduplicated, ranked, and capped at 20 chunks.
        """
        if not self.pinecone_client:
            chat_debug.step('PINECONE_SKIP', {'reason': 'client_not_available'})
            logger.info("Pinecone client not available, skipping semantic search")
            return None

        try:
            # ===== MULTI-SYSTEM PINECONE SEARCH =====
            logger.info("🔀 Starting MULTI-SYSTEM Pinecone search")
            logger.info(f"  → Equipment count: {len(equipment_context)}")
            logger.info(f"  → Complexity score: {complexity_score}")

            # Adaptive top_k based on query complexity
            top_k_per_system = 100 if complexity_score >= 0.7 else 50

            logger.info(f"  → Top-k per system: {top_k_per_system}")

            # Build equipment list for logging (avoid nested f-string escaping issues)
            equipment_list_str = [f"{eq.get('manufacturer', '')} {eq.get('model', '')}".strip() for eq in equipment_context]
            logger.info(f"  → Equipment list: {equipment_list_str}")

            chat_debug.step('MULTI_SYSTEM_PINECONE_START', {
                'equipment_count': len(equipment_context),
                'complexity_score': complexity_score,
                'top_k_per_system': top_k_per_system
            })

            # Build equipment-aware search query (SAME AS CURRENT)
            equipment_names = []
            for eq in equipment_context:
                manufacturer = eq.get('manufacturer', '')
                model = eq.get('model', '')
                if manufacturer and model:
                    equipment_names.append(f"{manufacturer} {model}")
                elif manufacturer:
                    equipment_names.append(manufacturer)
                elif model:
                    equipment_names.append(model)

            # Build enhanced query with equipment emphasis (SAME AS CURRENT)
            enhanced_query = query
            if equipment_names:
                equipment_emphasis = " ".join([name for name in equipment_names for _ in range(3)])
                enhanced_query = f"{equipment_emphasis} {query} {equipment_emphasis}"

                chat_debug.transform('pinecone_query_enhancement',
                    f"original={query}",
                    f"enhanced={enhanced_query[:100]}..."
                )

            # ===== PARALLEL SEARCH IMPLEMENTATION =====
            async def search_single_equipment(idx: int, eq: Dict[str, Any]):
                """
                Search Pinecone for single equipment with metadata filter
                Returns dict with success, matches, duration, and error info
                """
                equipment_start = datetime.now()
                manufacturer = eq.get('manufacturer', '').strip()
                model = eq.get('model', '').strip()

                logger.info(f"🔍 [PINECONE_SEARCH_{idx+1}] START")
                logger.info(f"  → Manufacturer: {manufacturer}")
                logger.info(f"  → Model: {model}")
                logger.info(f"  → Top-k: {top_k_per_system}")

                # Build metadata filter for THIS equipment (not first, THIS one)
                metadata_filter = {}
                if manufacturer:
                    metadata_filter['manufacturer'] = manufacturer
                if model:
                    metadata_filter['model'] = model

                logger.info(f"  → Metadata filter: {metadata_filter}")

                try:
                    # Search Pinecone with THIS equipment's filter
                    # Use asyncio.to_thread() to run sync call in thread pool for true parallelism
                    search_result = await asyncio.to_thread(
                        self.pinecone_client.search_vectors,
                        query=enhanced_query,
                        top_k=top_k_per_system,
                        include_metadata=True,
                        include_values=False,
                        filter_dict=metadata_filter if metadata_filter else None
                    )

                    duration_ms = (datetime.now() - equipment_start).total_seconds() * 1000

                    if search_result.get("success"):
                        matches = search_result.get("matches", [])
                        logger.info(f"✅ [PINECONE_SEARCH_{idx+1}] SUCCESS")
                        logger.info(f"  → Duration: {duration_ms:.2f}ms")
                        logger.info(f"  → Matches: {len(matches)}")
                        if matches:
                            logger.info(f"  → Score range: {matches[0].get('score', 0):.3f} - {matches[-1].get('score', 0):.3f}")
                        else:
                            logger.info(f"  → No matches")

                        chat_debug.timing(f'pinecone_search_{idx+1}', duration_ms, {
                            'equipment': f"{manufacturer} {model}",
                            'matches': len(matches)
                        })

                        return {
                            'success': True,
                            'equipment_index': idx,
                            'equipment': f"{manufacturer} {model}",
                            'matches': matches,
                            'duration_ms': duration_ms
                        }
                    else:
                        error_msg = search_result.get('error', 'Unknown error')
                        logger.warning(f"⚠️  [PINECONE_SEARCH_{idx+1}] FAILED")
                        logger.warning(f"  → Error: {error_msg}")
                        logger.warning(f"  → Duration: {duration_ms:.2f}ms")

                        return {
                            'success': False,
                            'equipment_index': idx,
                            'equipment': f"{manufacturer} {model}",
                            'error': error_msg,
                            'duration_ms': duration_ms
                        }

                except Exception as e:
                    duration_ms = (datetime.now() - equipment_start).total_seconds() * 1000
                    logger.error(f"❌ [PINECONE_SEARCH_{idx+1}] EXCEPTION")
                    logger.error(f"  → Error: {str(e)}")
                    logger.error(f"  → Duration: {duration_ms:.2f}ms")

                    chat_debug.error(f'pinecone_search_{idx+1}', e, {
                        'equipment': f"{manufacturer} {model}"
                    })

                    return {
                        'success': False,
                        'equipment_index': idx,
                        'equipment': f"{manufacturer} {model}",
                        'error': str(e),
                        'duration_ms': duration_ms
                    }

            # Launch parallel searches for ALL equipment
            search_tasks = [
                search_single_equipment(idx, eq)
                for idx, eq in enumerate(equipment_context)
            ]
            parallel_start = datetime.now()

            logger.info(f"🚀 Launching {len(search_tasks)} parallel Pinecone searches")

            search_results = await asyncio.gather(*search_tasks, return_exceptions=True)

            parallel_duration = (datetime.now() - parallel_start).total_seconds() * 1000

            logger.info(f"✅ Parallel searches COMPLETE")
            logger.info(f"  → Total duration: {parallel_duration:.2f}ms")
            logger.info(f"  → Avg per search: {parallel_duration / len(search_tasks):.2f}ms")

            # ===== COLLECT AND ANALYZE RESULTS =====
            all_matches = []
            search_stats = {
                'total_searches': len(search_results),
                'successful': 0,
                'failed': 0,
                'exceptions': 0,
                'total_matches': 0,
                'per_equipment': []
            }

            for idx, result in enumerate(search_results):
                if isinstance(result, Exception):
                    search_stats['exceptions'] += 1
                    logger.error(f"❌ Search {idx+1} raised exception: {result}")
                    continue

                equipment_stat = {
                    'index': idx,
                    'equipment': result.get('equipment', 'unknown'),
                    'success': result.get('success', False),
                    'matches': 0,
                    'duration_ms': result.get('duration_ms', 0)
                }

                if result.get("success"):
                    search_stats['successful'] += 1
                    matches = result.get("matches", [])
                    equipment_stat['matches'] = len(matches)
                    search_stats['total_matches'] += len(matches)
                    all_matches.extend(matches)

                    logger.info(f"  → Search {idx+1}: {len(matches)} matches ({result.get('equipment')})")
                else:
                    search_stats['failed'] += 1
                    logger.warning(f"  → Search {idx+1}: FAILED ({result.get('equipment')})")

                search_stats['per_equipment'].append(equipment_stat)

            logger.info(f"📊 Search statistics:")
            logger.info(f"  → Successful: {search_stats['successful']}/{search_stats['total_searches']}")
            logger.info(f"  → Failed: {search_stats['failed']}")
            logger.info(f"  → Exceptions: {search_stats['exceptions']}")
            logger.info(f"  → Total matches (before filter): {search_stats['total_matches']}")

            # ===== THRESHOLD FILTERING =====
            threshold = 0.2
            before_threshold = len(all_matches)
            threshold_filtered = [m for m in all_matches if m.get('score', 0) >= threshold]
            filtered_count = before_threshold - len(threshold_filtered)

            logger.info(f"🔍 Threshold filtering (>= {threshold})")
            logger.info(f"  → Before: {before_threshold}")
            logger.info(f"  → After: {len(threshold_filtered)}")
            logger.info(f"  → Filtered out: {filtered_count}")

            if len(threshold_filtered) > 0:
                scores = [m.get('score', 0) for m in threshold_filtered]
                logger.info(f"  → Score range: {min(scores):.3f} - {max(scores):.3f}")
                logger.info(f"  → Avg score: {sum(scores)/len(scores):.3f}")

            # ===== DEDUPLICATION BY VECTOR ID =====
            seen_ids = set()
            deduped_matches = []
            duplicate_count = 0
            dedup_details = []

            for match in threshold_filtered:
                vector_id = match.get('id')
                if vector_id and vector_id not in seen_ids:
                    seen_ids.add(vector_id)
                    deduped_matches.append(match)
                elif vector_id:
                    duplicate_count += 1
                    dedup_details.append({
                        'vector_id': vector_id,
                        'score': match.get('score', 0),
                        'manufacturer': match.get('metadata', {}).get('manufacturer'),
                        'model': match.get('metadata', {}).get('model')
                    })

            logger.info(f"🔄 Deduplication (by vector ID)")
            logger.info(f"  → Before: {len(threshold_filtered)}")
            logger.info(f"  → After: {len(deduped_matches)}")
            logger.info(f"  → Duplicates removed: {duplicate_count}")

            if duplicate_count > 0 and duplicate_count <= 5:
                logger.debug(f"  → Duplicate details: {dedup_details}")

            # ===== RANKING BY SEMANTIC SCORE =====
            ranked_matches = sorted(deduped_matches, key=lambda m: m.get('score', 0), reverse=True)

            logger.info(f"📊 Ranking (by semantic score)")
            logger.info(f"  → Total ranked: {len(ranked_matches)}")
            if len(ranked_matches) > 0:
                logger.info(f"  → Top score: {ranked_matches[0].get('score', 0):.3f}")
                logger.info(f"  → Bottom score: {ranked_matches[-1].get('score', 0):.3f}")

            # ===== CAP AT 20 CHUNKS =====
            final_matches = ranked_matches[:20]
            capped_count = len(ranked_matches) - len(final_matches)

            logger.info(f"✂️  Final cap (max 20 chunks)")
            logger.info(f"  → Before cap: {len(ranked_matches)}")
            logger.info(f"  → After cap: {len(final_matches)}")
            logger.info(f"  → Capped: {capped_count}")

            # ===== FINAL SUMMARY =====
            logger.info(f"🎯 MULTI-SYSTEM PINECONE COMPLETE")
            logger.info(f"  → Total searches: {search_stats['total_searches']}")
            logger.info(f"  → Successful: {search_stats['successful']}")
            logger.info(f"  → Raw matches: {search_stats['total_matches']}")
            logger.info(f"  → After threshold: {len(threshold_filtered)}")
            logger.info(f"  → After dedup: {len(deduped_matches)}")
            logger.info(f"  → Final chunks: {len(final_matches)}")
            logger.info(f"  → Total duration: {parallel_duration:.2f}ms")

            chat_debug.step('MULTI_SYSTEM_PINECONE_COMPLETE', {
                'total_searches': search_stats['total_searches'],
                'successful_searches': search_stats['successful'],
                'final_chunks': len(final_matches),
                'duration_ms': parallel_duration
            })

            # ===== RETURN RESULT =====
            return {
                "success": True,
                "matches": final_matches,
                "enhanced_query": enhanced_query,
                "equipment_context": equipment_names,
                "match_count": len(final_matches),
                "metadata_filter": "multi_system",  # Indicate we searched multiple systems
                "threshold": threshold,
                "total_matches": search_stats['total_matches'],
                "searches_performed": search_stats['total_searches'],
                "successful_searches": search_stats['successful'],
                "after_threshold": len(threshold_filtered),
                "after_dedup": len(deduped_matches)
            }

        except Exception as e:
            chat_debug.error('pinecone_query', e, {'query': query})
            logger.error(f"Pinecone query failed: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "enhanced_query": query
            }
