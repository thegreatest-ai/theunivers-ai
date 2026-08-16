/**
 * Rate limiter behaviour. These are the properties that matter when the invite gate opens;
 * the limits themselves may be retuned, but none of these may stop holding.
 *
 * The counters live in the database now, so the suite needs a database. DB_PATH is set to a
 * throwaway file BEFORE the module is imported, because db.mjs reads it once at load — a static
 * import would be hoisted above the assignment and open ./data/pilot.db instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DB = join(tmpdir(), `ratelimit-test-${process.pid}.db`);
process.env.DB_PATH = DB;
process.on('exit', () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f); } catch { /* never ran */ } }
});

const { take, refund, reset, clientIp, limitStats, LIMITS } = await import('../server/ratelimit.mjs');

const uniq = () => `k${Math.random().toString(36).slice(2)}`;

test('allows up to the limit, then blocks', () => {
  const k = uniq();
  for (let i = 0; i < 5; i++) assert.equal(take('t', k, 5, 60_000).ok, true, `attempt ${i + 1}`);
  const blocked = take('t', k, 5, 60_000);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0, 'must tell the caller when to come back');
});

test('keys are independent — one caller cannot lock out another', () => {
  const a = uniq(), b = uniq();
  for (let i = 0; i < 6; i++) take('t', a, 5, 60_000);
  assert.equal(take('t', a, 5, 60_000).ok, false);
  assert.equal(take('t', b, 5, 60_000).ok, true);
});

test('buckets are independent — a login limit is not a register limit', () => {
  const k = uniq();
  for (let i = 0; i < 6; i++) take('bucket-a', k, 5, 60_000);
  assert.equal(take('bucket-a', k, 5, 60_000).ok, false);
  assert.equal(take('bucket-b', k, 5, 60_000).ok, true);
});

test('the window expires', async () => {
  const k = uniq();
  for (let i = 0; i < 3; i++) take('t', k, 2, 40);
  assert.equal(take('t', k, 2, 40).ok, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(take('t', k, 2, 40).ok, true, 'a short window must actually reset');
});

test('refund returns an attempt, so a success does not leave you one typo from lockout', () => {
  const k = uniq();
  for (let i = 0; i < 5; i++) take('t', k, 5, 60_000);
  assert.equal(take('t', k, 5, 60_000).ok, false, 'exhausted');
  refund('t', k);
  refund('t', k);
  assert.equal(take('t', k, 5, 60_000).ok, true, 'refund must restore headroom');
});

test('rejected attempts still count, so an attacker cannot idle-wait a window open', () => {
  const k = uniq();
  for (let i = 0; i < 5; i++) take('t', k, 5, 60_000);
  const first = take('t', k, 5, 60_000);
  const later = take('t', k, 5, 60_000);
  assert.equal(first.ok, false);
  assert.equal(later.ok, false);
  assert.ok(later.retryAfter <= first.retryAfter, 'window must not be extended by rejected calls');
});

test('clientIp prefers Fly-Client-IP and IGNORES spoofable X-Forwarded-For', () => {
  // Trusting X-Forwarded-For would let an attacker mint a fresh limit per request by varying a
  // header — worse than no limit, because it looks protected.
  const req = {
    headers: { 'fly-client-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' },
    socket: { remoteAddress: '5.6.7.8' },
  };
  assert.equal(clientIp(req), '1.2.3.4');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '9.9.9.9' }, socket: { remoteAddress: '5.6.7.8' } }),
    '5.6.7.8', 'without Fly-Client-IP, fall back to the socket, never to the header');
});

test('login is limited on both IP and account', () => {
  assert.ok(LIMITS.loginPerIp.max > LIMITS.loginPerAccount.max,
    'per-IP must be looser than per-account, or shared networks lock each other out');
});

test('geocode is limited on both user and IP, and per-IP is the generous one', () => {
  assert.ok(LIMITS.geocodePerUser.max > 0);
  assert.ok(LIMITS.geocodePerIp.max > LIMITS.geocodePerUser.max,
    'per-IP must be looser than per-user, or a shared office tapping the button locks itself out');
});

/*
 * ── The properties that came with moving off process memory ──────────────────────────────
 */

test('a counter is in the DATABASE, not in this process', () => {
  // Read with a SEPARATE connection. If the count were held in a Map, a second connection would
  // see nothing — which is exactly what a second machine would see, and the bug this closes.
  const k = uniq();
  for (let i = 0; i < 3; i++) take('durable', k, 10, 60_000);

  const other = new DatabaseSync(DB);
  const row = other.prepare('SELECT count, max FROM rate_limit WHERE bucket = ? AND key = ?')
    .get('durable', k);
  other.close();

  assert.equal(row?.count, 3, 'the count must be readable by anything that can reach the database');
  assert.equal(row?.max, 10, 'the limit is stored with the row so metrics need no second copy');
});

test('a restart does not hand out a fresh set of attempts', () => {
  // `fly deploy` restarts the process. With counters in memory that cleared every limit, so a
  // brute-force defence reset on a schedule an attacker could simply wait for.
  const k = uniq();
  for (let i = 0; i < 6; i++) take('restart', k, 5, 60_000);
  assert.equal(take('restart', k, 5, 60_000).ok, false, 'exhausted before the restart');

  // Losing every module-level variable is what a restart does to this module; the row outlives it.
  const other = new DatabaseSync(DB);
  const surviving = other.prepare('SELECT count FROM rate_limit WHERE bucket = ? AND key = ?')
    .get('restart', k);
  other.close();
  assert.ok(surviving.count > 5, 'the lockout must outlive the process that recorded it');
});

test('reset unlocks one caller, because restarting no longer does', () => {
  const k = uniq();
  for (let i = 0; i < 6; i++) take('unlock', k, 5, 60_000);
  assert.equal(take('unlock', k, 5, 60_000).ok, false);

  assert.equal(reset('unlock', k), 1, 'reset reports what it cleared');
  assert.equal(take('unlock', k, 5, 60_000).ok, true, 'the caller is free again');
  assert.equal(reset('unlock', uniq()), 0, 'clearing an unknown key is not an error');
});

test('refund cannot mint attempts by driving a counter negative', () => {
  const k = uniq();
  take('neg', k, 5, 60_000);
  for (let i = 0; i < 10; i++) refund('neg', k);

  const other = new DatabaseSync(DB);
  const row = other.prepare('SELECT count FROM rate_limit WHERE bucket = ? AND key = ?').get('neg', k);
  other.close();
  assert.ok(row.count >= 0, 'a negative count would be free attempts for whoever asked');
});

test('limitStats counts who is over their limit, so a lockout is visible', () => {
  // Before this there was no way to tell a limit had fired except that somebody complained.
  const k = uniq();
  for (let i = 0; i < 7; i++) take('observable', k, 5, 60_000);

  const s = limitStats();
  assert.ok(s.tracked >= 1);
  assert.ok(s.blocked >= 1, 'a caller past their limit must show up as blocked');
  assert.equal(s.byBucket.observable.blocked, 1, 'and be attributable to the bucket that blocked');
});

test('a key that is not a string does not become a second counter', () => {
  // Route callers pass whatever they have — an email, an IP, sometimes a number. If 7 and "7"
  // keyed separately, the limit would silently double for anyone whose key was numeric.
  const k = Math.floor(Math.random() * 1e9);
  for (let i = 0; i < 5; i++) take('coerce', k, 5, 60_000);
  assert.equal(take('coerce', String(k), 5, 60_000).ok, false,
    'the same key in two types must be one counter');
});
