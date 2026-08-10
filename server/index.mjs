/**
 * Private pilot API for theunivers.ai Bridge.
 * Web UI uses session Bearer tokens; AI agents use agent API tokens.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { measure, daily, totals } from './metrics.mjs';
import { take, refund, clientIp, LIMITS } from './ratelimit.mjs';
import { sendMail, resetEmail, mailConfigured } from './mail.mjs';

// Tiny .env loader — no dependency
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { db, one, all, run } from './db.mjs';
import {
  token, now, requireInvite, consumeInvite, createSession,
  userFromSession, agentFromToken, inviteRequired} from './auth.mjs';
import { checkMandates, resolveTier } from './guard.mjs';
import { hashPassword, verifyPassword } from './passwords.mjs';
import { passwordError } from '../shared/password-policy.mjs';
import {
  oauthConfigured, googleAuthUrl, githubAuthUrl,
  finishGoogle, finishGithub,
  oauthCallbackRedirect,
} from './oauth.mjs';

const PORT = Number(process.env.PORT ?? 8790);
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`;
const INVITE_CODE = process.env.INVITE_CODE ?? 'univers-pilot';
const DIST = join(ROOT, 'dist');

// Ensure invite exists
if (!one('SELECT code FROM invite WHERE code = ?', INVITE_CODE)) {
  run(
    'INSERT INTO invite (code, max_uses, uses, created_at) VALUES (?, ?, 0, ?)',
    INVITE_CODE,
    Number(process.env.INVITE_MAX_USES ?? 100),
    now(),
  );
}

seedDemoFeed();

const routes = [];
function route(method, path, handler) {
  routes.push({ method, parts: path.split('/').filter(Boolean), handler });
}

route('GET', '/api/health', () => ({
  ok: true,
  service: 'theunivers-bridge-pilot',
  inviteRequired: inviteRequired(),
  baseUrl: BASE_URL,
  oauth: oauthConfigured(),
}));

// The sign-in surface: which providers work, and whether joining needs a code. The form is
// drawn from this, so it can never offer something the server will refuse.
route('GET', '/api/auth/providers', () => ({
  ...oauthConfigured(),
  inviteRequired: inviteRequired(),
  // No SMTP is wired up yet. The UI reads this so it can say what actually happens rather than
  // promising an email nobody sends. Set SMTP_HOST to flip it.
  mailer: Boolean(process.env.SMTP_HOST),
}));

route('GET', '/api/auth/google', (ctx) => {
  try {
    // No invite required to START the flow. A returning user has none, and we cannot know
    // which they are until the provider answers. Enforced at the callback instead.
    const invite = String(ctx.query.get('invite') ?? '').trim();
    return { __redirect: googleAuthUrl(invite) };
  } catch (e) {
    return err(400, e.message);
  }
});

route('GET', '/api/auth/github', (ctx) => {
  try {
    const invite = String(ctx.query.get('invite') ?? '').trim();
    return { __redirect: githubAuthUrl(invite) };
  } catch (e) {
    return err(400, e.message);
  }
});

route('GET', '/api/auth/google/callback', async (ctx) => {
  try {
    const code = ctx.query.get('code');
    const state = ctx.query.get('state');
    if (!code) return err(400, ctx.query.get('error') || 'missing code');
    const { sessionToken, next } = await finishGoogle(code, state);
    return { __redirect: oauthCallbackRedirect(sessionToken, next) };
  } catch (e) {
    return { __redirect: `${process.env.FRONTEND_URL || BASE_URL}/app/signin?error=${encodeURIComponent(e.message)}` };
  }
});

route('GET', '/api/auth/github/callback', async (ctx) => {
  try {
    const code = ctx.query.get('code');
    const state = ctx.query.get('state');
    if (!code) return err(400, ctx.query.get('error') || 'missing code');
    const { sessionToken, next } = await finishGithub(code, state);
    return { __redirect: oauthCallbackRedirect(sessionToken, next) };
  } catch (e) {
    return { __redirect: `${process.env.FRONTEND_URL || BASE_URL}/app/signin?error=${encodeURIComponent(e.message)}` };
  }
});

route('POST', '/api/auth/register', (ctx) => {
  // Registration is the volume attack: automated signups fill the volume and, because agent names
  // are globally unique, let one script squat every good name permanently. Limited per IP even
  // while the invite gate is closed, so opening the gate is a config change and not a risk change.
  const byIp = take('register-ip', ctx.ip, LIMITS.registerPerIp.max, LIMITS.registerPerIp.windowMs);
  if (!byIp.ok) return tooMany(byIp.retryAfter);

  const email = String(ctx.body.email ?? '').trim().toLowerCase();
  const name = String(ctx.body.name ?? '').trim();
  const password = String(ctx.body.password ?? '');
  const inviteCode = String(ctx.body.inviteCode ?? '').trim();
  if (!email || !name) return err(400, 'name and email are required');
  if (inviteRequired() && !inviteCode) return err(400, 'an invite code is required');

  // THE GATE. The browser checks the same rules live for feedback, but this is the one that
  // counts — the form is not a security boundary and anyone can POST here directly.
  const pwErr = passwordError(password);
  if (pwErr) return err(400, pwErr);

  const inv = requireInvite(inviteCode);
  if (!inv.ok) return err(403, inv.error);

  if (one('SELECT id FROM user WHERE email = ?', email)) {
    return err(409, 'That email is already registered — sign in instead.');
  }

  const id = `usr_${randomUUID().slice(0, 8)}`;
  run(
    `INSERT INTO user (id, email, name, kind, jurisdiction, password_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, email, name,
    String(ctx.body.kind ?? 'individual'),
    String(ctx.body.jurisdiction ?? 'IN'),
    hashPassword(password),
    now(),
  );
  consumeInvite(inviteCode);
  const sessionToken = createSession(id);
  const user = one('SELECT * FROM user WHERE id = ?', id);
  return { sessionToken, user: publicUser(user), agent: null, hasAgent: false };
});

route('POST', '/api/auth/login', (ctx) => {
  const email = String(ctx.body.email ?? '').trim().toLowerCase();
  const password = String(ctx.body.password ?? '');
  if (!email || !password) return err(400, 'email and password are required');

  // Limited on BOTH keys. Per-IP alone misses a distributed attack on one account; per-account
  // alone misses one host working through many accounts. Checked before the lookup so an attacker
  // cannot use response timing to tell a rate-limited address from an unknown one.
  const byIp = take('login-ip', ctx.ip, LIMITS.loginPerIp.max, LIMITS.loginPerIp.windowMs);
  if (!byIp.ok) return tooMany(byIp.retryAfter);
  const byAccount = take('login-acct', email, LIMITS.loginPerAccount.max, LIMITS.loginPerAccount.windowMs);
  if (!byAccount.ok) return tooMany(byAccount.retryAfter);

  const user = one('SELECT * FROM user WHERE email = ?', email);

  // One message for "no such user" and for "wrong password". Distinguishing them turns this
  // endpoint into an account-enumeration oracle: an attacker learns which emails are registered.
  const REJECT = 'Email or password is incorrect.';
  if (!user) return err(401, REJECT);

  // A null hash means the account was created through Google or GitHub. Say so plainly — a
  // generic rejection would send someone round in circles resetting a password they never had.
  if (!user.password_hash) {
    return err(400, `That account signs in with ${user.oauth_provider || 'a provider'}. Use that button instead.`);
  }
  if (!verifyPassword(password, user.password_hash)) return err(401, REJECT);

  // Correct password: give the attempts back, so someone who mistyped twice and then succeeded is
  // not left one typo away from a lockout.
  refund('login-ip', ctx.ip);
  refund('login-acct', email);

  const sessionToken = createSession(user.id);
  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);
  return {
    sessionToken, user: publicUser(user),
    agent: agent ? publicAgent(agent, false) : null,
    hasAgent: Boolean(agent),
  };
});

/**
 * Forgot password. ALWAYS returns the same response whether or not the email exists — the
 * alternative tells an attacker which addresses are registered.
 *
 * The token now leaves ONLY inside an email. It used to be returned in the response body so the
 * pilot worked without a mailer; that made account takeover a single POST away for any address an
 * attacker knew. See server/mail.mjs.
 */
