// src/schemas/envelope.schema.js
import { z } from 'zod';

export const ErrorObjectSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.any().optional(),
});

export const EnvelopeBase = {
  requestId: z.string().nullable().optional(),
};

export const EnvelopeSuccessSchema = z.object({
  ...EnvelopeBase,
  success: z.literal(true),
  data: z.any().optional(), // TODO: tighten per route
  error: z.undefined().optional(),
});

export const EnvelopeErrorSchema = z.object({
  ...EnvelopeBase,
  success: z.literal(false),
  data: z.null().optional(),
  error: ErrorObjectSchema,
});

export const EnvelopeSchema = z.union([EnvelopeSuccessSchema, EnvelopeErrorSchema]);
