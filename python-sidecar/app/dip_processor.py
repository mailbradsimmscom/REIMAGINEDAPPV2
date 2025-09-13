"""
DIP (Document Intelligence Packet) Processor
Extracts entities, spec hints, and golden tests from document content
"""

import json
import re
import time
import os
import requests
from typing import List, Dict, Any, Optional
from pathlib import Path
import logging

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
        playbook_hints = self.extract_playbook_hints(chunks)  # NEW
        
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
        
        # 2. Create playbook_hints.json
        playbook_hints = dip_data['dip'].get('playbook_hints', [])
        playbook_hints_content = json.dumps(playbook_hints, indent=2, ensure_ascii=False)
        playbook_hints_path = f"documents/manuals/{doc_id}/DIP/{doc_id}_playbook_hints.json"
        
        try:
            response = requests.post(
                f"{url}/storage/v1/object/{playbook_hints_path}",
                headers={
                    **headers,
                    "Content-Type": "text/plain",
                    "x-upsert": "true"
                },
                data=playbook_hints_content.encode('utf-8')
            )
            
            if response.status_code in [200, 201]:
                storage_results['playbook_hints'] = playbook_hints_path
                logger.info(f"Successfully uploaded playbook_hints.json to Supabase Storage")
            else:
                storage_results['playbook_hints'] = ''
                logger.warning(f"Failed to upload playbook_hints.json: {response.status_code} {response.text}")
        except Exception as e:
            storage_results['playbook_hints'] = ''
            logger.error(f"Error uploading playbook_hints.json: {e}")
        
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
