/**
 * Private pilot API for theunivers.ai Bridge.
 * Web UI uses session Bearer tokens; AI agents use agent API tokens.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { measure, daily, totals } from './metrics.mjs';
import { createOrder, transition, ordersFor, orderRow, publicOrder, roleOf } from './orders.mjs';
import { chainFor, verifyChain } from './receipts.mjs';
import { trustOf } from './trust.mjs';
import { analyseNote, analysisAvailable } from './analyse.mjs';
import * as store from './storage.mjs';
import { subscribe, publish, publishAll, streamStats } from './events.mjs';
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
import { handleError } from '../shared/agent-name.mjs';
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
  // Derived from the mail module rather than from an env var read here, so it cannot drift from
  // what actually sends. It did drift: this checked SMTP_HOST, which nothing has used since mail
  // moved to Resend, so the API reported mail as OFF while it was working.
  mailer: mailConfigured(),
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
  // Name is NOT asked at signup — it belongs to "Who are you?" in the deploy wizard, where it is
  // asked once alongside country and kind. Requiring it here made the user type it twice.
  // OAuth accounts arrive with a name from the provider; password accounts fill it in at deploy.
  if (!email) return err(400, 'email is required');
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

/**
 * Set or change this account's password.
 *
 * Two different operations behind one endpoint, and the difference matters:
 *
 *   FIRST password (OAuth account, password_hash IS NULL)
 *     A valid session is sufficient. There is no current password to prove, and demanding one
 *     would make the feature impossible for exactly the accounts that need it. This closes a real
 *     gap: a Google-only account whose owner loses access to Google is otherwise locked out
 *     permanently, because /api/auth/forgot has nothing to reset.
 *
 *   CHANGE (a password already exists)
 *     The current password is required, even though the caller is already signed in. A stolen or
 *     borrowed session must not be enough to seize the account — that turns a temporary
 *     compromise (someone at your unlocked laptop) into a permanent one.
 */
route('POST', '/api/auth/set-password', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');

  // Guessing the CURRENT password through this endpoint is the attack, so it is limited like login.
  const byIp = take('setpw-ip', ctx.ip, LIMITS.loginPerIp.max, LIMITS.loginPerIp.windowMs);
  if (!byIp.ok) return tooMany(byIp.retryAfter);

  const next = String(ctx.body.password ?? '');
  const pwErr = passwordError(next);
  if (pwErr) return err(400, pwErr);

  if (user.password_hash) {
    const current = String(ctx.body.currentPassword ?? '');
    if (!current) return err(400, 'Enter your current password.');
    if (!verifyPassword(current, user.password_hash)) {
      return err(401, 'That current password is incorrect.');
    }
    if (current === next) return err(400, 'That is already your password.');
  }

  run('UPDATE user SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      hashPassword(next), user.id);

  // Every OTHER session is dropped. A password change is what you do when you fear someone else
  // has access, and leaving their session alive would make the change theatre. The caller's own
  // session survives, so they are not signed out of the tab they just used.
  const mine = String(ctx.headers?.authorization ?? '').replace(/^Bearer /i, '');
  run('DELETE FROM session WHERE user_id = ? AND token != ?', user.id, mine);

  const fresh = one('SELECT * FROM user WHERE id = ?', user.id);
  return { ok: true, user: publicUser(fresh) };
});

/**
 * ── The proposal flow ────────────────────────────────────────────────────────────────────
 *
 * An agent proposes; the principal decides; the guard has the final word at BOTH ends.
 * See docs/decisions/ADR-0001-chat-cannot-widen-a-mandate.md.
 */

/** Agent asks permission for something its scope does not let it do alone. */
route('POST', '/api/agent/proposals', (ctx) => {
  const agent = ctx.agent;
  if (!agent) return err(401, 'agent token required');

  const kind = String(ctx.body.kind ?? 'commit').trim();
  const summary = String(ctx.body.summary ?? '').trim().slice(0, 300);
  const intent = ctx.body.intent;
  if (!summary) return err(400, 'summary is required');
  if (!intent || typeof intent !== 'object') return err(400, 'intent is required');

  /*
   * THE GUARD RUNS FIRST, and its refusal code decides whether a question is even askable.
   *
   *   SCOPE      → this is precisely what a proposal is for. The mandate says the agent may
   *                negotiate but not commit; the principal supplying that authority for ONE act is
   *                what "bring it back to me" means. Becomes a pending question.
   *   passes     → the agent may act alone and is asking voluntarily. Allowed; caution is not an
   *                error.
   *   anything   → a substantive limit: FLOOR, CEILING, QUANTITY, COMMODITY, EXPIRED,
   *   else         COUNTERPARTY_TIER. Refused outright and never shown to the principal.
   *
   * That last line is ADR-0001 made concrete. A principal may supply a missing SCOPE, because
   * scope is a delegation question — how much the AGENT may do alone. They may not supply a
   * missing FLOOR by tapping Approve, because that is a limit on the DEAL, and moving it through
   * an approval prompt is widening a mandate by chat. Doing it any other way would let a
   * counterparty put "approve selling below your floor" in front of the principal simply by
   * proposing it, and train them to wave refusals through.
   */
  // checkMandates takes mandate ROWS, not an agent id — passing an id yields a snapshot whose
  // status is undefined, every mandate is skipped, and the result is a misleading NO_MATCH that
  // looks like a legitimate refusal. Load them the same way /api/agent/intents/check does.
  const mandateRows = all(
    "SELECT * FROM mandate WHERE agent_id = ? AND status = 'active'", agent.id);
  const tier = resolveTier(ctx.body.counterpartyUserId);
  const check = checkMandates(mandateRows, intent, { counterpartyTier: tier });

  /*
   * "Is scope the ONLY obstacle?" — asked by re-running the guard against a copy of the mandate
   * with scope raised, and seeing whether everything else passes.
   *
   * Testing `check.code === 'SCOPE'` is NOT sufficient and was a real bug. evaluateOne checks
   * scope BEFORE floor and short-circuits, so a below-floor `accept` fails on SCOPE and never
   * reaches the floor rule. Reading that code as "just needs approval" turned a floor breach into
   * an approvable question — and approving it would have bypassed the floor completely.
   */
  const asIfPermitted = checkMandates(
    mandateRows.map((m) => ({ ...m, scope: 'commit' })), intent, { counterpartyTier: tier });

  if (!asIfPermitted.ok) {
    // A substantive limit. Report ITS code, not the SCOPE mask that hid it.
    return err(409, `Refused by your mandate: ${asIfPermitted.reason}`,
               undefined, asIfPermitted.code);
  }
  const escalation = !check.ok;   // passes on its own? then this is a voluntary check-in

  const id = `prp_${randomUUID().slice(0, 8)}`;
  run(`INSERT INTO proposal (id, agent_id, user_id, kind, intent, summary, guard_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, agent.id, agent.user_id, kind, JSON.stringify(intent), summary,
      escalation ? 'SCOPE' : null, now());

  // The whole reason the Bridge used to poll: a question can arrive at any moment.
  publish(agent.user_id, 'proposal', { id });
  return { id, status: 'pending', escalation };
});

/** What the principal has been asked. Newest first. */
route('GET', '/api/proposals', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const rows = all(
    `SELECT id, kind, intent, summary, status, guard_code, created_at, decided_at
     FROM proposal WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, user.id);
  return { proposals: rows.map((r) => ({ ...r, intent: JSON.parse(r.intent) })) };
});

