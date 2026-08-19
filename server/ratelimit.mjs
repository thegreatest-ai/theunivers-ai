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
 * Fixed-window counters held IN THE DATABASE, keyed by (bucket, key).
 *
 * They used to be held in a Map in this module, and moving them is worth its own paragraph because
 * the reason is not the obvious one.
 *
 *   What it fixes today: a process restart no longer wipes every counter. That mattered more than
 *   it sounds. `fly deploy` restarts the machine, so every deploy handed an attacker a fresh set of
 *   attempts against every account — and a pilot deploys often. A brute-force defence that resets
 *   whenever we ship is a defence with a published schedule.
 *
 *   What it does NOT fix, and must not be claimed to: this does not make limits shared between
 *   machines. A Fly volume attaches to exactly one machine, so two machines are two volumes and
 *   two SQLite files, and per-machine limits would still multiply. The gain is that the state now
 *   lives in the one place that has to become shared anyway. When the database moves — to Postgres,
 *   or to LiteFS — the limiter comes along for free instead of being a second thing to rewrite at
 *   the moment there is least appetite for it.
 *
 * A fixed window allows a burst across a boundary — up to 2x the limit spanning two windows. For
 * password guessing that is irrelevant: the attacker's rate is still bounded by a constant, and
 * the simplicity is worth more than the precision of a sliding log.
 */
import { db } from './db.mjs';

/*
 * reset_at is epoch milliseconds rather than an ISO string, unlike every domain table here. Those
 * are read by people; this one is only ever compared against Date.now(), and an integer comparison
 * is what the CASE below needs to stay a single statement.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS rate_limit (
    bucket   TEXT NOT NULL,
    key      TEXT NOT NULL,
    count    INTEGER NOT NULL,
    max      INTEGER NOT NULL,
    reset_at INTEGER NOT NULL,
    PRIMARY KEY (bucket, key)
  )`);

/*
 * ONE statement, because check-then-write is not atomic and this is the one place that matters.
 * Two concurrent login attempts could both read count = 5, both decide they were under the limit
 * of 6, and both write 6 — turning the last attempt of a window into two. An upsert that computes
 * the new value inside the statement cannot interleave that way.
 *
 * The CASE arms are the window roll: if the stored window has already expired this is the first
 * hit of a new one, so the count restarts at 1 and the window moves. Otherwise both are carried.
 *
 * `max` is written on every take rather than kept only in LIMITS, so limitStats() below can say
 * which callers are actually over their limit without holding a second copy of the mapping from
 * bucket name to limit. Route names and LIMITS keys already differ ('login-acct' against
 * loginPerAccount); a lookup table joining them would be a third place to forget to update.
 *
 * Prepared once at load rather than per call. These run on the authentication path, which is the
 * one place a wasted compile is paid for by somebody waiting to sign in.
 */
const TAKE = db.prepare(`
  INSERT INTO rate_limit (bucket, key, count, max, reset_at) VALUES (?, ?, 1, ?, ?)
  ON CONFLICT(bucket, key) DO UPDATE SET
    count    = CASE WHEN rate_limit.reset_at <= ? THEN 1 ELSE rate_limit.count + 1 END,
    max      = excluded.max,
    reset_at = CASE WHEN rate_limit.reset_at <= ? THEN ? ELSE rate_limit.reset_at END
  RETURNING count, reset_at`);

const REFUND = db.prepare(
  'UPDATE rate_limit SET count = count - 1 WHERE bucket = ? AND key = ? AND count > 0');

const RESET = db.prepare('DELETE FROM rate_limit WHERE bucket = ? AND key = ?');

const SWEEP = db.prepare('DELETE FROM rate_limit WHERE reset_at <= ?');

/**
 * Consume one unit. Returns {ok} or {ok:false, retryAfter} in whole seconds.
 * Counting happens on every call including rejected ones, so hammering a limit keeps it hot
 * rather than letting an attacker retry the instant a window opens.
 */
export function take(bucket, key, max, windowMs) {
  const now = Date.now();
  const until = now + windowMs;
  let row;
  try {
    row = TAKE.get(bucket, String(key), max, until, now, now, until);
  } catch (e) {
    /*
     * Fail OPEN, and deliberately.
     *
     * The alternative turns a moment of database contention into a total sign-in outage. This is
     * only safe because the failure is not cheap to induce: under WAL a write waits out
     * busy_timeout (5s) before throwing, and at a measured 0.020ms per insert an attacker would
     * need on the order of 245,000 queued writes to hold the lock that long — which is a denial of
     * service in its own right, and one that takes the login query down with it either way.
     * Counters already written still stand, so a targeted attack does not get a clean slate.
     */
    console.warn(`[ratelimit] ${bucket} not counted: ${e.message}`);
    return { ok: true };
  }
  if (row.count > max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((row.reset_at - now) / 1000)) };
  }
  return { ok: true };
}

/** Undo one unit. Used after a SUCCESSFUL login so honest users are not punished for typos. */
export function refund(bucket, key) {
  // `count > 0` keeps the counter from going negative and handing out free attempts, which a
  // refund on an already-swept row would otherwise do.
  REFUND.run(bucket, String(key));
}

/**
 * Drop one caller's counters. This is the operator's unlock, and it exists because moving the
 * counters into the database took the old remedy away: `fly apps restart` used to clear them by
 * losing them, which was never a deliberate feature so much as the absence of one.
 */
export function reset(bucket, key) {
  return RESET.run(bucket, String(key)).changes;
}

/**
 * For /api/metrics: what the limiter is currently holding.
 *
 * `blocked` is normally zero and is not zero during an attack or a lockout, which is what makes it
 * worth looking at rather than merely worth having. Before this, the only way to know whether a
 * limit had fired was that somebody complained.
 */