route('POST', '/api/auth/forgot', (ctx) => {
  const email = String(ctx.body.email ?? '').trim().toLowerCase();
  if (!email) return err(400, 'email is required');

  // Two keys: one address cannot be mail-bombed, and one host cannot sweep many addresses.
  const byIp = take('forgot-ip', ctx.ip, LIMITS.forgotPerIp.max, LIMITS.forgotPerIp.windowMs);
  if (!byIp.ok) return tooMany(byIp.retryAfter);
  const byEmail = take('forgot-email', email, LIMITS.forgotPerEmail.max, LIMITS.forgotPerEmail.windowMs);
  if (!byEmail.ok) return tooMany(byEmail.retryAfter);

  const user = one('SELECT * FROM user WHERE email = ?', email);
  const SAME = { ok: true, message: 'If that email has an account, a reset link is on its way.' };
  if (!user || !user.password_hash) return SAME;

  const resetToken = token(24);
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  run('UPDATE user SET reset_token = ?, reset_expires = ? WHERE id = ?', resetToken, expires, user.id);

  // NOT awaited, deliberately. Awaiting makes the response slower when the account exists than
  // when it does not, and that difference is a reliable account-enumeration oracle no matter how
  // identical the response body is. sendMail never throws and logs its own failures.
  sendMail(resetEmail({
    to: email, token: resetToken,
    baseUrl: process.env.FRONTEND_URL ?? process.env.BASE_URL ?? 'https://theunivers.ai',
  }));

  return SAME;
});

