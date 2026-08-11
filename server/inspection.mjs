/**
 * Inspection jobs and evidence capture. Build order step 3 of docs/specs/ORDER-AND-INSPECTION.md.
 *
 * ─── The two things this module refuses to do ──────────────────────────────────────────────
 *
 * 1. It never records a VERDICT. A receipt here says "the device reported these coordinates at
 *    this time, the network agreed to within one emirate, capture was live, assurance
 *    web-attested" — every clause of which stays true when challenged. It never says "the
 *    inspector was present", because that is a claim the system cannot support, and for a product
 *    whose thesis is receipts you can trust, overclaiming is the worst available failure.
 *
 * 2. It never trusts a location because it was reported. `navigator.geolocation` is spoofable in
 *    three different ways from a browser, so the grade is CONSISTENCY between the device fix and an
 *    independent network fix — see shared/assurance.mjs — not the fix itself. EXIF GPS is
 *    attacker-controlled and is stripped and never read.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * An inspector is an ORDINARY AGENT. Claiming a job runs through that agent's mandate exactly as
 * accepting an order does — fee floor, the spec template they are competent to judge, scope, and
 * (on the commissioner's side, via the order) counterparty tier. No new authority machinery.
 */
import { createHash, randomUUID } from 'node:crypto';
import { one, all, run } from './db.mjs';
import { canTransition, isTerminal } from '../shared/inspection-states.mjs';
import { grade, meets } from '../shared/assurance.mjs';
import { checkMandates } from './guard.mjs';
import { appendBothIn, inTransaction } from './receipts.mjs';
import { publishAll } from './events.mjs';
import * as store from './storage.mjs';
import { orderRow } from './orders.mjs';

const now = () => new Date().toISOString();

/** A four-character code, unambiguous by construction — no O/0, I/1, so it reads off a screen. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function nonce(len = 4) {
  const b = randomUUID().replace(/-/g, '');
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[parseInt(b[i], 16) % ALPHABET.length];
  return out;
}

export function jobRow(id) {
  return one('SELECT * FROM inspection_job WHERE id = ?', id);
}

/**
 * Both principals of the ORDER this job belongs to. Receipts about an inspection go to the parties
 * to the deal, because the finding is about their goods — derived from the order's agents, never
 * taken from a request.
 */
function orderPrincipals(order) {
  const b = one('SELECT user_id FROM agent WHERE id = ?', order.buyer_agent_id);
  const s = one('SELECT user_id FROM agent WHERE id = ?', order.seller_agent_id);
  return [b?.user_id, s?.user_id].filter(Boolean);
}

/** The inspector's principal, so the fee-owed receipt lands on the chain that will be paid. */
function inspectorPrincipal(job) {
  if (!job.inspector_id) return null;
  return one('SELECT user_id FROM agent WHERE id = ?', job.inspector_id)?.user_id ?? null;
}

/** Which role is `agentId` on for this job? The inspector, the commissioner, or nobody. */
export function roleOf(job, agentId) {
  if (job.inspector_id && job.inspector_id === agentId) return 'inspector';
  if (job.commissioner_id === agentId) return 'commissioner';
  return null;
}

/** Active mandates for one agent. Rows, because `checkMandates` takes rows. */
const mandatesOf = (agentId) =>
  all("SELECT * FROM mandate WHERE agent_id = ? AND status = 'active'", agentId);

/**
 * Post a job against an order. Only a party to that order may commission an inspection of it, and
 * only for a spec — the agreed quality definition the inspection judges against.
 */
export function postJob({ orderId, commissionerId, end, specTemplateId, fee, minAssurance }) {
  const order = orderRow(orderId);
  if (!order) return { ok: false, reason: 'no such order', code: 'NOT_FOUND' };
  if (order.buyer_agent_id !== commissionerId && order.seller_agent_id !== commissionerId) {
    return { ok: false, reason: 'only a party to the order may commission its inspection', code: 'NOT_A_PARTY' };
  }
  if (end !== 'origin' && end !== 'arrival') {
    return { ok: false, reason: "end must be 'origin' or 'arrival'", code: 'BAD_END' };
  }
  const amount = Number(fee?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: 'a positive fee is required', code: 'BAD_FEE' };
  }
  const currency = String(fee?.currency ?? '').trim();
  if (!currency) return { ok: false, reason: 'fee currency is required', code: 'BAD_FEE' };

  const id = `insp_${randomUUID().slice(0, 8)}`;
  run(
    `INSERT INTO inspection_job (
       id, order_id, commissioner_id, end, spec_template_id,
       fee_amount, fee_currency, min_assurance, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?)`,
    id, orderId, commissionerId, end, specTemplateId ?? order.spec_template_id,
    amount, currency, minAssurance ?? 'web-attested', now(), now(),
  );
  return { ok: true, job: jobRow(id) };
}

