"""
LLM Service for chat workflow

Handles all LLM interactions for:
- Query classification and intent detection
- Response synthesis from structured data
- Response quality scoring
"""

import os
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

from ..config import (
    CLASSIFICATION_PROMPT_TEMPLATE,
    SYNTHESIS_PROMPT_TEMPLATE,
    SCORING_PROMPT_TEMPLATE,
    PERSONALITY_TRAITS,
    RESPONSE_FORMAT_RULES,
    SYNTHESIS_INSTRUCTIONS
)

logger = logging.getLogger(__name__)


class LLMService:
    """Service for LLM operations in chat workflow"""

    def __init__(self):
        """Initialize LLM clients"""
        self.anthropic_client = None
        self.openai_client = None

        # Initialize Anthropic if available
        try:
            import anthropic
            anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')
            if anthropic_api_key:
                self.anthropic_client = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
                logger.info("Anthropic async client initialized")
        except ImportError:
            logger.warning("Anthropic library not available")
        except Exception as e:
            logger.warning(f"Failed to initialize Anthropic client: {e}")

        # Initialize OpenAI if available
        try:
            import openai
            openai_api_key = os.getenv('OPENAI_API_KEY')
            if openai_api_key:
                self.openai_client = openai.AsyncOpenAI(api_key=openai_api_key)
                logger.info("OpenAI async client initialized")
        except ImportError:
            logger.warning("OpenAI library not available")
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAI client: {e}")

        if not self.anthropic_client and not self.openai_client:
            logger.error("No LLM clients available - chat workflow will use fallback mode")


    async def classify_query(self,
                           user_query: str,
                           systems_context: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Classify user query and determine intent and equipment focus

        Args:
            user_query: User's conversational query
            systems_context: Equipment found by systems search

        Returns:
            Classification result with intent, equipment analysis, etc.
        """
        if not systems_context:
            return {
                "intent": "general_information",
                "confidence": 0.5,
                "table_types_needed": ["spec", "routing"],
                "primary_equipment_index": None,
                "reasoning": "No equipment context provided"
            }

        # Format equipment context for LLM
        equipment_list = []
        for i, eq in enumerate(systems_context):
            equipment_list.append(f"{i+1}. {eq.get('manufacturer', '')} {eq.get('model', '')} "
                                f"(rank: {eq.get('rank', 0):.2f}, description: {eq.get('description', '')})")

        equipment_text = "\n".join(equipment_list)

        prompt = CLASSIFICATION_PROMPT_TEMPLATE.format(
            user_query=user_query,
            equipment_text=equipment_text
        )

        try:
            response_text = await self._call_llm(prompt)

            # Parse JSON response
            try:
                result = json.loads(response_text)

                # Validate and set defaults
                result.setdefault("intent", "general_information")
                result.setdefault("confidence", 0.7)
                result.setdefault("table_types_needed", ["spec", "routing"])
                result.setdefault("primary_equipment_index", 0 if systems_context else None)
                result.setdefault("search_keywords", [])
                result.setdefault("reasoning", "LLM classification")

                return result

            except json.JSONDecodeError as e:
                logger.warning(f"Failed to parse LLM classification response: {e}")
                return self._fallback_classification(user_query, systems_context)

        except Exception as e:
            logger.error(f"Query classification failed: {e}")
            return self._fallback_classification(user_query, systems_context)

    async def synthesize_response(self,
                                user_query: str,
                                systems_context: List[Dict[str, Any]],
                                classification: Optional[Dict[str, Any]],
                                dip_results: List[Dict[str, Any]],
                                pinecone_results: Optional[Dict[str, Any]] = None,
                                conversation_summary: Optional[str] = None) -> str:
        """
        Synthesize natural language response from structured data with conversation memory

        Args:
            user_query: Original user query
            systems_context: Equipment context
            classification: Query classification results
            dip_results: Results from DIP table queries
            pinecone_results: Results from Pinecone search (optional)
            conversation_summary: Weighted conversation history (optional)

        Returns:
            Natural language response
        """
        # Format context for LLM
        equipment_context = self._format_equipment_context(systems_context)
        dip_context = self._format_dip_context(dip_results)
        pinecone_context = self._format_pinecone_context(pinecone_results)

        intent = classification.get("intent", "general_information") if classification else "general_information"

        prompt = SYNTHESIS_PROMPT_TEMPLATE.format(
            personality_traits=PERSONALITY_TRAITS,
            user_query=user_query,
            equipment_context=equipment_context,
            conversation_summary=conversation_summary or "No previous conversation context.",
            dip_context=dip_context,
            pinecone_context=pinecone_context,
            intent=intent,
            format_rules=RESPONSE_FORMAT_RULES,
            synthesis_instructions=SYNTHESIS_INSTRUCTIONS
        )

        # Log the context being sent to LLM (full content for troubleshooting)
        logger.info("📦 LLM Synthesis Context:")
        logger.info(f"  Equipment: {equipment_context}")
        logger.info(f"  DIP Context: {dip_context}")
        logger.info(f"  Pinecone Context: {pinecone_context}")

        try:
            response = await self._call_llm(prompt)
            return response.strip()

        except Exception as e:
            logger.error(f"Response synthesis failed: {e}")
            return self._fallback_response(user_query, systems_context, dip_results)

    async def score_response(self,
                           user_query: str,
                           response: str,
                           dip_results: List[Dict[str, Any]],
                           systems_context: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Score response quality and confidence

        Args:
            user_query: Original user query
            response: Generated response
            dip_results: DIP query results used
            systems_context: Equipment context

        Returns:
            Score breakdown with confidence level
        """
        total_results = sum(r.get('count', 0) for r in dip_results)
        equipment_count = len(systems_context)

        prompt = SCORING_PROMPT_TEMPLATE.format(
            user_query=user_query,
            response=response,
            equipment_count=equipment_count,
            dip_table_count=len(dip_results),
            total_results=total_results
        )

        try:
            score_text = await self._call_llm(prompt)

            try:
                result = json.loads(score_text)

                # Validate and set defaults
                result.setdefault("total_score", 70)
                result.setdefault("confidence", "medium")
                result.setdefault("breakdown", {})
                result.setdefault("confidence_emoji", "🟡")
                result.setdefault("reasoning", "Automated scoring")

                return result

            except json.JSONDecodeError:
                logger.warning("Failed to parse LLM scoring response")
                return self._fallback_scoring(total_results, equipment_count)

        except Exception as e:
            logger.error(f"Response scoring failed: {e}")
            return self._fallback_scoring(total_results, equipment_count)

    async def _call_llm(self, prompt: str) -> str:
        """Call LLM with fallback between Anthropic and OpenAI with usage tracking"""
        start_time = datetime.now()

        # Try Anthropic first (Claude)
        if self.anthropic_client:
            try:
                message = await self.anthropic_client.messages.create(
                    model="claude-3-haiku-20240307",
                    max_tokens=2000,
                    messages=[{
                        "role": "user",
                        "content": prompt
                    }]
                )

                # Log LLM usage metrics
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                usage = message.usage
                input_tokens = usage.input_tokens
                output_tokens = usage.output_tokens

                # Anthropic Claude Haiku pricing (as of 2025)
                # Input: $0.25 per 1M tokens, Output: $1.25 per 1M tokens
                input_cost = (input_tokens / 1_000_000) * 0.25
                output_cost = (output_tokens / 1_000_000) * 1.25
                total_cost = input_cost + output_cost

                logger.info("💰 LLM Usage (Anthropic Claude Haiku)", {
                    "model": "claude-3-haiku-20240307",
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                    "duration_ms": round(duration_ms, 2),
                    "estimated_cost_usd": round(total_cost, 6),
                    "input_cost_usd": round(input_cost, 6),
                    "output_cost_usd": round(output_cost, 6)
                })

                return message.content[0].text

            except Exception as e:
                logger.warning(f"Anthropic call failed: {e}")

        # Try OpenAI as fallback
        if self.openai_client:
            try:
                response = await self.openai_client.chat.completions.create(
                    model="gpt-3.5-turbo",
                    messages=[{
                        "role": "user",
                        "content": prompt
                    }],
                    max_tokens=2000
                )

                # Log LLM usage metrics
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                usage = response.usage
                input_tokens = usage.prompt_tokens
                output_tokens = usage.completion_tokens
                total_tokens = usage.total_tokens

                # GPT-3.5-turbo pricing (as of 2025)
                # Input: $0.50 per 1M tokens, Output: $1.50 per 1M tokens
                input_cost = (input_tokens / 1_000_000) * 0.50
                output_cost = (output_tokens / 1_000_000) * 1.50
                total_cost = input_cost + output_cost

                logger.info("💰 LLM Usage (OpenAI GPT-3.5-turbo)", {
                    "model": "gpt-3.5-turbo",
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": total_tokens,
                    "duration_ms": round(duration_ms, 2),
                    "estimated_cost_usd": round(total_cost, 6),
                    "input_cost_usd": round(input_cost, 6),
                    "output_cost_usd": round(output_cost, 6)
                })

                return response.choices[0].message.content

            except Exception as e:
                logger.warning(f"OpenAI call failed: {e}")

        # No LLM available
        raise Exception("No LLM clients available")

    def _format_equipment_context(self, systems_context: List[Dict[str, Any]]) -> str:
        """Format equipment context for LLM prompts"""
        if not systems_context:
            return "No equipment found."

        lines = []
        for eq in systems_context:
            manufacturer = eq.get('manufacturer', 'Unknown')
            model = eq.get('model', 'Unknown')
            description = eq.get('description', '')
            rank = eq.get('rank', 0)

            lines.append(f"- {manufacturer} {model}")
            if description and description != f"{manufacturer} {model}":
                lines.append(f"  Description: {description}")

            # Add ownership confidence based on rank
            if rank >= 0.90:
                lines.append(f"  OWNERSHIP: CONFIRMED - This equipment is owned by the user (confidence: {rank:.2f})")
            elif rank >= 0.70:
                lines.append(f"  OWNERSHIP: LIKELY - This equipment is likely owned by the user (confidence: {rank:.2f})")
            else:
                lines.append(f"  OWNERSHIP: POSSIBLE - This equipment may be owned by the user (confidence: {rank:.2f})")

        return "\n".join(lines)

    def _format_dip_context(self, dip_results: List[Dict[str, Any]]) -> str:
        """Format DIP results for LLM prompts"""
        if not dip_results:
            return "No relevant technical data found."

        lines = []
        for result in dip_results:
            table_type = result.get('table_type', 'Unknown')
            count = result.get('count', 0)
            equipment = result.get('equipment', {})

            lines.append(f"\n{table_type.upper()} DATA:")
            if equipment:
                eq_name = f"{equipment.get('manufacturer', '')} {equipment.get('model', '')}".strip()
                lines.append(f"Equipment: {eq_name}")

            lines.append(f"Entries found: {count}")

            # Include top results
            results_data = result.get('results', [])
            for i, entry in enumerate(results_data[:2]):  # Top 2 entries
                if table_type == 'spec':
                    param = entry.get('parameter', 'Unknown')
                    value = entry.get('value', 'Unknown')
                    lines.append(f"  • {param}: {value}")
                elif table_type == 'routing':
                    question = entry.get('question', 'Unknown')
                    answer = entry.get('answer', 'Unknown')
                    lines.append(f"  • Q: {question}")
                    lines.append(f"    A: {answer}")
                elif table_type == 'procedure':
                    outcome = entry.get('expected_outcome', entry.get('title', 'Unknown'))
                    lines.append(f"  • {outcome}")

        return "\n".join(lines)

    def _fallback_classification(self, user_query: str, systems_context: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Fallback classification when LLM fails"""
        intent = "general_information"
        table_types = ["spec", "routing"]

        # Simple keyword-based intent detection
        query_lower = user_query.lower()
        if any(word in query_lower for word in ["how", "install", "setup", "procedure"]):
            intent = "procedure"
            table_types = ["procedure", "troubleshooting"]
        elif any(word in query_lower for word in ["spec", "dimension", "weight", "size"]):
            intent = "specifications"
            table_types = ["spec"]
        elif any(word in query_lower for word in ["problem", "issue", "trouble", "fix"]):
            intent = "troubleshooting"
            table_types = ["troubleshooting", "procedure"]

        return {
            "intent": intent,
            "confidence": 0.6,
            "table_types_needed": table_types,
            "primary_equipment_index": 0 if systems_context else None,
            "reasoning": "Fallback keyword-based classification"
        }

    def _fallback_response(self, user_query: str, systems_context: List[Dict[str, Any]],
                          dip_results: List[Dict[str, Any]]) -> str:
        """Fallback response when LLM synthesis fails"""
        equipment_names = []
        for eq in systems_context:
            name = f"{eq.get('manufacturer', '')} {eq.get('model', '')}".strip()
            if name:
                equipment_names.append(name)

        total_results = sum(r.get('count', 0) for r in dip_results)

        if equipment_names and total_results > 0:
            equipment_text = equipment_names[0] if len(equipment_names) == 1 else f"{len(equipment_names)} pieces of equipment"
            return f"I found information about your {equipment_text} with {total_results} relevant technical entries across {len(dip_results)} data sources."
        elif equipment_names:
            return f"I found your {equipment_names[0]} in the system but no specific technical data for your query."
        else:
            return f"I couldn't find specific information for '{user_query}' in the available data sources."

    def _fallback_scoring(self, total_results: int, equipment_count: int) -> Dict[str, Any]:
        """Fallback scoring when LLM fails"""
        # Simple heuristic scoring
        if total_results > 5 and equipment_count > 0:
            score = 80
            confidence = "high"
            emoji = "🟢"
        elif total_results > 0:
            score = 65
            confidence = "medium"
            emoji = "🟡"
        else:
            score = 30
            confidence = "low"
            emoji = "🔴"

        return {
            "total_score": score,
            "confidence": confidence,
            "breakdown": {
                "completeness": score,
                "accuracy": score,
                "clarity": score,
                "helpfulness": score
            },
            "confidence_emoji": emoji,
            "reasoning": f"Heuristic scoring based on {total_results} results and {equipment_count} equipment"
        }

    def _format_pinecone_context(self, pinecone_results: Optional[Dict[str, Any]]) -> str:
        """Format Pinecone results for LLM prompts"""
        if not pinecone_results or not pinecone_results.get("success"):
            return "No relevant documents found in knowledge base."

        matches = pinecone_results.get("matches", [])
        if not matches:
            return "No relevant documents found in knowledge base."

        lines = []
        lines.append(f"Found {len(matches)} relevant documents:")

        for i, match in enumerate(matches):  # Send ALL matches to LLM
            score = match.get("score", 0)
            metadata = match.get("metadata", {})

            # Extract document information from metadata
            doc_title = metadata.get("title", metadata.get("filename", f"Document {i+1}"))
            doc_content = metadata.get("text", metadata.get("content", ""))
            doc_type = metadata.get("doc_type", metadata.get("type", "document"))

            lines.append(f"\n{i+1}. {doc_title} (relevance: {score:.2f})")
            lines.append(f"   Type: {doc_type}")

            # Include FULL content - no character limits, let LLM extract what's needed
            if doc_content:
                lines.append(f"   Content: {doc_content}")

        return "\n".join(lines)