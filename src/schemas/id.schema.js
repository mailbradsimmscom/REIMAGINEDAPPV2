import { z } from 'zod';

/**
 * Schema for validating UUIDs
 * Used for systems.asset_uid which is a UUID
 */
export const SystemUid = z.string().uuid();

/**
 * Schema for validating hash-based or UUID-based IDs
 * Used for documents.doc_id which can be either format
 */
export const HashOrUuid = z.string().refine(v => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const hex = /^[0-9a-f]{32,64}$/i; // loosen if needed
  return uuid.test(v) || hex.test(v);
}, "Expected UUID or known hash id");