export function limitStats() {
  const now = Date.now();
  const rows = db.prepare(
    `SELECT bucket, COUNT(*) tracked, SUM(count > max) blocked
     FROM rate_limit WHERE reset_at > ? GROUP BY bucket`).all(now);
  return {
    tracked: rows.reduce((n, r) => n + r.tracked, 0),
    blocked: rows.reduce((n, r) => n + (r.blocked ?? 0), 0),
    byBucket: Object.fromEntries(rows.map((r) => [r.bucket, { tracked: r.tracked, blocked: r.blocked ?? 0 }])),
  };
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

/**
 * Sweep expired windows so the table does not grow forever.
 *
 * An expired row is already harmless — every read compares reset_at against now — so this is
 * housekeeping rather than correctness, and it is why the sweep may be a plain DELETE on a timer
 * instead of anything transactional.
 */
const sweep = setInterval(() => {
  try {
    SWEEP.run(Date.now());
  } catch (e) {
    console.warn(`[ratelimit] sweep failed: ${e.message}`);
  }
}, 60_000);
sweep.unref?.();                                  // never hold the process open for housekeeping

/**
 * Limits, in one place so they read as a policy rather than being hunted through routes.
 * Login is checked on TWO keys and both must pass.
 *
 * THE PRINCIPLE THESE NUMBERS FOLLOW
 *
 *   per-ACCOUNT limits protect accounts.  per-IP limits protect infrastructure.
 *
 * Only the per-account limit stops a targeted attack, because an attacker can rotate addresses.
 * The per-IP limit exists to stop one host flooding us — not to stop a person signing up. So the
 * per-account numbers stay tight and the per-IP numbers are generous, because an IP is a terrible
 * proxy for a person:
 *
 *   - mobile carriers in the UAE and India run carrier-grade NAT, so THOUSANDS of real users can
 *     share one address. registerPerIp was 5/hour, which would have blocked a whole carrier's
 *     users after five signups on launch day.
 *   - offices, cafés, universities and VPNs all present one address for many people.
 *
 * Found the hard way: six test signups from one machine locked that machine out for 50 minutes.
 * That was the limit doing exactly what it was told, and what it was told was wrong.
 */
export const LIMITS = {
  // Tight, and the one that actually matters: 6 wrong passwords for ONE account per 15 minutes,
  // no matter how many addresses the attempts come from.
  loginPerAccount: { max: 6,   windowMs: 15 * 60_000 },

  // Generous: a shared office should never lock itself out. Brute force is already bounded by
  // the per-account limit above, so this is only a flood ceiling.
  loginPerIp:      { max: 100, windowMs: 15 * 60_000 },

  // A busy launch day behind one carrier NAT must not hit this. Automated signup floods look
  // nothing like 20/hour anyway — they look like hundreds per minute.
  registerPerIp:   { max: 20,  windowMs: 60 * 60_000 },

  // Client error reports. UNAUTHENTICATED by necessity — the failure worth catching is the one
  // that happens before anybody signs in, on a page that never rendered. That makes it an open
  // write path, so it is the tightest per-IP limit here: a broken page reports once or twice, and
  // anything sending thirty an hour is either a loop or an attack, and both should be dropped
  // rather than stored.
  errorPerIp:      { max: 30,  windowMs: 60 * 60_000 },

  // Per-EMAIL is what stops someone being mail-bombed; per-IP is again just a flood ceiling.
  forgotPerEmail:  { max: 3,   windowMs: 60 * 60_000 },
  forgotPerIp:     { max: 30,  windowMs: 60 * 60_000 },

  resetPerIp:      { max: 30,  windowMs: 60 * 60_000 },

  // Reporting is brigade-proof per SUBJECT — one open report per person per thing — but nothing
  // bounded how many DIFFERENT things one account could report, and every post and work id is a
  // different subject. Registration is open, so that is an unbounded write path behind a free
  // signup: rows to store, a queue nobody can clear, and SQLITE_BUSY under enough of it.
  //
  // Twenty an hour is already an implausible amount of genuine reporting by one person. The per-IP
  // ceiling is the Sybil case — a swarm of throwaway accounts sharing one host — and is generous
  // enough that a shared office reporting a real incident never meets it.
  reportPerUser:   { max: 20,  windowMs: 60 * 60_000 },
  reportPerIp:     { max: 100, windowMs: 60 * 60_000 },

  // Commenting is the product, so this is looser than reporting — a real conversation on one
  // photograph can be twenty remarks, and reporting is an exceptional ask. Still bounded: an
  // unbounded write behind a free signup is rows to store and SQLITE_BUSY under a flood.
  commentPerUser:  { max: 60,  windowMs: 60 * 60_000 },
  commentPerIp:    { max: 300, windowMs: 60 * 60_000 },

  // Contesting a limit is exceptional — a person with a genuine case writes one, maybe two.
  // Twelve an hour is already more than the operator of this node can read; the per-IP
  // ceiling is the Sybil case, same shape as reporting.
  appealPerUser:   { max: 12,  windowMs: 60 * 60_000 },
  appealPerIp:     { max: 60,  windowMs: 60 * 60_000 },

  // Reverse geocode. The third party is Nominatim, unmetered use gets the whole origin blocked,
  // and a process-wide 1/s serialiser is the courtesy to them — these buckets are the courtesy
  // to everyone else sharing that one slot. Twenty an hour is already more lookups than a
  // person composing posts will make; the per-IP ceiling is the Sybil case, generous enough
  // that a shared office tapping the button never meets it.
  geocodePerUser:  { max: 20,  windowMs: 60 * 60_000 },
  geocodePerIp:    { max: 100, windowMs: 60 * 60_000 },
};
