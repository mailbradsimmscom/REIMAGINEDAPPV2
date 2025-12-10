// src/middleware/validateResponse.js
import { ENV } from '../config/env.js';

export const validateResponse = (schema) => (req, res, next) => {
  // Only gate when flag is on (RESPONSE_VALIDATE=1 in CI)
  if (ENV.RESPONSE_VALIDATE !== '1') return next();

  const origJson = res.json.bind(res);

  res.json = (payload) => {
    // Skip validation for error responses - let error handler work without interference
    // This prevents throwing during error handling which would turn 400/404/503 into 500
    if (payload?.success === false) {
      return origJson(payload);
    }

    // For success responses, validate strictly - this catches real schema bugs
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const err = new Error('Response schema validation failed');
      err.status = 500;
      err.code = 'RESPONSE_SCHEMA_MISMATCH';
      err.details = parsed.error.format();
      throw err;
    }
    return origJson(payload);
  };

  next();
};
