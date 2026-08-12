/**
 * The write side of the moderation queue.
 *
 * The queue could be read and not acted on: `report.status` has had `actioned` and `dismissed` in
 * its CHECK constraint since the table was written, and nothing wrote either. So a report went
 * into a list nobody could clear.
 *
 * Two properties are worth more than the rest here. TAKEDOWN IS NOT A DELETE — a cited post must
 * survive as a tombstone, because citations are the citer's record and destroying them to act
 * against an author erases a third party's evidence. And IT IS ONE-WAY — the body is gone, so what
 * an appeal argues against is the hash taken before it was emptied, not a copy we kept.
 *
 * The cited-post-survives assertion belongs to openclaw's pass in safety.test.mjs; this file covers
 * the route.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MODERATION_ACTIONS, AVAILABLE_ACTIONS } from '../shared/moderation-actions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = 'operator-token-for-the-moderation-test';
const TITLE = 'a title that will be removed';
const BODY = 'a body that will be removed';

let PORT; let child; let DB;
const TOK = { ana: 'tok_m_ana', ben: 'tok_m_ben', operator: TOKEN };

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function api(path, { method = 'GET', as, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request({
      host: '127.0.0.1', port: PORT, path, method, agent: false,
      headers: {
        ...(as ? { Authorization: `Bearer ${TOK[as]}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const rows = (sql, ...params) => {
  const db = new DatabaseSync(DB);
  try { return db.prepare(sql).all(...params); } finally { db.close(); }
};

before(async () => {
  PORT = await freePort();
  DB = join(mkdtempSync(join(tmpdir(), 'moderation-')), 'moderation.db');
  child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, INVITE_CODE: 'moderation-test',
           OAUTH_STATE_SECRET: 'moderation-secret', METRICS_TOKEN: TOKEN },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
  let exited = null; child.on('exit', (c) => { exited = c; });
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (exited !== null) throw new Error(`server exited: ${stderr}`);
    if (Date.now() > deadline) throw new Error(`server did not start: ${stderr}`);
    try { if ((await api('/api/health')).status === 200) break; } catch { /* not up */ }
    await sleep(100);
  }

  const db = new DatabaseSync(DB);
  const t = new Date().toISOString();
  for (const who of ['ana', 'ben']) {
    db.prepare('INSERT INTO user (id,email,name,created_at) VALUES (?,?,?,?)')
      .run(`usr_${who}`, `${who}@example.test`, who, t);
    db.prepare('INSERT INTO session (token,user_id,created_at) VALUES (?,?,?)').run(TOK[who], `usr_${who}`, t);
    db.prepare('INSERT INTO agent (id,user_id,name,purpose,api_token,created_at) VALUES (?,?,?,?,?,?)')
      .run(`agt_${who}`, `usr_${who}`, `${who}.mod`, 'acts', `tok_agent_m_${who}`, t);
  }
  db.prepare(`INSERT INTO post (id,agent_id,user_id,type,lane,title,body,created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run('pst_target', 'agt_ana', 'usr_ana', 'result', 'produce', TITLE, BODY, t);
  // A citation of the post that will be removed, so the standing question is testable: ben's
  // agent built on ana's post. project → note → source → citation, the real chain.
  db.prepare('INSERT INTO project (id,user_id,name,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run('prj_ben', 'usr_ben', 'work', t, t);
  db.prepare('INSERT INTO note (id,project_id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .run('nte_ben', 'prj_ben', 'usr_ben', 'a note', t, t);
  db.prepare(`INSERT INTO source (id,note_id,user_id,post_id,author_id,title,created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run('src_ben', 'nte_ben', 'usr_ben', 'pst_target', 'usr_ana', 'ana post', t);
  db.prepare(`INSERT INTO citation (id,note_id,source_id,user_id,post_id,author_id,used_for,
                                   content_hash,cited_state,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('cit_ben', 'nte_ben', 'src_ben', 'usr_ben', 'pst_target', 'usr_ana', 'built on it',
         'deadbeef', 'live', t);
  db.close();
});

after(() => child?.kill());

describe('resolving a report', () => {
  let reportId;

  test('a report exists to resolve', async () => {
    const r = await api('/api/report', {
      method: 'POST', as: 'ben',
      body: { kind: 'post', subject: 'pst_target', reason: 'spam', detail: 'unsolicited' },
    });
    assert.equal(r.status, 200);
    reportId = rows("SELECT id FROM report WHERE subject_id = 'pst_target'")[0].id;
    assert.ok(reportId);
  });

  test('it is closed without the operator token, and to an ordinary session', async () => {
    assert.equal((await api('/api/moderation/dismiss', {
      method: 'POST', body: { report: reportId, reason: 'no' },
    })).status, 401);
    assert.equal((await api('/api/moderation/dismiss', {
      method: 'POST', as: 'ben', body: { report: reportId, reason: 'no' },
    })).status, 401, 'a signed-in person is not an operator — that is not decided in a schema');
  });

  test('an agent token is not an operator token', async () => {
    // An agent acts for a person under a mandate. No mandate carries the authority to moderate the
    // platform, so the agent surface must not reach this route at all — not even to be told why.
    const r = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ report: reportId, action: 'takedown', reason: 'x' });
      const req = request({
        host: '127.0.0.1', port: PORT, path: '/api/moderation/takedown', method: 'POST', agent: false,
        headers: {
          Authorization: 'Bearer tok_agent_m_ben',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
      }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
    assert.equal(r.status, 401);
  });

  test('a decision without a stated reason is refused', async () => {
    const r = await api('/api/moderation/takedown', {
      method: 'POST', body: { token: TOKEN, report: reportId, reason: '  ' },
    });
    assert.equal(r.status, 400, 'an unappealable decision is the thing this product is not');
  });

  test('taking it down leaves a tombstone that says an OPERATOR did it', async () => {
    const r = await api('/api/moderation/takedown', {
      method: 'POST',
      body: { token: TOKEN, report: reportId, reason: 'off-platform spam' },
    });
    assert.equal(r.status, 200);

    const seen = await api('/api/posts/pst_target', { as: 'ben' });
    assert.equal(seen.status, 200, 'a tombstone, never a 404 — 404 says the source never existed');
    assert.equal(seen.json.post.withdrawn, true);
    assert.equal(seen.json.post.takenDown, true);
    assert.equal(seen.json.post.removedBy, 'operator',
      'an author withdrawing and an operator removing are different facts');
  });

  test('the hash is of what was removed, taken before the row was emptied', async () => {
    const post = rows("SELECT title, body, body_sha256 FROM post WHERE id = 'pst_target'")[0];
    assert.equal(post.title, '', 'the content is gone, not hidden behind a flag');
    assert.equal(post.body, '');
    assert.equal(post.body_sha256,
      createHash('sha256').update(`${TITLE}\n\n${BODY}`).digest('hex'),
      'an author who kept their copy must be able to prove what was taken down');
  });

  test('the author\'s chain records it as an observation, not a verdict', async () => {
    const [receipt] = rows(
      "SELECT type, user_id, payload FROM receipt WHERE type = 'moderation.removed'");
    assert.ok(receipt, 'a moderation act with no receipt is the hole withdraw still has');
    assert.equal(receipt.type, MODERATION_ACTIONS.takedown.receipt,
      'every receipt type in this system is domain.pastParticiple — takedown was the one noun');
    assert.equal(receipt.user_id, 'usr_ana', 'it happened to the author; it is their record');
    const payload = JSON.parse(receipt.payload);
    assert.equal(payload.source, 'operator-token',
      'there is no signing key in this system — the provenance must not claim one');
    assert.equal(payload.report, reportId);
    assert.ok(payload.bodySha256);
  });

  test('the report moves to actioned and cannot be resolved twice', async () => {
    const report = rows('SELECT status, outcome, reviewed_by FROM report WHERE id = ?', reportId)[0];
    assert.equal(report.status, 'actioned');
    assert.equal(report.outcome, 'off-platform spam');
    assert.equal(report.reviewed_by, null,
      'no operator user row exists yet — leave the FK null rather than invent a reviewer');

    const again = await api('/api/moderation/takedown', {
      method: 'POST', body: { token: TOKEN, report: reportId, reason: 'again' },
    });
    assert.equal(again.status, 409);
  });

  test('it is gone from the queue, and gone from the feed', async () => {
    const queue = await api('/api/moderation/queue', { as: 'operator' });
    assert.equal(queue.json.reports.filter((x) => x.subject === 'pst_target').length, 0);

    const feed = await api('/api/feed', { as: 'ben' });
    assert.equal(feed.json.posts.filter((p) => p.id === 'pst_target').length, 0,
      'one visibility predicate hides it — a second column would mean auditing every read path');
  });

  test('there is no un-takedown — the route does not exist', async () => {
    // Reversal is a fresh publish under a new id, not a toggle. A restore would mean holding the
    // payload a takedown exists to remove, and mutating the tombstone would erase the fact that
    // something was down for three days.
    for (const path of ['restore', 'untakedown', 'reinstate', 'resolve']) {
      const r = await api(`/api/moderation/${path}`, {
        method: 'POST', body: { token: TOKEN, report: reportId, reason: 'mistake' },
      });
      assert.equal(r.status, 404, `/api/moderation/${path} must not exist`);
    }
  });
});

test('a rung that is defined but not built is not callable', () => {
  // suspend exists in the ladder so the ADR and the code use one vocabulary, and is not built. A
  // half-wired rung is worse than an absent one, so the route enum derives from this flag.
  assert.deepEqual(AVAILABLE_ACTIONS.sort(), ['dismiss', 'limit', 'takedown']);
  assert.equal(MODERATION_ACTIONS.suspend.implemented, false);
});

describe('what a removal does to standing', () => {
  test('the citing row survives the takedown — it is the citer\'s record, not the author\'s', () => {
    const [row] = rows("SELECT post_id, content_hash, author_id FROM citation WHERE id = 'cit_ben'");
    assert.ok(row, 'deleting it would be the CASCADE this schema declared RESTRICT to prevent');
    assert.equal(row.post_id, 'pst_target', 'still pointing at the tombstone, not orphaned');
    assert.equal(row.content_hash, 'deadbeef', 'and still saying what was built on');
  });

  test('but the author keeps no standing from a post the operator removed', () => {
    // Withdrawal and removal are different facts. Withdrawing your own work does not unmake that
    // somebody built on it; a post removed for breaching the standard must not keep paying its
    // author, or removal is a cost-free price for a citation farm.
    const seen = rows(
      `SELECT COUNT(DISTINCT c.user_id) c FROM citation c
         LEFT JOIN post p ON p.id = c.post_id
        WHERE c.author_id = 'usr_ana' AND p.taken_down_at IS NULL`);
    assert.equal(seen[0].c, 0, 'the removed post must not count toward ana');

    const raw = rows("SELECT COUNT(*) c FROM citation WHERE author_id = 'usr_ana'");
    assert.equal(raw[0].c, 1, 'and the row is still there — excluded from scoring, not deleted');
  });
});

describe('limit is the rung that keeps the body', () => {
  let reportId;

  test('a second report exists to act on', async () => {
    const db = new DatabaseSync(DB);
    const t = new Date().toISOString();
    db.prepare(`INSERT INTO post (id,agent_id,user_id,type,lane,title,body,created_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run('pst_quarantine', 'agt_ana', 'usr_ana', 'result', 'produce', 'borderline', 'body kept', t);
    db.close();
    const r = await api('/api/report', {
      method: 'POST', as: 'ben',
      body: { kind: 'post', subject: 'pst_quarantine', reason: 'spam', detail: 'borderline' },
    });
    assert.equal(r.status, 200);
    reportId = rows("SELECT id FROM report WHERE subject_id = 'pst_quarantine'")[0].id;
  });

  test('limiting hides the post and does NOT empty it', async () => {
    const r = await api('/api/moderation/limit', {
      method: 'POST', body: { token: TOKEN, report: reportId, reason: 'under review' },
    });
    assert.equal(r.status, 200);

    const [post] = rows("SELECT title, body, limited_at FROM post WHERE id = 'pst_quarantine'");
    assert.ok(post.limited_at);
    assert.equal(post.body, 'body kept',
      'retaining the body is the whole point — an undo that needs a shadow copy is the thing this avoids');
  });

  test('but nobody else can read it, and there is no parameter that says otherwise', async () => {
    const seen = await api('/api/posts/pst_quarantine', { as: 'ben' });
    assert.equal(seen.json.post.limited, true);
    assert.equal(seen.json.post.title, undefined, 'quarantined means the body does not leave the row');
    assert.equal(seen.json.post.body, undefined);

    const forced = await api('/api/posts/pst_quarantine?includeLimited=true', { as: 'ben' });
    assert.equal(forced.json.post.body, undefined, 'a query parameter must never reveal it');

    const feed = await api('/api/feed', { as: 'ben' });
    assert.equal(feed.json.posts.filter((p) => p.id === 'pst_quarantine').length, 0);
  });

  test('the author still sees their own, or they cannot appeal it', async () => {
    const mine = await api('/api/posts/pst_quarantine', { as: 'ana' });
    assert.equal(mine.json.post.body, 'body kept');
  });

  test('and the chain says what happened, in the ladder\'s own words', () => {
    const [receipt] = rows("SELECT type, user_id FROM receipt WHERE type = 'moderation.limited'");
    assert.ok(receipt, 'a moderation act with no receipt is not a moderation act');
    assert.equal(receipt.user_id, 'usr_ana');
  });
});

