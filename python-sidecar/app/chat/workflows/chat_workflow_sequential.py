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

from typing import Dict, Any, List, Optional
from datetime import datetime
import logging
import os

from ..debug_logger import chat_debug

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
                          memory_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Process chat query through sequential workflow

        Args:
            user_query: User's conversational query
            systems_context: Equipment found by Node.js systems search
            thread_id: Optional thread ID
            conversation_summary: Weighted conversation summary from Node.js
            memory_context: Memory context with weights and equipment transitions

        Returns:
            Dict with response, sources, metadata, etc.
        """
        start_time = datetime.now()

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
            step_start = datetime.now()
            state = await self._classify_query(state)
            step_duration = (datetime.now() - step_start).total_seconds() * 1000
            chat_debug.timing('classify_query', step_duration, {
                'intent': state.get('classification', {}).get('intent', 'unknown'),
                'confidence': state.get('classification', {}).get('confidence', 0)
            })

            if state.get("error"):
                chat_debug.error('CLASSIFY_QUERY_FAILED', Exception(state["error"]), {
                    'query': user_query[:100]
                })
                return await self._fallback_processing(user_query, systems_context, thread_id)

            # ===== STEP 2: Data Retrieval =====
            step_start = datetime.now()
            state = await self._retrieve_data(state)
            step_duration = (datetime.now() - step_start).total_seconds() * 1000
            chat_debug.timing('retrieve_data', step_duration, {
                'dip_results_count': len(state.get('dip_results', [])),
                'pinecone_success': state.get('pinecone_results', {}).get('success', False)
            })

            if state.get("error"):
                chat_debug.error('RETRIEVE_DATA_FAILED', Exception(state["error"]), {
                    'query': user_query[:100]
                })

            # ===== STEP 3: Response Synthesis =====
            step_start = datetime.now()
            state = await self._synthesize_response(state)
            step_duration = (datetime.now() - step_start).total_seconds() * 1000
            chat_debug.timing('synthesize_response', step_duration, {
                'response_length': len(state.get('final_response', ''))
            })

            if not state.get("final_response"):
                chat_debug.error('SYNTHESIS_FAILED', Exception('No response generated'), {
                    'query': user_query[:100]
                })

            # ===== STEP 4: Response Scoring =====
            step_start = datetime.now()
            state = await self._score_response(state)
            step_duration = (datetime.now() - step_start).total_seconds() * 1000
            chat_debug.timing('score_response', step_duration, {
                'confidence': state.get('response_score', {}).get('confidence', 'unknown')
            })

            # Format response
            processing_time = int((datetime.now() - state["start_time"]).total_seconds() * 1000)

            result = {
                "response": state["final_response"],
                "classification": state["classification"],
                "sources": self._format_sources(state["dip_results"]),
                "score": state["response_score"],
                "processing_time_ms": processing_time,
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

            return result

        except Exception as e:
            chat_debug.error('PROCESS_CHAT_EXCEPTION', e, {
                'query': user_query[:100],
                'thread_id': thread_id
            })
            logger.error(f"Sequential workflow failed: {e}", exc_info=True)
            return await self._fallback_processing(user_query, systems_context, thread_id)

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

            state["classification"] = classification

            # Determine primary and secondary equipment based on LLM analysis
            if state["systems_context"]:
                if classification.get("primary_equipment_index") is not None:
                    idx = classification["primary_equipment_index"]
                    if 0 <= idx < len(state["systems_context"]):
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
                f"primary={state.get('primary_equipment', {}).get('model', 'none')}, secondary={len(state['secondary_equipment'])}"
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
                'primary_equipment': state.get('primary_equipment', {}).get('model', 'none'),
                'classification_intent': state.get('classification', {}).get('intent', 'unknown')
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
                original_query=state["user_query"]
            )
            pinecone_duration = (datetime.now() - pinecone_start).total_seconds() * 1000

            state["pinecone_results"] = pinecone_results

            chat_debug.timing('pinecone_search', pinecone_duration, {
                'success': pinecone_results.get('success', False) if pinecone_results else False,
                'matches_count': pinecone_results.get('match_count', 0) if pinecone_results else 0
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
                'pinecone_matches': state.get('pinecone_results', {}).get('match_count', 0),
                'has_conversation_summary': bool(state.get('conversation_summary'))
            })

            llm_start = datetime.now()

            # Use LLM to generate natural response
            response = await self.llm_service.synthesize_response(
                user_query=state["user_query"],
                systems_context=state["systems_context"],
                classification=state["classification"],
                dip_results=state["dip_results"],
                pinecone_results=state["pinecone_results"],
                conversation_summary=state.get("conversation_summary")
            )

            llm_duration = (datetime.now() - llm_start).total_seconds() * 1000

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
        """
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

    # ========== HELPER METHODS (Keep from original) ==========

    def _format_sources(self, dip_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Format DIP results for API response"""
        sources = []
        for result in dip_results:
            sources.append({
                'type': result.get('table_type', 'unknown'),
                'count': result.get('count', 0),
                'equipment': result.get('equipment', {}),
                'data': result.get('results', [])[:3]  # Limit to top 3
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
                "sources": self._format_sources(dip_results),
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
                                           original_query: str = None) -> Optional[Dict[str, Any]]:
        """
        INTELLIGENCE: Query Pinecone with equipment name repetition for semantic emphasis

        This is a KEY intelligence feature from the original Python workflow.
        Equipment names are repeated 3x to bias results toward specific equipment manuals.
        """
        if not self.pinecone_client:
            chat_debug.step('PINECONE_SKIP', {'reason': 'client_not_available'})
            logger.info("Pinecone client not available, skipping semantic search")
            return None

        try:
            # Build equipment-aware search query and metadata filter
            equipment_names = []
            metadata_filter = None

            for eq in equipment_context:
                manufacturer = eq.get('manufacturer', '')
                model = eq.get('model', '')
                if manufacturer and model:
                    equipment_names.append(f"{manufacturer} {model}")
                elif manufacturer:
                    equipment_names.append(manufacturer)
                elif model:
                    equipment_names.append(model)

            # Build metadata filter for first equipment (most relevant)
            if equipment_context:
                eq = equipment_context[0]
                manufacturer = eq.get('manufacturer', '').strip()
                model = eq.get('model', '').strip()

                if manufacturer or model:
                    metadata_filter = {}
                    if manufacturer:
                        metadata_filter['manufacturer'] = manufacturer
                    if model:
                        metadata_filter['model'] = model

            # INTELLIGENCE: Repeat equipment names 3x for semantic emphasis
            enhanced_query = query
            if equipment_names:
                equipment_emphasis = " ".join([name for name in equipment_names for _ in range(3)])
                enhanced_query = f"{equipment_emphasis} {query} {equipment_emphasis}"

                chat_debug.transform('pinecone_query_enhancement',
                    f"original={query}",
                    f"enhanced={enhanced_query[:100]}..."
                )

            # INTELLIGENCE: Adaptive top_k based on metadata filter
            if metadata_filter:
                top_k = int(os.getenv('PINECONE_TOP_K_FILTERED', '100'))
            else:
                top_k = int(os.getenv('PINECONE_TOP_K', '30'))

            chat_debug.step('PINECONE_SEARCH', {
                'query': query,
                'enhanced_query_length': len(enhanced_query),
                'equipment': equipment_names[0] if equipment_names else 'none',
                'has_metadata_filter': metadata_filter is not None,
                'top_k': top_k
            })

            logger.info(
                f"🔍 Pinecone Search Query: '{query}' "
                f"(keywords={original_query != query if original_query else False}, "
                f"equipment={equipment_names[0] if equipment_names else 'none'}, "
                f"original='{original_query or query}')"
            )

            # Search Pinecone
            search_result = self.pinecone_client.search_vectors(
                query=enhanced_query,
                top_k=top_k,
                include_metadata=True,
                include_values=False,
                filter_dict=metadata_filter
            )

            if search_result.get("success"):
                matches = search_result.get("matches", [])

                # INTELLIGENCE: Adaptive score threshold
                threshold = 0.35 if metadata_filter else 0.5
                filtered_matches = [m for m in matches if m.get('score', 0) >= threshold]

                logger.info(
                    f"🔍 Pinecone Results: {len(matches)} total, {len(filtered_matches)} above threshold {threshold} "
                    f"(metadata_filter={'applied' if metadata_filter else 'none'})"
                )

                chat_debug.step('PINECONE_RESULTS', {
                    'total_matches': len(matches),
                    'filtered_matches': len(filtered_matches),
                    'threshold': threshold,
                    'has_filter': metadata_filter is not None
                })

                return {
                    "success": True,
                    "matches": filtered_matches,
                    "enhanced_query": enhanced_query,
                    "equipment_context": equipment_names,
                    "match_count": len(filtered_matches),
                    "metadata_filter": metadata_filter,
                    "threshold": threshold,
                    "total_matches": len(matches)
                }
            else:
                error_msg = search_result.get('error', 'Unknown error')
                chat_debug.error('pinecone_search', Exception(error_msg), {
                    'query': query
                })
                logger.warning(f"Pinecone search failed: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "enhanced_query": enhanced_query
                }

        except Exception as e:
            chat_debug.error('pinecone_query', e, {'query': query})
            logger.error(f"Pinecone query failed: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e),
                "enhanced_query": query
            }
