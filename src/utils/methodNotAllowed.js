
export function methodNotAllowed(req, res) {
  return res.json({
    success: false,
    data: null,
    error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not allowed` },
  }, 405);
}
