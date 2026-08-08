/**
 * Pilot adapter for trust — maps SQLite rows into Corridor snapshots and calls the shared
 * derivation. Do not re-implement ANCHOR_STRENGTH or the tier ladder here. Ever.
 *
 * INVARIANT 1: tier is DERIVED, never granted. There is deliberately no setTier(), no tier
 * column, and no admin path. If someone asks for one to close a deal or impress an investor,
 * the answer is no — the moment tier is a field rather than a function this is a directory
 * with badges, and the whole trust model is decoration.
 */
import { derive } from './vendor/trust-rules.ts';
import { all, one } from './db.mjs';

/** Anchor rows -> the shape derive() reads. */
function anchorsOf(userId) {
  return all(
    `SELECT type, method, status, verified_at, expires_at
       FROM anchor WHERE user_id = ?`, userId,
  ).map((r) => ({
    type: r.type,
    method: r.method,
    status: r.status,
    verifiedAt: r.verified_at ?? null,
    expiresAt: r.expires_at ?? null,
  }));
}

/** Receipt TYPES only — the derivation counts kinds, it does not read payloads. */
function receiptTypesOf(userId) {
  return all('SELECT type FROM receipt WHERE user_id = ?', userId).map((r) => r.type);
}

/**
 * Compute standing for a user. Returns tier, score, components and the explanation keys.
 * Never cached to a column: a cached tier is a granted tier the moment the cache goes stale.
 */
export function trustOf(userId, now = new Date()) {
  const u = one('SELECT created_at FROM user WHERE id = ?', userId);
  const ageDays = u?.created_at
    ? (now.getTime() - new Date(u.created_at).getTime()) / 86_400_000
    : 0;
  return derive(anchorsOf(userId), receiptTypesOf(userId), ageDays, now);
}

/** Convenience for the guard, which needs only the tier. */
export const tierOf = (userId, now = new Date()) => trustOf(userId, now).tier;