describe('a reported work can actually be acted on', () => {
  test('limiting a work hides it from others and keeps it for its author', async () => {
    // report.subject_kind has allowed 'work' since the table was written while the resolver
    // refused anything that was not a post — so a reported photograph could be filed and never
    // acted on. A work is what a PERSON publishes, which makes it the case that matters most.
    const db = new DatabaseSync(DB);
    const t = new Date().toISOString();
    db.prepare('INSERT INTO work (id,user_id,kind,title,body,created_at) VALUES (?,?,?,?,?,?)')
      .run('wrk_ana', 'usr_ana', 'photo', 'a photo', 'caption', t);
    db.close();

    const filed = await api('/api/report', {
      method: 'POST', as: 'ben',
      body: { kind: 'work', subject: 'wrk_ana', reason: 'spam', detail: 'not ok' },
    });
    assert.equal(filed.status, 200);
    const reportId = rows("SELECT id FROM report WHERE subject_id = 'wrk_ana'")[0].id;

    const acted = await api('/api/moderation/limit', {
      method: 'POST', body: { token: TOKEN, report: reportId, reason: 'under review' },
    });
    assert.equal(acted.status, 200, 'a work must be actionable, not just reportable');

    const [work] = rows("SELECT body, limited_at FROM work WHERE id = 'wrk_ana'");
    assert.ok(work.limited_at);
    assert.equal(work.body, 'caption', 'limit retains — that is what makes it reversible');

    const theirs = await api('/api/works?user=usr_ana', { as: 'ben' });
    assert.equal(theirs.json.works.filter((w) => w.id === 'wrk_ana').length, 0,
      'filtered before the row is built, so no media is attached to a hidden work');

    const mine = await api('/api/works?user=usr_ana', { as: 'ana' });
    assert.equal(mine.json.works.filter((w) => w.id === 'wrk_ana').length, 1,
      'the author sees their own, or they cannot see what they are appealing');
  });
});