/**
 * Approve or refuse.
 *
 * The guard runs AGAIN on approval. A mandate can expire, be edited, or have its quantity consumed
 * between the question being asked and answered, and approval is not permission to skip the check
 * — it says "I agree to this", not "ignore the rules". A proposal that no longer passes is marked
 * `invalidated` with the code, so the principal sees what changed rather than a silent failure.
 */
route('POST', '/api/proposals/decide', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');

  const id = String(ctx.body.id ?? '');
  const approve = ctx.body.approve === true;
  const row = one('SELECT * FROM proposal WHERE id = ? AND user_id = ?', id, user.id);
  if (!row) return err(404, 'no such proposal');
  if (row.status !== 'pending') return err(409, `Already ${row.status}.`);

  if (!approve) {
    run('UPDATE proposal SET status = ?, decided_at = ? WHERE id = ?', 'refused', now(), id);
    publish(user.id, 'proposal', { id, status: 'refused' });
    return { id, status: 'refused' };
  }

  /*
   * Re-checked, because a mandate can expire, be edited, or have its quantity consumed between the
   * question and the answer. Approval says "I agree to this", not "ignore the rules".
   *
   * A SCOPE refusal is the one the principal is entitled to answer — that is the delegation
   * question they were asked. Every other code is a limit on the deal, and no amount of tapping
   * Approve may move it (ADR-0001).
   */
  const rows = all("SELECT * FROM mandate WHERE agent_id = ? AND status = 'active'", row.agent_id);
  // Same question as at submission, and for the same reason: scope is the principal's to supply,
  // every other limit is not. Elevating scope isolates exactly that.
  const check = checkMandates(
    rows.map((m) => ({ ...m, scope: 'commit' })), JSON.parse(row.intent), {});
  if (!check.ok) {
    run('UPDATE proposal SET status = ?, guard_code = ?, decided_at = ? WHERE id = ?',
        'invalidated', check.code, now(), id);
    return err(409, `Your mandate no longer allows this: ${check.reason}`);
  }

  run('UPDATE proposal SET status = ?, decided_at = ? WHERE id = ?', 'approved', now(), id);
  // Same person, other tabs — a decision made on a phone should clear on the laptop.
  publish(user.id, 'proposal', { id, status: 'approved' });
  return { id, status: 'approved' };
});

/**
 * Set what an agent may do.
 *
 * Replaces the old mandate step in sign-up. Mandates are per-deal decisions and asking for them
 * during onboarding produced terms nobody meant.
 *
 * A new mandate SUPERSEDES the old one rather than editing it: the previous row is retired to
 * 'superseded' and a new row is written. Editing in place would rewrite history that receipts
 * already point at — a receipt saying "checked against mandate X" must keep meaning what it meant.
 */
route('POST', '/api/mandate', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);
  if (!agent) return err(409, 'deploy an agent first');

  const commodity = String(ctx.body.commodity ?? '').trim();
  const floor = Number(ctx.body.floor);
  if (!commodity) return err(400, 'A commodity or domain is required.');
  if (Number.isNaN(floor) || floor < 0) return err(400, 'A price floor is required.');
  if (ctx.body.ceiling != null && ctx.body.ceiling !== '' && Number(ctx.body.ceiling) < floor) {
    return err(400, 'The ceiling cannot be below the floor.');
  }

  run("UPDATE mandate SET status = 'superseded' WHERE agent_id = ? AND status = 'active'", agent.id);
  const mandate = createMandate(agent.id, ctx.body);
  return { mandate: publicMandate(mandate) };
});

/**
 * ── Orders ───────────────────────────────────────────────────────────────────────────────
 * The customised purchase order and its state machine.
 * See docs/specs/ORDER-AND-INSPECTION.md and shared/order-states.mjs.
 */

/** A buyer's agent drafts a PO. Drafting commits nobody — sending it does. */
route('POST', '/api/agent/orders', (ctx) => {
  const agent = ctx.agent;
  if (!agent) return err(401, 'agent token required');

  // The seller is named by HANDLE, resolved here. Accepting a raw agent id from the body would
  // let a caller address an agent they could not otherwise find or spell.
  const handle = String(ctx.body.sellerAgent ?? '').trim();
  const seller = one('SELECT * FROM agent WHERE lower(trim(name)) = ?', handle.toLowerCase());
  if (!seller) return err(404, 'no agent with that name');
  if (seller.id === agent.id) return err(400, 'an agent cannot trade with itself');

  const commodity = String(ctx.body.commodity ?? '').trim();
  const amount = Number(ctx.body.price?.amount);
  const currency = String(ctx.body.price?.currency ?? '').trim();
  if (!commodity) return err(400, 'commodity is required');
  if (Number.isNaN(amount) || amount <= 0) return err(400, 'a positive price is required');
  if (!currency) return err(400, 'price currency is required');

  const order = createOrder({
    buyerAgentId: agent.id,
    sellerAgentId: seller.id,
    commodity,
    price: { amount, currency },
    quantity: ctx.body.quantity ?? { value: 1, unit: 't' },
    deliveryWindow: ctx.body.deliveryWindow ?? {
      from: new Date().toISOString().slice(0, 10),
      to: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    },
    specTemplateId: ctx.body.specTemplateId,
    inspectionPolicy: ctx.body.inspectionPolicy,
  });
  return { order: publicOrder(order, agent.id) };
});

/**
 * Move an order.
 *
 * A SCOPE refusal here is not a failure — it means the mandate withholds the authority to bind,
 * which is exactly what /api/agent/proposals turns into a question for the principal. The code is
 * returned so the agent can tell that case from a substantive refusal it must not retry.
 */
