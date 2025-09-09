// src/middleware/validate.js
export function validate({ body }) {
  return (req, res, next) => {
    if (body) {
      const result = body.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }
      req.body = result.data;
    }
    next();
  };
}