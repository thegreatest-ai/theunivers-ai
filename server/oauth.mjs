/**
 * Google + GitHub OAuth for the private pilot.
 * Invite code travels in `state` so the gate still applies on first signup.
 */
import { randomBytes, createHmac } from 'node:crypto';
import { one, run } from './db.mjs';
import { requireInvite, consumeInvite, createSession, now } from './auth.mjs';
import { randomUUID } from 'node:crypto';

const STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.INVITE_CODE || 'univers-pilot-state';

export function oauthConfigured() {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),

  };
}

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readState(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
  if (expect !== sig) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function apiBase() {
  return process.env.BASE_URL || `http://localhost:${process.env.PORT || 8790}`;
}

function frontendBase() {
  return process.env.FRONTEND_URL || apiBase();
}

export function googleAuthUrl(inviteCode) {
  const cfg = oauthConfigured();
  if (!cfg.google) throw new Error('Google OAuth not configured');

  // The invite is NOT validated here. At this point the provider has not told us who this is,
  // so we cannot know whether an invite is even required — a returning user does not need one.
  // It is carried in the signed state and checked at the callback, once we know. Requiring it
  // here locked existing users out of their own accounts the moment the invite was used up.

  const state = signState({
    provider: 'google',
    invite: inviteCode,
    nonce: randomBytes(8).toString('hex'),
    exp: Date.now() + 10 * 60 * 1000,
  });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${apiBase()}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function githubAuthUrl(inviteCode) {
  const cfg = oauthConfigured();
  if (!cfg.github) throw new Error('GitHub OAuth not configured');

  // Same as Google: the invite is carried in signed state and checked at the callback, once we
  // know whether this is a new account. See googleAuthUrl above.

  const state = signState({
    provider: 'github',
    invite: inviteCode,
    nonce: randomBytes(8).toString('hex'),
    exp: Date.now() + 10 * 60 * 1000,
  });
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri: `${apiBase()}/api/auth/github/callback`,
    scope: 'read:user user:email',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

/**
 * @param inviteCode  required only when this creates a NEW account. Returning users sign in
 *                    without one — the invite gates joining, not logging in.
 */
async function upsertOAuthUser({ provider, oauthId, email, name, inviteCode }) {
  if (!email) throw new Error('OAuth account has no email — grant email permission');

  let user = one(
    'SELECT * FROM user WHERE oauth_provider = ? AND oauth_id = ?',
    provider, oauthId,
  );
  if (!user) {
    user = one('SELECT * FROM user WHERE email = ?', email.toLowerCase());
  }

  if (user) {
    run(
      `UPDATE user SET name = ?, oauth_provider = ?, oauth_id = ? WHERE id = ?`,
      name || user.name, provider, oauthId, user.id,
    );
    return { user: one('SELECT * FROM user WHERE id = ?', user.id), created: false };
  }

  // NEW account: this is the first point at which we know an invite is actually required, so
  // it is validated here rather than before the redirect. Consumption stays in the callers,
  // which already do `if (created) consumeInvite(...)`.
  const inv = requireInvite(inviteCode);
  if (!inv.ok) throw new Error(`${inv.error} — an invite is needed to create an account.`);

  const id = `usr_${randomUUID().slice(0, 8)}`;
  run(
    `INSERT INTO user (id, email, name, kind, jurisdiction, oauth_provider, oauth_id, created_at)
     VALUES (?, ?, ?, 'individual', 'IN', ?, ?, ?)`,
    id, email.toLowerCase(), name || email.split('@')[0], provider, oauthId, now(),
  );
  return { user: one('SELECT * FROM user WHERE id = ?', id), created: true };
}

export async function finishGoogle(code, stateRaw) {
  const state = readState(stateRaw);
  if (!state || state.provider !== 'google') throw new Error('invalid OAuth state');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${apiBase()}/api/auth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokens.error_description || tokens.error || 'Google token exchange failed');

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json();
  if (!profileRes.ok) throw new Error('Google profile fetch failed');

  const { user, created } = await upsertOAuthUser({
    provider: 'google',
    oauthId: String(profile.sub),
    email: profile.email,
    name: profile.name,
    inviteCode: state.invite,
  });
  if (created) consumeInvite(state.invite);

  const sessionToken = createSession(user.id);
  const agent = one('SELECT id FROM agent WHERE user_id = ?', user.id);
  return {
    sessionToken,
    next: agent ? `${frontendBase()}/app` : `${frontendBase()}/app/deploy`,
  };
}

export async function finishGithub(code, stateRaw) {
  const state = readState(stateRaw);
  if (!state || state.provider !== 'github') throw new Error('invalid OAuth state');

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${apiBase()}/api/auth/github/callback`,
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokens.access_token) throw new Error(tokens.error_description || tokens.error || 'GitHub token exchange failed');

  const profileRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'theunivers-bridge-pilot',
    },
  });
  const profile = await profileRes.json();
  if (!profileRes.ok) throw new Error('GitHub profile fetch failed');

  let email = profile.email;
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'theunivers-bridge-pilot',
      },
    });
    const emails = await emailsRes.json();
    const primary = Array.isArray(emails)
      ? emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified)
      : null;
    email = primary?.email;
  }

  const { user, created } = await upsertOAuthUser({
    provider: 'github',
    oauthId: String(profile.id),
    email,
    name: profile.name || profile.login,
    inviteCode: state.invite,
  });
  if (created) consumeInvite(state.invite);

  const sessionToken = createSession(user.id);
  const agent = one('SELECT id FROM agent WHERE user_id = ?', user.id);
  return {
    sessionToken,
    next: agent ? `${frontendBase()}/app` : `${frontendBase()}/app/deploy`,
  };
}

export function oauthCallbackRedirect(sessionToken, next) {
  const url = new URL(`${frontendBase()}/app/oauth`);
  url.searchParams.set('session', sessionToken);
  url.searchParams.set('next', next.replace(frontendBase(), '') || '/app');
  return url.toString();
}