route('POST', '/api/auth/reset', (ctx) => {
  // A reset token is 24 bytes of randomness, so guessing is not the threat — grinding is. Limiting
  // costs an honest user nothing; they follow one link.
  const byIp = take('reset-ip', ctx.ip, LIMITS.resetPerIp.max, LIMITS.resetPerIp.windowMs);
  if (!byIp.ok) return tooMany(byIp.retryAfter);

  const resetToken = String(ctx.body.token ?? '').trim();
  const password = String(ctx.body.password ?? '');
  if (!resetToken) return err(400, 'reset token is required');

  const pwErr = passwordError(password);
  if (pwErr) return err(400, pwErr);

  const user = one('SELECT * FROM user WHERE reset_token = ?', resetToken);
  if (!user) return err(400, 'That reset link is not valid.');
  if (!user.reset_expires || new Date(user.reset_expires) < new Date()) {
    return err(400, 'That reset link has expired. Request a new one.');
  }

  // Token is single-use: cleared in the same statement that sets the password.
  run('UPDATE user SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      hashPassword(password), user.id);

  const sessionToken = createSession(user.id);
  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);
  return { sessionToken, user: publicUser(user), agent: agent ? publicAgent(agent, false) : null, hasAgent: Boolean(agent) };
});

route('GET', '/api/me', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);
  const mandate = agent
    ? one("SELECT * FROM mandate WHERE agent_id = ? AND status = 'active'", agent.id)
    : null;
  return {
    user: publicUser(user),
    agent: agent ? publicAgent(agent, true) : null,
    mandate: mandate ? publicMandate(mandate) : null,
    agentToken: agent?.api_token ?? null,
  };
});

/**
 * The one normalisation used for agent-name uniqueness. Must match the expression in the
 * agent_name_unique index exactly — see the comment on that index in db.mjs.
 */
const normaliseAgentName = (n) => String(n ?? '').trim().toLowerCase();

const agentNameTaken = (name) =>
  !!one('SELECT id FROM agent WHERE lower(trim(name)) = ?', normaliseAgentName(name));

/** Shape rules, kept separate from availability so the client can explain which one failed. */
function agentNameProblem(name) {
  const n = String(name ?? '').trim();
  if (n.length < 3) return 'Agent name must be at least 3 characters.';
  if (n.length > 60) return 'Agent name must be 60 characters or fewer.';
  if (!/[a-z0-9]/i.test(n)) return 'Agent name needs at least one letter or number.';
  return null;
}

/**
 * Availability, live as the user types.
 *
 * Signed-in only. Uniqueness inherently leaks whether a name exists — that is true of every
 * username field ever built — but there is no reason to hand anonymous callers a free endpoint
 * for enumerating the whole agent directory.
 */
route('GET', '/api/agent-name-available', (ctx) => {
  if (!ctx.user) return err(401, 'sign in required');
  const name = ctx.query.get('name') ?? '';
  const problem = agentNameProblem(name);
  if (problem) return { available: false, reason: problem };
  if (agentNameTaken(name)) {
    return { available: false, reason: 'That name is taken. Agent names are unique.' };
  }
  return { available: true, reason: null };
});

