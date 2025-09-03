/** Validate BEFORE sending. Throw to error handler; never write here. */
export async function enforceResponse(schema, envelope) {
  const { env } = await import('../config/env.js');
  if (!env.RESPONSE_VALIDATE || !schema) return envelope;
  const parsed = schema.safeParse(envelope);
  if (!parsed.success) {
    const e = new Error('RESPONSE_SCHEMA_MISMATCH');
    e.code = 'RESPONSE_SCHEMA_MISMATCH';
    e.statusCode = 500;
    e.details = parsed.error.issues;
    throw e;
  }
  return parsed.data;
}
