/**
 * Guardianage Auth Middleware
 * Validates session cookie on every guardianage request (except login page and static assets).
 */

import { validateSession, hashToken } from '../services/auth.service.js';

function isPublicPath(path) {
  // Paths are relative to the /guardianage mount point
  if (path === '/login') return true;
  if (path === '/api/auth/login') return true;
  if (path.startsWith('/public/')) return true;
  return false;
}

export function guardianageAuth(req, res, next) {
  if (isPublicPath(req.path)) {
    return next();
  }

  const sessionToken = req.cookies?.guardianage_session;

  if (!sessionToken) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    return res.redirect('/guardianage/login');
  }

  validateSession(sessionToken)
    .then(session => {
      if (!session) {
        if (req.path.startsWith('/api/')) {
          return res.status(401).json({ success: false, error: 'Session expired' });
        }
        res.clearCookie('guardianage_session');
        return res.redirect('/guardianage/login');
      }

      req.guardianageUser = session.user;
      req.guardianageSessionId = session.sessionId;
      next();
    })
    .catch(err => {
      console.error('Guardianage auth error:', err);
      if (req.path.startsWith('/api/')) {
        return res.status(500).json({ success: false, error: 'Auth error' });
      }
      return res.redirect('/guardianage/login');
    });
}

export function requireAdmin(req, res, next) {
  if (req.guardianageUser?.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }
  next();
}
