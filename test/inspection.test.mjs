/**
 * Inspection jobs and evidence capture, against a real database.
 *
 * The properties under test are the ones the spec makes load-bearing:
 *   - only a party to the order may commission an inspection of it
 *   - claiming runs through the inspector's OWN mandate (fee floor, spec they may judge)
 *   - a check-in nonce is issued at claim, and a frame that does not carry it is refused
 *   - evidence is graded, and the receipt records the OBSERVATION, never a verdict
 *   - EXIF is stripped, and the hash is taken over the stored bytes
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DB = join(tmpdir(), `inspection-test-${process.pid}.db`);
process.env.DB_PATH = DB;
process.env.MEDIA_PATH = join(tmpdir(), `inspection-media-${process.pid}`);
process.on('exit', () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f); } catch { /* never ran */ } }
  try { rmSync(process.env.MEDIA_PATH, { recursive: true }); } catch { /* never made */ }
});

const { one, run } = await import('../server/db.mjs');
const orders = await import('../server/orders.mjs');
const inspection = await import('../server/inspection.mjs');
const { verifyChain } = await import('../server/receipts.mjs');

const now = () => new Date().toISOString();

/** Make a user + their agent, returning the agent id. */
function makeAgent(tag, { withMandate } = {}) {
  const uid = `usr_${tag}`;
  const aid = `agt_${tag}`;
  run('INSERT INTO user (id, email, name, created_at) VALUES (?,?,?,?)',
    uid, `${uid}@example.test`, tag, now());
  run(`INSERT INTO agent (id, user_id, name, purpose, api_token, created_at)
       VALUES (?,?,?,?,?,?)`,
    aid, uid, `${tag}.agent`, 'acts for me', `tok_${tag}`, now());
  if (withMandate) {
    run(`INSERT INTO mandate (id, agent_id, commodity, scope, price_floor, currency,
           spec_template_id, counterparty_min_tier, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      `mnd_${tag}`, aid, withMandate.commodity, withMandate.scope,
      withMandate.floor ?? null, withMandate.currency ?? 'AED',
      withMandate.spec ?? 'default', 'T0', 'active', now());
  }
  return aid;
}

function makeOrder(buyer, seller, status = 'shipped') {
  const id = `ord_${Math.random().toString(36).slice(2, 8)}`;
  run(`INSERT INTO "order" (id, buyer_agent_id, seller_agent_id, commodity, spec_template_id,
         price_amount, price_currency, quantity, delivery_window, inspection_policy,
         status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, buyer, seller, 'tomatoes-organic', 'default', 100, 'AED',
    '{"value":10,"unit":"t"}', '{"from":"2026-01-01","to":"2026-12-31"}',
    '{"required":true,"minAssurance":"web-attested"}', status, now(), now());
  return id;
}

const buyer = makeAgent('buyer');
const seller = makeAgent('seller');
// An inspector whose mandate lets it commit to inspection jobs against the 'default' spec for a
// fee at or above 30 AED. This is exactly how the spec frames an inspector: an ordinary agent
// whose price_floor is a minimum FEE and whose spec_template_id is what it may judge.
const inspector = makeAgent('inspector', {
  withMandate: { commodity: 'default', scope: 'commit', floor: 30, currency: 'AED', spec: 'default' },
});
const stranger = makeAgent('stranger');

test('only a party to the order may commission its inspection', () => {
  const order = makeOrder(buyer, seller);
  const bad = inspection.postJob({
    orderId: order, commissionerId: stranger, end: 'arrival', fee: { amount: 50, currency: 'AED' },
  });
  assert.ok(!bad.ok);
  assert.equal(bad.code, 'NOT_A_PARTY');

  const ok = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'arrival', fee: { amount: 50, currency: 'AED' },
  });
  assert.ok(ok.ok);
  assert.equal(ok.job.status, 'posted');
  assert.equal(ok.job.nonce, null, 'no nonce before a claim');
});

test('end must be origin or arrival — the two-ended record the spec requires', () => {
  const order = makeOrder(buyer, seller);
  const bad = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'somewhere', fee: { amount: 50, currency: 'AED' },
  });
  assert.ok(!bad.ok);
  assert.equal(bad.code, 'BAD_END');
});

test('claiming runs through the inspector mandate; a below-floor fee is refused', () => {
  const order = makeOrder(buyer, seller);
  const low = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'arrival', fee: { amount: 10, currency: 'AED' },
  }).job;
  const refused = inspection.transition(low.id, inspector, 'claimed');
  assert.ok(!refused.ok);
  assert.equal(refused.code, 'FLOOR');
  assert.ok(refused.mandate);
});

test('a valid claim stamps the inspector and issues a check-in nonce', () => {
  const order = makeOrder(buyer, seller);
  const job = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'arrival', fee: { amount: 50, currency: 'AED' },
  }).job;
  const claimed = inspection.transition(job.id, inspector, 'claimed');
  assert.ok(claimed.ok);
  assert.equal(claimed.job.status, 'claimed');
  assert.equal(claimed.job.inspector_id, inspector);
  assert.ok(/^[A-Z0-9]{4}$/.test(claimed.nonce), 'a four-char nonce is issued at claim');

  // The nonce is shown to the inspector only, and only while claimed — never to a stranger.
  assert.equal(inspection.publicJob(claimed.job, inspector).nonce, claimed.nonce);
  assert.equal(inspection.publicJob(claimed.job, buyer).nonce, undefined);
});

