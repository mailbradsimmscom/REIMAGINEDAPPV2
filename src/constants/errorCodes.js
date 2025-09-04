export const ERR = {
  BAD_REQUEST: 'BAD_REQUEST',              // 400 (validation)
  UNAUTHORIZED: 'UNAUTHORIZED',            // 401 (missing admin token)
  FORBIDDEN: 'FORBIDDEN',                  // 403 (bad token)
  NOT_FOUND: 'NOT_FOUND',                  // 404 (unknown path)
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',// 405
  RATE_LIMITED: 'RATE_LIMITED',            // 429
  INTERNAL: 'INTERNAL',                    // 500
  ADMIN_DISABLED: 'ADMIN_DISABLED',        // 401 (admin not configured)
  PINECONE_DISABLED: 'PINECONE_DISABLED',  // 200/503 (choose one & stick to it)
  SUPABASE_DISABLED: 'SUPABASE_DISABLED',  // 503 (service unavailable)
  OPENAI_DISABLED: 'OPENAI_DISABLED',      // 503 (service unavailable)
  SIDECAR_DISABLED: 'SIDECAR_DISABLED',    // 503 (service unavailable)
};