/**
 * The fee, in the shape the mandate guard understands. An inspector's mandate carries a
 * `price_floor` meaning the minimum FEE they will accept, and a `spec_template_id` meaning which
 * forms they are competent to complete — so claiming a job is checked as an `accept` intent, and
 * the guard's existing FLOOR and spec refusals do the work with no special case.
 */
function claimIntent(job) {
  return {
    kind: 'accept',
    commodity: job.spec_template_id,
    price: { amount: Number(job.fee_amount), currency: job.fee_currency },
    specTemplateId: job.spec_template_id,
  };
}

/**
 * Move a job. `actorAgentId` is resolved to a role from the job itself — never read from the
 * caller — so an agent cannot claim to be the other side. The state change and the receipts that
 * prove it happen in ONE transaction, the same discipline `transition()` in orders.mjs uses: a
 * receipt that was never written breaks no hash, so a half-written step would leave the chain
 * valid while incomplete, which is the worst failure for a structure whose whole purpose is to be
 * evidence.
 */
export function transition(jobId, actorAgentId, to,
                           { system = false, arbiter = false, principal = false } = {}) {
  const job = jobRow(jobId);
  if (!job) return { ok: false, reason: 'no such inspection', code: 'NOT_FOUND' };
  if (isTerminal(job.status)) return { ok: false, reason: `inspection is ${job.status}`, code: 'TERMINAL' };

  const role = system ? 'system' : arbiter ? 'arbiter' : roleOf(job, actorAgentId);
  // Claiming is the one move made by an agent who is not yet on the job — before a claim there is
  // no inspector, so roleOf returns null. A `posted → claimed` by a non-party is exactly that
  // case and is allowed to proceed to the guard, which is what actually decides it.
  const claiming = to === 'claimed' && job.status === 'posted';
  if (!role && !claiming && !system && !arbiter) {
    return { ok: false, reason: 'not a party to this inspection', code: 'NOT_A_PARTY' };
  }

  const effectiveRole = claiming ? 'inspector' : role;
  const allowed = canTransition(job.status, to, effectiveRole);
  if (!allowed.ok) return allowed;

  /*
   * A binding move commits the actor, so it goes through THEIR mandate. Claiming binds the
   * inspector to the fee floor and the spec they may judge. `principal: true` satisfies SCOPE and
   * nothing else — the same rule orders.mjs and the proposal flow enforce — by elevating scope on
   * a COPY of the mandate rather than reading the refusal code, because the guard checks scope
   * before floor and short-circuits, so reading the code would let a person approve past their own
   * floor.
   */
  if (allowed.transition.binds) {
    const rows = mandatesOf(actorAgentId);
    if (rows.length === 0) {
      return { ok: false, reason: 'the inspector has no active mandate', code: 'NO_MANDATE', mandate: true };
    }
    const check = checkMandates(
      principal ? rows.map((m) => ({ ...m, scope: 'commit' })) : rows,
      claimIntent(job),
    );
    if (!check.ok) return { ok: false, reason: check.reason, code: check.code, mandate: true };
  }

  const order = orderRow(job.order_id);
  const audience = [...orderPrincipals(order), inspectorPrincipal(job)].filter(Boolean);

  // A claim stamps the inspector onto the job and issues the check-in nonce in the same move, so
  // there is never a window where a job is claimed but has no inspector or no code to capture.
  const claimNonce = claiming ? nonce() : null;

  let receipts;
  try {
    receipts = inTransaction(() => {
      let sql = 'UPDATE inspection_job SET status = ?, updated_at = ?';
      const params = [to, now()];
      if (claiming) {
        sql += ', inspector_id = ?, claimed_at = ?, nonce = ?, nonce_issued_at = ?';
        params.push(actorAgentId, now(), claimNonce, now());
      }
      sql += ' WHERE id = ? AND status = ?';
      params.push(jobId, job.status);

      const moved = run(sql, ...params);
      if (moved.changes === 0) {
        const e = new Error('the inspection moved while this was being decided');
        e.code = 'CONFLICT';
        throw e;
      }
      // The audience for a claim must include the inspector who is being stamped on right now;
      // inspectorPrincipal(job) read the pre-claim row and would miss them.
      const claimAudience = claiming
        ? [...orderPrincipals(order),
           one('SELECT user_id FROM agent WHERE id = ?', actorAgentId)?.user_id].filter(Boolean)
        : audience;
      return appendBothIn(claimAudience, allowed.transition.receipt, {
        inspection: jobId,
        order: job.order_id,
        end: job.end,
        from: job.status,
        to,
        by: effectiveRole,
        agent: system || arbiter ? null : actorAgentId,
        spec: job.spec_template_id,
        fee: { amount: Number(job.fee_amount), currency: job.fee_currency },
        at: now(),
      });
    });
  } catch (e) {
    if (e.code === 'CONFLICT') return { ok: false, reason: e.message, code: 'CONFLICT' };
    throw e;
  }

  publishAll(audience, 'inspection', { id: jobId, order: job.order_id, from: job.status, to });
  return { ok: true, job: jobRow(jobId), receipts, nonce: claimNonce };
}

