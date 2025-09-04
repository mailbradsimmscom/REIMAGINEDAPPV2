import { enforceResponse } from '../middleware/enforceResponse.js';

export function methodNotAllowed(req, res) {
  return enforceResponse(res, {
    success: false,
    data: null,
    error: { code: 'METHOD_NOT_ALLOWED', message: `${req.method} not allowed` },
  }, 405);
}