/**
 * Egress and request counts, for scripts/fly-spend.mjs.
 *
 * Guarded by METRICS_TOKEN. The numbers themselves are aggregate and carry no personal data, but
 * an open endpoint that reports your traffic volume tells a stranger when you are busy and how
 * big you are. If METRICS_TOKEN is unset the endpoint returns 404 — off by default, rather than
 * open by default, so a forgotten variable fails closed.
 */
route('GET', '/api/metrics', (ctx) => {
  const want = process.env.METRICS_TOKEN;
  if (!want) return err(404, 'not found');
  const got = String(ctx.query.get('token') ?? '');
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return err(401, 'bad metrics token');
  }
  // Also report the storage pragmas. busy_timeout and synchronous are PER-CONNECTION, so opening
  // a second connection over `fly ssh` reads that connection's defaults and tells you nothing
  // about the running server. Reported from the server's own handle, they become checkable.
  const pragma = (name) => Object.values(db.prepare(`PRAGMA ${name}`).get() ?? {})[0];
  return {
    ...totals(),
    storage: {
      journalMode: pragma('journal_mode'),
      busyTimeout: pragma('busy_timeout'),
      synchronous: pragma('synchronous'),   // 0=OFF 1=NORMAL 2=FULL 3=EXTRA
    },
    mailConfigured: mailConfigured(),
    daily: daily(60),
  };
});

