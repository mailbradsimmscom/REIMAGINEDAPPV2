# DIP Cleaner Debug Logging Summary

## Complete Debug Logging Pattern

All four DIP cleaners now have consistent debug logging for complete pipeline visibility:

### 1. Specs (`src/services/dip-cleaner/spec.cleaner.js`)
- `[LLM DEBUG][specs] parsed:` - Shows data after LLM processing
- `[LLM DEBUG][specs] mapped:` - Shows final mapped data before database insertion

### 2. Playbooks (`src/services/dip-cleaner/playbook.cleaner.js`)
- `[LLM DEBUG][playbooks] parsed:` - Shows data after LLM processing
- `[LLM DEBUG][playbooks] mapped:` - Shows final mapped data before database insertion

### 3. Golden Tests (`src/services/dip-cleaner/goldens.cleaner.js`)
- `[LLM DEBUG][goldens] parsed:` - Shows data after LLM processing
- `[LLM DEBUG][goldens] mapped:` - Shows final mapped data before database insertion

### 4. Intents (`src/services/dip-cleaner/intent.cleaner.js`)
- `[LLM DEBUG][intents] parsed:` - Shows data after LLM processing
- `[LLM DEBUG][intents] mapped:` - Shows final mapped data before database insertion

### 5. Raw LLM Responses (`src/services/dip-cleaner/util.llm.js`)
- `[LLM DEBUG][{kind}] raw:` - Shows raw JSON response from OpenAI API for all types

## Pipeline Flow
```
Raw Staging Data → LLM Processing → Parsed Data → Mapped Data → Database
     ↓                    ↓              ↓            ↓
   (input)         (raw response)   (parsed)    (final format)
```

## Environment Control
- Debug logging is controlled by `DIP_LLM_DEBUG=1` environment variable
- Set this before starting servers: `DIP_LLM_DEBUG=1 npm run dev`

## Usage
This comprehensive logging allows you to:
1. See exactly what the LLM is returning (raw JSON)
2. Verify parsing is working correctly (parsed data)
3. Confirm final data mapping is correct (mapped data)
4. Debug any issues in the pipeline at any stage
