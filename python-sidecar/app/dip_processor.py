"""
DIP (Document Intelligence Packet) Processor
Extracts entities, spec hints, and golden tests from document content
"""

import json
import re
import time
import os
import requests
import io
from typing import List, Dict, Any, Optional
from pathlib import Path
import logging
import anthropic

from .models import DIPEntity, DIPSpecHint, DIPGoldenTest, PageElement, Table, BoundingBox
from .supabase_storage import supabase_storage

logger = logging.getLogger(__name__)

class DIPProcessor:
    """Processes document content to extract DIP components"""
    
    def __init__(self):
        self.entity_patterns = {
            'manufacturer': [
                r'(?:manufacturer|made by|produced by|brand):\s*([A-Za-z\s&.,-]+)',
                r'([A-Za-z\s&.,-]+)\s+(?:inc\.|corp\.|ltd\.|llc\.|company|co\.)',
                r'([A-Za-z\s&.,-]+)\s+(?:technologies|systems|equipment|machinery)',
                r'([A-Za-z\s&.,-]+)\s+(?:grill|oven|furnace|heater|burner)',
            ],
            'model': [
                r'(?:model|part number|pn|part no|sku):\s*([A-Z0-9\s\-\.]+)',
                r'model\s+([A-Z0-9\s\-\.]+)',
                r'(?:series|type|version):\s*([A-Z0-9\s\-\.]+)',
                r'([A-Z0-9\s\-\.]+)\s+(?:model|series|type)',
            ],
            'specification': [
                r'(?:spec|specification|rating):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:rated|nominal|maximum|minimum|max|min):\s*([0-9\.\s]+)\s*([A-Za-z]+)',
                r'(?:capacity|output|input|power):\s*([0-9\.\s]+)\s*([A-Za-z]+)',
                r'(?:dimensions|size|measurements):\s*([0-9\.\s]+)\s*(?:x|by|×)\s*([0-9\.\s]+)',
            ],
            'warning': [
                r'(?:warning|caution|danger|note|important|attention):\s*([A-Za-z0-9\s\-\.!]+)',
                r'⚠️\s*([A-Za-z0-9\s\-\.!]+)',
                r'(?:do not|never|avoid|prevent):\s*([A-Za-z0-9\s\-\.!]+)',
                r'(?:hot surface|high temperature|electrical hazard):\s*([A-Za-z0-9\s\-\.!]+)',
            ],
            'procedure': [
                r'(?:step|procedure|instruction|operation):\s*([0-9]+)\.?\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:to|for|how to|how do you):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:start|begin|initiate|activate):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:turn on|switch on|power on):\s*([A-Za-z0-9\s\-\.]+)',
            ],
            'material': [
                r'(?:material|construction|made of|fabricated from):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:stainless steel|aluminum|steel|cast iron|ceramic):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:coating|finish|surface):\s*([A-Za-z0-9\s\-\.]+)',
            ],
            'certification': [
                r'(?:certified|approved|listed|compliant):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:ul|ce|fcc|fda|nsf|ansi):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:meets|conforms to):\s*([A-Za-z0-9\s\-\.]+)',
            ]
        }
        
        self.spec_hint_patterns = {
            'pressure': [
                r'([0-9\.]+)\s*(?:psi|bar|pa|kpa|mpa)\s*(?:pressure|psig|psia)',
                r'pressure:\s*([0-9\.]+)\s*(psi|bar|pa|kpa|mpa)',
                r'(?:operating|working|max|min)\s+pressure:\s*([0-9\.]+)\s*(psi|bar|pa|kpa|mpa)',
                r'([0-9\.]+)\s*(?:psi|bar|pa|kpa|mpa)\s*(?:operating|working|maximum|minimum)',
            ],
            'temperature': [
                r'([0-9\.]+)\s*(?:°c|°f|celsius|fahrenheit|deg)\s*(?:temperature|temp)',
                r'temperature:\s*([0-9\.]+)\s*(°c|°f|celsius|fahrenheit)',
                r'(?:operating|working|max|min)\s+temperature:\s*([0-9\.]+)\s*(°c|°f|celsius|fahrenheit)',
                r'([0-9\.]+)\s*(?:°c|°f|celsius|fahrenheit)\s*(?:operating|working|maximum|minimum)',
                r'(?:heat|heating|cooling)\s+to\s+([0-9\.]+)\s*(°c|°f|celsius|fahrenheit)',
            ],
            'voltage': [
                r'([0-9\.]+)\s*(?:v|volts|voltage|dc|ac)',
                r'voltage:\s*([0-9\.]+)\s*(v|volts|dc|ac)',
                r'(?:input|output|operating)\s+voltage:\s*([0-9\.]+)\s*(v|volts|dc|ac)',
                r'([0-9\.]+)\s*(?:v|volts|dc|ac)\s*(?:input|output|operating)',
                r'(?:120|240|110|220|12|24|48)\s*(?:v|volts|dc|ac)',
            ],
            'flow_rate': [
                r'([0-9\.]+)\s*(?:gpm|lpm|cfm|gph|lph)\s*(?:flow|rate)',
                r'flow rate:\s*([0-9\.]+)\s*(gpm|lpm|cfm|gph|lph)',
                r'(?:air|gas|water)\s+flow:\s*([0-9\.]+)\s*(gpm|lpm|cfm|gph|lph)',
                r'([0-9\.]+)\s*(?:gpm|lpm|cfm|gph|lph)\s*(?:air|gas|water)\s+flow',
            ],
            'dimension': [
                r'([0-9\.]+)\s*(?:in|inch|inches|mm|cm|ft|feet)\s*(?:x|by|×)\s*([0-9\.]+)\s*(?:in|inch|inches|mm|cm|ft|feet)',
                r'size:\s*([0-9\.]+)\s*(?:x|by|×)\s*([0-9\.]+)\s*(?:in|inch|inches|mm|cm|ft|feet)',
                r'dimensions:\s*([0-9\.]+)\s*(?:x|by|×)\s*([0-9\.]+)\s*(?:x|by|×)\s*([0-9\.]+)\s*(?:in|inch|inches|mm|cm|ft|feet)',
                r'(?:length|width|height|depth):\s*([0-9\.]+)\s*(?:in|inch|inches|mm|cm|ft|feet)',
            ],
            'power': [
                r'([0-9\.]+)\s*(?:w|watts|kw|kilowatts|hp|horsepower)',
                r'power:\s*([0-9\.]+)\s*(w|watts|kw|kilowatts|hp|horsepower)',
                r'(?:rated|maximum|nominal)\s+power:\s*([0-9\.]+)\s*(w|watts|kw|kilowatts|hp|horsepower)',
                r'([0-9\.]+)\s*(?:w|watts|kw|kilowatts|hp|horsepower)\s*(?:rated|maximum|nominal)',
            ],
            'capacity': [
                r'([0-9\.]+)\s*(?:lbs|pounds|kg|kilograms|tons|gallons|liters)',
                r'capacity:\s*([0-9\.]+)\s*(lbs|pounds|kg|kilograms|tons|gallons|liters)',
                r'(?:cooking|grilling|heating)\s+capacity:\s*([0-9\.]+)\s*(lbs|pounds|kg|kilograms)',
                r'([0-9\.]+)\s*(?:lbs|pounds|kg|kilograms)\s*(?:cooking|grilling|heating)\s+capacity',
            ],
            'efficiency': [
                r'([0-9\.]+)\s*(?:%|percent)\s*(?:efficiency|efficient)',
                r'efficiency:\s*([0-9\.]+)\s*(%|percent)',
                r'(?:thermal|energy|fuel)\s+efficiency:\s*([0-9\.]+)\s*(%|percent)',
                r'([0-9\.]+)\s*(?:%|percent)\s*(?:thermal|energy|fuel)\s+efficiency',
            ]
        }
        
        self.golden_test_patterns = {
            'procedure': [
                r'(?:test|check|verify|validate):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:step|procedure)\s+([0-9]+):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:operation|maintenance|cleaning|inspection):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:startup|shutdown|initialization):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:troubleshooting|diagnostic|repair):\s*([A-Za-z0-9\s\-\.]+)',
            ],
            'checklist': [
                r'□\s*([A-Za-z0-9\s\-\.]+)',
                r'☐\s*([A-Za-z0-9\s\-\.]+)',
                r'•\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:check|verify|ensure|confirm):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:before|after|during)\s+(?:use|operation|startup):\s*([A-Za-z0-9\s\-\.]+)',
            ],
            'measurement': [
                r'(?:measure|check|verify)\s+([A-Za-z0-9\s\-\.]+)\s*(?:with|using)\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:reading|value)\s+(?:should be|must be|is)\s*([0-9\.]+)\s*([A-Za-z]+)',
                r'(?:temperature|pressure|voltage|current)\s+(?:reading|measurement):\s*([0-9\.]+)\s*([A-Za-z]+)',
                r'(?:calibrate|adjust|set)\s+(?:to|at)\s*([0-9\.]+)\s*([A-Za-z]+)',
            ],
            'safety': [
                r'(?:safety|precaution|warning)\s+(?:check|test|verify):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:emergency|shutdown|stop)\s+(?:procedure|test):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:fire|gas|electrical)\s+(?:safety|hazard)\s+(?:check|test):\s*([A-Za-z0-9\s\-\.]+)',
            ],
            'performance': [
                r'(?:performance|efficiency|output)\s+(?:test|check|verify):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:load|stress|endurance)\s+(?:test|check):\s*([A-Za-z0-9\s\-\.]+)',
                r'(?:quality|functionality)\s+(?:test|check|verify):\s*([A-Za-z0-9\s\-\.]+)',
            ]
        }
        
        # Initialize Anthropic client with environment-driven configuration
        self.anthropic_client = None
        anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')
        if anthropic_api_key:
            self.anthropic_client = anthropic.Anthropic(api_key=anthropic_api_key)
            
            # Load model configuration from environment
            self.anthropic_model = os.getenv('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022')
            self.anthropic_max_tokens = int(os.getenv('ANTHROPIC_MAX_TOKENS', '8000'))
            self.anthropic_temperature = float(os.getenv('ANTHROPIC_TEMPERATURE', '0') or '0')
            
            logger.info(f"Anthropic client initialized with model: {self.anthropic_model}")
        else:
            logger.warning("ANTHROPIC_API_KEY not found - playbook extraction will be disabled")
        
        # Provider selection
        self.playbook_provider = os.getenv('PLAYBOOK_EXTRACTION_PROVIDER', 'anthropic').lower()
        logger.info(f"Playbook extraction provider: {self.playbook_provider}")
        
        # ROLLBACK: To revert to OpenAI, replace the above with:
        # from openai import OpenAI
        # self.openai_client = None
        # openai_api_key = os.getenv('OPENAI_API_KEY')
        # if openai_api_key:
        #     self.openai_client = OpenAI(api_key=openai_api_key)
        #     
        #     # Load model configuration from environment
        #     self.openai_model = os.getenv('OPENAI_MODEL', 'gpt-4o-mini')
        #     self.openai_max_tokens = int(os.getenv('OPENAI_MAX_TOKENS', '8000'))
        #     self.openai_temperature = float(os.getenv('OPENAI_TEMPERATURE', '0'))
        #     
        #     logger.info(f"OpenAI client initialized with model: {self.openai_model}")
        # else:
        #     logger.warning("OPENAI_API_KEY not found - playbook extraction will be disabled")
        
        # TEMPORARY: Initialize OpenAI client for provider switching
        self.openai_client = None
        openai_api_key = os.getenv('OPENAI_API_KEY')
        if openai_api_key:
            from openai import OpenAI
            self.openai_client = OpenAI(api_key=openai_api_key)
            
            # Load model configuration from environment
            self.openai_model = os.getenv('OPENAI_MODEL', 'gpt-4o-mini')
            self.openai_max_tokens = int(os.getenv('OPENAI_MAX_TOKENS', '8000'))
            # Prefer LLM_TEMPERATURE if set, otherwise fallback to OPENAI_TEMPERATURE
            temp_value = os.getenv('LLM_TEMPERATURE') or os.getenv('OPENAI_TEMPERATURE', '0')
            self.openai_temperature = float(temp_value) if temp_value else 0.0
            
            logger.info(
                f"OpenAI client initialized with model={self.openai_model}, "
                f"temp={self.openai_temperature}, "
                f"max_tokens={self.openai_max_tokens}"
            )
        else:
            logger.warning("OPENAI_API_KEY not found - OpenAI playbook extraction will be disabled")

    def extract_entities(self, elements: List[PageElement]) -> List[DIPEntity]:
        """Extract entities from document elements"""
        entities = []
        
        for element in elements:
            if element.element_type in ['text', 'ocr']:
                content = element.content.lower()
                
                for entity_type, patterns in self.entity_patterns.items():
                    for pattern in patterns:
                        try:
                            matches = re.finditer(pattern, content, re.IGNORECASE)
                            for match in matches:
                                if match.groups():
                                    value = match.group(1).strip()
                                    if len(value) > 2:  # Filter out very short matches
                                        confidence = self._calculate_confidence(match, content)
                                        context = self._extract_context(content, match.start(), match.end())
                                        
                                        entity = DIPEntity(
                                            entity_type=entity_type,
                                            value=value,
                                            confidence=confidence,
                                            page=element.page,
                                            context=context,
                                            bbox=element.bbox
                                        )
                                        entities.append(entity)
                        except Exception as e:
                            logger.warning(f"Error processing entity pattern {pattern}: {e}")
                            continue
        
        return entities

    def extract_spec_hints(self, elements: List[PageElement]) -> List[DIPSpecHint]:
        """Extract specification hints from document elements"""
        spec_hints = []
        
        for element in elements:
            if element.element_type in ['text', 'ocr']:
                content = element.content.lower()
                
                for hint_type, patterns in self.spec_hint_patterns.items():
                    for pattern in patterns:
                        try:
                            matches = re.finditer(pattern, content, re.IGNORECASE)
                            for match in matches:
                                if match.groups():
                                    value = match.group(1).strip()
                                    # Try to extract unit from the match groups first
                                    unit = match.group(2).strip() if len(match.groups()) > 1 and match.group(2) else None
                                    
                                    # If no unit found in groups, try to extract from surrounding text
                                    if not unit:
                                        unit = self._extract_unit_from_text(content, match.start(), match.end())
                                    
                                    if len(value) > 0:
                                        confidence = self._calculate_confidence(match, content)
                                        context = self._extract_context(content, match.start(), match.end())
                                        
                                        spec_hint = DIPSpecHint(
                                            hint_type=hint_type,
                                            value=value,
                                            unit=unit,
                                            page=element.page,
                                            context=context,
                                            confidence=confidence,
                                            bbox=element.bbox
                                        )
                                        spec_hints.append(spec_hint)
                        except Exception as e:
                            logger.warning(f"Error processing spec hint pattern {pattern}: {e}")
                            continue
        
        return spec_hints

    def _extract_unit_from_text(self, text: str, match_start: int, match_end: int) -> str:
        """Extract unit from text around the matched spec value"""
        # Look for unit patterns after the number
        unit_patterns = [
            r'(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>[A-Za-z%°]+(?:/[A-Za-z%°]+)?)',
            r'(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>V(?:DC|AC)?|W|A|bar|psi|°[CF]|gpm|lpm)',
        ]
        
        for pattern in unit_patterns:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for match in matches:
                if match.start() >= match_start and match.end() <= match_end + 10:
                    unit = match.group('unit')
                    if unit:
                        return self._normalize_unit_text(unit)
        return None

    def _normalize_unit_text(self, unit_text: str) -> str:
        """Normalize unit text by joining adjacent unit-like tokens"""
        if not unit_text:
            return None
        
        # Clean and normalize
        normalized = unit_text.strip().upper()
        
        # Handle common OCR artifacts and join adjacent tokens
        # "V DC" -> "VDC", "kg m²" -> "kg/m²"
        normalized = re.sub(r'\s+', '', normalized)  # Remove spaces
        
        return normalized if normalized else None

    def extract_golden_tests(self, elements: List[PageElement]) -> List[DIPGoldenTest]:
        """Extract golden test cases from document elements"""
        golden_tests = []
        
        for element in elements:
            if element.element_type in ['text', 'ocr']:
                content = element.content.lower()
                
                for test_type, patterns in self.golden_test_patterns.items():
                    for pattern in patterns:
                        try:
                            matches = re.finditer(pattern, content, re.IGNORECASE)
                            for match in matches:
                                if match.groups():
                                    description = match.group(1).strip()
                                    
                                    if len(description) > 5:  # Filter out very short matches
                                        confidence = self._calculate_confidence(match, content)
                                        context = self._extract_context(content, match.start(), match.end())
                                        
                                        # Extract steps if it's a procedure
                                        steps = self._extract_steps(content, match.start())
                                        
                                        golden_test = DIPGoldenTest(
                                            test_name=f"{test_type.title()} Test",
                                            test_type=test_type,
                                            description=description,
                                            steps=steps,
                                            expected_result=context,  # Use actual context instead of placeholder
                                            page=element.page,
                                            confidence=confidence,
                                            bbox=element.bbox
                                        )
                                        golden_tests.append(golden_test)
                                        logger.debug(f"[GOLDEN TEST] Added: desc='{description}', expected='{context[:80]}...'")
                        except Exception as e:
                            logger.warning(f"Error processing golden test pattern {pattern}: {e}")
                            continue
        
        return golden_tests

    def extract_playbook_hints(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Extract procedural / imperative instructions as playbook hints"""
        playbook_hints = []
        imperative_patterns = [
            r'^(?:always|never|do not|disconnect|remove|insert|replace|check|clean|use|fill|preheat|turn|press|close)\b.*',
            r'.*prior to.*',
            r'.*when not in use.*',
        ]

        for chunk in chunks:
            text = chunk.get("content", "")
            page = chunk.get("page", None)
            for line in text.split("\n"):
                stripped = line.strip()
                for pat in imperative_patterns:
                    if re.match(pat, stripped, flags=re.IGNORECASE):
                        playbook_hints.append({
                            "hint": stripped,
                            "page": page,
                            "confidence": 0.8
                        })
                        break
        return playbook_hints

    async def extract_playbook_hints_anthropic(self, doc_id: str, chunks: List[Dict]) -> List[Dict[str, Any]]:
        """Extract playbook procedures using selected provider (OpenAI or Anthropic)"""
        
        # Branch based on provider selection
        if self.playbook_provider == 'openai':
            return await self._extract_playbook_hints_openai(doc_id, chunks)
        else:
            return await self._extract_playbook_hints_anthropic_impl(doc_id, chunks)
    
    async def _extract_playbook_hints_anthropic_impl(self, doc_id: str, chunks: List[Dict]) -> List[Dict[str, Any]]:
        """Extract playbook procedures using Anthropic with PDF content"""
        if not self.anthropic_client:
            logger.warning("Anthropic client not available - skipping playbook extraction")
            return []
        
        try:
            logger.info(f"Starting Anthropic playbook extraction for document {doc_id}")
            
            # Combine all chunk content into a single document
            document_text = ""
            for chunk in chunks:
                document_text += f"Page {chunk.get('page', 1)}: {chunk.get('content', '')}\n\n"
            
            # Limit document size to avoid token limits (roughly 300k characters)
            if len(document_text) > 300000:
                document_text = document_text[:300000]
                logger.info(f"Document truncated to 300k characters for Anthropic processing")
            
            # Your exact prompt
            system_prompt = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
If you add ANY text outside the JSON brackets, the system will fail.

TASK: Extract ALL procedures, error codes, and maintenance steps from technical manuals.
INCLUDE EVERYTHING: installation, setup, operation, troubleshooting, maintenance, cleaning, error resolution, safety procedures.
OUTPUT FORMAT (copy exactly):
{"procedures":[{"title":"string","preconditions":["string"],"steps":["string"],"expected_outcome":"string","models":["string"],"error_codes":["string"]}]}

RULES:
- Extract ALL procedures found in the manual
- Include installation, operation, maintenance, troubleshooting, cleaning procedures
- Include all error codes and their resolution steps
- Extract every procedure or sub-procedure as its own entry
- If a section has multiple modes or features (such as cooking modes), create separate procedures for each. Do not merge them
- Safety and lock features must always be their own procedure
- Cleaning and maintenance routines must always be their own procedure
- Error codes and their resolutions must be included as their own procedure
- For installation content: merge and cap at 2 procedures total (Unpacking/Setup and Countertop/Connections)
- Exclude recipes or non-technical content
- Start response with { character
- End response with } character
- No explanatory text before JSON
- No explanatory text after JSON
- No markdown code blocks
- No 'Here is the JSON:' or similar phrases"""

            user_prompt = f"""Extract all actionable procedures from this technical manual:

{document_text}"""
            
            # Call Anthropic API
            response = self.anthropic_client.messages.create(
                model=self.anthropic_model,
                max_tokens=self.anthropic_max_tokens,  # Use environment variable
                temperature=self.anthropic_temperature,
                system=system_prompt,
                messages=[
                    {"role": "user", "content": user_prompt}
                ]
            )
            
            # ROLLBACK: To revert to OpenAI, replace the above with:
            # # Advanced system prompt (same as Anthropic)
            # system_prompt = """CRITICAL: You MUST respond with ONLY pure JSON. No explanations, no text before or after JSON.
            # FORMAT REQUIREMENT: Output must start with { and end with }. Nothing else.
            # If you add ANY text outside the JSON brackets, the system will fail.
            #
            # TASK: Extract ALL procedures, error codes, and maintenance steps from technical manuals.
            # INCLUDE EVERYTHING: installation, setup, operation, troubleshooting, maintenance, cleaning, error resolution, safety procedures.
            # OUTPUT FORMAT (copy exactly):
            # {"procedures":[{"title":"string","preconditions":["string"],"steps":["string"],"expected_outcome":"string","models":["string"],"error_codes":["string"]}]}
            #
            # RULES:
            # - Extract ALL procedures found in the manual
            # - Include installation, operation, maintenance, troubleshooting, cleaning procedures
            # - Include all error codes and their resolution steps
            # - Start response with { character
            # - End response with } character
            # - No explanatory text before JSON
            # - No explanatory text after JSON
            # - No markdown code blocks
            # - No 'Here is the JSON:' or similar phrases"""
            #
            # # Limit document size to avoid token limits (roughly 300k characters)
            # if len(document_text) > 300000:
            #     document_text = document_text[:300000]
            #     logger.info(f"Document truncated to 300k characters for OpenAI processing")
            #
            # response = self.openai_client.chat.completions.create(
            #     model=self.openai_model,
            #     messages=[
            #         {"role": "system", "content": system_prompt},
            #         {"role": "user", "content": user_prompt}
            #     ],
            #     max_tokens=self.openai_max_tokens,
            #     temperature=self.openai_temperature
            # )
            
            # Parse the response with robust error handling
            if response.content and len(response.content) > 0:
                response_content = response.content[0].text
            else:
                logger.error("Empty response from Anthropic API")
                return []
            
            logger.info(f"Anthropic response received for document {doc_id}")
            logger.info(f"Raw response content: {response_content}")  # Show full response
            
            # ROLLBACK: To revert to OpenAI, replace the above with:
            # # Parse the response with robust error handling
            # if response.choices and len(response.choices) > 0:
            #     response_content = response.choices[0].message.content
            # else:
            #     logger.error("Empty response from OpenAI API")
            #     return []
            # 
            # logger.info(f"OpenAI response received for document {doc_id}")
            # logger.info(f"Raw response content: {response_content}")  # Show full response
            # 
            # # Extract JSON from response (handles explanatory text + markdown)
            # json_content = response_content.strip()
            #
            # # Remove markdown code blocks if present
            # if '```json' in json_content:
            #     json_start = json_content.find('```json') + 7
            #     json_end = json_content.find('```', json_start)
            #     if json_end != -1:
            #         json_content = json_content[json_start:json_end].strip()
            #     else:
            #         json_content = json_content[json_start:].strip()
            #
            # # Find JSON object start if there's explanatory text
            # json_start_pos = json_content.find('{')
            # if json_start_pos > 0:
            #     json_content = json_content[json_start_pos:].strip()
            #
            # # Find JSON object end (handle potential trailing text)
            # brace_count = 0
            # json_end_pos = -1
            # for i, char in enumerate(json_content):
            #     if char == '{':
            #         brace_count += 1
            #     elif char == '}':
            #         brace_count -= 1
            #         if brace_count == 0:
            #             json_end_pos = i + 1
            #             break
            #
            # if json_end_pos > 0:
            #     json_content = json_content[:json_end_pos].strip()
            #
            # logger.info("=" * 80)
            logger.info("CLEANED JSON CONTENT - NO LIMITS:")
            logger.info("=" * 80)
            logger.info(json_content)
            logger.info("=" * 80)
            logger.info("END OF CLEANED JSON CONTENT")
            logger.info("=" * 80)
            
            # Extract JSON from response (handles explanatory text + markdown)
            json_content = response_content.strip()

            # Remove markdown code blocks if present
            if '```json' in json_content:
                json_start = json_content.find('```json') + 7
                json_end = json_content.find('```', json_start)
                if json_end != -1:
                    json_content = json_content[json_start:json_end].strip()
                else:
                    json_content = json_content[json_start:].strip()

            # Find JSON object start if there's explanatory text
            json_start_pos = json_content.find('{')
            if json_start_pos > 0:
                json_content = json_content[json_start_pos:].strip()

            # Find JSON object end (handle potential trailing text)
            brace_count = 0
            json_end_pos = -1
            for i, char in enumerate(json_content):
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        json_end_pos = i + 1
                        break

            if json_end_pos > 0:
                json_content = json_content[:json_end_pos].strip()

            logger.info("=" * 80)
            logger.info("CLEANED JSON CONTENT - NO LIMITS:")
            logger.info("=" * 80)
            logger.info(json_content)
            logger.info("=" * 80)
            logger.info("END OF CLEANED JSON CONTENT")
            logger.info("=" * 80)

            # Parse JSON response
            try:
                parsed_response = json.loads(json_content)
                procedures = parsed_response.get('procedures', [])
                
                # Convert to the format expected by the staging table
                playbook_hints = []
                for procedure in procedures:
                    playbook_hint = {
                        'id': f"{doc_id}_{len(playbook_hints) + 1}",
                        'title': procedure.get('title', ''),
                        'procedures': [procedure],  # Store the full procedure in the procedures JSONB field
                        'preconditions': procedure.get('preconditions', []),
                        'error_codes': procedure.get('error_codes', []),
                        'related_procedures': [],  # Could be populated from cross-references
                        'page_references': [],  # Could be populated from chunk page numbers
                        'category': self._categorize_procedure(procedure.get('title', '')),
                        'system_norm': '',  # Will be populated based on models
                        'subsystem_norm': '',  # Will be populated based on models
                        'doc_id': doc_id,
                        'created_at': time.time(),
                        'confidence': 0.9  # High confidence for AI extraction
                    }
                    playbook_hints.append(playbook_hint)
                
                logger.info(f"Successfully extracted {len(playbook_hints)} playbook procedures for document {doc_id}")
                return playbook_hints
                
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse Anthropic JSON response for document {doc_id}: {e}")
                return []
                
        except Exception as e:
            logger.error(f"Anthropic playbook extraction failed for document {doc_id}: {e}")
            return []
    
    async def _extract_playbook_hints_openai(self, doc_id: str, chunks: List[Dict]) -> List[Dict[str, Any]]:
        """Extract playbook procedures using OpenAI with PDF content"""
        if not hasattr(self, 'openai_client') or not self.openai_client:
            logger.warning("OpenAI client not available - skipping playbook extraction")
            return []
        
        try:
            logger.info(f"Starting OpenAI playbook extraction for document {doc_id}")
            
            # Combine all chunk content into a single document
            document_text = ""
            for chunk in chunks:
                document_text += f"Page {chunk.get('page', 1)}: {chunk.get('content', '')}\n\n"
            
            # Advanced system prompt (same as Anthropic)
            system_prompt = """You are an information extractor. Output only valid JSON.

TASK: Extract all procedures, error codes, and maintenance steps from this manual.

RULES:
- Every procedure or sub-procedure must be a separate entry.
- If a section has multiple modes or features, output one procedure per mode/feature (never merge them).
- Safety/lock features must always be their own procedure.
- Cleaning and maintenance routines must always be their own procedure.
- Error codes and resolutions must always be their own procedure.
- Installation content must be capped at 2 consolidated procedures (Unpacking/Setup and Countertop/Connections).
- Exclude recipes or non-technical content.
- The output must be a JSON object with one key: "procedures".
- Each procedure object must include: title, preconditions, steps, expected_outcome, models, error_codes.
"""

            # Download PDF from Supabase storage and upload to OpenAI
            logger.info(f"Downloading PDF from Supabase storage for document {doc_id}")
            
            # Get Supabase credentials
            supabase_url = os.getenv('SUPABASE_URL')
            supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
            
            if not supabase_url or not supabase_key:
                logger.error("Supabase configuration missing")
                return []
            
            # Download PDF from Supabase storage
            url = supabase_url.rstrip("/")
            headers = {
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}"
            }
            
            # Get the PDF file from storage
            pdf_response = requests.get(
                f"{url}/storage/v1/object/documents/manuals/{doc_id}/145775-48VDC-SINGLE-ZONE-INTELLIKEN-GRILL-1-1.pdf",
                headers=headers
            )
            
            if pdf_response.status_code != 200:
                logger.error(f"Failed to download PDF from storage: {pdf_response.status_code}")
                return []
            
            # Upload PDF to OpenAI - wrap bytes in file-like object
            logger.info(f"Uploading PDF file to OpenAI for document {doc_id}")
            pdf_file = io.BytesIO(pdf_response.content)
            pdf_file.name = f"{doc_id}.pdf"  # OpenAI needs a filename
            
            uploaded_file = self.openai_client.files.create(
                file=pdf_file,  # ✅ Now it's a file-like object
                purpose="assistants"
            )
            logger.info(f"File uploaded with ID: {uploaded_file.id}")

            user_prompt = "Extract all actionable procedures from this technical manual."
            
            response = self.openai_client.responses.create(
                model=self.openai_model,
                instructions=system_prompt,   # replaces system role
                input=[
                    {"type": "message", "role": "user", "content": user_prompt}
                ],
                max_output_tokens=self.openai_max_tokens,
                temperature=self.openai_temperature,
                metadata={"doc_id": doc_id, "file_id": uploaded_file.id}  # document and file reference in metadata
            )
            
            # Parse the response with robust error handling
            if response.output and len(response.output) > 0:
                # Look for the message output (not reasoning)
                message_output = None
                for output_item in response.output:
                    if hasattr(output_item, 'type') and output_item.type == 'message':
                        message_output = output_item
                        break
                
                if message_output and hasattr(message_output, 'content') and message_output.content:
                    response_content = message_output.content[0].text
                else:
                    logger.error("No message output found in OpenAI response")
                    return []
            else:
                logger.error("Empty response from OpenAI API")
                return []
            
            logger.info(f"OpenAI response received for document {doc_id}")
            logger.info(f"Raw response length: {len(response_content)} characters")
            logger.info("=" * 80)
            logger.info("COMPLETE OPENAI RESPONSE - NO LIMITS:")
            logger.info("=" * 80)
            logger.info(response_content)
            logger.info("=" * 80)
            logger.info("END OF COMPLETE OPENAI RESPONSE")
            logger.info("=" * 80)
            
            # Parse JSON response
            try:
                parsed_response = json.loads(response_content)
                procedures = parsed_response.get('procedures', [])
                
                # Convert to the format expected by the staging table
                playbook_hints = []
                for procedure in procedures:
                    playbook_hint = {
                        'id': f"{doc_id}_{len(playbook_hints) + 1}",
                        'title': procedure.get('title', ''),
                        'procedures': [procedure],  # Store the full procedure in the procedures JSONB field
                        'preconditions': procedure.get('preconditions', []),
                        'error_codes': procedure.get('error_codes', []),
                        'related_procedures': [],  # Could be populated from cross-references
                        'page_references': [],  # Could be populated from chunk page numbers
                        'category': self._categorize_procedure(procedure.get('title', '')),
                        'system_norm': '',  # Will be populated based on models
                        'subsystem_norm': '',  # Will be populated based on models
                        'doc_id': doc_id,
                        'created_at': time.time(),
                        'confidence': 0.9  # High confidence for AI extraction
                    }
                    playbook_hints.append(playbook_hint)
                
                logger.info(f"Successfully extracted {len(playbook_hints)} playbook procedures for document {doc_id}")
                return playbook_hints
                
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse OpenAI JSON response for document {doc_id}: {e}")
                return []
                
        except Exception as e:
            logger.error(f"OpenAI playbook extraction failed for document {doc_id}: {e}")
            return []

    def _categorize_procedure(self, title: str) -> str:
        """Categorize procedure based on title content"""
        title_lower = title.lower()
        
        if any(word in title_lower for word in ['install', 'setup', 'mount', 'connect']):
            return 'installation'
        elif any(word in title_lower for word in ['start', 'stop', 'power', 'on', 'off', 'shutdown']):
            return 'operation'
        elif any(word in title_lower for word in ['troubleshoot', 'diagnose', 'fix', 'repair', 'error']):
            return 'troubleshooting'
        elif any(word in title_lower for word in ['maintain', 'clean', 'service', 'inspect', 'check']):
            return 'maintenance'
        elif any(word in title_lower for word in ['safety', 'warning', 'caution', 'danger']):
            return 'safety'
        else:
            return 'operation'  # Default category

    def _calculate_confidence(self, match, content: str) -> float:
        """Calculate confidence score for a match"""
        base_confidence = 0.7
        
        # Boost confidence for longer matches
        match_length = len(match.group(0))
        if match_length > 20:
            base_confidence += 0.1
        elif match_length > 10:
            base_confidence += 0.05
        
        # Boost confidence for matches with units or specific patterns
        if any(unit in match.group(0).lower() for unit in ['psi', 'volts', '°c', '°f', 'gpm']):
            base_confidence += 0.1
        
        return min(base_confidence, 1.0)

    def _extract_context(self, content: str, start: int, end: int, context_length: int = 100) -> str:
        """Extract surrounding context for a match"""
        context_start = max(0, start - context_length)
        context_end = min(len(content), end + context_length)
        return content[context_start:context_end].strip()

    def _extract_steps(self, content: str, match_start: int) -> List[str]:
        """Extract steps from procedure content"""
        steps = []
        
        # Look for numbered steps after the match
        step_pattern = r'(?:step|procedure)\s+([0-9]+):\s*([A-Za-z0-9\s\-\.]+)'
        matches = re.finditer(step_pattern, content[match_start:match_start + 500], re.IGNORECASE)
        
        for match in matches:
            step_text = match.group(2).strip() if len(match.groups()) > 1 and match.group(2) else match.group(1).strip()
            if len(step_text) > 5:
                steps.append(step_text)
        
        return steps[:5]  # Limit to 5 steps

    def process_document(self, elements: List[PageElement], doc_id: str) -> Dict[str, Any]:
        """Process document and extract all DIP components"""
        start_time = time.time()
        
        logger.info(f"Processing DIP for document {doc_id}")
        
        # Extract all components
        entities = self.extract_entities(elements)
        spec_hints = self.extract_spec_hints(elements)
        golden_tests = self.extract_golden_tests(elements)
        
        processing_time = time.time() - start_time
        
        logger.info(f"DIP processing completed for {doc_id}: "
                   f"{len(entities)} entities, {len(spec_hints)} hints, {len(golden_tests)} tests")
        
        return {
            'success': True,
            'doc_id': doc_id,
            'entities': entities,
            'spec_hints': spec_hints,
            'golden_tests': golden_tests,
            'processing_time': processing_time,
            'pages_processed': len(set(e.page for e in elements)),
            'entities_count': len(entities),
            'hints_count': len(spec_hints),
            'tests_count': len(golden_tests)
        }

    async def process_chunks(self, doc_id: str, chunks: List[Dict]) -> Dict[str, Any]:
        """Process document chunks and extract all DIP components"""
        start_time = time.time()
        
        logger.info(f"Processing DIP from chunks for document {doc_id}")
        
        # Convert chunks to PageElement format for existing methods
        elements = []
        for chunk in chunks:
            element = PageElement(
                content=chunk['content'],
                element_type='text',
                page=chunk.get('page', 1),
                bbox=BoundingBox(x0=0, y0=0, x1=0, y1=0),
                has_text_layer=True,
                ocr_used=False,
                confidence=1.0
            )
            elements.append(element)
        
        # Extract all components using existing methods
        entities = self.extract_entities(elements)
        spec_hints = self.extract_spec_hints(elements)
        golden_tests = self.extract_golden_tests(elements)
        # playbook_hints = self.extract_playbook_hints(chunks)  # DISABLED - using OpenAI extraction instead
        playbook_hints = await self.extract_playbook_hints_anthropic(doc_id, chunks)  # NEW Anthropic extraction
        
        processing_time = time.time() - start_time
        
        logger.info(f"DIP processing from chunks completed for {doc_id}: "
                   f"{len(entities)} entities, {len(spec_hints)} hints, {len(golden_tests)} tests, {len(playbook_hints)} playbook hints")
        
        return {
            'success': True,
            'doc_id': doc_id,
            'dip': {
                'entities': entities,
                'spec_hints': spec_hints,
                'golden_tests': golden_tests,
                'playbook_hints': playbook_hints  # NEW
            },
            'suggestions': {
                'entities': {'add_aliases': {}},
                'intents': {'hints': []},
                'playbooks': {'hints': playbook_hints},  # NEW
                'units': {'suggest_add': []},
                'tests': {'seed_goldens': []}
            },
            'processing_time': processing_time,
            'pages_processed': len(set(chunk.get('page', 1) for chunk in chunks)),
            'entities_count': len(entities),
            'hints_count': len(spec_hints),
            'tests_count': len(golden_tests),
            'playbook_count': len(playbook_hints)  # NEW
        }

    def save_dip_files(self, dip_data: Dict[str, Any], output_dir: str) -> Dict[str, str]:
        """Save DIP data to 4 separate JSON files and upload to Supabase Storage"""
        doc_id = dip_data['doc_id']
        
        # Get Supabase credentials (same as working chunk uploads)
        supabase_url = os.getenv('SUPABASE_URL')
        supabase_key = os.getenv('SUPABASE_SERVICE_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        
        if not supabase_url or not supabase_key:
            logger.warning("Supabase credentials not found, DIP files saved locally only")
            return {
                'spec_suggestions': '',
                'playbook_hints': '',
                'intent_router': '',
                'golden_tests': ''
            }
        
        url = supabase_url.rstrip("/")
        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
        
        storage_results = {}
        
        # 1. Create spec_suggestions.json
        spec_suggestions = []
        for hint in dip_data['dip']['spec_hints']:
            spec_suggestions.append({
                'spec_name': hint.hint_type,
                'spec_value': hint.value,
                'spec_unit': hint.unit,
                'page': hint.page,
                'confidence': hint.confidence
            })
        
        # Upload spec_suggestions.json
        spec_suggestions_content = json.dumps(spec_suggestions, indent=2, ensure_ascii=False)
        spec_suggestions_path = f"documents/manuals/{doc_id}/DIP/{doc_id}_spec_suggestions.json"
        
        try:
            response = requests.post(
                f"{url}/storage/v1/object/{spec_suggestions_path}",
                headers={
                    **headers,
                    "Content-Type": "text/plain",
                    "x-upsert": "true"
                },
                data=spec_suggestions_content.encode('utf-8')
            )
            
            if response.status_code in [200, 201]:
                storage_results['spec_suggestions'] = spec_suggestions_path
                logger.info(f"Successfully uploaded spec_suggestions.json to Supabase Storage")
            else:
                storage_results['spec_suggestions'] = ''
                logger.warning(f"Failed to upload spec_suggestions.json: {response.status_code} {response.text}")
        except Exception as e:
            storage_results['spec_suggestions'] = ''
            logger.error(f"Error uploading spec_suggestions.json: {e}")
        
        # 2. Insert playbook_hints directly into staging table
        playbook_hints = dip_data['dip'].get('playbook_hints', [])
        
        try:
            if playbook_hints:
                # Insert each playbook hint into the staging table
                for hint in playbook_hints:
                    # Prepare the data for the playbook_hints table (using original schema)
                    insert_data = {
                        'doc_id': doc_id,
                        'test_name': hint.get('title', ''),
                        'test_type': hint.get('category', 'operation'),
                        'description': hint.get('expected_outcome', ''),
                        'steps': hint.get('procedures', []),
                        'expected_result': hint.get('expected_outcome', ''),
                        'page': 1,  # Default page since we don't have specific page info
                        'confidence': hint.get('confidence', 0.9),
                        'bbox': None  # No bounding box for AI-generated content
                    }
                    
                    # Insert into playbook_hints table
                    response = requests.post(
                        f"{url}/rest/v1/playbook_hints",
                        headers={
                            **headers,
                            "Content-Type": "application/json",
                            "Prefer": "resolution=merge-duplicates"
                        },
                        json=insert_data
                    )
                    
                    if response.status_code in [200, 201]:
                        logger.info(f"Successfully inserted playbook hint '{hint.get('title', '')}' into staging table")
                    else:
                        logger.warning(f"Failed to insert playbook hint: {response.status_code} {response.text}")
                
                storage_results['playbook_hints'] = f"inserted_{len(playbook_hints)}_records_to_staging_table"
                logger.info(f"Successfully inserted {len(playbook_hints)} playbook hints into staging table")
            else:
                storage_results['playbook_hints'] = 'no_playbook_hints_extracted'
                logger.info("No playbook hints extracted for this document")
                
        except Exception as e:
            storage_results['playbook_hints'] = ''
            logger.error(f"Error inserting playbook hints into staging table: {e}")
        
        # 3. Create intent_router.json
        intent_router = []
        for test in dip_data['dip']['golden_tests']:
            intent_router.append({
                'intent': test.description,
                'route_to': test.expected_result,
                'confidence': test.confidence,
                'page': test.page
            })
        
        # Upload intent_router.json
        intent_router_content = json.dumps(intent_router, indent=2, ensure_ascii=False)
        intent_router_path = f"documents/manuals/{doc_id}/DIP/{doc_id}_intent_router.json"
        
        try:
            response = requests.post(
                f"{url}/storage/v1/object/{intent_router_path}",
                headers={
                    **headers,
                    "Content-Type": "text/plain",
                    "x-upsert": "true"
                },
                data=intent_router_content.encode('utf-8')
            )
            
            if response.status_code in [200, 201]:
                storage_results['intent_router'] = intent_router_path
                logger.info(f"Successfully uploaded intent_router.json to Supabase Storage")
            else:
                storage_results['intent_router'] = ''
                logger.warning(f"Failed to upload intent_router.json: {response.status_code} {response.text}")
        except Exception as e:
            storage_results['intent_router'] = ''
            logger.error(f"Error uploading intent_router.json: {e}")
        
        # 4. Create golden_tests.json
        golden_tests = []
        for test in dip_data['dip']['golden_tests']:
            golden_tests.append({
                'query': test.description,
                'expected': test.expected_result,
                'page': test.page,
                'confidence': test.confidence
            })
        
        # Upload golden_tests.json
        golden_tests_content = json.dumps(golden_tests, indent=2, ensure_ascii=False)
        golden_tests_path = f"documents/manuals/{doc_id}/DIP/{doc_id}_golden_tests.json"
        
        try:
            response = requests.post(
                f"{url}/storage/v1/object/{golden_tests_path}",
                headers={
                    **headers,
                    "Content-Type": "text/plain",
                    "x-upsert": "true"
                },
                data=golden_tests_content.encode('utf-8')
            )
            
            if response.status_code in [200, 201]:
                storage_results['golden_tests'] = golden_tests_path
                logger.info(f"Successfully uploaded golden_tests.json to Supabase Storage")
            else:
                storage_results['golden_tests'] = ''
                logger.warning(f"Failed to upload golden_tests.json: {response.status_code} {response.text}")
        except Exception as e:
            storage_results['golden_tests'] = ''
            logger.error(f"Error uploading golden_tests.json: {e}")
        
        return storage_results

    def _get_entity_type_counts(self, entities: List[DIPEntity]) -> Dict[str, int]:
        """Get count of entities by type"""
        counts = {}
        for entity in entities:
            counts[entity.entity_type] = counts.get(entity.entity_type, 0) + 1
        return counts

    def _get_hint_type_counts(self, spec_hints: List[DIPSpecHint]) -> Dict[str, int]:
        """Get count of spec hints by type"""
        counts = {}
        for hint in spec_hints:
            counts[hint.hint_type] = counts.get(hint.hint_type, 0) + 1
        return counts

    def _get_test_type_counts(self, golden_tests: List[DIPGoldenTest]) -> Dict[str, int]:
        """Get count of golden tests by type"""
        counts = {}
        for test in golden_tests:
            counts[test.test_type] = counts.get(test.test_type, 0) + 1
        return counts

    def _enhance_entity_data(self, entity: DIPEntity) -> Dict[str, Any]:
        """Enhance entity data with additional metadata"""
        return {
            'entity_type': entity.entity_type,
            'value': entity.value,
            'confidence': entity.confidence,
            'page': entity.page,
            'context': entity.context,
            'bbox': entity.bbox.dict() if entity.bbox else None,
            'metadata': {
                'extraction_method': 'regex_pattern',
                'confidence_level': self._get_confidence_level(entity.confidence),
                'value_length': len(entity.value),
                'context_length': len(entity.context)
            }
        }

    def _enhance_spec_hint_data(self, hint: DIPSpecHint) -> Dict[str, Any]:
        """Enhance spec hint data with additional metadata"""
        return {
            'hint_type': hint.hint_type,
            'value': hint.value,
            'unit': hint.unit,
            'page': hint.page,
            'context': hint.context,
            'confidence': hint.confidence,
            'bbox': hint.bbox.dict() if hint.bbox else None,
            'metadata': {
                'extraction_method': 'regex_pattern',
                'confidence_level': self._get_confidence_level(hint.confidence),
                'has_unit': hint.unit is not None,
                'value_length': len(hint.value),
                'context_length': len(hint.context)
            }
        }

    def _enhance_golden_test_data(self, test: DIPGoldenTest) -> Dict[str, Any]:
        """Enhance golden test data with additional metadata"""
        return {
            'test_name': test.test_name,
            'test_type': test.test_type,
            'description': test.description,
            'steps': test.steps,
            'expected_result': test.expected_result,
            'page': test.page,
            'confidence': test.confidence,
            'bbox': test.bbox.dict() if test.bbox else None,
            'metadata': {
                'extraction_method': 'regex_pattern',
                'confidence_level': self._get_confidence_level(test.confidence),
                'steps_count': len(test.steps),
                'description_length': len(test.description),
                'expected_result_length': len(test.expected_result)
            }
        }

    def _get_confidence_level(self, confidence: float) -> str:
        """Convert confidence score to level"""
        if confidence >= 0.9:
            return 'high'
        elif confidence >= 0.7:
            return 'medium'
        elif confidence >= 0.5:
            return 'low'
        else:
            return 'very_low'