route('POST', '/api/agent/orders/transition', (ctx) => {
  const agent = ctx.agent;
  if (!agent) return err(401, 'agent token required');

  const id = String(ctx.body.order ?? '');
  const to = String(ctx.body.to ?? '');
  const result = transition(id, agent.id, to);
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404
      : result.code === 'NOT_A_PARTY' ? 403 : 409;
    return err(status, result.reason, undefined, result.code);
  }

  // Bookkeeping, not a decision: an accepted order is by definition waiting to be funded. Done
  // here rather than left to a caller so the state cannot sit in a place nobody advances it from.
  if (result.order.status === 'accepted') {
    const next = transition(id, agent.id, 'awaiting_funding', { system: true });
    if (next.ok) return { order: publicOrder(next.order, agent.id) };
  }
  return { order: publicOrder(result.order, agent.id) };
});

/**
 * Funding confirmation.
 *
 * THE PLATFORM DOES NOT FUND ANYTHING. This records that a funding confirmation reached us, and
 * the receipt says where it came from. Until a licensed provider's webhook exists, the only
 * source is an operator asserting it by hand — so the receipt records `operator-manual`, never
 * something that reads as though a system observed it. A receipt that overstates its own source
 * is worse than no receipt.
 *
 * Gated by METRICS_TOKEN, and 404s when that is unset: off by default.
 */
route('POST', '/api/orders/confirm-funding', (ctx) => {
  const want = process.env.METRICS_TOKEN;
  if (!want) return err(404, 'not found');
  const got = String(ctx.body.token ?? '');
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return err(401, 'bad operator token');
  }
  const id = String(ctx.body.order ?? '');
  const result = transition(id, null, 'funded', { system: true });
  if (!result.ok) return err(409, result.reason, undefined, result.code);
  return { order: publicOrder(result.order, null), source: 'operator-manual' };
});

/** A principal's orders, across whichever agent is theirs. */
/**
 * A principal moves their own order, from the app.
 *
 * Distinct from /api/agent/orders/transition, which an unattended agent calls with an agent token.
 * Same machine, same guard, one difference: a person acting in the app satisfies SCOPE for that
 * act, because scope limits what the AGENT may do alone and not what its principal may do. Every
 * other limit is untouched — see the comment in orders.mjs.
 */
route('POST', '/api/orders/transition', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);
  if (!agent) return err(409, 'deploy an agent first');

  const result = transition(String(ctx.body.order ?? ''), agent.id, String(ctx.body.to ?? ''),
                            { principal: true });
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'NOT_A_PARTY' ? 403 : 409;
    return err(status, result.reason, undefined, result.code);
  }
  return { order: publicOrder(result.order, agent.id) };
});

/**
 * Everything the You screen shows in one call.
 *
 * One request rather than five, because a profile is read as a whole — five parallel fetches would
 * paint the header in pieces and make a settled account look like it is still loading.
 *
 * `trust` is DERIVED here and returned with its explanation. It is never stored and never accepted
 * from a request: the moment tier becomes a field somebody can set, this is a directory with
 * badges rather than a record of conduct.
 */
route('GET', '/api/profile', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');

  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);
  const mandate = agent
    ? one("SELECT * FROM mandate WHERE agent_id = ? AND status = 'active'", agent.id)
    : null;

  const anchors = all(
    `SELECT id, type, issuer, method, status, reference, verified_at, expires_at, created_at
     FROM anchor WHERE user_id = ? ORDER BY created_at DESC`, user.id);

  const chain = verifyChain(user.id);
  const orders = agent
    ? one(`SELECT COUNT(*) c FROM "order" WHERE buyer_agent_id = ? OR seller_agent_id = ?`,
          agent.id, agent.id)
    : { c: 0 };

  return {
    user: publicUser(user),
    agent: agent ? publicAgent(agent, true) : null,
    mandate: mandate ? publicMandate(mandate) : null,
    trust: trustOf(user.id),
    anchors,
    counts: {
      anchors: anchors.length,
      receipts: chain.length ?? 0,
      mandates: mandate ? 1 : 0,
      deals: orders?.c ?? 0,
    },
    chain: { ok: chain.ok, length: chain.length ?? 0, at: chain.at ?? null },
  };
});

/**
 * Switch between acting as an individual and as a registered business.
 *
 * A business is not a label — it is a claim that a registration exists, so switching TO business
 * records that registration as a **pending** anchor. Pending because nobody has checked it, and
 * writing it as verified on the user's own say-so would make standing something you can assert.
 *
 * Switching back to individual does NOT delete the anchor. Receipts may already point at standing
 * that was derived while it existed, and deleting the evidence would rewrite what those receipts
 * meant. It is retired instead.
 */
route('POST', '/api/account/kind', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');

  const kind = String(ctx.body.kind ?? '');
  if (kind !== 'individual' && kind !== 'business') {
    return err(400, 'kind must be individual or business');
  }

  if (kind === 'business') {
    const reference = String(ctx.body.licenceNo ?? '').trim();
    if (!reference) return err(400, 'A registration number is required to act as a business.');
    const jurisdiction = String(ctx.body.jurisdiction ?? user.jurisdiction);
    const type = String(ctx.body.licenceType ?? 'trade_licence');

    const existing = one(
      'SELECT id FROM anchor WHERE user_id = ? AND type = ? AND reference = ?',
      user.id, type, reference);
    if (!existing) {
      run(`INSERT INTO anchor (id, user_id, type, issuer, method, status, reference, created_at)
           VALUES (?, ?, ?, ?, 'document', 'pending', ?, ?)`,
          `anc_${randomUUID().slice(0, 8)}`, user.id, type, jurisdiction, reference, now());
    }
    run('UPDATE user SET kind = ?, jurisdiction = ? WHERE id = ?', kind, jurisdiction, user.id);
  } else {
    run('UPDATE user SET kind = ? WHERE id = ?', kind, user.id);
  }

  return { user: publicUser(one('SELECT * FROM user WHERE id = ?', user.id)) };
});

/**
 * ── Workspace ────────────────────────────────────────────────────────────────────────────
 * Everything in progress, in one call — drafts, saved searches with their unread counts, and
 * whatever the agent has said unprompted.
 */
/**
 * ── Projects ─────────────────────────────────────────────────────────────────────────────
 * You find something useful, share it to your agent, and it lands in a project as a note with its
 * sources attached. See docs/specs/KNOWLEDGE-AND-CITATION.md.
 */