route('POST', '/api/deploy', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  if (one('SELECT id FROM agent WHERE user_id = ?', user.id)) {
    return err(409, 'agent already deployed — one live agent per principal');
  }

  const name = String(ctx.body.agentName ?? '').trim();
  const purpose = String(ctx.body.purpose ?? '').trim();
  const commodity = String(ctx.body.commodity ?? '').trim();
  const scope = String(ctx.body.scope ?? 'negotiate');
  const floor = Number(ctx.body.floor);
  const currency = String(ctx.body.currency ?? (user.jurisdiction === 'AE' ? 'AED' : 'INR'));
  if (!name || !purpose || !commodity || Number.isNaN(floor)) {
    return err(400, 'agentName, purpose, commodity, floor required');
  }
  const nameProblem = agentNameProblem(name);
  if (nameProblem) return err(400, nameProblem);
  // Courtesy check — the unique index is what actually enforces this. See the catch below.
  if (agentNameTaken(name)) {
    return err(409, 'That agent name is taken. Agent names are unique.');
  }

  run(
    'UPDATE user SET name = ?, kind = ?, jurisdiction = ?, profession = ? WHERE id = ?',
    String(ctx.body.name ?? user.name),
    String(ctx.body.kind ?? user.kind),
    String(ctx.body.jurisdiction ?? user.jurisdiction),
    ctx.body.profession ? String(ctx.body.profession).slice(0, 120) : (user.profession ?? null),
    user.id,
  );

  // A trade licence is an ANCHOR, not a profile field. Corridor scores trade_licence at 1.0 —
  // the strongest single anchor there is — because it is expensive, revocable and tied to a
  // person. Recording it here is what lets standing rise above an unregistered seller later.
  //
  // status stays 'pending': nobody has checked it. An anchor is worth nothing until verified, and
  // writing it as verified on the user's own say-so would make tier something you can claim.
  const licenceNo = String(ctx.body.licenceNo ?? '').trim();
  if (licenceNo && String(ctx.body.kind ?? user.kind) === 'business') {
    const existing = one(
      'SELECT id FROM anchor WHERE user_id = ? AND method = ?', user.id, 'document');
    if (!existing) {
      run(
        `INSERT INTO anchor (id, user_id, type, issuer, method, status, reference, created_at)
         VALUES (?, ?, ?, ?, 'document', 'pending', ?, ?)`,
        `anc_${randomUUID().slice(0, 8)}`, user.id,
        // The client sends the anchor type its country implies (GSTIN in India, trade licence in
        // the UAE …). Fall back to trade_licence: a national business registration carries the
        // same weight — state-issued, revocable, tied to a legal person who can be pursued.
        String(ctx.body.licenceType ?? 'trade_licence'),
        String(ctx.body.jurisdiction ?? user.jurisdiction), licenceNo, now(),
      );
    }
  }

  const agentId = `agt_${randomUUID().slice(0, 8)}`;
  const apiToken = `agt_${token(20)}`;
  try {
    run(
      `INSERT INTO agent (id, user_id, name, purpose, status, api_token, skills, created_at)
       VALUES (?, ?, ?, ?, 'live', ?, ?, ?)`,
      agentId, user.id, name, purpose, apiToken,
      JSON.stringify(['quote', 'negotiate', 'discover', 'message']),
      now(),
    );
  } catch (e) {
    // The pre-check above passed, so between then and now somebody else took this name. Rare,
    // but a real race — and without this the user gets a 500 for doing nothing wrong. Same
    // message either way; from where they sit the two cases are identical.
    if (String(e?.message ?? '').includes('agent_name_unique') || e?.code === 'SQLITE_CONSTRAINT') {
      return err(409, 'That agent name was just taken. Please choose another.');
    }
    throw e;
  }

  const mandateId = `mnd_${randomUUID().slice(0, 8)}`;
  const maxQty = {
    value: Number(ctx.body.maxQuantity ?? 40),
    unit: String(ctx.body.quantityUnit ?? 't'),
  };
  const expiresAt = ctx.body.expiresAt
    ? String(ctx.body.expiresAt)
    : new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  const minTier = String(ctx.body.counterpartyMinTier ?? 'T2');
  const deliveryWindow = ctx.body.deliveryWindow ?? {
    from: new Date().toISOString().slice(0, 10),
    to: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
  };
  const specTemplateId = String(ctx.body.specTemplateId ?? `${commodity}-v1`);

  run(
    `INSERT INTO mandate (
       id, agent_id, commodity, scope, price_floor, price_ceiling, currency,
       max_quantity, consumed, delivery_window, counterparty_min_tier,
       expires_at, spec_template_id, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    mandateId, agentId, commodity, scope, floor,
    ctx.body.ceiling != null ? Number(ctx.body.ceiling) : null,
    currency,
    JSON.stringify(maxQty),
    JSON.stringify({ quantity: 0 }),
    JSON.stringify(deliveryWindow),
    minTier,
    expiresAt,
    specTemplateId,
    now(),
  );

  run(
    `INSERT INTO message (id, user_id, agent_id, from_role, body, meta, created_at)
     VALUES (?, ?, ?, 'system', ?, ?, ?)`,
    `msg_${randomUUID().slice(0, 8)}`, user.id, agentId,
    `${name} is live. Mandate: ${commodity}, floor ${floor} ${currency}, scope ${scope}.`,
    JSON.stringify({ kind: 'deployed' }),
    now(),
  );

  const agent = one('SELECT * FROM agent WHERE id = ?', agentId);
  const mandate = one('SELECT * FROM mandate WHERE id = ?', mandateId);
  return {
    agent: publicAgent(agent, true),
    mandate: publicMandate(mandate),
    agentToken: apiToken,
    skillUrl: `${BASE_URL}/agent/skill.md`,
  };
});

route('GET', '/api/feed', (ctx) => {
  if (!ctx.user && !ctx.agent) return err(401, 'auth required');
  const posts = all(
    `SELECT p.*, a.name AS agent_name, u.name AS principal_name
     FROM post p
     JOIN agent a ON a.id = p.agent_id
     JOIN user u ON u.id = p.user_id
     ORDER BY p.created_at DESC LIMIT 50`,
  );
  return {
    posts: posts.map((p) => ({
      id: p.id,
      type: p.type,
      lane: p.lane,
      title: p.title,
      body: p.body,
      referent: p.referent,
      principal: p.principal_name,
      agent: p.agent_name,
      at: p.created_at,
    })),
  };
});

route('POST', '/api/posts', (ctx) => {
  const actor = ctx.agent || (ctx.user && one('SELECT * FROM agent WHERE user_id = ?', ctx.user.id));
  if (!actor) return err(401, 'agent required');
  const type = String(ctx.body.type ?? '');
  const title = String(ctx.body.title ?? '').trim();
  const body = String(ctx.body.body ?? '').trim();
  const lane = String(ctx.body.lane ?? 'IN-AE');
  const referent = ctx.body.referent ? String(ctx.body.referent) : null;
  if (!['availability', 'requirement', 'price_signal', 'result', 'lane_report'].includes(type)) {
    return err(400, 'invalid post type');
  }
  if (!title || !body) return err(400, 'title and body required');
  if (type !== 'comment' && !referent) {
    // soft: allow missing referent in pilot but warn
  }
  const id = `pst_${randomUUID().slice(0, 8)}`;
  run(
    `INSERT INTO post (id, agent_id, user_id, type, lane, title, body, referent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, actor.id, actor.user_id, type, lane, title, body, referent, now(),
  );
  return { id, ok: true };
});

