import crypto from 'node:crypto';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { ERR } from '../constants/errorCodes.js';

function readAdminToken(req) {
  const h = req.headers;
  const x = h['x-admin-token'];
  const auth = h['authorization'];
  if (x && typeof x === 'string') return x.trim();
  if (auth && typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

function mask(token) {
  if (!token) return 'not-set';
  if (token.length <= 8) return `${'*'.repeat(Math.max(0, token.length - 2))}${token.slice(-2)}`;
  return `${token.slice(0,4)}…${token.slice(-4)}`;
}

function tokenHash(token) {
  return token ? crypto.createHash('sha256').update(token).digest('hex').slice(0,12) : 'none';
}

export function adminGate(req, res, next) {
  const env = getEnv({ loose: true });
  const expected = env.ADMIN_TOKEN;
  const supplied = readAdminToken(req);

  if (!expected) {
    return res.status(401).json({ 
      success: false, 
      data: null, 
      error: { code: ERR.ADMIN_DISABLED, message: 'Admin token not configured' },
      requestId: res.locals?.requestId ?? null,
    });
  }
  if (!supplied) {
    logger.info('Admin auth: missing token');
    return res.status(401).json({ 
      success: false, 
      data: null, 
      error: { code: ERR.UNAUTHORIZED, message: 'Admin token required' },
      requestId: res.locals?.requestId ?? null,
    });
  }
  if (supplied !== expected) {
    logger.warn('Admin auth: bad token', { supplied: mask(supplied), supplied_sha: tokenHash(supplied) });
    return res.status(403).json({ 
      success: false, 
      data: null, 
      error: { code: ERR.FORBIDDEN, message: 'Invalid admin token' },
      requestId: res.locals?.requestId ?? null,
    });
  }

  // success — don't log the raw token
  logger.info('Admin auth: ok', { supplied_sha: tokenHash(supplied) });
  return next();
}

/**
 * Optional admin gate - only checks if token is provided
 * Useful for routes that can work with or without admin access
 */
export async function optionalAdminGate(req, res, next) {
  const env = getEnv({ loose: true });
  const expected = env.ADMIN_TOKEN;
  const supplied = readAdminToken(req);
  
  if (expected && supplied && supplied === expected) {
    req.isAdmin = true;
  } else {
    req.isAdmin = false;
  }
  
  next();
}