describe('erasing your own work is not an exit from a review', () => {
  test('the author cannot delete a work the operator has limited', async () => {
    // Author erasure of a work is a real delete, bytes included, and that is correct — it is the
    // right to erase and nothing else references a work. But the operator rungs reached works when
    // limit learned a subject table, and without this guard an author under review could destroy
    // the thing being reviewed along with the evidence of the decision.
    const r = await api('/api/works/delete', {
      method: 'POST', as: 'ana', body: { id: 'wrk_ana' },
    });
    assert.equal(r.status, 409);

    const [still] = rows("SELECT id FROM work WHERE id = 'wrk_ana'");
    assert.ok(still, 'the work must survive the attempt');
  });

  test('an unlimited work still deletes, bytes and all', async () => {
    const db = new DatabaseSync(DB);
    db.prepare('INSERT INTO work (id,user_id,kind,title,body,created_at) VALUES (?,?,?,?,?,?)')
      .run('wrk_free', 'usr_ana', 'photo', 'mine', 'to erase', new Date().toISOString());
    db.close();

    const r = await api('/api/works/delete', { method: 'POST', as: 'ana', body: { id: 'wrk_free' } });
    assert.equal(r.status, 200, 'the right to erase is not conditional on nobody having reported anything');
    assert.equal(rows("SELECT id FROM work WHERE id = 'wrk_free'").length, 0);
  });
});

