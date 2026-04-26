/**
 * Guardianage Auth Repository
 * Database operations for users and sessions.
 */

import { getSupabaseClient } from './supabase.js';

export async function findUserByLoginId(loginId) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from('guardianage_users')
    .select('*')
    .eq('login_id', loginId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) throw new Error(`Failed to find user: ${error.message}`);
  return data;
}

export async function updateLastLogin(userId) {
  const supabase = await getSupabaseClient();
  await supabase
    .from('guardianage_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('id', userId);
}

export async function createSession({ userId, sessionTokenHash, expiresAt, ipAddress, userAgent }) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase
    .from('guardianage_user_sessions')
    .insert({
      user_id: userId,
      session_token_hash: sessionTokenHash,
      expires_at: expiresAt,
      ip_address: ipAddress,
      user_agent: userAgent,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create session: ${error.message}`);
  return data;
}

export async function findSessionByTokenHash(tokenHash) {
  const supabase = await getSupabaseClient();

  // Get session
  const { data: session, error: sessionError } = await supabase
    .from('guardianage_user_sessions')
    .select('*')
    .eq('session_token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (sessionError) throw new Error(`Failed to find session: ${sessionError.message}`);
  if (!session) return null;

  // Get user separately (no FK constraint)
  const { data: user, error: userError } = await supabase
    .from('guardianage_users')
    .select('*')
    .eq('id', session.user_id)
    .maybeSingle();

  if (userError) throw new Error(`Failed to find user: ${userError.message}`);

  return { ...session, guardianage_users: user };
}

export async function revokeSession(sessionId) {
  const supabase = await getSupabaseClient();
  await supabase
    .from('guardianage_user_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function revokeAllUserSessions(userId) {
  const supabase = await getSupabaseClient();
  await supabase
    .from('guardianage_user_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
}

export async function refreshSessionExpiry(sessionId, newExpiresAt) {
  const supabase = await getSupabaseClient();
  await supabase
    .from('guardianage_user_sessions')
    .update({ expires_at: newExpiresAt })
    .eq('id', sessionId);
}

export async function countRecentFailedLogins(loginId, windowMinutes = 30) {
  const supabase = await getSupabaseClient();
  const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('guardianage_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('entity_type', 'auth')
    .eq('action_type', 'login_failed')
    .eq('summary', loginId)
    .gte('created_at', since);

  if (error) return 0;
  return data?.length ?? 0;
}

export async function writeAuditLog({ actorUserId, entityType, entityId, actionType, summary, metadataJson }) {
  const supabase = await getSupabaseClient();
  await supabase
    .from('guardianage_audit_log')
    .insert({
      actor_user_id: actorUserId,
      entity_type: entityType,
      entity_id: entityId,
      action_type: actionType,
      summary,
      metadata_json: metadataJson,
    });
}
