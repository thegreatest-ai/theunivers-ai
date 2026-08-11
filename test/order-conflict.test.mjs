/**
 * Two actors moving one order at the same time.
 *
 * `transition()` reads the order's status, decides, and then writes. Between the read and the write
 * the order may already have moved. On one machine it cannot: node:sqlite is synchronous and there
 * is no await in that path, so the event loop runs the whole function to completion. A SECOND
 * MACHINE removes that accident, and nothing in the state machine would notice — both callers pass
 * `canTransition` against the same stale status, both write receipts, and one of the two chains
 * then records a transition that never happened.
 *
 * The compare-and-swap is what closes it. These tests cover the two halves that have to hold:
 * that the SQL really is a compare-and-swap, and that its result is acted on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = join(tmpdir(), `order-conflict-test-${process.pid}.db`);
process.env.DB_PATH = DB;
process.on('exit', () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f); } catch { /* never ran */ } }
});

const { one, run } = await import('../server/db.mjs');

const now = () => new Date().toISOString();

function makeOrder(status = 'offered') {
  const id = `ord_test_${Math.random().toString(36).slice(2, 8)}`;
  for (const side of ['buyer', 'seller']) {
    const uid = `usr_${id}_${side}`;
    run('INSERT INTO user (id, email, name, created_at) VALUES (?,?,?,?)',
      uid, `${uid}@example.test`, `${side} person`, now());
    run(`INSERT INTO agent (id, user_id, name, purpose, api_token, created_at)
         VALUES (?,?,?,?,?,?)`,
      `agt_${id}_${side}`, uid, `${side}.${id.slice(-6)}`, 'acts on my behalf',
      `tok_${id}_${side}`, now());
  }
  run(`INSERT INTO "order" (id, buyer_agent_id, seller_agent_id, commodity, price_amount,
         price_currency, quantity, delivery_window, inspection_policy, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, `agt_${id}_buyer`, `agt_${id}_seller`, 'onion-red', 15, 'AED',
    '{"value":40,"unit":"t"}', '{"from":"2026-01-01","to":"2026-12-31"}',
    '{"required":true}', status, now(), now());
  return id;
}

const CAS = 'UPDATE "order" SET status = ?, updated_at = ? WHERE id = ? AND status = ?';

test('the update moves the order only from the status it was read at', () => {
  const id = makeOrder('offered');
  const first = run(CAS, 'accepted', now(), id, 'offered');
  assert.equal(first.changes, 1, 'the first mover wins');
  assert.equal(one('SELECT status FROM "order" WHERE id = ?', id).status, 'accepted');
});

test('a second actor working from a stale status changes nothing', () => {
  // This is the concurrent case: both read `offered`, the first commits, the second arrives with a
  // status that is no longer true. It must write NOTHING rather than overwrite the first.
  const id = makeOrder('offered');
  run(CAS, 'accepted', now(), id, 'offered');

  const stale = run(CAS, 'withdrawn', now(), id, 'offered');
  assert.equal(stale.changes, 0, 'a stale compare-and-swap must not move the order');
  assert.equal(one('SELECT status FROM "order" WHERE id = ?', id).status, 'accepted',
    'the first mover’s outcome must survive the second');
});

test('transition() acts on the result instead of assuming it worked', () => {
  /*
   * Structural, because the race cannot be staged in-process: the path this guards has no await to
   * interleave at. Read from source so the check cannot be removed silently — deleting it would
   * restore a bug whose symptom is a receipt for something that did not happen, which is the worst
   * possible failure for a chain that exists to be evidence.
   */
  const SRC = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'orders.mjs'), 'utf8');

  assert.match(SRC, /const moved = run\('UPDATE "order" SET status/,
    'the compare-and-swap result must be captured');
  assert.match(SRC, /if \(moved\.changes === 0\)/,
    'and checked before anything is written on the strength of it');

  const casAt = SRC.indexOf('const moved = run(');
  const guardAt = SRC.indexOf('moved.changes === 0');
  const receiptAt = SRC.indexOf('appendBoth(');
  assert.ok(casAt < guardAt && guardAt < receiptAt,
    'the check must come between the write and the receipts, or it guards nothing');
});
