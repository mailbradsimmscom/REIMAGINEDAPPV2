"""
LangGraph workflow for intelligent chat processing
"""
import logging
from datetime import datetime
from typing import Dict, Any, Literal
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI

from .models import ChatState, QueryClassification, ResponseScore
from .services.query_classifier import QueryClassifier
from .services.memory_manager import MemoryManagerFactory
from .services.simple_dip_retriever import SimpleDIPRetriever
from .services.response_scorer import ResponseScorer

logger = logging.getLogger(__name__)


class ChatWorkflow:
    """
    LangGraph-based chat workflow with DIP integration and memory management
    """

    def __init__(self):
        # Initialize services
        self.classifier = QueryClassifier()
        self.dip_retriever = SimpleDIPRetriever()
        self.response_scorer = ResponseScorer()

        # Initialize LLM for response formatting
        self.llm = ChatOpenAI(
            model="gpt-4o",
            temperature=0.2,
            max_tokens=1500
        )

        # Build workflow
        self.workflow = self._build_workflow()

    def _build_workflow(self) -> StateGraph:
        """Build the LangGraph workflow"""

        # Create state graph
        workflow = StateGraph(ChatState)

        # Add nodes
        workflow.add_node("load_memory", self._load_memory_node)
        workflow.add_node("classify_query", self._classify_query_node)
        workflow.add_node("query_dip_tables", self._query_dip_tables_node)
        workflow.add_node("query_pinecone", self._query_pinecone_node)
        workflow.add_node("query_web", self._query_web_node)
        workflow.add_node("merge_results", self._merge_results_node)
        workflow.add_node("score_response", self._score_response_node)
        workflow.add_node("format_response", self._format_response_node)
        workflow.add_node("save_memory", self._save_memory_node)

        # Add edges
        workflow.add_edge("load_memory", "classify_query")
        workflow.add_edge("classify_query", "query_dip_tables")
        workflow.add_edge("query_dip_tables", "query_pinecone")

        # Conditional edge for web search
        workflow.add_conditional_edges(
            "query_pinecone",
            self._should_search_web,
            {
                "search_web": "query_web",
                "merge": "merge_results"
            }
        )

        workflow.add_edge("query_web", "merge_results")
        workflow.add_edge("merge_results", "score_response")
        workflow.add_edge("score_response", "format_response")
        workflow.add_edge("format_response", "save_memory")
        workflow.add_edge("save_memory", END)

        # Set entry point
        workflow.set_entry_point("load_memory")

        return workflow.compile()

    async def process_chat(self, state: ChatState) -> ChatState:
        """Process a chat request through the workflow"""
        try:
            state.processing_steps.append("workflow_started")
            result = await self.workflow.ainvoke(state.dict())

            # Convert back to ChatState
            final_state = ChatState(**result)
            final_state.processing_steps.append("workflow_completed")

            return final_state

        except Exception as e:
            logger.error(f"Workflow processing failed: {e}")
            state.error = str(e)
            return state

    # Node implementations
    async def _load_memory_node(self, state: ChatState) -> ChatState:
        """Load conversation memory and context"""
        try:
            state.processing_steps.append("loading_memory")

            if not state.session_id:
                # Generate session ID if not provided
                state.session_id = f"session-{datetime.now().strftime('%Y%m%d-%H%M%S')}"

            # Get memory manager
            memory_manager = MemoryManagerFactory.get_manager(state.session_id)

            # Load memory context
            memory_context = memory_manager.get_context()
            state.memory_context = memory_context.dict()

            # Extract equipment context for DIP queries
            equipment_context = memory_manager.get_equipment_context()
            if equipment_context:
                state.systems_context.append(equipment_context)

            logger.info(f"Loaded memory for session {state.session_id}")
            return state

        except Exception as e:
            logger.error(f"Failed to load memory: {e}")
            state.error = f"Memory loading failed: {e}"
            return state

    async def _classify_query_node(self, state: ChatState) -> ChatState:
        """Classify user query to determine routing"""
        try:
            state.processing_steps.append("classifying_query")

            # Get equipment context from memory
            equipment_context = state.systems_context[0] if state.systems_context else {}
            conversation_summary = state.memory_context.get("conversation_summary", "") if state.memory_context else ""

            # Classify query
            classification = self.classifier.classify(
                state.user_query,
                equipment_context,
                conversation_summary
            )

            state.classification = classification.dict()
            logger.info(f"Classified query as: {classification.primary} ({classification.confidence:.2f})")

            return state

        except Exception as e:
            logger.error(f"Query classification failed: {e}")
            state.error = f"Classification failed: {e}"
            return state

    async def _query_dip_tables_node(self, state: ChatState) -> ChatState:
        """Query DIP tables based on classification"""
        try:
            state.processing_steps.append("querying_dip_tables")

            if not state.classification:
                return state

            classification = QueryClassification(**state.classification)
            equipment_context = state.systems_context[0] if state.systems_context else {}

            dip_results = []

            # Query based on classification
            if "spec_suggestions" in classification.target_tables:
                spec_results = await self.dip_retriever.search_spec_suggestions(
                    state.user_query, equipment_context
                )
                if spec_results:
                    dip_results.append({
                        "table": "spec_suggestions",
                        "results": spec_results,
                        "count": len(spec_results)
                    })

            if "playbook_hints" in classification.target_tables:
                playbook_results = await self.dip_retriever.search_playbook_hints(
                    state.user_query, equipment_context
                )
                if playbook_results:
                    dip_results.append({
                        "table": "playbook_hints",
                        "results": playbook_results,
                        "count": len(playbook_results)
                    })

            if "intent_router" in classification.target_tables:
                intent_results = await self.dip_retriever.search_intent_router(
                    state.user_query, equipment_context
                )
                if intent_results:
                    dip_results.append({
                        "table": "intent_router",
                        "results": intent_results,
                        "count": len(intent_results)
                    })

            if "golden_tests" in classification.target_tables:
                golden_results = await self.dip_retriever.search_golden_tests(
                    state.user_query, equipment_context
                )
                if golden_results:
                    dip_results.append({
                        "table": "golden_tests",
                        "results": golden_results,
                        "count": len(golden_results)
                    })

            state.dip_results = dip_results
            total_results = sum(r["count"] for r in dip_results)
            logger.info(f"Found {total_results} DIP results across {len(dip_results)} tables")

            return state

        except Exception as e:
            logger.error(f"DIP table querying failed: {e}")
            state.error = f"DIP querying failed: {e}"
            return state

    async def _query_pinecone_node(self, state: ChatState) -> ChatState:
        """Query Pinecone for semantic search (placeholder)"""
        try:
            state.processing_steps.append("querying_pinecone")

            # This is a placeholder - integrate with existing Pinecone service
            # For now, simulate Pinecone results
            state.pinecone_results = {
                "finalists": [],
                "meta": {"message": "Pinecone integration placeholder"},
                "error": None
            }

            logger.info("Pinecone query completed (placeholder)")
            return state

        except Exception as e:
            logger.error(f"Pinecone querying failed: {e}")
            state.pinecone_results = {"finalists": [], "meta": {"error": str(e)}, "error": str(e)}
            return state

    async def _query_web_node(self, state: ChatState) -> ChatState:
        """Query web sources for current information (placeholder)"""
        try:
            state.processing_steps.append("querying_web")

            # Placeholder for web search integration
            state.web_results = []

            logger.info("Web search completed (placeholder)")
            return state

        except Exception as e:
            logger.error(f"Web search failed: {e}")
            return state

    async def _merge_results_node(self, state: ChatState) -> ChatState:
        """Merge all results with priority logic"""
        try:
            state.processing_steps.append("merging_results")

            merged_context = {
                "dip_data": state.dip_results,
                "pinecone_data": state.pinecone_results,
                "web_data": state.web_results,
                "has_dip_results": len(state.dip_results) > 0,
                "has_pinecone_results": bool(state.pinecone_results and state.pinecone_results.get("finalists")),
                "has_web_results": len(state.web_results) > 0
            }

            state.merged_context = merged_context
            logger.info("Results merged successfully")

            return state

        except Exception as e:
            logger.error(f"Result merging failed: {e}")
            state.error = f"Merging failed: {e}"
            return state

    async def _score_response_node(self, state: ChatState) -> ChatState:
        """Score the response quality"""
        try:
            state.processing_steps.append("scoring_response")

            if not state.merged_context:
                return state

            score = self.response_scorer.calculate_score(
                state.merged_context,
                QueryClassification(**state.classification) if state.classification else None
            )

            state.response_score = score.dict()
            logger.info(f"Response scored: {score.total_score}/100 ({score.confidence})")

            return state

        except Exception as e:
            logger.error(f"Response scoring failed: {e}")
            return state

    async def _format_response_node(self, state: ChatState) -> ChatState:
        """Format final response using LLM"""
        try:
            state.processing_steps.append("formatting_response")

            if not state.merged_context:
                state.final_response = "I couldn't find relevant information to answer your query."
                return state

            # Build comprehensive prompt
            prompt = self._build_response_prompt(state)

            # Get LLM response
            response = await self.llm.ainvoke(prompt)
            state.final_response = response.content

            logger.info("Response formatted successfully")
            return state

        except Exception as e:
            logger.error(f"Response formatting failed: {e}")
            state.final_response = f"I encountered an error while formatting the response: {e}"
            return state

    async def _save_memory_node(self, state: ChatState) -> ChatState:
        """Save interaction to memory"""
        try:
            state.processing_steps.append("saving_memory")

            if state.session_id and state.final_response:
                memory_manager = MemoryManagerFactory.get_manager(state.session_id)

                # Save interaction with metadata
                metadata = {
                    "classification": state.classification,
                    "dip_results_count": len(state.dip_results),
                    "score": state.response_score
                }

                memory_manager.save_interaction(
                    state.user_query,
                    state.final_response,
                    metadata
                )

            logger.info("Memory saved successfully")
            return state

        except Exception as e:
            logger.error(f"Memory saving failed: {e}")
            return state

    # Conditional edge logic
    def _should_search_web(self, state: ChatState) -> Literal["search_web", "merge"]:
        """Determine if web search is needed"""
        try:
            # Web search triggers
            query_lower = state.user_query.lower()

            # Time-sensitive queries
            if any(term in query_lower for term in ["current", "latest", "recent", "2024", "2025", "new", "updated"]):
                state.should_search_web = True
                return "search_web"

            # No good internal results
            has_good_dip_results = len(state.dip_results) > 0 and any(
                r["count"] > 0 for r in state.dip_results
            )
            has_good_pinecone_results = (
                state.pinecone_results and
                len(state.pinecone_results.get("finalists", [])) > 0
            )

            if not has_good_dip_results and not has_good_pinecone_results:
                state.should_search_web = True
                return "search_web"

            # Troubleshooting queries with no DIP results
            if (state.classification and
                state.classification.get("primary") == "troubleshooting" and
                not has_good_dip_results):
                state.should_search_web = True
                return "search_web"

            return "merge"

        except Exception as e:
            logger.error(f"Web search decision failed: {e}")
            return "merge"

    def _build_response_prompt(self, state: ChatState) -> str:
        """Build comprehensive prompt for response formatting"""

        context = state.merged_context
        classification = state.classification
        score = state.response_score

        prompt = f"""
You are an expert HVAC technical support assistant. Format a comprehensive response based on the following context:

USER QUERY: {state.user_query}

QUERY CLASSIFICATION: {classification.get("primary", "general") if classification else "general"}
CONFIDENCE: {classification.get("confidence", 0.5) if classification else 0.5}

DIP TABLE RESULTS:
{self._format_dip_data_for_prompt(context.get("dip_data", []))}

PINECONE CONTEXT:
{context.get("pinecone_data", {}).get("meta", {}).get("message", "No vector search results")}

WEB SEARCH RESULTS:
{len(context.get("web_data", []))} web results found

RESPONSE QUALITY SCORE:
{score.get("total_score", 0) if score else 0}/100 ({score.get("confidence", "unknown") if score else "unknown"})

CONVERSATION CONTEXT:
{state.memory_context.get("conversation_summary", "No prior context") if state.memory_context else "No prior context"}

FORMAT REQUIREMENTS:
1. Lead with a direct, concise answer to the user's question
2. Include relevant technical specifications if the query is spec-related
3. Provide step-by-step procedures if the query is procedure-related
4. Include troubleshooting guidance if the query is problem-related
5. Add source icons and quality score at the bottom using this format:

**Answer Quality:** {self._get_confidence_emoji(score)} {score.get("total_score", 0) if score else 0}/100 ({score.get("confidence", "unknown") if score else "unknown"} confidence)

**Sources Used:**
{self._generate_source_attribution(context)}

IMPORTANT:
- Be concise but comprehensive
- Use technical terminology appropriately
- Focus on practical, actionable information
- If information is limited, be honest about limitations
- Always include the quality score and source attribution

RESPONSE:
"""
        return prompt

    def _format_dip_data_for_prompt(self, dip_data: list) -> str:
        """Format DIP data for prompt inclusion"""
        if not dip_data:
            return "No structured data found"

        formatted_sections = []
        for table_result in dip_data:
            table_name = table_result["table"]
            results = table_result["results"]
            count = table_result["count"]

            formatted_sections.append(f"{table_name.upper()} ({count} results):")

            for i, result in enumerate(results[:3], 1):  # Limit to top 3 per table
                if table_name == "spec_suggestions":
                    formatted_sections.append(f"  {i}. {result.get('parameter', 'N/A')}: {result.get('value', 'N/A')} {result.get('units', '')}")
                elif table_name == "playbook_hints":
                    formatted_sections.append(f"  {i}. {result.get('title', 'N/A')}")
                elif table_name == "intent_router":
                    formatted_sections.append(f"  {i}. Q: {result.get('question', 'N/A')[:100]}...")
                elif table_name == "golden_tests":
                    formatted_sections.append(f"  {i}. Test: {result.get('query', 'N/A')[:100]}...")

        return "\n".join(formatted_sections) if formatted_sections else "No structured data found"

    def _get_confidence_emoji(self, score: dict) -> str:
        """Get confidence emoji based on score"""
        if not score:
            return "🔴"

        confidence = score.get("confidence", "very_low")
        emoji_map = {
            "high": "🟢",
            "medium": "🟡",
            "low": "🟠",
            "very_low": "🔴"
        }
        return emoji_map.get(confidence, "🔴")

    def _generate_source_attribution(self, context: dict) -> str:
        """Generate source attribution with icons"""
        sources = []

        # DIP table sources
        dip_data = context.get("dip_data", [])
        for table_result in dip_data:
            table = table_result["table"]
            count = table_result["count"]

            if count > 0:
                icon_map = {
                    "spec_suggestions": "📊",
                    "playbook_hints": "📋",
                    "intent_router": "🎯",
                    "golden_tests": "🔧"
                }
                icon = icon_map.get(table, "📄")
                sources.append(f"{icon} **{table.replace('_', ' ').title()}**: {count} result{'s' if count != 1 else ''}")

        # Vector search
        if context.get("has_pinecone_results"):
            sources.append("🔍 **Document Search**: Multiple sections")

        # Web search
        web_count = len(context.get("web_data", []))
        if web_count > 0:
            sources.append(f"🌐 **Web Sources**: {web_count} result{'s' if web_count != 1 else ''}")

        return "\n".join(sources) if sources else "📋 **General Knowledge**: Response based on training data"


# Create singleton instance
chat_workflow = ChatWorkflow()