/**
 * How many DISTINCT people's agents have CITED this post — not how many shared it.
 *
 * Distinct, so filing the same thing ten times is one voice. Reading `citation` and not `source`
 * on purpose: a share is somebody collecting, a citation is somebody's agent having built on it,
 * and only the second is evidence the work was useful. Until an agent analyses a note, this is
 * legitimately zero — which is the honest number, not a missing feature.
 */
const citedCount = (postId) =>
  // `author_id IS NOT NULL` is what excludes self-citation. A self-cite is still WRITTEN, so a
  // note's provenance stays complete, but its author is nulled — and without this clause the row
  // was counted anyway, because it still carries a post_id. Caught by a test that cited its own
  // post and watched the number go from 1 to 2.
  one(`SELECT COUNT(DISTINCT user_id) c FROM citation
       WHERE post_id = ? AND author_id IS NOT NULL`, postId)?.c ?? 0;

/**
 * Distinct viewers, split by what did the viewing. Never summed into one number: an agent
 * machine-reading a feed is not the same event as a person stopping to read.
 */
const viewCounts = (postId) => ({
  people: one("SELECT COUNT(*) c FROM view WHERE post_id = ? AND kind = 'person'", postId)?.c ?? 0,
  agents: one("SELECT COUNT(*) c FROM view WHERE post_id = ? AND kind = 'agent'", postId)?.c ?? 0,
});

/** Everything a creator has been cited for, for their profile. */
const citedTotal = (authorId) =>
  one('SELECT COUNT(DISTINCT user_id) c FROM citation WHERE author_id = ?', authorId)?.c ?? 0;

/**
 * Share something into a project.
 *
 * Creates the project if none was named — "Project 1", "Project 2" — because being asked to name a
 * thing before you know what it is stops the share. Renaming is one tap later, when you do know.
 *
 * THE ANALYSIS IS NOT DONE HERE. The note is stored as `captured` with the source attached, and a
 * model turns it into something later. Saying "analysed" now would be the overclaiming this
 * codebase refuses everywhere else: the status says exactly what has happened, which is that the
 * material was kept.
 */
/**
 * Record that something was seen.
 *
 * INSERT OR IGNORE against a UNIQUE (post, viewer, kind), so a refresh cannot inflate it and the
 * client may call it freely. A counter that goes up when you scroll past twice is a vanity metric,
 * and this product argues against numbers that can be manufactured.
 *
 * The kind is derived from the credential presented, never from the request body — otherwise a
 * caller could claim fifty people read something by saying so.
 */
route('POST', '/api/views', (ctx) => {
  const viewer = ctx.user?.id ?? ctx.agent?.id;
  if (!viewer) return err(401, 'auth required');
  const kind = ctx.user ? 'person' : 'agent';
  const ids = (Array.isArray(ctx.body.posts) ? ctx.body.posts : [ctx.body.post])
    .filter(Boolean).map(String).slice(0, 50);

  for (const postId of ids) {
    try {
      run(`INSERT OR IGNORE INTO view (id, post_id, viewer_id, kind, created_at)
           VALUES (?, ?, ?, ?, ?)`,
          `viw_${randomUUID().slice(0, 8)}`, postId, viewer, kind, now());
    } catch { /* a view is never worth failing a request over */ }
  }
  return { ok: true, counted: ids.length };
});

route('POST', '/api/projects/share', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');

  const postId = String(ctx.body.postId ?? '').trim();
  const post = postId ? one('SELECT * FROM post WHERE id = ?', postId) : null;
  const url = String(ctx.body.url ?? '').trim();
  if (!post && !url) return err(400, 'nothing to share');

  // Project: named, chosen, or created.
  let projectId = String(ctx.body.projectId ?? '').trim();
  let project = projectId ? one('SELECT * FROM project WHERE id = ? AND user_id = ?', projectId, user.id) : null;
  if (!project) {
    const n = (one('SELECT COUNT(*) c FROM project WHERE user_id = ?', user.id)?.c ?? 0) + 1;
    projectId = `prj_${randomUUID().slice(0, 8)}`;
    run('INSERT INTO project (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        projectId, user.id, String(ctx.body.projectName ?? `Project ${n}`), now(), now());
    project = one('SELECT * FROM project WHERE id = ?', projectId);
  }

  // Note: append to the one named, or start a new file.
  let noteId = String(ctx.body.noteId ?? '').trim();
  let note = noteId ? one('SELECT * FROM note WHERE id = ? AND user_id = ?', noteId, user.id) : null;
  if (!note) {
    noteId = `not_${randomUUID().slice(0, 8)}`;
    run(`INSERT INTO note (id, project_id, user_id, title, body, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 'captured', ?, ?)`,
        noteId, projectId, user.id,
        String(ctx.body.noteTitle ?? post?.title ?? 'Untitled note').slice(0, 160), now(), now());
    note = one('SELECT * FROM note WHERE id = ?', noteId);
  }

  run(`INSERT INTO source (id, note_id, user_id, post_id, author_id, title, excerpt, used_for, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      `src_${randomUUID().slice(0, 8)}`, noteId, user.id,
      post?.id ?? null, post?.user_id ?? null,
      String(post?.title ?? ctx.body.title ?? '').slice(0, 200),
      String(post?.body ?? '').slice(0, 2000),
      String(ctx.body.usedFor ?? '').slice(0, 200),
      url || null, now());

  run('UPDATE note SET updated_at = ? WHERE id = ?', now(), noteId);
  run('UPDATE project SET updated_at = ? WHERE id = ?', now(), projectId);
  publish(user.id, 'project', { project: projectId, note: noteId });

  return { project: { id: projectId, name: project.name }, note: { id: noteId, title: note.title } };
});

/**
 * An agent records what it used while producing a note.
 *
 * This is the act that earns a creator their count. Deliberately separate from sharing, and
 * deliberately the agent's call rather than the person's: a citation asserts "I built on this",
 * which only whatever did the building can honestly say.
 */
route('POST', '/api/agent/cite', (ctx) => {
  const agent = ctx.agent;
  if (!agent) return err(401, 'agent token required');

  const noteId = String(ctx.body.note ?? '');
  const note = one('SELECT * FROM note WHERE id = ? AND user_id = ?', noteId, agent.user_id);
  if (!note) return err(404, 'no such note');

  const used = Array.isArray(ctx.body.used) ? ctx.body.used : [];
  const written = [];
  for (const u of used) {
    const src = one('SELECT * FROM source WHERE id = ? AND note_id = ?', String(u.source ?? ''), noteId);
    if (!src) continue;
    // Self-citation earns nothing. Recorded, so the note's provenance is complete, but the author
    // is left null so it cannot raise their own count.
    const selfCite = src.author_id === agent.user_id;
    const id = `cit_${randomUUID().slice(0, 8)}`;
    run(`INSERT INTO citation (id, note_id, source_id, user_id, post_id, author_id, used_for, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        id, noteId, src.id, agent.user_id, src.post_id,
        selfCite ? null : src.author_id,
        String(u.usedFor ?? '').slice(0, 200), now());
    written.push(id);
  }

  if (ctx.body.body != null) {
    run("UPDATE note SET body = ?, status = 'analysed', updated_at = ? WHERE id = ?",
        String(ctx.body.body), now(), noteId);
  }
  publish(agent.user_id, 'project', { note: noteId });
  return { citations: written.length, note: noteId };
});