describe('withdrawing is not a way out of a review', () => {
  let reportId;

  test('an author withdraws the moment a report lands', async () => {
    const db = new DatabaseSync(DB);
    const t = new Date().toISOString();
    db.prepare(`INSERT INTO post (id,agent_id,user_id,type,lane,title,body,created_at)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run('pst_dodge', 'agt_ana', 'usr_ana', 'result', 'produce', 'dodge', 'the body', t);
    db.close();

    assert.equal((await api('/api/report', {
      method: 'POST', as: 'ben',
      body: { kind: 'post', subject: 'pst_dodge', reason: 'spam', detail: 'x' },
    })).status, 200);
    reportId = rows("SELECT id FROM report WHERE subject_id = 'pst_dodge'")[0].id;

    assert.equal((await api('/api/posts/pst_dodge/withdraw', { method: 'POST', as: 'ana' })).status, 200);
  });

  test('the operator can still act, and the record gets made', async () => {
    const r = await api('/api/moderation/takedown', {
      method: 'POST', body: { token: TOKEN, report: reportId, reason: 'spam, reviewed after withdrawal' },
    });
    assert.equal(r.status, 200,
      'a 409 here would let an author dodge the moderation record by withdrawing first');

    const [post] = rows("SELECT withdrawn_at, taken_down_at, body_sha256 FROM post WHERE id = 'pst_dodge'");
    assert.ok(post.taken_down_at, 'the operator act is recorded');
    assert.ok(post.withdrawn_at, 'and the author act is still recorded');
    assert.ok(post.body_sha256, 'the hash from the withdrawal survives — re-hashing an empty row attests to nothing');

    const [receipt] = rows(
      "SELECT payload FROM receipt WHERE type = 'moderation.removed' AND payload LIKE '%pst_dodge%'");
    assert.equal(JSON.parse(receipt.payload).alreadyWithdrawn, true,
      'the record must not read as though the operator removed something still up');
  });

  test('but a second takedown of the same post is refused', async () => {
    const again = await api('/api/moderation/takedown', {
      method: 'POST', body: { token: TOKEN, report: reportId, reason: 'again' },
    });
    assert.equal(again.status, 409);
  });
});
