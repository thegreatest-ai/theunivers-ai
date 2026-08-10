/**
 * Rate limiter behaviour. These are the properties that matter when the invite gate opens;
 * the limits themselves may be retuned, but none of these may stop holding.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { take, refund, clientIp, LIMITS } from '../server/ratelimit.mjs';

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
