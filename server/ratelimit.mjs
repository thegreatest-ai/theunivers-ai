/**
 * Rate limiting for the endpoints that guess, enumerate, or cost money.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────────────────
 *
 * `/api/auth/login` is not behind the invite gate — by design, since existing users must be able
 * to sign in — and had no throttle. That is unlimited password guessing at machine speed against
 * any address an attacker knows. The invite gate was doing this job by accident, purely by keeping
 * the user table to a handful of people, so the absence never showed. Opening registration without
 * this in place turns login into a front door with no limit on how many keys you may try.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * Fixed-window counters held in memory. In memory is honest for a single machine, which is what
 * this is; the moment there are two, this must move to the database or a shared store, because
 * per-process limits multiply by the number of processes. That is written here rather than
 * discovered later.
 *
 * A fixed window allows a burst across a boundary — up to 2x the limit spanning two windows. For
 * password guessing that is irrelevant: the attacker's rate is still bounded by a constant, and
 * the simplicity is worth more than the precision of a sliding log.
 */

/** bucket -> Map<key, {count, resetAt}> */
const buckets = new Map();

/**
 * Consume one unit. Returns {ok} or {ok:false, retryAfter} in whole seconds.
 * Counting happens on every call including rejected ones, so hammering a limit keeps it hot
 * rather than letting an attacker retry the instant a window opens.
 */
export function take(bucket, key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(bucket);
  if (!b) { b = new Map(); buckets.set(bucket, b); }

  const hit = b.get(key);
  if (!hit || hit.resetAt <= now) {
    b.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  hit.count += 1;
  if (hit.count > max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((hit.resetAt - now) / 1000)) };
  }
  return { ok: true };
}

/** Undo one unit. Used after a SUCCESSFUL login so honest users are not punished for typos. */
export function refund(bucket, key) {
  const hit = buckets.get(bucket)?.get(key);
  if (hit && hit.count > 0) hit.count -= 1;
}

/**
 * The caller's address.
 *
 * `Fly-Client-IP` is set by Fly's proxy and cannot be spoofed by the client — the proxy overwrites
 * whatever arrived. `X-Forwarded-For` is deliberately NOT trusted: anyone can send it, and treating
 * it as identity would let an attacker mint a fresh limit per request simply by varying a header,
 * which is worse than having no limit at all because it looks protected.
 */
export function clientIp(req) {
  return req.headers['fly-client-ip']
    ?? req.socket?.remoteAddress
    ?? 'unknown';
}

/** Sweep expired entries so a long-running process does not accumulate keys forever. */
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [name, b] of buckets) {
    for (const [k, v] of b) if (v.resetAt <= now) b.delete(k);
    if (b.size === 0) buckets.delete(name);
  }
}, 60_000);
sweep.unref?.();

/**
 * Limits, in one place so they can be read as a policy rather than hunted through routes.
 *
 * Login is limited on TWO keys at once. Per-IP alone misses a distributed attack on one account;
 * per-account alone misses one host working through many accounts. Both must pass.
 */
export const LIMITS = {
  loginPerIp:      { max: 30, windowMs: 15 * 60_000 },
  loginPerAccount: { max: 6,  windowMs: 15 * 60_000 },
  registerPerIp:   { max: 5,  windowMs: 60 * 60_000 },
  forgotPerIp:     { max: 10, windowMs: 60 * 60_000 },
  forgotPerEmail:  { max: 3,  windowMs: 60 * 60_000 },
  resetPerIp:      { max: 10, windowMs: 60 * 60_000 },
};