/**
 * Strip EXIF from a JPEG by rebuilding it from only the segments that carry image data.
 *
 * EXIF (APP1) and the other APPn/COM metadata segments are where a camera writes GPS, timestamps
 * and device ids — every one of which is attacker-controlled and none of which we read. We keep
 * SOF/DHT/DQT/SOS and the entropy-coded scan, and drop the rest. On anything that is not a JPEG
 * this returns the bytes unchanged, because the only formats the store accepts for a photo are
 * JPEG/PNG/WebP and PNG/WebP do not carry EXIF GPS the way a phone JPEG does.
 *
 * This is a stripper, not a re-encoder: it removes metadata segments without touching pixels, so
 * the visible frame — and therefore the human-readable watermark drawn into it by the client — is
 * unchanged, while nothing the file CLAIMS about itself survives to be mistaken for evidence.
 */
export function stripExif(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf; // not a JPEG
  const out = [Buffer.from([0xff, 0xd8])]; // SOI
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); break; } // EOI
    if (marker === 0xda) { out.push(buf.subarray(i)); break; }           // SOS + scan to end
    const len = (buf[i + 2] << 8) | buf[i + 3];
    const isMeta = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe; // APPn / COM
    if (!isMeta) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return Buffer.concat(out);
}

/**
 * Capture one frame of evidence at check-in.
 *
 * The job must be `checked_in` — the state machine gets there via a live capture, and this is that
 * capture. The caller supplies:
 *   - `bytes`      the image, from getUserMedia (the CLIENT enforces the stream; the receipt
 *                  records `live` as reported, and the grade collapses to `self` if it is false)
 *   - `presentedNonce`  the code the client showed and drew into the frame; must equal the job's
 *   - `nonceInShot`     that the code was legible in the frame (an OCR/human check, passed in)
 *   - `device`     { lat, lng, accuracy_m } from navigator.geolocation
 *   - `network`    { lat, lng } derived server-side from the request, independent of the device
 *   - `requestedAt`/`observedAt`  when the platform asked and the device answered
 *
 * The hash is taken over the STRIPPED bytes — the exact bytes stored — so "this is the image
 * submitted" is provable against what actually lives in the store, not against a pre-strip version
 * that no longer exists anywhere.
 */