route('GET', '/api/projects', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const projects = all(
    'SELECT * FROM project WHERE user_id = ? ORDER BY updated_at DESC', user.id);
  return {
    projects: projects.map((p) => ({
      id: p.id, name: p.name, updatedAt: p.updated_at,
      notes: all('SELECT id, title, status, updated_at FROM note WHERE project_id = ? ORDER BY updated_at DESC', p.id)
        .map((n) => ({
          ...n,
          sources: one('SELECT COUNT(*) c FROM source WHERE note_id = ?', n.id)?.c ?? 0,
        })),
    })),
  };
});

route('GET', '/api/projects/:id', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const p = one('SELECT * FROM project WHERE id = ? AND user_id = ?', ctx.params.id, user.id);
  if (!p) return err(404, 'no such project');
  const notes = all('SELECT * FROM note WHERE project_id = ? ORDER BY updated_at DESC', p.id)
    .map((n) => ({
      id: n.id, title: n.title, body: n.body, status: n.status, updatedAt: n.updated_at,
      /*
       * A source's own `used_for` is set at SHARE time and is almost always empty — a person
       * files something without yet knowing what they will take from it. The interesting value is
       * on the CITATION, written by whatever actually read it: "used your entry-signal rule".
       *
       * That sentence is the whole point of a citation — it is what makes the claim checkable by
       * the creator, and therefore challengeable. Reading the wrong column made the model's most
       * useful output invisible.
       */
      sources: all('SELECT * FROM source WHERE note_id = ? ORDER BY created_at', n.id)
        .map((src) => ({
          ...src,
          used_for: one('SELECT used_for FROM citation WHERE source_id = ?', src.id)?.used_for
                    || src.used_for,
        })),
    }));
  return { project: { id: p.id, name: p.name }, notes };
});

route('POST', '/api/projects/rename', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const name = String(ctx.body.name ?? '').trim().slice(0, 80);
  if (!name) return err(400, 'a name is required');
  run('UPDATE project SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      name, now(), String(ctx.body.id ?? ''), user.id);
  return { ok: true, name };
});

/**
 * Move a note to another project.
 *
 * The reason the whole structure is shallow: a line of research reveals what it was only after you
 * have been at it a while, so re-filing has to be one action rather than a migration.
 */
/**
 * Ask for a note to be analysed.
 *
 * The PERSON asks; the model reads; the citations are written by the runner. That keeps the
 * division from `who-may.test.mjs` intact — a person never cites, they only ask, and what gets
 * cited is decided by whatever actually did the reading.
 *
 * Awaited rather than queued. A note has a handful of sources and this is one model call, so a
 * queue would add a job table, a worker and a retry story to solve a problem that does not exist
 * yet. It becomes wrong the moment a note has fifty sources; that is when to add one.
 */
route('POST', '/api/notes/analyse', async (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');

  const r = await analyseNote(String(ctx.body.note ?? ''), user.id);
  if (!r.ok) {
    // NO_MODEL is a configuration fact, not a failure of this note — say so plainly rather than
    // leaving someone to wonder what they did wrong.
    return err(r.code === 'NO_MODEL' ? 503 : 409, r.reason, undefined, r.code);
  }
  publish(user.id, 'project', { note: String(ctx.body.note) });
  return r;
});

route('POST', '/api/notes/move', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const noteId = String(ctx.body.note ?? '');
  const to = String(ctx.body.project ?? '');
  if (!one('SELECT id FROM project WHERE id = ? AND user_id = ?', to, user.id)) {
    return err(404, 'no such project');
  }
  run('UPDATE note SET project_id = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      to, now(), noteId, user.id);
  run('UPDATE project SET updated_at = ? WHERE id = ?', now(), to);
  return { ok: true };
});

/**
 * What the DESKTOP agent reads.
 *
 * The point of filing something is being able to work on it elsewhere. An agent token already
 * identifies a principal, so Claude Code or any other client can read the projects it was told to
 * work on — and nothing else.
 */
route('GET', '/api/agent/projects', (ctx) => {
  const agent = ctx.agent;
  if (!agent) return err(401, 'agent token required');
  const projects = all('SELECT * FROM project WHERE user_id = ? ORDER BY updated_at DESC', agent.user_id);
  return {
    projects: projects.map((p) => ({
      id: p.id, name: p.name,
      notes: all('SELECT id, title, body, status FROM note WHERE project_id = ?', p.id).map((n) => ({
        ...n,
        sources: all('SELECT title, excerpt, used_for, url FROM source WHERE note_id = ?', n.id),
      })),
    })),
  };
});

/**
 * ── Works — what a person publishes on their own profile ─────────────────────────────────
 * Four kinds, which are the four tabs: photo (single or carousel), video, thread, doc.
 */

/**
 * A signed, expiring URL for one file.
 *
 * Media cannot be fetched with an Authorization header: an <img src>, a <video src> and a download
 * link are ordinary browser requests, and the browser attaches no bearer token to any of them. The
 * first version required a session and every image on the profile silently 404'd while a PDF
 * helpfully rendered {"error":"auth required"} as its own contents.
 *
 * So the URL carries its own proof. The signature covers THE MEDIA ID AND THE EXPIRY, so a link
 * grants exactly one file for a bounded time and cannot be edited into a link for another. It
 * confers no other authority — it is not a session, and losing one loses nothing else.
 */
/*
 * Short, because a signed URL is the one thing that leaves the app. Twenty-four hours was a
 * caching decision; ten minutes is a viewing decision. A URL copied out of the network tab stops
 * working before it is useful to anyone, which is the difference between casual copying and
 * deliberate effort.
 */
