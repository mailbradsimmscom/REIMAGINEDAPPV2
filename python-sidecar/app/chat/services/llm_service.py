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

import cohere

from ..config import (
    CLASSIFICATION_PROMPT_TEMPLATE,
    SYNTHESIS_PROMPT_TEMPLATE,
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

        # Read configuration
        self.chat_model_provider = os.getenv('CHAT_MODEL', 'ANTHROPIC').upper()
        self.openai_model = os.getenv('OPENAI_MODEL', 'gpt-4o')
        self.openai_summary_model = os.getenv('OPENAI_SUMMARY_MODEL', 'gpt-4o-mini')

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
                logger.info(f"OpenAI async client initialized (model: {self.openai_model})")
        except ImportError:
            logger.warning("OpenAI library not available")
        except Exception as e:
            logger.warning(f"Failed to initialize OpenAI client: {e}")

        if not self.anthropic_client and not self.openai_client:
            logger.error("No LLM clients available - chat workflow will use fallback mode")

        logger.info(f"Chat model provider: {self.chat_model_provider}")


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
            rank = eq.get('rank', 0) or 0  # Handle None values
            equipment_list.append(f"{i+1}. {eq.get('manufacturer', '')} {eq.get('model', '')} "
                                f"(rank: {rank:.2f}, description: {eq.get('description', '')})")

        equipment_text = "\n".join(equipment_list)

        prompt = CLASSIFICATION_PROMPT_TEMPLATE.format(
            user_query=user_query,
            equipment_text=equipment_text
        )

        try:
            # Use faster/cheaper model for classification with lower token limit
            response_text = await self._call_llm(
                prompt,
                model=self.openai_summary_model,
                max_tokens=500
            )

            # Parse JSON response - strip markdown code fences if present
            try:
                cleaned_text = response_text.strip()
                if cleaned_text.startswith('```'):
                    # Remove ```json or ``` from start and ``` from end
                    cleaned_text = cleaned_text.split('\n', 1)[1] if '\n' in cleaned_text else cleaned_text
                    cleaned_text = cleaned_text.rsplit('```', 1)[0] if '```' in cleaned_text else cleaned_text
                    cleaned_text = cleaned_text.strip()

                result = json.loads(cleaned_text)

                # Validate and set defaults
                result.setdefault("intent", "general_information")
                result.setdefault("confidence", 0.7)
                result.setdefault("complexity", "moderate")
                result.setdefault("complexity_score", 0.5)
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
                                conversation_summary: Optional[str] = None,
                                synthesis_model: Optional[str] = None,
                                doc_assets_results: Optional[Dict[str, Any]] = None) -> str:
        """
        Synthesize natural language response from structured data with conversation memory

        Args:
            user_query: Original user query
            systems_context: Equipment context
            synthesis_model: Optional model override (gpt-5 or gpt-4.1-mini), defaults to env var
            classification: Query classification results
            dip_results: Results from DIP table queries
            pinecone_results: Results from Pinecone search (optional)
            conversation_summary: Weighted conversation history (optional)
            doc_assets_results: Results from doc_assets retrieval (figures/tables)

        Returns:
            Natural language response
        """
        # Format context for LLM
        equipment_context = self._format_equipment_context(systems_context)
        dip_context = self._format_dip_context(dip_results)
        pinecone_context = self._format_pinecone_context(pinecone_results)
        doc_assets_context = self._format_doc_assets_context(doc_assets_results)

        intent = classification.get("intent", "general_information") if classification else "general_information"

        prompt = SYNTHESIS_PROMPT_TEMPLATE.format(
            personality_traits=PERSONALITY_TRAITS,
            user_query=user_query,
            equipment_context=equipment_context,
            conversation_summary=conversation_summary or "No previous conversation context.",
            dip_context=dip_context,
            pinecone_context=pinecone_context,
            doc_assets_context=doc_assets_context,
            intent=intent,
            format_rules=RESPONSE_FORMAT_RULES,
            synthesis_instructions=SYNTHESIS_INSTRUCTIONS
        )

        # Determine which model to use
        model_to_use = synthesis_model or self.openai_model
        complexity_score = classification.get("complexity_score", 0.5) if classification else 0.5

        # Set model-specific parameters
        if "gpt-5" in model_to_use.lower():
            # GPT-5: No reasoning_effort (not supported), high token limit, temperature=1 (only supported value)
            reasoning_effort = None
            max_tokens = 8000
            temperature = 1
            logger.info(f"🤖 Using GPT-5 with temperature={temperature}, max_tokens={max_tokens}")

        elif "gpt-4.1-mini" in model_to_use.lower():
            # GPT-4.1-mini: Use temperature, standard limit, no reasoning
            reasoning_effort = None
            max_tokens = 4000
            temperature = float(os.getenv('OPENAI_TEMPERATURE', '0'))
            logger.info(f"🤖 Using GPT-4.1-mini with temperature={temperature}, max_tokens={max_tokens}")

        else:
            # Fallback for other models (gpt-4o, etc)
            reasoning_effort = None
            max_tokens = 4000
            temperature = None
            logger.info(f"🤖 Using default model: {model_to_use} with max_tokens={max_tokens}")

        # Log the context being sent to LLM (full content for troubleshooting)
        logger.info("📦 LLM Synthesis Context:")
        logger.info(f"  Equipment: {equipment_context}")
        logger.info(f"  DIP Context: {dip_context}")
        logger.info(f"  Pinecone Context: {pinecone_context}")
        logger.info(f"  Complexity: {complexity_score:.2f}")

        try:
            response = await self._call_llm(
                prompt,
                model=model_to_use,
                max_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
                temperature=temperature
            )
            return response.strip()

        except Exception as e:
            logger.error(f"Response synthesis failed: {e}")
            return self._fallback_response(user_query, systems_context, dip_results)

    async def rank_chunks(self,
                         user_query: str,
                         chunks: List[Dict[str, Any]],
                         complexity_score: float) -> List[Dict[str, Any]]:
        """
        Rank and filter Pinecone chunks using Cohere Rerank API

        Args:
            user_query: User's question
            chunks: Pinecone search results
            complexity_score: Query complexity (0.0-1.0)

        Returns:
            Filtered list of chunks based on complexity, with Cohere relevance scores
        """
        if not chunks:
            return []

        # Determine chunk limit based on complexity
        if complexity_score <= 0.3:
            chunk_limit = 2  # Simple
        elif complexity_score <= 0.6:
            chunk_limit = 5  # Moderate
        else:
            chunk_limit = 10  # Complex

        # If we have fewer chunks than the limit, return all
        if len(chunks) <= chunk_limit:
            logger.info(f"🔍 Chunk filtering: {len(chunks)} chunks <= limit {chunk_limit}, using all")
            return chunks

        # Use Cohere Rerank for fast, accurate ranking
        try:
            logger.info(f"🔍 Cohere reranking {len(chunks[:10])} chunks for query: '{user_query}'")

            # Extract text content from chunks
            documents = [chunk.get('metadata', {}).get('text', '') for chunk in chunks[:10]]

            # Call Cohere Rerank API
            co = cohere.Client(os.getenv('COHERE_API_KEY'))
            response = co.rerank(
                model='rerank-v3.5',
                query=user_query,
                documents=documents,
                top_n=chunk_limit
            )

            # Build filtered chunks with Cohere relevance scores
            filtered_chunks = []
            for result in response.results:
                chunk = chunks[result.index].copy()
                chunk['score'] = result.relevance_score  # Replace Pinecone score with Cohere score
                filtered_chunks.append(chunk)

            logger.info(f"🔍 Cohere rerank: {len(chunks)} → {len(filtered_chunks)} chunks (complexity: {complexity_score:.2f}, limit: {chunk_limit}, top_score: {filtered_chunks[0]['score']:.3f})")

            return filtered_chunks

        except Exception as e:
            logger.warning(f"Cohere rerank failed, using top chunks: {e}")
            return chunks[:chunk_limit]

    # async def score_response(self,
    #                        user_query: str,
    #                        response: str,
    #                        dip_results: List[Dict[str, Any]],
    #                        systems_context: List[Dict[str, Any]]) -> Dict[str, Any]:
    #     """
    #     Score response quality and confidence
    #
    #     Args:
    #         user_query: Original user query
    #         response: Generated response
    #         dip_results: DIP query results used
    #         systems_context: Equipment context
    #
    #     Returns:
    #         Score breakdown with confidence level
    #     """
    #     total_results = sum(r.get('count', 0) for r in dip_results)
    #     equipment_count = len(systems_context)
    #
    #     prompt = SCORING_PROMPT_TEMPLATE.format(
    #         user_query=user_query,
    #         response=response,
    #         equipment_count=equipment_count,
    #         dip_table_count=len(dip_results),
    #         total_results=total_results
    #     )
    #
    #     try:
    #         score_text = await self._call_llm(prompt)
    #
    #         try:
    #             result = json.loads(score_text)
    #
    #             # Validate and set defaults
    #             result.setdefault("total_score", 70)
    #             result.setdefault("confidence", "medium")
    #             result.setdefault("breakdown", {})
    #             result.setdefault("confidence_emoji", "🟡")
    #             result.setdefault("reasoning", "Automated scoring")
    #
    #             return result
    #
    #         except json.JSONDecodeError:
    #             logger.warning("Failed to parse LLM scoring response")
    #             return self._fallback_scoring(total_results, equipment_count)
    #
    #     except Exception as e:
    #         logger.error(f"Response scoring failed: {e}")
    #         return self._fallback_scoring(total_results, equipment_count)

    async def _call_llm(self, prompt: str, model: str = None, max_tokens: int = 4000, reasoning_effort: str = None, temperature: float = None) -> str:
        """Call LLM with fallback between Anthropic and OpenAI with usage tracking

        Args:
            prompt: The prompt to send to the LLM
            model: Optional model override (defaults to self.openai_model)
            max_tokens: Maximum completion tokens (default 4000)
            reasoning_effort: Optional reasoning effort for GPT-5 ("medium" or "high")
            temperature: Optional temperature for non-reasoning models
        """
        start_time = datetime.now()

        # Use provided model or fall back to default
        selected_model = model or self.openai_model

        # Determine provider priority based on CHAT_MODEL env var
        use_openai_first = self.chat_model_provider == 'OPENAI'

        # Try OpenAI first if configured
        if use_openai_first and self.openai_client:
            try:
                # Log full prompt (no character limits)
                logger.info(f"📤 OpenAI Prompt ({selected_model}):")
                logger.info(f"{prompt}")

                # Build request parameters
                # For GPT-5: Split system and user messages
                if "gpt-5" in selected_model.lower():
                    # Extract personality from prompt (first line before "USER QUESTION:")
                    system_message = PERSONALITY_TRAITS
                    # Remove personality from user message
                    user_message = prompt.replace(PERSONALITY_TRAITS, "").strip()

                    request_params = {
                        "model": selected_model,
                        "messages": [
                            {"role": "system", "content": system_message},
                            {"role": "user", "content": user_message}
                        ],
                        "max_completion_tokens": max_tokens,
                        "temperature": temperature,
                        "stream": False
                    }
                else:
                    # Other models: Keep everything in user message
                    request_params = {
                        "model": selected_model,
                        "messages": [{
                            "role": "user",
                            "content": prompt
                        }],
                        "max_completion_tokens": max_tokens
                    }

                    # Add reasoning_effort for non-GPT-5 models if specified
                    if reasoning_effort:
                        request_params["reasoning_effort"] = reasoning_effort
                        logger.info(f"🧠 Using reasoning_effort={reasoning_effort}")

                    # Add temperature if specified (for non-reasoning models)
                    if temperature is not None:
                        request_params["temperature"] = temperature
                        logger.info(f"🌡️ Using temperature={temperature}")

                response = await self.openai_client.chat.completions.create(**request_params)

                # Log LLM usage metrics
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                usage = response.usage
                input_tokens = usage.prompt_tokens
                output_tokens = usage.completion_tokens
                total_tokens = usage.total_tokens

                # Pricing varies by model - using GPT-4o as baseline
                # Input: $2.50 per 1M tokens, Output: $10.00 per 1M tokens
                input_cost = (input_tokens / 1_000_000) * 2.50
                output_cost = (output_tokens / 1_000_000) * 10.00
                total_cost = input_cost + output_cost

                logger.info(f"💰 LLM Usage (OpenAI {selected_model})", {
                    "model": selected_model,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": total_tokens,
                    "duration_ms": round(duration_ms, 2),
                    "estimated_cost_usd": round(total_cost, 6),
                    "input_cost_usd": round(input_cost, 6),
                    "output_cost_usd": round(output_cost, 6)
                })

                # Debug: Log response content
                message = response.choices[0].message
                content = message.content
                logger.info(f"🔍 OpenAI Response Content: type={type(content)}, is_none={content is None}, length={len(content) if content else 0}")
                if content:
                    logger.info(f"🔍 First 200 chars: {content[:200]}")

                # Check for refusal
                if hasattr(message, 'refusal') and message.refusal:
                    logger.error(f"🚫 OpenAI Refusal: {message.refusal}")
                    return ""

                # Log full message object for debugging
                logger.info(f"🔍 Message object: {message}")

                return content

            except Exception as e:
                logger.warning(f"OpenAI call failed: {e}")
                # Fall through to Anthropic

        # Try Anthropic (Claude)
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

        # Try OpenAI as fallback if not tried first
        if not use_openai_first and self.openai_client:
            try:
                # Log full prompt (no character limits)
                logger.info(f"📤 OpenAI Prompt ({selected_model}):")
                logger.info(f"{prompt}")

                # Build request parameters for fallback
                # For GPT-5: Split system and user messages
                if "gpt-5" in selected_model.lower():
                    system_message = PERSONALITY_TRAITS
                    user_message = prompt.replace(PERSONALITY_TRAITS, "").strip()

                    request_params = {
                        "model": selected_model,
                        "messages": [
                            {"role": "system", "content": system_message},
                            {"role": "user", "content": user_message}
                        ],
                        "max_completion_tokens": max_tokens,
                        "temperature": temperature,
                        "stream": False
                    }
                else:
                    request_params = {
                        "model": selected_model,
                        "messages": [{
                            "role": "user",
                            "content": prompt
                        }],
                        "max_completion_tokens": max_tokens
                    }

                    # Add reasoning_effort for non-GPT-5 models if specified
                    if reasoning_effort:
                        request_params["reasoning_effort"] = reasoning_effort

                    # Add temperature if specified
                    if temperature is not None:
                        request_params["temperature"] = temperature

                response = await self.openai_client.chat.completions.create(**request_params)

                # Log LLM usage metrics
                duration_ms = (datetime.now() - start_time).total_seconds() * 1000
                usage = response.usage
                input_tokens = usage.prompt_tokens
                output_tokens = usage.completion_tokens
                total_tokens = usage.total_tokens

                # Pricing varies by model - using GPT-4o as baseline
                # Input: $2.50 per 1M tokens, Output: $10.00 per 1M tokens
                input_cost = (input_tokens / 1_000_000) * 2.50
                output_cost = (output_tokens / 1_000_000) * 10.00
                total_cost = input_cost + output_cost

                logger.info(f"💰 LLM Usage (OpenAI {selected_model})", {
                    "model": selected_model,
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

    def _format_doc_assets_context(self, doc_assets_results: Optional[Dict[str, Any]]) -> str:
        """Format doc_assets (figures/tables) for LLM prompts"""
        if not doc_assets_results:
            return "No relevant diagrams or tables found."

        assets = doc_assets_results.get("data", [])
        if not assets:
            return "No relevant diagrams or tables found."

        lines = []
        lines.append(f"Found {len(assets)} relevant diagram(s)/table(s) from the manual:")

        for i, asset in enumerate(assets):
            asset_kind = asset.get("asset_kind", "figure").upper()
            figure_ref = asset.get("figure_reference", "")
            title = asset.get("title", "")
            page = asset.get("page_number", "")
            description = asset.get("description", "")
            search_blob = asset.get("search_blob", "")

            # Build reference string
            ref_str = f"{asset_kind}"
            if figure_ref:
                ref_str += f" {figure_ref}"
            if title:
                ref_str += f": {title}"

            lines.append(f"\n{i+1}. {ref_str} (page {page})")

            # Include description if available
            if description:
                lines.append(f"   Shows: {description}")

            # Include search_blob summary (truncated for context)
            if search_blob:
                blob_preview = search_blob[:300] + "..." if len(search_blob) > 300 else search_blob
                lines.append(f"   Context: {blob_preview}")

        lines.append("\nWhen referencing these visuals, mention the figure number (e.g., 'See FIG. 3-8') so the user can locate them.")

        return "\n".join(lines)