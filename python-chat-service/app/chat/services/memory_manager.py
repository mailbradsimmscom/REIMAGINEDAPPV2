"""
LangChain-based memory management for chat sessions
"""
import os
from typing import Dict, List, Any, Optional
from langchain.memory import (
    ConversationBufferWindowMemory,
    ConversationSummaryBufferMemory,
    ConversationEntityMemory,
    CombinedMemory
)
from langchain_community.chat_message_histories import PostgresChatMessageHistory
from langchain_openai import ChatOpenAI
from ..models import MemoryContext
import logging

logger = logging.getLogger(__name__)


class SmartChatMemory:
    """
    LangChain-powered memory management with equipment entity tracking
    """

    def __init__(self, session_id: str, database_url: str = None):
        self.session_id = session_id

        # Use environment database URL if not provided
        self.database_url = database_url or os.getenv("DATABASE_URL")
        if not self.database_url:
            raise ValueError("DATABASE_URL environment variable is required")

        # Initialize LLM for summarization
        self.llm = ChatOpenAI(
            model="gpt-4o-mini",
            temperature=0.1,
            api_key=os.getenv("OPENAI_API_KEY")
        )

        # Equipment entity extraction prompt
        self.equipment_entity_prompt = """
        Extract equipment entities from this HVAC/mechanical systems conversation:

        ENTITY TYPES TO EXTRACT:
        - Manufacturer (e.g., Carrier, Trane, York, Johnson Controls)
        - Model numbers (e.g., 30HXC120, RTU-150, AHU-250)
        - System types (e.g., chiller, boiler, AHU, RTU, VAV, heat pump)
        - Components (e.g., compressor, heat exchanger, fan, coil, damper)
        - Parameters (e.g., pressure, temperature, flow rate, capacity)
        - Units (e.g., PSI, GPM, BTU/hr, CFM, tons)
        - Values (e.g., 150 PSI, 500 GPM, 25 tons)

        Current conversation: {history}
        Last message: {input}

        Extract and update entities in JSON format:
        {{
            "manufacturer": "...",
            "model": "...",
            "system_type": "...",
            "components": [...],
            "parameters": {{
                "parameter_name": {{"value": "...", "unit": "..."}}
            }}
        }}
        """

        # Initialize chat message history with LangChain
        self.chat_history = PostgresChatMessageHistory(
            connection_string=self.database_url,
            session_id=session_id,
            table_name="langchain_chat_history"
        )

        # Initialize combined memory
        self._initialize_memory()

    def _initialize_memory(self):
        """Initialize LangChain memory components"""
        try:
            # Window memory - keeps last 10 messages for immediate context
            self.window_memory = ConversationBufferWindowMemory(
                k=10,
                chat_memory=self.chat_history,
                return_messages=True,
                memory_key="recent_messages"
            )

            # Summary memory - maintains conversation summary with token limits
            self.summary_memory = ConversationSummaryBufferMemory(
                llm=self.llm,
                chat_memory=self.chat_history,
                max_token_limit=1000,
                memory_key="conversation_summary",
                return_messages=False
            )

            # Entity memory - tracks equipment entities
            self.entity_memory = ConversationEntityMemory(
                llm=self.llm,
                chat_memory=self.chat_history,
                entity_extraction_prompt=self.equipment_entity_prompt,
                memory_key="equipment_entities"
            )

            # Combined memory
            self.combined_memory = CombinedMemory(
                memories=[self.window_memory, self.summary_memory, self.entity_memory]
            )

            logger.info(f"Initialized memory for session {self.session_id}")

        except Exception as e:
            logger.error(f"Failed to initialize memory for session {self.session_id}: {e}")
            raise

    def get_context(self) -> MemoryContext:
        """
        Get all conversation context for use in chat processing

        Returns:
            MemoryContext with recent messages, summary, and equipment entities
        """
        try:
            # Get context from combined memory
            memory_vars = self.combined_memory.load_memory_variables({})

            # Extract recent messages
            recent_messages = []
            if "recent_messages" in memory_vars:
                for message in memory_vars["recent_messages"]:
                    recent_messages.append({
                        "role": "user" if message.type == "human" else "assistant",
                        "content": message.content,
                        "timestamp": getattr(message, "timestamp", None)
                    })

            # Extract conversation summary
            conversation_summary = memory_vars.get("conversation_summary", "")

            # Extract equipment entities
            equipment_entities = memory_vars.get("equipment_entities", {})

            # Generate context keywords from entities and summary
            context_keywords = self._extract_context_keywords(equipment_entities, conversation_summary)

            return MemoryContext(
                recent_messages=recent_messages,
                conversation_summary=conversation_summary,
                equipment_entities=equipment_entities,
                context_keywords=context_keywords
            )

        except Exception as e:
            logger.error(f"Failed to get context for session {self.session_id}: {e}")
            # Return empty context on error
            return MemoryContext()

    def save_interaction(self, user_input: str, ai_response: str, metadata: Dict[str, Any] = None):
        """
        Save user interaction to memory

        Args:
            user_input: User's input message
            ai_response: AI's response message
            metadata: Optional metadata to associate with the interaction
        """
        try:
            # Save to combined memory - LangChain handles all persistence
            context_input = {"input": user_input}
            if metadata:
                context_input.update(metadata)

            self.combined_memory.save_context(
                context_input,
                {"output": ai_response}
            )

            logger.debug(f"Saved interaction for session {self.session_id}")

        except Exception as e:
            logger.error(f"Failed to save interaction for session {self.session_id}: {e}")
            raise

    def clear_memory(self):
        """Clear all memory for this session"""
        try:
            self.combined_memory.clear()
            logger.info(f"Cleared memory for session {self.session_id}")
        except Exception as e:
            logger.error(f"Failed to clear memory for session {self.session_id}: {e}")
            raise

    def get_equipment_context(self) -> Dict[str, Any]:
        """Get just the equipment context for DIP table filtering"""
        try:
            memory_vars = self.combined_memory.load_memory_variables({})
            return memory_vars.get("equipment_entities", {})
        except Exception as e:
            logger.error(f"Failed to get equipment context for session {self.session_id}: {e}")
            return {}

    def _extract_context_keywords(self, equipment_entities: Dict, summary: str) -> List[str]:
        """Extract keywords from equipment entities and summary for enhanced search"""
        keywords = []

        # Extract from equipment entities
        if isinstance(equipment_entities, dict):
            for key, value in equipment_entities.items():
                if isinstance(value, str) and value.strip():
                    keywords.append(value.strip())
                elif isinstance(value, list):
                    keywords.extend([str(v).strip() for v in value if str(v).strip()])

        # Extract from summary (simple keyword extraction)
        if summary:
            # Simple extraction of technical terms
            technical_terms = []
            words = summary.split()
            for word in words:
                word_clean = word.strip('.,!?()[]').lower()
                if len(word_clean) > 3 and any(term in word_clean for term in
                    ['pressure', 'temperature', 'flow', 'capacity', 'btu', 'cfm', 'gpm', 'psi']):
                    technical_terms.append(word_clean)
            keywords.extend(technical_terms[:5])  # Limit to top 5

        # Remove duplicates and limit
        return list(set(keywords))[:10]


class MemoryManagerFactory:
    """Factory for creating memory managers with connection pooling"""

    _managers: Dict[str, SmartChatMemory] = {}

    @classmethod
    def get_manager(cls, session_id: str) -> SmartChatMemory:
        """Get or create a memory manager for a session"""
        if session_id not in cls._managers:
            cls._managers[session_id] = SmartChatMemory(session_id)
        return cls._managers[session_id]

    @classmethod
    def cleanup_manager(cls, session_id: str):
        """Remove memory manager from cache"""
        if session_id in cls._managers:
            del cls._managers[session_id]