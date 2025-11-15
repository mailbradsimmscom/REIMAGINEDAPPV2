// src/middleware/validate.js
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
        error: result.error.errors
      });
    }

    // Only assign back to body (writable), for query/params just validate
    if (source === 'body') {
      req[source] = result.data;
    }

    next();
  };
}