export function captureEvidence(jobId, actorAgentId, {
  bytes, mime, presentedNonce, nonceInShot = false,
  device, network, requestedAt, observedAt, live = true,
}) {
  const job = jobRow(jobId);
  if (!job) return { ok: false, reason: 'no such inspection', code: 'NOT_FOUND' };
  if (roleOf(job, actorAgentId) !== 'inspector') {
    return { ok: false, reason: 'only the assigned inspector may capture evidence', code: 'NOT_A_PARTY' };
  }
  if (job.status !== 'claimed' && job.status !== 'checked_in') {
    return { ok: false, reason: `cannot capture evidence while ${job.status}`, code: 'WRONG_STATE' };
  }
  if (!bytes?.length) return { ok: false, reason: 'no frame received', code: 'NO_FRAME' };

  // The nonce is what stops last week's photo of the right warehouse working. A mismatch is not a
  // downgrade — it means this frame is not answering THIS check-in, and it is refused.
  if (String(presentedNonce ?? '') !== String(job.nonce ?? '') || !job.nonce) {
    return { ok: false, reason: 'the check-in code does not match', code: 'BAD_NONCE' };
  }

  const graded = grade({
    live, nonce: job.nonce, nonceInShot,
    device, network, requestedAt, observedAt,
  });

  // EXIF stripped, never read. Hash AFTER stripping, over the bytes that will actually be stored.
  const clean = mime === 'image/jpeg' ? stripExif(Buffer.from(bytes)) : Buffer.from(bytes);
  const sha256 = createHash('sha256').update(clean).digest('hex');

  let media = null;
  try { media = store.put(clean, mime || 'image/jpeg'); } catch { media = null; }

  const id = `ev_${randomUUID().slice(0, 8)}`;
  const source = device?.lat != null ? 'device' : (network?.lat != null ? 'network' : null);

  const evidenceReceipt = {
    inspection: jobId,
    order: job.order_id,
    end: job.end,
    // OBSERVATIONS, never a verdict. Every field here is a thing that was measured or reported,
    // and the assurance grade is labelled as a grade with its reasons — not as a finding of fact.
    observed: {
      sha256,
      nonce: job.nonce,
      live: !!live,
      device: device ? { lat: Number(device.lat), lng: Number(device.lng), accuracy_m: device.accuracy_m ?? null } : null,
      network: network ? { lat: Number(network.lat), lng: Number(network.lng) } : null,
      source,
      assurance: graded.level,
      reasons: graded.reasons,
      requested_at: requestedAt ?? null,
      observed_at: observedAt ?? null,
    },
    at: now(),
  };

  const order = orderRow(job.order_id);
  const audience = [...orderPrincipals(order), inspectorPrincipal(job)].filter(Boolean);

  let receipts;
  try {
    receipts = inTransaction(() => {
      run(
        `INSERT INTO inspection_evidence (
           id, job_id, media_id, sha256, nonce, live, lat, lng, accuracy_m,
           net_lat, net_lng, source, assurance, reasons, requested_at, observed_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, jobId, media?.id ?? null, sha256, job.nonce, live ? 1 : 0,
        device?.lat ?? null, device?.lng ?? null, device?.accuracy_m ?? null,
        network?.lat ?? null, network?.lng ?? null, source,
        graded.level, JSON.stringify(graded.reasons), requestedAt ?? null, observedAt ?? null, now(),
      );
      // The evidence receipt uses type `inspection.observed` precisely because it is an
      // observation. It is NOT `inspection.passed` — passing is a verdict, and this records what
      // was seen, not what it means.
      return appendBothIn(audience, 'inspection.observed', evidenceReceipt);
    });
  } catch (e) {
    throw e;
  }

  // Move claimed → checked_in on the first accepted frame. Done here, after the evidence is
  // written, so the state only advances once there is something to show for it.
  if (job.status === 'claimed') {
    transition(jobId, actorAgentId, 'checked_in');
  }

  return {
    ok: true,
    evidence: { id, sha256, assurance: graded.level, reasons: graded.reasons, consistent: graded.consistent },
    meetsPolicy: meets(graded.level, job.min_assurance),
    receipts,
  };
}

/** Every piece of evidence for a job, newest first. Observations, returned as observations. */
export function evidenceFor(jobId) {
  return all(
    `SELECT id, media_id, sha256, nonce, live, lat, lng, accuracy_m, net_lat, net_lng,
            source, assurance, reasons, requested_at, observed_at, created_at
     FROM inspection_evidence WHERE job_id = ? ORDER BY created_at DESC`, jobId)
    .map((r) => ({ ...r, live: !!r.live, reasons: JSON.parse(r.reasons) }));
}

export function jobsForOrder(orderId) {
  return all('SELECT * FROM inspection_job WHERE order_id = ? ORDER BY created_at DESC', orderId);
}

export function jobsForInspector(agentId, limit = 50) {
  return all(
    'SELECT * FROM inspection_job WHERE inspector_id = ? ORDER BY created_at DESC LIMIT ?',
    agentId, limit);
}

/** Open jobs an inspector could claim. The nonce is NEVER included — it is issued at claim. */
export function openJobs(limit = 50) {
  return all("SELECT * FROM inspection_job WHERE status = 'posted' ORDER BY created_at DESC LIMIT ?",
    limit);
}

/**
 * Client shape. The nonce is shown ONLY to the assigned inspector, and only while a check-in is
 * live — it is the one secret in the flow, and leaking it to the feed would hand every scraper the
 * code that is supposed to prove presence.
 */
export function publicJob(job, viewerAgentId) {
  if (!job) return null;
  const role = viewerAgentId ? roleOf(job, viewerAgentId) : null;
  return {
    id: job.id,
    order: job.order_id,
    role,
    end: job.end,
    specTemplateId: job.spec_template_id,
    fee: { amount: Number(job.fee_amount), currency: job.fee_currency },
    minAssurance: job.min_assurance,
    status: job.status,
    nonce: role === 'inspector' && job.status === 'claimed' ? job.nonce : undefined,
    claimedAt: job.claimed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}