const MEDIA_TTL_MS = 10 * 60 * 1000;

function signMedia(id, exp) {
  return createHmac('sha256', process.env.OAUTH_STATE_SECRET ?? 'dev-only-secret')
    .update(`${id}.${exp}`).digest('hex').slice(0, 32);
}

function mediaUrl(id) {
  const exp = Date.now() + MEDIA_TTL_MS;
  return `/api/media/${id}?e=${exp}&s=${signMedia(id, exp)}`;
}

/** Media rows shaped for a client, with a URL rather than a disk path. */
const mediaFor = (workId) =>
  all('SELECT id, mime, kind, bytes, filename, ordinal FROM media WHERE work_id = ? ORDER BY ordinal', workId)
    .map((m) => ({ ...m, url: mediaUrl(m.id) }));

route('POST', '/api/works', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const kind = String(ctx.body.kind ?? '');
  if (!['photo', 'video', 'thread', 'doc'].includes(kind)) return err(400, 'unknown kind');

  const title = String(ctx.body.title ?? '').slice(0, 200);
  const body = String(ctx.body.body ?? '').slice(0, 10_000);
  if (kind === 'thread' && !body.trim()) return err(400, 'a thread needs something to say');

  const id = `wrk_${randomUUID().slice(0, 8)}`;
  run(`INSERT INTO work (id, user_id, kind, title, body, shareable, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id, user.id, kind, title, body,
      // Default yes, because publishing to a profile in a place built on citation implies it.
      // Per item, because a tutorial and a family photograph are not the same offer.
      ctx.body.shareable === false ? 0 : 1, now());
  return { work: { id, kind, title, body } };
});

/**
 * Upload one file to a work.
 *
 * RAW BODY, not multipart. Multipart needs a parser, and a parser is a dependency plus a class of
 * bug, to solve a problem the browser does not actually have: `fetch(url, { body: file })` sends
 * the bytes and the type, which is everything needed. The filename rides in a header because it is
 * metadata, not content.
 */
route('POST', '/api/works/:id/media', async (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const work = one('SELECT * FROM work WHERE id = ? AND user_id = ?', ctx.params.id, user.id);
  if (!work) return err(404, 'no such work');

  const mime = String(ctx.headers['content-type'] ?? '').split(';')[0].trim();
  const spec = store.allowed(mime);
  if (!spec) return err(415, `${mime || 'that file type'} is not accepted here`);

  const used = one('SELECT COALESCE(SUM(bytes),0) b FROM media WHERE user_id = ?', user.id)?.b ?? 0;
  if (used >= store.QUOTA_BYTES) {
    return err(413, 'You have used your storage allowance. Remove something first.');
  }

  const buf = ctx.raw;
  if (!buf?.length) return err(400, 'no file received');

  let put;
  try { put = store.put(buf, mime); } catch (e) { return err(413, e.message); }

  const ordinal = one('SELECT COUNT(*) c FROM media WHERE work_id = ?', work.id)?.c ?? 0;
  run(`INSERT INTO media (id, work_id, user_id, mime, kind, bytes, path, filename, ordinal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      put.id, work.id, user.id, mime, put.kind, put.bytes, put.path,
      String(ctx.headers['x-filename'] ?? '').slice(0, 160), ordinal, now());

  return { media: { id: put.id, url: mediaUrl(put.id), bytes: put.bytes, kind: put.kind } };
});

/** Somebody's profile content, by kind. Public within the platform — it is a profile. */
/**
 * Serve an uploaded file.
 *
 * `nosniff` is not optional here. Without it a browser may look at the bytes, decide a file is
 * HTML whatever we called it, and run it — on our own origin, with our own cookies. The upload
 * allowlist already excludes SVG and HTML for the same reason; this is the second lock.
 *
 * Images and video are shown inline; anything else downloads, because "display this document" is
 * how a viewer gets talked into rendering something it should not.
 */
route('GET', '/api/media/:id', (ctx) => {
  // Signature or session — either is proof. The signature exists because a browser cannot send a
  // header for an <img>; the session path is kept so an API client with a token still works.
  const exp = Number(ctx.query.get('e') ?? 0);
  const sig = String(ctx.query.get('s') ?? '');
  const signed = exp > Date.now() && sig.length === 32
    && timingSafeEqual(Buffer.from(sig), Buffer.from(signMedia(ctx.params.id, exp)));
  if (!signed && !ctx.user && !ctx.agent) return err(401, 'auth required');

  const m = one('SELECT * FROM media WHERE id = ?', ctx.params.id);
  if (!m) return err(404, 'not found');
  const bytes = store.get(m.path);
  if (!bytes) return err(404, 'not found');

  return {
    __file: true,
    bytes,
    headers: {
      'content-type': m.mime,
      'content-length': String(bytes.length),
      'x-content-type-options': 'nosniff',
      /*
       * ALWAYS inline, never attachment — including documents. `attachment` tells the browser to
       * save the file, which is precisely the behaviour being removed: content is viewed in the
       * platform, not collected from it.
       *
       * This is a product decision, not a security control. Bytes a browser renders are on that
       * device, and no header changes that. What it removes is the AFFORDANCE — nothing offers to
       * save it, nothing lands in Downloads, and a copied URL expires in ten minutes.
       */
      'content-disposition': 'inline',
      // no-store, so a viewed file is not left sitting in the browser cache after the link dies.
      'cache-control': 'private, no-store',
    },
  };
});

route('GET', '/api/works', (ctx) => {
  if (!ctx.user && !ctx.agent) return err(401, 'auth required');
  const userId = String(ctx.query.get('user') ?? ctx.user?.id ?? '');
  const kind = ctx.query.get('kind');
  const rows = kind
    ? all('SELECT * FROM work WHERE user_id = ? AND kind = ? ORDER BY created_at DESC', userId, kind)
    : all('SELECT * FROM work WHERE user_id = ? ORDER BY created_at DESC', userId);
  return {
    works: rows.map((w) => ({
      id: w.id, kind: w.kind, title: w.title, body: w.body,
      shareable: Boolean(w.shareable), at: w.created_at, media: mediaFor(w.id),
    })),
  };
});

