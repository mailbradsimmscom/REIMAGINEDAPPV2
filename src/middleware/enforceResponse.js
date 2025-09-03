import { getEnv } from '../config/env.js';

/** Validate BEFORE sending. Throw to error handler; never write here. */
export function enforceResponse(res, payload, status = 200) {
  if (res.headersSent) return;
  res.status(status).json({
    success: !!payload?.success,
    data: payload?.data ?? null,
    error: payload?.error ?? null,
    requestId: res.locals?.requestId ?? null,
  });
  return;
}
