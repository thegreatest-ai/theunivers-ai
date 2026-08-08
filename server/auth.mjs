import { randomBytes } from 'node:crypto';
import { one, run } from './db.mjs';

export function token(bytes = 24) {
  return randomBytes(bytes).toString('hex');
}

export function now() {
  return new Date().toISOString();
}

/**
 * Whether joining needs an invite. Default TRUE — an absent or malformed env var must not
 * silently open registration to the world, so only the exact string 'false' turns it off.
 */
export function inviteRequired() {
  return String(process.env.INVITE_REQUIRED ?? 'true').toLowerCase() !== 'false';
}

export function requireInvite(code) {
  // Open registration: nothing to check, nothing to consume.
  if (!inviteRequired()) return { ok: true, invite: null };

  const invite = one('SELECT * FROM invite WHERE code = ?', code);
  if (!invite) return { ok: false, error: 'invalid invite code' };
  if (invite.uses >= invite.max_uses) return { ok: false, error: 'invite code exhausted' };
  return { ok: true, invite };
}

export function consumeInvite(code) {
  if (!inviteRequired() || !code) return;
  run('UPDATE invite SET uses = uses + 1 WHERE code = ?', code);
}

export function createSession(userId) {
  const t = token();
  run('INSERT INTO session (token, user_id, created_at) VALUES (?, ?, ?)', t, userId, now());
  return t;
}

export function userFromSession(authHeader) {
  const t = bearer(authHeader);
  if (!t) return null;
  const row = one(
    `SELECT u.* FROM session s JOIN user u ON u.id = s.user_id WHERE s.token = ?`,
    t,
  );
  return row;
}

export function agentFromToken(authHeader) {
  const t = bearer(authHeader);
  if (!t) return null;
  return one('SELECT * FROM agent WHERE api_token = ?', t);
}

function bearer(header) {
  if (!header) return null;
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
