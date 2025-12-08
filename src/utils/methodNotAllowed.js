
export function methodNotAllowed(req, res) {
  return res.status(405).json({
    success: false,
    data: null,
    error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not allowed` },
  });
}
