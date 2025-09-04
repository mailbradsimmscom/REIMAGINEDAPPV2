# External Service Guards

## Overview

The external service guards provide a centralized way to check if external services are properly configured before attempting to use them. This prevents 500 errors when services are misconfigured or unavailable.

## Available Guards

### `isPineconeConfigured()`
Checks if Pinecone vector database is configured via the Python sidecar.
- **Required**: `PYTHON_SIDECAR_URL`
- **Used by**: Pinecone operations, vector search

### `isSupabaseConfigured()`
Checks if Supabase database is properly configured.
- **Required**: `SUPABASE_URL` + one of: `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_ROLE`, `SERVICE_ROLE_KEY`
- **Used by**: Database operations, document storage, chat history

### `isOpenAIConfigured()`
Checks if OpenAI API is configured for AI operations.
- **Required**: `OPENAI_API_KEY`
- **Used by**: Chat functionality, query enhancement, embeddings

### `isSidecarConfigured()`
Checks if Python sidecar service is configured.
- **Required**: `PYTHON_SIDECAR_URL`
- **Used by**: Document processing, PDF parsing, OCR

## Usage

```javascript
import { isSupabaseConfigured, isOpenAIConfigured } from '../services/guards/index.js';

// In repository or service
if (!isSupabaseConfigured()) {
  throw new Error('Supabase not configured');
}

// Or return early with proper error response
if (!isOpenAIConfigured()) {
  return {
    success: false,
    error: {
      code: 'OPENAI_DISABLED',
      message: 'OpenAI not configured'
    }
  };
}
```

## Error Codes

When guards fail, use these consistent error codes:
- `PINECONE_DISABLED` - Pinecone not configured
- `SUPABASE_DISABLED` - Supabase not configured  
- `OPENAI_DISABLED` - OpenAI not configured
- `SIDECAR_DISABLED` - Python sidecar not configured

## Testing

Run the guard tests:
```bash
node --test tests/unit/services/guards.test.js
```

The tests verify:
- Guards return `true` when required env vars are set
- Guards return `false` when required env vars are missing
- `getExternalServiceStatus()` returns correct status for all services
