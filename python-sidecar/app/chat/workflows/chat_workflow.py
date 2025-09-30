"""
LangGraph workflow for conversational chat with DIP integration

This workflow implements:
1. Query Classification - Understanding user intent and equipment context
2. Multi-Source Retrieval - Querying DIP tables and Pinecone with context
3. Response Synthesis - Generating natural language answers from structured data
4. Response Scoring - Evaluating answer quality and confidence
"""

from typing import Dict, Any, List, Optional, TypedDict
from datetime import datetime
import logging
import os

# LangGraph imports with compatibility check
from ..compatibility import get_langgraph_imports

logger = logging.getLogger(__name__)

class WorkflowState(TypedDict):
    """Extended state for LangGraph workflow"""
    # Input data
    user_query: str
    thread_id: Optional[str]
    systems_context: List[Dict[str, Any]]  # Equipment found by Node.js

    # NEW: Conversation memory
    conversation_summary: Optional[str]
    memory_context: Optional[Dict[str, Any]]

    # Classification results
    classification: Optional[Dict[str, Any]]
    primary_equipment: Optional[Dict[str, Any]]
    secondary_equipment: List[Dict[str, Any]]

    # Retrieval results
    dip_results: List[Dict[str, Any]]
    pinecone_results: Optional[Dict[str, Any]]

    # Response generation
    final_response: Optional[str]
    response_score: Optional[Dict[str, Any]]

    # Workflow metadata
    processing_steps: List[str]
    start_time: Optional[datetime]
    error: Optional[str]