test('a frame without the check-in nonce is refused — last week’s photo does not work', async () => {
  const order = makeOrder(buyer, seller);
  const job = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'arrival', fee: { amount: 50, currency: 'AED' },
  }).job;
  inspection.transition(job.id, inspector, 'claimed');

  const bad = await inspection.captureEvidence(job.id, inspector, {
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg',
    presentedNonce: 'WRNG', nonceInShot: true, live: true,
  });
  assert.ok(!bad.ok);
  assert.equal(bad.code, 'BAD_NONCE');
});

test('a live, consistent capture grades web-attested and records an OBSERVATION', async () => {
  const order = makeOrder(buyer, seller);
  const job = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'arrival', fee: { amount: 50, currency: 'AED' },
    minAssurance: 'web-attested',
  }).job;
  const claim = inspection.transition(job.id, inspector, 'claimed');

  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG (SOI+EOI)
  const cap = await inspection.captureEvidence(job.id, inspector, {
    bytes, mime: 'image/jpeg', presentedNonce: claim.nonce, nonceInShot: true, live: true,
    device: { lat: 25.2048, lng: 55.2708, accuracy_m: 18 },
    network: { lat: 25.34, lng: 55.42 },
    requestedAt: '2026-08-10T14:00:00Z', observedAt: '2026-08-10T14:00:05Z',
  });
  assert.ok(cap.ok);
  assert.equal(cap.evidence.assurance, 'web-attested');
  assert.ok(cap.meetsPolicy);

  // The receipt is an OBSERVATION, never a verdict: its type says `observed`, not `passed`, and
  // the parties can each verify their own chain.
  assert.ok(cap.receipts.every((r) => r.type === 'inspection.observed'));
  assert.ok(verifyChain(one('SELECT user_id FROM agent WHERE id = ?', buyer).user_id).ok);
  assert.ok(verifyChain(one('SELECT user_id FROM agent WHERE id = ?', seller).user_id).ok);

  // Capturing advanced the job to checked_in.
  assert.equal(inspection.jobRow(job.id).status, 'checked_in');

  // The stored evidence carries the reasons, not a bare grade.
  const ev = inspection.evidenceFor(job.id);
  assert.equal(ev.length, 1);
  assert.ok(ev[0].reasons.length > 0);
  assert.equal(ev[0].assurance, 'web-attested');
});

test('the stored hash matches the stripped bytes — not what the file claims about itself', async () => {
  // A JPEG with an APP1 (EXIF) segment. stripExif must remove it, and the hash must be over the
  // result, so "this is the image submitted" is provable against what actually lives in the store.
  const soi = Buffer.from([0xff, 0xd8]);
  const app1 = Buffer.from([0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66]); // len=6 + "Exif"
  const eoi = Buffer.from([0xff, 0xd9]);
  const withExif = Buffer.concat([soi, app1, eoi]);

  const stripped = inspection.stripExif(withExif);
  assert.ok(!stripped.includes(Buffer.from('Exif')), 'EXIF segment must be gone');
  assert.deepEqual(stripped, Buffer.concat([soi, eoi]), 'only image segments survive');

  const order = makeOrder(buyer, seller);
  const job = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'origin', fee: { amount: 50, currency: 'AED' },
  }).job;
  const claim = inspection.transition(job.id, inspector, 'claimed');
  const cap = await inspection.captureEvidence(job.id, inspector, {
    bytes: withExif, mime: 'image/jpeg', presentedNonce: claim.nonce, nonceInShot: true, live: true,
    device: { lat: 25.2, lng: 55.27 }, network: { lat: 25.2, lng: 55.27 },
  });
  assert.ok(cap.ok);
  assert.equal(cap.evidence.sha256, createHash('sha256').update(stripped).digest('hex'),
    'the receipted hash is over the stored, stripped bytes');
});

test('a spoofed device position that disagrees with the network drops to self', async () => {
  const order = makeOrder(buyer, seller);
  const job = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'arrival', fee: { amount: 50, currency: 'AED' },
    minAssurance: 'web-attested',
  }).job;
  const claim = inspection.transition(job.id, inspector, 'claimed');
  const cap = await inspection.captureEvidence(job.id, inspector, {
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg',
    presentedNonce: claim.nonce, nonceInShot: true, live: true,
    device: { lat: 29.7604, lng: -95.3698 },  // Houston — the spoof
    network: { lat: 25.2048, lng: 55.2708 },   // edge says Dubai
  });
  assert.ok(cap.ok, 'the capture is recorded — it is not rejected, it is graded down');
  assert.equal(cap.evidence.assurance, 'self');
  assert.ok(!cap.meetsPolicy, 'self does not meet a web-attested policy');
});

test('a non-inspector cannot capture evidence', async () => {
  const order = makeOrder(buyer, seller);
  const job = inspection.postJob({
    orderId: order, commissionerId: buyer, end: 'arrival', fee: { amount: 50, currency: 'AED' },
  }).job;
  inspection.transition(job.id, inspector, 'claimed');
  const bad = await inspection.captureEvidence(job.id, seller, {
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', presentedNonce: 'ANY',
  });
  assert.ok(!bad.ok);
  assert.equal(bad.code, 'NOT_A_PARTY');
});
