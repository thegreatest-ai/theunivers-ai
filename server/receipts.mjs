/**
 * The receipt chain — append-only, hash-linked, one chain per principal.
 *
 * ─── What a receipt is, and is not ───────────────────────────────────────────────────────
 *
 * A receipt records that SOMETHING HAPPENED, from the perspective of one principal. It is not a
 * transfer, not an instruction, and not a verdict. `payment.released` does not release a payment —
 * it records that a release happened somewhere the platform does not reach. See the payment
 * boundary in docs/specs/ORDER-AND-INSPECTION.md.
 *
 * Receipts record OBSERVATIONS, NEVER VERDICTS. "the device reported these coordinates" is a
 * receipt; "the inspector was present" is a claim the system cannot support.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * ONE CHAIN PER PRINCIPAL, not one global chain. The schema says so — `UNIQUE (user_id, seq)`.
 * A deal has two parties, so a transition writes a receipt to BOTH chains with the same payload.
 * Each party then holds a complete, independently verifiable record of the deal as it concerns
 * them, and neither depends on the other's copy to prove their own history.
 *
 * The hash covers the previous hash, so altering any earlier receipt invalidates every one after
 * it. That makes tampering DETECTABLE — it does not make it impossible, and within our own
 * database we are the ones who could do it. Anchoring a daily Merkle root to a public chain is
 * what removes us from our own evidence; see the anchoring section of the spec. It is not built.
 */
import { createHash, randomUUID } from 'node:crypto';
import { db, one, all } from './db.mjs';

/** The hash a chain starts from. 64 zeroes, so every row has a `prev_hash` of the same shape. */
export const GENESIS = '0'.repeat(64);

/**
 * Hash over everything that identifies this link. The previous hash is included FIRST so the
 * chain property holds: change anything historical and every later hash changes with it.
 *
 * `payload` is hashed as canonical JSON — keys sorted — because `JSON.stringify` preserves
 * insertion order, and two objects that differ only in key order must not produce different
 * hashes for the same facts.
 */
export function receiptHash({ prevHash, seq, userId, type, payload, createdAt }) {
  return createHash('sha256')
    .update([prevHash, String(seq), userId, type, canonical(payload), createdAt].join('\n'))
    .digest('hex');
}

/** Deterministic JSON: object keys sorted at every depth, arrays left in order. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

/**
 * Append one receipt to a principal's chain.
 *
 * Wrapped in a transaction because reading the head and writing the next link is not atomic on its
 * own: two concurrent appends could read the same head and both claim the same `seq`. The
 * UNIQUE (user_id, seq) constraint would catch that — the transaction means it never happens
 * rather than failing loudly afterwards.
 */
export function appendReceipt(userId, type, payload) {
  const createdAt = new Date().toISOString();
  const id = `rct_${randomUUID().slice(0, 8)}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    const head = one(
      'SELECT seq, hash FROM receipt WHERE user_id = ? ORDER BY seq DESC LIMIT 1', userId);
    const seq = (head?.seq ?? 0) + 1;
    const prevHash = head?.hash ?? GENESIS;
    const hash = receiptHash({ prevHash, seq, userId, type, payload, createdAt });

    db.prepare(
      `INSERT INTO receipt (id, seq, user_id, type, payload, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, seq, userId, type, canonical(payload), prevHash, hash, createdAt);

    db.exec('COMMIT');
    return { id, seq, hash, prevHash, type, createdAt };
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** Write the same event to both sides of a deal. Order is stable so tests are deterministic. */
export function appendBoth(userIds, type, payload) {
  return [...new Set(userIds)].filter(Boolean).sort()
    .map((uid) => appendReceipt(uid, type, payload));
}

/**
 * Re-derive every hash in a principal's chain and report the first place it stops matching.
 *
 * This is the whole point of the structure, so it is a function rather than a comment: a chain
 * nobody can check is just a table with an extra column.
 */
export function verifyChain(userId) {
  const rows = all(
    'SELECT * FROM receipt WHERE user_id = ? ORDER BY seq ASC', userId);
  let prevHash = GENESIS;

  for (const [i, r] of rows.entries()) {
    if (r.seq !== i + 1) {
      return { ok: false, at: r.seq, reason: `sequence jumps to ${r.seq} at position ${i + 1}` };
    }
    if (r.prev_hash !== prevHash) {
      return { ok: false, at: r.seq, reason: 'prev_hash does not match the previous link' };
    }
    const expected = receiptHash({
      prevHash, seq: r.seq, userId, type: r.type,
      payload: JSON.parse(r.payload), createdAt: r.created_at,
    });
    if (expected !== r.hash) {
      return { ok: false, at: r.seq, reason: 'contents do not match the stored hash' };
    }
    prevHash = r.hash;
  }
  return { ok: true, length: rows.length, head: prevHash };
}

export function chainFor(userId, limit = 100) {
  return all(
    `SELECT id, seq, type, payload, prev_hash, hash, created_at
     FROM receipt WHERE user_id = ? ORDER BY seq DESC LIMIT ?`, userId, limit)
    .map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
}