class ChatWorkflow:
    """LangGraph workflow for conversational chat processing"""

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
        self.graph = None

        # Initialize LangGraph
        self._setup_workflow()

    def _setup_workflow(self):
        """Setup LangGraph StateGraph with nodes and edges"""
        try:
            imports = get_langgraph_imports()
            StateGraph = imports['StateGraph']
            START = imports['START']
            END = imports['END']

            # Create the graph
            workflow = StateGraph(WorkflowState)

            # Add nodes
            workflow.add_node("classify_query", self._classify_query_node)
            workflow.add_node("retrieve_data", self._retrieve_data_node)
            workflow.add_node("synthesize_response", self._synthesize_response_node)
            workflow.add_node("score_response", self._score_response_node)

            # Define edges
            workflow.add_edge(START, "classify_query")
            workflow.add_edge("classify_query", "retrieve_data")
            workflow.add_edge("retrieve_data", "synthesize_response")
            workflow.add_edge("synthesize_response", "score_response")
            workflow.add_edge("score_response", END)

            # Compile the graph
            self.graph = workflow.compile()

            logger.info("LangGraph workflow initialized successfully")

        except Exception as e:
            logger.error(f"Failed to setup LangGraph workflow: {e}")
            self.graph = None

    async def process_chat(self,
                          user_query: str,
                          systems_context: List[Dict[str, Any]],
                          thread_id: Optional[str] = None,
                          conversation_summary: Optional[str] = None,
                          memory_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Process chat query through LangGraph workflow with conversation memory

        Args:
            user_query: User's conversational query
            systems_context: Equipment found by Node.js systems search
            thread_id: Optional thread ID
            conversation_summary: Weighted conversation summary from Node.js
            memory_context: Memory context with weights and equipment transitions

        Returns:
            Dict with response, sources, metadata, etc.
        """
        if not self.graph:
            # Fallback to simple processing if LangGraph not available
            return await self._fallback_processing(user_query, systems_context, thread_id)

        try:
            # Initialize state with conversation memory
            initial_state: WorkflowState = {
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
                "start_time": datetime.now(),
                "error": None
            }

            # Run the workflow
            final_state = await self.graph.ainvoke(initial_state)

            # Format response
            processing_time = int((datetime.now() - final_state["start_time"]).total_seconds() * 1000)

            return {
                "response": final_state["final_response"],
                "classification": final_state["classification"],
                "sources": self._format_sources(final_state["dip_results"]),
                "score": final_state["response_score"],
                "processing_time_ms": processing_time,
                "metadata": {
                    "workflow": "langgraph",
                    "processing_steps": final_state["processing_steps"],
                    "equipment_found": len(systems_context),
                    "dip_tables_queried": len(final_state["dip_results"]),
                    "total_results": sum(r.get('count', 0) for r in final_state["dip_results"])
                }
            }

        except Exception as e:
            logger.error(f"LangGraph workflow failed: {e}")
            return await self._fallback_processing(user_query, systems_context, thread_id)

    async def _classify_query_node(self, state: WorkflowState) -> WorkflowState:
        """Node 1: Classify user query and analyze equipment context"""
        try:
            state["processing_steps"].append("query_classification")

            # Use LLM to classify the query
            classification = await self.llm_service.classify_query(
                user_query=state["user_query"],
                systems_context=state["systems_context"]
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

            logger.info(f"Query classified: {classification.get('intent', 'unknown')}")

        except Exception as e:
            logger.error(f"Query classification failed: {e}")
            state["error"] = f"Classification failed: {str(e)}"

        return state

    async def _retrieve_data_node(self, state: WorkflowState) -> WorkflowState:
        """Node 2: Retrieve data from DIP tables and optionally Pinecone"""
        try:
            state["processing_steps"].append("data_retrieval")

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

                # Extract search keywords from classification or fall back to raw query
                search_query = state["user_query"]
                if "classification" in state and state["classification"]:
                    keywords = state["classification"].get("search_keywords", [])
                    if keywords:
                        search_query = " ".join(keywords)
                        logger.info(f"Using extracted keywords for DIP search: {search_query}")

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

            state["dip_results"] = all_dip_results

            # Add Pinecone semantic search for equipment-specific documents
            pinecone_results = await self._query_pinecone_for_equipment(
                query=state["user_query"],
                equipment_context=state["systems_context"]
            )
            state["pinecone_results"] = pinecone_results

            logger.info(f"Retrieved data from {len(all_dip_results)} DIP table(s)")

        except Exception as e:
            logger.error(f"Data retrieval failed: {e}")
            state["error"] = f"Retrieval failed: {str(e)}"

        return state

    async def _synthesize_response_node(self, state: WorkflowState) -> WorkflowState:
        """Node 3: Synthesize natural language response from retrieved data"""
        try:
            state["processing_steps"].append("response_synthesis")

            # Use LLM to generate natural response
            response = await self.llm_service.synthesize_response(
                user_query=state["user_query"],
                systems_context=state["systems_context"],
                classification=state["classification"],
                dip_results=state["dip_results"],
                pinecone_results=state["pinecone_results"],
                conversation_summary=state.get("conversation_summary")
            )

            state["final_response"] = response

            logger.info("Response synthesized successfully")

        except Exception as e:
            logger.error(f"Response synthesis failed: {e}")
            state["error"] = f"Synthesis failed: {str(e)}"
            # Fallback response
            state["final_response"] = self._generate_fallback_response(state)

        return state

    async def _score_response_node(self, state: WorkflowState) -> WorkflowState:
        """Node 4: Score response quality and confidence"""
        try:
            state["processing_steps"].append("response_scoring")

            # Use LLM to score the response
            score = await self.llm_service.score_response(
                user_query=state["user_query"],
                response=state["final_response"],
                dip_results=state["dip_results"],
                systems_context=state["systems_context"]
            )

            state["response_score"] = score

            logger.info(f"Response scored: {score.get('confidence', 'unknown')} confidence")

        except Exception as e:
            logger.error(f"Response scoring failed: {e}")
            # Continue without scoring
            pass

        return state

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

    def _generate_fallback_response(self, state: WorkflowState) -> str:
        """Generate fallback response when synthesis fails"""
        dip_count = len(state["dip_results"])
        total_results = sum(r.get('count', 0) for r in state["dip_results"])

        if dip_count > 0:
            equipment_names = []
            if state["primary_equipment"]:
                equipment_names.append(f"{state['primary_equipment'].get('manufacturer', '')} {state['primary_equipment'].get('model', '')}".strip())

            equipment_context = f" for your {equipment_names[0]}" if equipment_names else ""

            return f"I found {total_results} relevant entries in {dip_count} table(s){equipment_context}. The information includes technical specifications and procedures."
        else:
            return f"I couldn't find specific information for '{state['user_query']}' in the available data sources."

    async def _fallback_processing(self, user_query: str, systems_context: List[Dict[str, Any]],
                                 thread_id: Optional[str]) -> Dict[str, Any]:
        """Fallback processing when LangGraph is not available"""
        logger.warning("Using fallback processing - LangGraph workflow not available")

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
            logger.error(f"Fallback processing failed: {e}")
            return {
                "response": f"I encountered an error processing your request: {str(e)}",
                "classification": None,
                "sources": [],
                "score": None,
                "processing_time_ms": 0,
                "metadata": {"workflow": "error"}
            }

    async def _query_pinecone_for_equipment(self, query: str, equipment_context: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """
        Query Pinecone for equipment-specific documents using semantic search

        Args:
            query: User's natural language query
            equipment_context: List of equipment from systems table

        Returns:
            Dict with Pinecone search results or None if not available
        """
        if not self.pinecone_client:
            logger.info("Pinecone client not available, skipping semantic search")
            return None

        try:
            # Build equipment-aware search query
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

            # Enhance query with equipment context for better semantic matching
            # Heavily weight the specific equipment model since manuals often cover multiple models
            enhanced_query = query
            if equipment_names:
                # Repeat equipment names multiple times to strongly bias results toward this specific model
                equipment_emphasis = " ".join([name for name in equipment_names for _ in range(3)])
                enhanced_query = f"{equipment_emphasis} {query} {equipment_emphasis}"

            logger.info(f"Querying Pinecone with enhanced query: {enhanced_query}")

            # Search Pinecone for relevant documents
            top_k = int(os.getenv('PINECONE_TOP_K', '10'))
            search_result = self.pinecone_client.search_vectors(
                query=enhanced_query,
                top_k=top_k,
                include_metadata=True,
                include_values=False
            )

            if search_result.get("success"):
                matches = search_result.get("matches", [])
                logger.info(f"Pinecone returned {len(matches)} document matches")

                return {
                    "success": True,
                    "matches": matches,
                    "enhanced_query": enhanced_query,
                    "equipment_context": equipment_names,
                    "match_count": len(matches)
                }
            else:
                logger.warning(f"Pinecone search failed: {search_result.get('error', 'Unknown error')}")
                return {
                    "success": False,
                    "error": search_result.get('error', 'Unknown error'),
                    "enhanced_query": enhanced_query
                }

        except Exception as e:
            logger.error(f"Pinecone query failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "enhanced_query": query
            }