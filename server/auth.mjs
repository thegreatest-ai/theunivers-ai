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

/**
 * The agent behind a bearer token — and only if it is still live.
 *
 * `agent.status` existed from the first schema and gated NOTHING: it was selected for display on
 * three surfaces and checked on none, so a row set to 'suspended' changed what the interface said
 * and not what the agent could do. There was therefore no way to stop a running agent at all,
 * which is the gap gemini named from the adversary seat — a content ladder cannot answer an agent
 * actively misbehaving, and the operator needs a stop that works before a policy exists to
 * describe when to use it.
 *
 * Refusing here rather than per-route is deliberate: this is the one place an agent credential
 * becomes an identity, so a route added tomorrow inherits the stop without knowing about it.
 * Returning null makes a suspended agent indistinguishable from a bad token, which is also the
 * honest answer — that credential no longer authenticates anything.
 */
export function agentFromToken(authHeader) {
  const t = bearer(authHeader);
  if (!t) return null;
  const agent = one('SELECT * FROM agent WHERE api_token = ?', t);
  return agent && agent.status === 'live' ? agent : null;
}

function bearer(header) {
  if (!header) return null;
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
