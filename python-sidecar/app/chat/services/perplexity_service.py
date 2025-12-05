"""
Perplexity API service for real-world troubleshooting

This service queries Perplexity's sonar-pro model to find real-world
marine troubleshooting insights from forums, YouTube, and boat owner communities.
"""
import httpx
import logging
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)

# Intent to natural language mapping for Perplexity queries
INTENT_PHRASES = {
    "general_information": "We are looking for general information",
    "troubleshooting": "We are looking for troubleshooting information",
    "specifications": "We are looking for technical specifications",
    "installation": "We are looking for installation guidance",
    "maintenance": "We are looking for maintenance procedures",
    "how-to": "We are looking for step-by-step instructions",
    "comparison": "We are looking for comparison information"
}


class PerplexityService:
    """
    Service for querying Perplexity API with enhanced marine equipment queries
    """

    def __init__(self, api_key: str, model: str = "sonar-pro", timeout: int = 45):
        """
        Initialize Perplexity service

        Args:
            api_key: Perplexity API key
            model: Model to use (default: sonar-pro)
            timeout: Request timeout in seconds (default: 45)
        """
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.base_url = "https://api.perplexity.ai/chat/completions"

    def build_enhanced_query(
        self,
        user_query: str,
        equipment: List[Dict],
        pinecone_chunks: List[Dict],
        system_context: Dict,
        intent: str = "general_information"
    ) -> str:
        """
        Build enhanced Perplexity query from context

        Takes the user's natural language query and enhances it with:
        - Specific equipment model numbers
        - Technical features from manuals
        - Marine environment context
        - Target audience (cruisers, liveaboards)

        Args:
            user_query: Original user question (e.g., "pump erroring out")
            equipment: List of matched equipment with manufacturer/model
            pinecone_chunks: Top Pinecone results (for feature extraction)
            system_context: Vessel type, environment, etc.

        Returns:
            Enhanced query string optimized for Perplexity search

        Example:
            Input: "pump erroring out"
            Output: "Marco UP6/E 24V self-priming fresh water pump on a catamaran
                    is erroring out. The pump has electronic pressure sensor with
                    blue LED and multicolored LED diagnostics..."
        """
        # Extract primary equipment (highest rank)
        primary = equipment[0] if equipment else {}
        manufacturer = primary.get("manufacturer", "")
        model_name = primary.get("model", primary.get("model_name", ""))
        equipment_description = primary.get("description", "")

        # Extract key features from top Pinecone chunk
        features = []
        if pinecone_chunks:
            top_chunk = pinecone_chunks[0].get("text", "")
            top_chunk_lower = top_chunk.lower()

            # Look for electronic pressure sensor
            if "electronic pressure sensor" in top_chunk_lower:
                features.append("electronic pressure sensor")

            # Look for LED diagnostics
            if "blue led" in top_chunk_lower and "multicolored" in top_chunk_lower:
                features.append("blue LED and multicolored LED (red/green/yellow) diagnostics")

        # Check for control panel in equipment list
        has_control_panel = any(eq.get("model") == "control_panel" for eq in equipment)
        if has_control_panel and manufacturer:
            features.append(f"{manufacturer} control panel for remote monitoring")

        # Join features with proper grammar
        features_text = ". The system has ".join(features) if features else ""

        # Get system context
        vessel_type = system_context.get("vessel_type", "Balance 526 catamaran")
        environment = "marine environments"

        # Keep user's natural language (don't translate "erroring out" to technical terms)
        symptom = user_query

        # Target audience for marine context
        target_audience = "cruisers and liveaboards"

        # Get intent phrase (default to general_information if not in mapping)
        intent_phrase = INTENT_PHRASES.get(intent, "We are looking for general information")

        # Build query components
        intent_line = f"{intent_phrase}."

        # Build equipment identifier (handle missing fields gracefully)
        equipment_parts = [p for p in [manufacturer, model_name, equipment_description] if p]
        equipment_identifier = " ".join(equipment_parts) if equipment_parts else "marine equipment"

        base = f"{equipment_identifier} on a {vessel_type}: {symptom}"

        if features_text:
            feature_line = f"\n\nThe equipment has {features_text}."
        else:
            feature_line = ""

        # Ask for real-world insights from experienced boat owners
        ask = f"\n\nWhat are the most common real-world insights and practical advice that {target_audience} share about this in {environment}?"

        # Format instructions for concise, scannable output
        format_instruction = "\n\nProvide 3-5 concise, actionable bullet points. Be specific but brief."

        return f"{intent_line} {base}{feature_line}{ask}{format_instruction}"

    async def query(self, enhanced_query: str) -> Optional[Dict[str, Any]]:
        """
        Call Perplexity API with enhanced query

        Args:
            enhanced_query: The enhanced query string from build_enhanced_query()

        Returns:
            Dict with structure:
            {
                "answer": "The most common real-world causes...",
                "citations": ["https://...", "https://..."],
                "usage": {"prompt_tokens": 105, "completion_tokens": 983, ...},
                "model": "sonar-pro"
            }

            Returns None on any failure (timeout, API error, etc.)

        Error Handling:
            - Timeouts return None (no exception propagation)
            - API errors logged and return None
            - Network errors return None
            - All errors are graceful (allow workflow to continue)
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.base_url,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.model,
                        "messages": [{
                            "role": "user",
                            "content": enhanced_query
                        }],
                        "temperature": 0.3,  # Focused, factual responses
                        "max_tokens": 800   # Concise, actionable responses
                    }
                )

                if response.status_code != 200:
                    logger.error(
                        f"Perplexity API error: {response.status_code} {response.text}",
                        extra={
                            "status_code": response.status_code,
                            "query_preview": enhanced_query[:100]
                        }
                    )
                    return None

                data = response.json()

                # Extract relevant fields
                return {
                    "answer": data["choices"][0]["message"]["content"],
                    "citations": data.get("citations", []),
                    "usage": data.get("usage", {}),
                    "model": data.get("model", self.model)
                }

        except httpx.TimeoutException:
            logger.error(
                f"Perplexity API timeout after {self.timeout}s",
                extra={
                    "timeout_seconds": self.timeout,
                    "query_preview": enhanced_query[:100]
                }
            )
            return None

        except httpx.HTTPError as e:
            logger.error(
                f"Perplexity HTTP error: {str(e)}",
                extra={
                    "error_type": type(e).__name__,
                    "query_preview": enhanced_query[:100]
                }
            )
            return None

        except Exception as e:
            logger.error(
                f"Perplexity unexpected error: {str(e)}",
                extra={
                    "error_type": type(e).__name__,
                    "query_preview": enhanced_query[:100]
                }
            )
            return None
