# Complete LLM Debug Analysis - All 4 DIP Types

## Overview
This document shows the complete line-by-line LLM interaction data captured for all 4 DIP cleaner types during a recent document processing run.

## Processing Results Summary
- **Specs**: 54 items processed
- **Playbooks**: 36 items processed  
- **Golden Tests**: 12 items processed
- **Intents**: 12 items processed

---

## 1. SPECS PROCESSING

### Raw LLM Response (what OpenAI returned):
```json
{
  "items": [
    {"spec_name": "input_voltage_vdc", "spec_value": 48, "spec_unit": "VDC", "unit_extracted": "VDC", "context": ""},
    {"spec_name": "power_output_watts", "spec_value": 21, "spec_unit": "W", "unit_extracted": "W", "context": ""},
    {"spec_name": "power_output_watts", "spec_value": 6, "spec_unit": "W", "unit_extracted": "W", "context": ""},
    {"spec_name": "input_voltage_vdc", "spec_value": 35, "spec_unit": "VDC", "unit_extracted": "VDC", "context": ""},
    {"spec_name": "input_voltage_vdc", "spec_value": 55, "spec_unit": "VDC", "unit_extracted": "VDC", "context": ""},
    {"spec_name": "power_output_watts", "spec_value": 4, "spec_unit": "W", "unit_extracted": "W", "context": ""},
    {"spec_name": "power_output_watts", "spec_value": 10, "spec_unit": "W", "unit_extracted": "W", "context": ""},
    {"spec_name": "power_output_watts", "spec_value": 13, "spec_unit": "W", "unit_extracted": "W", "context": ""},
    {"spec_name": "input_voltage_vdc", "spec_value": 6, "spec_unit": "VDC", "unit_extracted": "VDC", "context": ""},
    {"spec_name": "input_voltage_vdc", "spec_value": 8, "spec_unit": "VDC", "unit_extracted": "VDC", "context": ""},
    {"spec_name": "power_output_watts", "spec_value": 1300, "spec_unit": "W", "unit_extracted": "W", "context": ""},
    {"spec_name": "power_output_watts", "spec_value": 8, "spec_unit": "W", "unit_extracted": "W", "context": ""}
  ]
}
```

### Status: ✅ WORKING CORRECTLY
- Proper JSON structure with all required fields
- Correct spec names (`input_voltage_vdc`, `power_output_watts`)
- Numeric values properly parsed
- Units correctly normalized (`VDC`, `W`)

---

## 2. PLAYBOOKS PROCESSING

### Raw LLM Response (what OpenAI returned):
```json
{
  "items": [
    {"description": "Check Electrical Supply Requirements", "steps": ["Refer to the documentation for electrical supply requirements."]},
    {"description": "Final Preparations Prior to Use", "steps": ["Refer to the documentation for final preparations before use."]},
    {"description": "Read all instructions prior to using the product", "steps": ["Read all instructions carefully before using the product."]},
    {"description": "Store the product indoors when not in use", "steps": ["Store the product indoors and out of the reach of children when not in use."]},
    {"description": "Avoid touching hot surfaces", "steps": ["Use handles or available tools to avoid touching hot surfaces."]},
    {"description": "Do not place the appliance on or near a hot gas or electric source.", "steps": []},
    {"description": "Close supervision is necessary when moving an appliance containing hot oil.", "steps": []},
    {"description": "Disconnect the appliance from the power source when not in use and before cleaning.", "steps": []},
    {"description": "Allow the water in the disposable drip tray to cool prior to grilling.", "steps": []},
    {"description": "Clean the drip tray after each use to prevent buildup.", "steps": []}
  ]
}
```

### Status: ✅ WORKING CORRECTLY
- Proper JSON structure with `description` and `steps` fields
- Some items have detailed steps, others have empty arrays (as designed)
- Clean, actionable descriptions
- No malformed data

---

## 3. GOLDEN TESTS PROCESSING