route('POST', '/api/works/delete', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const id = String(ctx.body.id ?? '');
  const work = one('SELECT * FROM work WHERE id = ? AND user_id = ?', id, user.id);
  if (!work) return err(404, 'no such work');
  // Bytes go too. The spec's erasure constraint is why media never reaches an immutable store:
  // a deletion that leaves the file behind is not a deletion.
  for (const m of all('SELECT path FROM media WHERE work_id = ?', id)) store.remove(m.path);
  run('DELETE FROM media WHERE work_id = ?', id);
  run('DELETE FROM work WHERE id = ?', id);
  return { ok: true };
});

route('GET', '/api/workspace', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);

  // A drafted ORDER is a draft, and it lives in the order table where the state machine can see
  // it. Merging the two lists here rather than copying orders into `draft` keeps one definition of
  // what a draft order is.
  const draftOrders = agent
    ? all(`SELECT * FROM "order" WHERE (buyer_agent_id = ? OR seller_agent_id = ?)
             AND status = 'drafted' ORDER BY updated_at DESC`, agent.id, agent.id)
        .map((o) => publicOrder(o, agent.id))
    : [];

  const drafts = all(
    'SELECT id, kind, title, body, updated_at FROM draft WHERE user_id = ? ORDER BY updated_at DESC',
    user.id).map((d) => ({ ...d, body: JSON.parse(d.body || '{}') }));

  /*
   * "3 new" is DERIVED, by counting matching posts since you last looked — not stored per user.
   * A stored counter has to be updated by every writer and drifts the first time one forgets;
   * a count you compute cannot be wrong.
   */
  /*
   * "3 new" is DERIVED, by counting matching posts since you last looked — not stored per user.
   * A stored counter must be updated by every writer and drifts the first time one forgets; a
   * count you compute cannot be wrong.
   *
   * Written as two plain statements rather than one assembled string. The first version built the
   * SQL with a .replace() and a conditional parameter list, which is how a query ends up not
   * meaning what it looks like it means.
   */
  const watching = all('SELECT * FROM watch WHERE user_id = ? ORDER BY created_at DESC', user.id)
    .map((w) => {
      const row = w.commodity
        ? one(`SELECT COUNT(*) c FROM post
               WHERE created_at > ? AND lower(title || ' ' || body) LIKE ?`,
              w.last_seen_at, `%${w.commodity.toLowerCase()}%`)
        : one('SELECT COUNT(*) c FROM post WHERE created_at > ?', w.last_seen_at);
      return {
        id: w.id, label: w.label, commodity: w.commodity, lane: w.lane,
        minTier: w.min_tier, fresh: row?.c ?? 0,
      };
    });

  // Unprompted agent messages — the "your agent noticed something" lane. Limited, because a
  // workspace is for what you are working on, not a log.
  const notes = agent
    ? all(`SELECT id, body, created_at FROM message
           WHERE user_id = ? AND from_role = 'agent' ORDER BY created_at DESC LIMIT 5`, user.id)
    : [];

  return { draftOrders, drafts, watching, notes };
});

route('POST', '/api/drafts', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const kind = String(ctx.body.kind ?? 'note');
  if (!['post', 'request', 'note'].includes(kind)) return err(400, 'unknown draft kind');

  const id = String(ctx.body.id ?? '') || `drf_${randomUUID().slice(0, 8)}`;
  const title = String(ctx.body.title ?? '').slice(0, 200);
  const body = JSON.stringify(ctx.body.body ?? {});
  const existing = one('SELECT id FROM draft WHERE id = ? AND user_id = ?', id, user.id);

  if (existing) {
    run('UPDATE draft SET kind = ?, title = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        kind, title, body, now(), id, user.id);
  } else {
    run(`INSERT INTO draft (id, user_id, kind, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, id, user.id, kind, title, body, now(), now());
  }
  return { id, kind, title, body: JSON.parse(body) };
});

route('POST', '/api/drafts/delete', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  run('DELETE FROM draft WHERE id = ? AND user_id = ?', String(ctx.body.id ?? ''), user.id);
  return { ok: true };
});

route('POST', '/api/watch', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const commodity = String(ctx.body.commodity ?? '').trim();
  if (!commodity) return err(400, 'a commodity to watch is required');
  const id = `wch_${randomUUID().slice(0, 8)}`;
  run(`INSERT INTO watch (id, user_id, label, commodity, lane, min_tier, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, user.id, commodity, commodity,
      ctx.body.lane ? String(ctx.body.lane) : null,
      String(ctx.body.minTier ?? 'T0'), now(), now());
  return { id };
});

/** Mark a watch as read. Separate from reading the workspace, so opening the page does not
 *  silently clear a count you had not looked at. */
route('POST', '/api/watch/seen', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  run('UPDATE watch SET last_seen_at = ? WHERE id = ? AND user_id = ?',
      now(), String(ctx.body.id ?? ''), user.id);
  return { ok: true };
});

route('POST', '/api/watch/delete', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  run('DELETE FROM watch WHERE id = ? AND user_id = ?', String(ctx.body.id ?? ''), user.id);
  return { ok: true };
});

route('GET', '/api/orders', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);
  if (!agent) return { orders: [] };
  return { orders: ordersFor(agent.id).map((o) => publicOrder(o, agent.id)) };
});

route('GET', '/api/orders/:id', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  const agent = one('SELECT * FROM agent WHERE user_id = ?', user.id);
  const order = orderRow(ctx.params.id);
  if (!order || !agent || !roleOf(order, agent.id)) return err(404, 'no such order');
  return { order: publicOrder(order, agent.id) };
});

/**
 * The principal's own receipt chain, and whether it still verifies.
 *
 * Verification is returned alongside the receipts rather than hidden behind a separate call: a
 * chain nobody checks is a table with an extra column, and the cheapest way to make sure it is
 * checked is to check it every time anyone looks.
 */
route('GET', '/api/receipts', (ctx) => {
  const user = ctx.user;
  if (!user) return err(401, 'sign in required');
  return { receipts: chainFor(user.id), verification: verifyChain(user.id) };
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

/**
 * Shape rules, kept separate from availability so the client can explain which one failed.
 * Delegates to the shared definition the browser imports too — one rule, two callers.
 */
const agentNameProblem = (name) => handleError(String(name ?? '').trim());

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
    return { available: false, reason: 'That name is not available.' };
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
    analysisConfigured: analysisAvailable(),
    // Egress here UNDER-counts the stream: measure() tallies a response when it ends, and an SSE
    // response ends only on disconnect. Heartbeats and events are not counted. Given the point of
    // the stream is to send far less than polling did, an undercount of a small number is
    // acceptable — but it is a known gap, not an oversight.
    streams: streamStats(),
    daily: daily(60),
  };
});