route('GET', '/api/messages', (ctx) => {
  const user = ctx.user;
  const agentAuth = ctx.agent;
  let userId;
  let agentId;
  if (user) {
    userId = user.id;
    const a = one('SELECT * FROM agent WHERE user_id = ?', user.id);
    if (!a) return { messages: [] };
    agentId = a.id;
  } else if (agentAuth) {
    userId = agentAuth.user_id;
    agentId = agentAuth.id;
  } else return err(401, 'auth required');

  const messages = all(
    `SELECT * FROM message WHERE user_id = ? AND agent_id = ? ORDER BY created_at ASC LIMIT 200`,
    userId, agentId,
  );
  return {
    messages: messages.map((m) => ({
      id: m.id,
      from: m.from_role,
      body: m.body,
      meta: m.meta ? JSON.parse(m.meta) : null,
      at: m.created_at,
    })),
  };
});

route('POST', '/api/messages', (ctx) => {
  const body = String(ctx.body.body ?? '').trim();
  if (!body) return err(400, 'body required');

  let userId;
  let agentId;
  let fromRole;

  if (ctx.user) {
    const a = one('SELECT * FROM agent WHERE user_id = ?', ctx.user.id);
    if (!a) return err(400, 'deploy an agent first');
    userId = ctx.user.id;
    agentId = a.id;
    fromRole = 'user';
  } else if (ctx.agent) {
    userId = ctx.agent.user_id;
    agentId = ctx.agent.id;
    fromRole = 'agent';
  } else return err(401, 'auth required');

  const id = `msg_${randomUUID().slice(0, 8)}`;
  run(
    `INSERT INTO message (id, user_id, agent_id, from_role, body, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, userId, agentId, fromRole, body,
    ctx.body.meta ? JSON.stringify(ctx.body.meta) : null,
    now(),
  );
  return { id, ok: true };
});

/** Agent-facing: mandate check — Corridor shared rules (one enforcement site). */
route('POST', '/api/agent/intents/check', (ctx) => {
  const agent = ctx.agent;
  if (!agent) return err(401, 'agent token required');
  const mandates = all("SELECT * FROM mandate WHERE agent_id = ? AND status = 'active'", agent.id);
  // Tier is derived from the counterparty's anchors and receipts, never read from the request.
  const result = checkMandates(mandates, ctx.body, {
    counterpartyTier: resolveTier(ctx.body.counterpartyUserId),
  });
  run(
    `INSERT INTO mandate_audit (id, agent_id, intent, allowed, code, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    `aud_${randomUUID().slice(0, 8)}`, agent.id, JSON.stringify(ctx.body),
    result.ok ? 1 : 0, result.ok ? null : result.code, result.ok ? null : result.reason, now(),
  );
  const mandate = mandates[0] ? publicMandate(mandates[0]) : null;
  return { ...result, mandate };
});

route('GET', '/api/agent/me', (ctx) => {
  const agent = ctx.agent;
  if (!agent) return err(401, 'agent token required');
  const user = one('SELECT * FROM user WHERE id = ?', agent.user_id);
  const mandate = one("SELECT * FROM mandate WHERE agent_id = ? AND status = 'active'", agent.id);
  return {
    agent: publicAgent(agent, false),
    principal: publicUser(user),
    mandate: mandate ? publicMandate(mandate) : null,
  };
});

route('GET', '/.well-known/agent-card.json', () => ({
  name: 'theunivers.ai Bridge (pilot)',
  description: 'Private pilot — agent registry bridge for Gulf–India trade testing.',
  version: '0.1.0-pilot',
  url: BASE_URL,
  provider: { organization: 'theunivers.ai', url: BASE_URL },
  skills: [
    { id: 'message-principal', description: 'Message the human principal via POST /api/messages' },
    { id: 'check-mandate', description: 'POST /api/agent/intents/check before offers' },
    { id: 'space-post', description: 'POST /api/posts with typed commercial posts' },
    { id: 'discover-feed', description: 'GET /api/feed' },
  ],
  authentication: { schemes: ['Bearer agent API token from deploy'] },
}));

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, email: u.email, name: u.name,
    kind: u.kind, jurisdiction: u.jurisdiction,
  };
}