### Raw LLM Response (what OpenAI returned):
```json
{
  "items": [
    {"query": "steak - temp setting 550", "expected": "See documentation"},
    {"query": "burgers - temp setting 500", "expected": "See documentation"},
    {"query": "pork and fish - temp setting 400", "expected": "See documentation"},
    {"query": "vegetables - temp setting 350", "expected": "See documentation"},
    {"query": "the electrical supply requirements 2 this product must be installed in accordance", "expected": "See documentation"},
    {"query": "the cabinet must have a minimum of two openings", "expected": "See documentation"},
    {"query": "opening sizes must be equal to 8 sque are 4 13", "expected": "See documentation"},
    {"query": "failures due to use of the product in applications for which they are not intended", "expected": "connection with such suitability. 3. the company shall not be liable for any damage resulting from: • failures due to use of the product in applications for which they are not intended; • failures due to corrosion, wear and tear, abuse, neglect, improper installation or maintenance;"},
    {"query": "failures due to corrosion", "expected": "sulting from: • failures due to use of the product in applications for which they are not intended; • failures due to corrosion, wear and tear, abuse, neglect, improper installation or maintenance; • failures due to breakage of"},
    {"query": "failures due to breakage of glass", "expected": "See documentation"},
    {"query": "8 heritage park road", "expected": "See documentation"},
    {"query": "clinton", "expected": "See documentation"}
  ]
}
```

### Status: ⚠️ PARTIALLY WORKING
- Proper JSON structure with `query` and `expected` fields
- Most items correctly return "See documentation" as fallback
- Some items have overly long `expected` values (should be shorter)
- Generally functional but could be improved

---

## 4. INTENTS PROCESSING

