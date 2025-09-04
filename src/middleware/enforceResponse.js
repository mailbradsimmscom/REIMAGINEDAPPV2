import { getEnv } from '../config/env.js';

/** Validate BEFORE sending. Throw to error handler; never write here. */
export function enforceResponse(res, payload, status = 200) {
  if (res.headersSent) return;
  
  const response = {
    success: !!payload?.success,
    requestId: res.locals?.requestId ?? null,
  };
  
  if (payload?.data !== undefined) {
    response.data = payload.data;
  }
  
  if (payload?.error !== undefined) {
    response.error = payload.error;
  }
  
  res.status(status).json(response);
  return;
}
