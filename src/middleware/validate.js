// src/middleware/validate.js
import { ERR } from '../constants/errorCodes.js';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    if (!schema) {
      return next();
    }

    const target = req[source]; // 'body', 'query', 'params'
    const result = schema.safeParse(target);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        data: null,
        error: {
          code: ERR.BAD_REQUEST,
          message: 'Validation failed',
          details: result.error.errors
        },
        requestId: res.locals?.requestId ?? null
      });
    }

    // Only assign back to body (writable), for query/params just validate
    if (source === 'body') {
      req[source] = result.data;
    }

    next();
  };
}