/**
 * Create a mandate for an agent. Shared by /api/deploy (when terms are supplied) and
 * /api/mandate (the normal path). One definition, because two would drift on defaults — and a
 * default that differs between paths is a mandate the principal did not choose.
 */
function createMandate(agentId, body) {
  const commodity = String(body.commodity ?? '').trim();
  const floor = Number(body.floor);
  if (!commodity || Number.isNaN(floor)) return null;

  const id = `mnd_${randomUUID().slice(0, 8)}`;
  run(
    `INSERT INTO mandate (
       id, agent_id, commodity, scope, price_floor, price_ceiling, currency,
       max_quantity, consumed, delivery_window, counterparty_min_tier,
       expires_at, spec_template_id, status, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    id, agentId, commodity, String(body.scope ?? 'negotiate'), floor,
    body.ceiling != null && body.ceiling !== '' ? Number(body.ceiling) : null,
    String(body.currency ?? 'AED'),
    JSON.stringify({ value: Number(body.maxQuantity ?? 40), unit: String(body.quantityUnit ?? 't') }),
    JSON.stringify({ quantity: 0 }),
    JSON.stringify(body.deliveryWindow ?? {
      from: new Date().toISOString().slice(0, 10),
      to: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
    }),
    String(body.counterpartyMinTier ?? 'T2'),
    body.expiresAt ? String(body.expiresAt)
                   : new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    String(body.specTemplateId ?? `${commodity}-v1`),
    now(),
  );
  return one('SELECT * FROM mandate WHERE id = ?', id);
}

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
  // No mandate at sign-up. Commodity and floor are per-deal decisions and asking for them during
  // onboarding produced a mandate nobody meant. An agent with no mandate can do nothing — the
  // guard answers NO_MANDATE to every intent — which is the correct default. Set one at
  // /app/mandate when there is something to do.
  if (!name || !purpose) {
    return err(400, 'agentName and purpose are required');
  }
  const wantsMandate = Boolean(commodity) && !Number.isNaN(floor);
  const nameProblem = agentNameProblem(name);
  if (nameProblem) return err(400, nameProblem);
  // Courtesy check — the unique index is what actually enforces this. See the catch below.
  if (agentNameTaken(name)) {
    return err(409, 'That agent name is not available.');
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
      return err(409, 'That agent name is not available.');
    }
    throw e;
  }

  // Only when terms were supplied. Sign-up no longer asks for them.
  const mandate = wantsMandate ? createMandate(agentId, ctx.body) : null;

  run(
    `INSERT INTO message (id, user_id, agent_id, from_role, body, meta, created_at)
     VALUES (?, ?, ?, 'system', ?, ?, ?)`,
    `msg_${randomUUID().slice(0, 8)}`, user.id, agentId,
    mandate
      ? `${name} is live. Mandate: ${commodity}, floor ${floor} ${mandate.currency}, scope ${mandate.scope}.`
      : `${name} is live. It cannot act until you set what it may do.`,
    JSON.stringify({ kind: 'deployed' }),
    now(),
  );

  const agent = one('SELECT * FROM agent WHERE id = ?', agentId);
  return {
    agent: publicAgent(agent, true),
    mandate: mandate ? publicMandate(mandate) : null,
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
      // Three different claims, kept apart. Read → shared → cited is a ladder of increasing
      // commitment, and collapsing it into one number would throw away the only interesting part.
      cited: citedCount(p.id),
      views: viewCounts(p.id),
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
  // The feed is shared, so every listener is told. With one machine this is every open tab; when
  // there are two machines it will be every tab on THIS one, which is why events.mjs says the
  // registry must move to a shared bus before that happens.
  publishAll(all('SELECT id FROM user').map((u) => u.id), 'post', {});

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
  publish(ctx.user?.id ?? ctx.agent?.user_id, 'message', {});

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
    // Stored since the profession field was added and never returned, so nothing could show it.
    // It is the demand signal PRODUCT-SHAPE.md wanted — of no use sitting in a column unread.
    profession: u.profession ?? null,
    // Whether a password exists — never the hash. The UI needs this to say "set" vs "change",
    // and to warn an OAuth-only account that it currently has no way back in without Google.
    hasPassword: Boolean(u.password_hash),
    signInMethod: u.password_hash ? 'password' : (u.oauth_provider || 'oauth'),
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

function err(status, message, headers, code) {
  return { __error: true, status, message, headers, code };
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

  /*
   * GET /api/events — the live stream.
   *
   * Handled here rather than through route(), because every other handler RETURNS a value and the
   * server writes it. This one takes the response over and keeps it open, which the route loop has
   * no way to express.
   *
   * Authenticated by the Authorization header like everything else. Note this rules out the
   * browser's EventSource, which cannot set headers — the client reads the stream with fetch
   * instead. The alternative, a session token in the query string, would put a live credential
   * into every access log and proxy trace, which is a poor trade for a smaller client.
   */
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const user = userFromSession(req.headers.authorization);
    if (!user) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'sign in required' }));
      return;
    }
    subscribe(user.id, req, res);
    return;
  }

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

    /*
     * JSON for everything except a file, which arrives as raw bytes with its own content-type.
     * Reading it as a Buffer rather than parsing multipart avoids a parser dependency and a class
     * of bug, to solve a problem the browser does not have: fetch(url, { body: file }) already
     * sends the bytes and the type.
     */
    let body = {};
    let raw = null;
    if (req.method === 'POST') {
      const ct = String(req.headers['content-type'] ?? '');
      if (ct.startsWith('application/json') || ct === '') {
        body = await readJson(req);
      } else {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          // A hard ceiling above the largest per-file limit, so a hostile upload cannot exhaust
          // memory before the per-type check ever runs.
          if (size > 50_000_000) return void res.writeHead(413).end();
          chunks.push(c);
        }
        raw = Buffer.concat(chunks);
      }
    }
    const ctx = {
      params, query: url.searchParams, body, raw,
      ip: clientIp(req),
      headers: req.headers,
      user: userFromSession(req.headers.authorization),
      agent: agentFromToken(req.headers.authorization),
    };
    try {
      const out = await r.handler(ctx);
      if (out?.__error) {
        res.writeHead(out.status, { 'content-type': 'application/json', ...(out.headers ?? {}) });
        res.end(JSON.stringify({ error: out.message, ...(out.code ? { code: out.code } : {}) }));
        return;
      }
      if (out?.__file) {
        res.writeHead(200, out.headers);
        res.end(out.bytes);
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
