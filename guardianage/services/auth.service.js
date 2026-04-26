/**
 * Guardianage Auth Service
 * Login, logout, session management.
 */

import crypto from 'node:crypto';
import {
  findUserByLoginId,
  updateLastLogin,
  createSession,
  findSessionByTokenHash,
  revokeSession,
  revokeAllUserSessions,
  refreshSessionExpiry,
  countRecentFailedLogins,
  writeAuditLog,
} from '../repositories/auth.repository.js';

const SESSION_TTL_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MINUTES = 30;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function verifyPassword(plaintext, hash) {
  // Dynamic import to avoid top-level await issues
  const bcrypt = await import('bcrypt');
  return bcrypt.default.compare(plaintext, hash);
}

export async function hashPassword(plaintext) {
  const bcrypt = await import('bcrypt');
  return bcrypt.default.hash(plaintext, 10);
}

export async function login(loginId, password, { ipAddress, userAgent } = {}) {
  // Check rate limiting
  const recentFailures = await countRecentFailedLogins(loginId, LOCKOUT_WINDOW_MINUTES);
  if (recentFailures >= MAX_FAILED_ATTEMPTS) {
    await writeAuditLog({
      actorUserId: null,
      entityType: 'auth',
      entityId: null,
      actionType: 'login_locked',
      summary: loginId,
      metadataJson: { ip_address: ipAddress, reason: 'too_many_attempts' },
    });
    return { success: false, error: 'Account temporarily locked. Try again in 30 minutes.' };
  }

  const user = await findUserByLoginId(loginId);
  if (!user) {
    await writeAuditLog({
      actorUserId: null,
      entityType: 'auth',
      entityId: null,
      actionType: 'login_failed',
      summary: loginId,
      metadataJson: { ip_address: ipAddress, reason: 'user_not_found' },
    });
    return { success: false, error: 'Invalid credentials' };
  }

  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    await writeAuditLog({
      actorUserId: user.id,
      entityType: 'auth',
      entityId: user.id,
      actionType: 'login_failed',
      summary: loginId,
      metadataJson: { ip_address: ipAddress, reason: 'bad_password' },
    });
    return { success: false, error: 'Invalid credentials' };
  }

  // Generate session token
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionTokenHash = hashToken(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const session = await createSession({
    userId: user.id,
    sessionTokenHash,
    expiresAt,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
  });

  await updateLastLogin(user.id);

  await writeAuditLog({
    actorUserId: user.id,
    entityType: 'auth',
    entityId: session.id,
    actionType: 'login_success',
    summary: loginId,
    metadataJson: { ip_address: ipAddress },
  });

  return {
    success: true,
    sessionToken,
    user: {
      id: user.id,
      login_id: user.login_id,
      display_name: user.display_name,
      role: user.role,
    },
  };
}

export async function logout(sessionTokenHash) {
  const session = await findSessionByTokenHash(sessionTokenHash);
  if (session) {
    await revokeSession(session.id);
    await writeAuditLog({
      actorUserId: session.user_id,
      entityType: 'auth',
      entityId: session.id,
      actionType: 'logout',
      summary: session.guardianage_users?.login_id || 'unknown',
    });
  }
}

export async function validateSession(sessionToken) {
  const tokenHash = hashToken(sessionToken);
  const session = await findSessionByTokenHash(tokenHash);

  if (!session) return null;
  if (!session.guardianage_users?.is_active) return null;

  // Refresh expiry on activity
  const newExpiry = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await refreshSessionExpiry(session.id, newExpiry);

  return {
    sessionId: session.id,
    tokenHash,
    user: {
      id: session.guardianage_users.id,
      login_id: session.guardianage_users.login_id,
      display_name: session.guardianage_users.display_name,
      role: session.guardianage_users.role,
    },
  };
}

export { hashToken };