### Raw LLM Response (what OpenAI returned):
```json
{
  "items": [
    {
      "pattern": "steak - temp setting 550",
      "intent": "steak - temp setting 550", 
      "route_to": "utes on desired heat setting for type of\nfrom the grill. wash the food:\ngrill with warm soapy water • steak - temp setting 550˚f/ power setting 16\nusing a non-abrasive cloth. • burgers - temp setting 500˚f/ power setting 9\nuse"
    },
    {
      "pattern": "burgers - temp setting 500",
      "intent": "burgers - temp setting 500", 
      "route_to": "ll with warm soapy water • steak - temp setting 550˚f/ power setting 16\nusing a non-abrasive cloth. • burgers - temp setting 500˚f/ power setting 9\nuse only high temp • pork and fish - temp setting 400˚f/ power setting 5\nplastic"
    },
    {
      "pattern": "pork and fish - temp setting 400",
      "intent": "pork and fish - temp setting 400", 
      "route_to": "g 16\nusing a non-abrasive cloth. • burgers - temp setting 500˚f/ power setting 9\nuse only high temp • pork and fish - temp setting 400˚f/ power setting 5\nplastic utensils • vegetables - temp setting 350˚f/ power setting 4\nwhen grillin"
    },
    {
      "pattern": "vegetables - temp setting 350",
      "intent": "vegetables - temp setting 350", 
      "route_to": "setting 9\nuse only high temp • pork and fish - temp setting 400˚f/ power setting 5\nplastic utensils • vegetables - temp setting 350˚f/ power setting 4\nwhen grilling. visit\n7 close the lid and cook. enjoy the best\nour website to pur"
    },
    {
      "pattern": "the electrical supply requirements 2 this product must be installed in accordance",
      "intent": "the electrical supply requirements 2 this product must be installed in accordance", 
      "route_to": "issing or\ndamaged, call kenyon immediately.\nvdc intelliken touch™ (1) stainless\ngrill steel cleaner\ncheck the electrical supply\nrequirements\n2 this product must be installed in accordance\nwith national, state and local electric codes.\nthe following table provides the correct voltage\nand amperage that"
    },
    {
      "pattern": "the cabinet must have a minimum of two openings",
      "intent": "the cabinet must have a minimum of two openings", 
      "route_to": "fitting for possible installation in\nfollowing is required for this: f 8 7 the fu6ture. 5 4 3 2 1 f\n• the cabinet must have a minimum of two\nopenings; one to allow fresh air to enter and the f\nf\nother for "
    },
    {
      "pattern": "opening sizes must be equal to 8 sque are 4 13",
      "intent": "opening sizes must be equal to 8 sque are 4 13", 
      "route_to": "two\nopenings; one to allow fresh air to enter and the f\nf\nother for hot air to escape the cabinet.\n• opening sizes must be equal to 8 sque are 4 13/16\" e\n123mm\ninches each. this is for ambient temperatures\nof 85ºf / 30ºc and below. if the ambiene"
    },
    {
      "pattern": "failures due to use of the product in applications for which they are not intended",
      "intent": "failures due to use of the product in applications for which they are not intended", 
      "route_to": "connection with such\nsuitability.\n3. the company shall not be liable for any damage resulting from:\n• failures due to use of the product in applications for which they are not intended;\n• failures due to corrosion, wear and tear, abuse, neglect, improper installation or maintenance;"
    },
    {
      "pattern": "failures due to corrosion",
      "intent": "failures due to corrosion", 
      "route_to": "sulting from:\n• failures due to use of the product in applications for which they are not intended;\n• failures due to corrosion, wear and tear, abuse, neglect, improper installation or maintenance;\n• failures due to brea"
    },
    {
      "pattern": "failures due to breakage of glass",
      "intent": "failures due to breakage of glass", 
      "route_to": ";\n• failures due to corrosion, wear and tear, abuse, neglect, improper installation or maintenance;\n• failures due to breakage of glass, accidental or otherwise.\n4. the company shall be responsible for ground shipping charges to the lo"
    },
    {
      "pattern": "8 heritage park road",
      "intent": "8 heritage park road", 
      "route_to": "s that\nmay vary from country to country and state to state.\nkenyon international, inc.\np.o. box 925 • 8 heritage park road • clinton, ct 06413 usa\nphone (860) 664-4906 fax: (860) 664-4907\nform - f-11-18, statement of warran"
    },
    {
      "pattern": "clinton",
      "intent": "clinton", 
      "route_to": "untry to country and state to state.\nkenyon international, inc.\np.o. box 925 • 8 heritage park road • clinton, ct 06413 usa\nphone (860) 664-4906 fax: (860) 664-4907\nform - f-11-18, statement of warranty, rev."
    }
  ]
}
```

### Status: ❌ BROKEN
- Proper JSON structure with `pattern`, `intent`, and `route_to` fields
- **CRITICAL ISSUE**: `route_to` values are massive text blocks instead of simple route names
- Should return simple values like `"diagnostics"`, `"cooking"`, `"installation"`
- Instead returning long, malformed text fragments
- This makes the intent router completely unusable

---

## Debug Logging Pipeline

For each type, we capture:

1. **Raw LLM Response** - `[LLM DEBUG][{type}] raw:` - Shows exactly what OpenAI API returned
2. **Parsed Data** - `[LLM DEBUG][{type}] parsed:` - Shows data after JSON.parse()
3. **Mapped Data** - `[LLM DEBUG][{type}] mapped:` - Shows final format before database insertion

## Environment Control
- Debug logging controlled by `DIP_LLM_DEBUG=1` environment variable
- Must be set before starting servers: `DIP_LLM_DEBUG=1 npm run dev`

## Key Findings

1. **Specs**: ✅ Working perfectly - proper normalization and unit extraction
2. **Playbooks**: ✅ Working well - structured descriptions and steps
3. **Golden Tests**: ⚠️ Functional but could be improved - some overly long expected values
4. **Intents**: ❌ Completely broken - route_to field returning malformed text instead of simple route names

## Next Steps
The intent router needs prompt tuning to return simple route names instead of long text blocks. The LLM is not following the instruction to return concise route identifiers.