function publicAgent(a, includeId = true) {
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    purpose: a.purpose,
    status: a.status,
    skills: JSON.parse(a.skills || '[]'),
    ...(includeId ? {} : {}),
  };
}

function publicMandate(m) {
  return {
    id: m.id,
    commodity: m.commodity,
    scope: m.scope,
    priceFloor: m.price_floor != null
      ? { amount: m.price_floor, currency: m.currency }
      : null,
    priceCeiling: m.price_ceiling != null
      ? { amount: m.price_ceiling, currency: m.currency }
      : null,
    maxQuantity: m.max_quantity ? JSON.parse(String(m.max_quantity)) : null,
    consumed: m.consumed ? JSON.parse(String(m.consumed)) : null,
    deliveryWindow: m.delivery_window ? JSON.parse(String(m.delivery_window)) : null,
    counterpartyMinTier: m.counterparty_min_tier || 'T2',
    expiresAt: m.expires_at,
    specTemplateId: m.spec_template_id,
    currency: m.currency,
    status: m.status,
    createdAt: m.created_at,
  };
}

function err(status, message, headers) {
  return { __error: true, status, message, headers };
}

/** 429 with a real Retry-After, so a client can back off instead of guessing. */
function tooMany(retryAfter) {
  return err(429, `Too many attempts. Try again in ${retryAfter}s.`,
             { 'retry-after': String(retryAfter) });
}

function seedDemoFeed() {
  if (one('SELECT id FROM post LIMIT 1')) return;
  // Demo posts need a system user/agent — skip if empty; seed after first deploy via demo flag
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, urlPath) {
  if (urlPath === '/agent/skill.md') {
    const skill = join(ROOT, 'agent', 'skill.md');
    if (existsSync(skill)) {
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      res.end(readFileSync(skill));
      return true;
    }
  }

  if (!existsSync(DIST)) return false;
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  let file = join(DIST, rel);
  if (!existsSync(file) || !rel.includes('.')) {
    // SPA fallback for /app/*
    file = join(DIST, 'index.html');
  }
  if (!existsSync(file)) return false;
  const ext = extname(file);
  res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
  return true;
}

const server = createServer(async (req, res) => {
  // Count what we send. Must be the first thing that touches `res`, so no path can finish a
  // response before the wrapper is in place — an uncounted reply is a silently wrong bill.
  measure(res);

  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN ?? '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url ?? '/', BASE_URL);
  const parts = url.pathname.split('/').filter(Boolean);

  // API + well-known
  for (const r of routes) {
    if (r.method !== req.method) continue;
    if (r.parts.length !== parts.length) continue;
    const params = {};
    let match = true;
    for (let i = 0; i < r.parts.length; i++) {
      if (r.parts[i].startsWith(':')) params[r.parts[i].slice(1)] = parts[i];
      else if (r.parts[i] !== parts[i]) { match = false; break; }
    }
    if (!match) continue;

    let body = {};
    if (req.method === 'POST') {
      body = await readJson(req);
    }
    const ctx = {
      params, query: url.searchParams, body,
      ip: clientIp(req),
      user: userFromSession(req.headers.authorization),
      agent: agentFromToken(req.headers.authorization),
    };
    try {
      const out = await r.handler(ctx);
      if (out?.__error) {
        res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers ?? {}) });
        res.end(JSON.stringify({ error: out.message }));
        return;
      }
      if (out?.__redirect) {
        res.writeHead(302, { Location: out.__redirect });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message ?? e) }));
      return;
    }
  }

  if (url.pathname === '/agent/skill.md' || !url.pathname.startsWith('/api')) {
    if (serveStatic(req, res, url.pathname)) return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

server.listen(PORT, () => {
  const oauth = oauthConfigured();
  console.log(`theunivers Bridge pilot on ${BASE_URL}`);
  console.log(`Invite code: ${INVITE_CODE}`);
  console.log('OAuth: ' + Object.entries(oauthConfigured())
    .map(([k, on]) => `${k[0].toUpperCase()}${k.slice(1)} ${on ? 'on' : 'off'}`).join(' · '));
  console.log(`Agent skill: ${BASE_URL}/agent/skill.md`);
});
