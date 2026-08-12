/**
 * ADR-0003 — a post is withdrawn, never deleted.
 *
 * Two halves have to hold, and they are different kinds of claim.
 *
 * The CONSTRAINT half is permanent: `source.post_id`, `source.author_id`, `citation.post_id` and
 * `citation.author_id` carried no foreign key at all, so a deleted post left citations of it
 * pointing at nothing and said nothing about it. That is the failure this product cannot afford —
 * a reference that looks intact and resolves to nothing — and it was hit for real on 2026-08-12.
 * These tests assert the database now REFUSES it rather than trusting every future caller to
 * remember.
 *
 * The BEHAVIOUR half is what a person experiences: a withdrawn post leaves the feed, and a citation
 * of it still resolves to a tombstone rather than a 404, because a 404 tells the citer their source
 * never existed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `withdraw-test-${process.pid}.db`);
process.env.DB_PATH = DB;
process.on('exit', () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f); } catch { /* never ran */ } }
});

const { db, one, all, run } = await import('../server/db.mjs');

const now = () => new Date().toISOString();
let n = 0;

/** A post with a real author, agent, project, note and a citation of it by a SECOND person. */
function scenario() {
  const k = `w${++n}`;
  const author = `usr_${k}_author`;
  const citer = `usr_${k}_citer`;
  for (const [id, name] of [[author, 'the author'], [citer, 'the citer']]) {
    run('INSERT INTO user (id, email, name, created_at) VALUES (?,?,?,?)',
      id, `${id}@example.test`, name, now());
  }
  run(`INSERT INTO agent (id, user_id, name, purpose, api_token, created_at) VALUES (?,?,?,?,?,?)`,
    `agt_${k}`, author, `author.${k}`, 'acts on my behalf', `tok_${k}`, now());
  run(`INSERT INTO post (id, agent_id, user_id, type, lane, title, body, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    `pst_${k}`, `agt_${k}`, author, 'result', 'produce', 'How I set buy and sell points',
    'Entry when the 20-day crosses the 50-day.', now());

  run('INSERT INTO project (id, user_id, name, created_at, updated_at) VALUES (?,?,?,?,?)',
    `prj_${k}`, citer, 'Project 1', now(), now());
  run(`INSERT INTO note (id, project_id, user_id, title, body, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    `not_${k}`, `prj_${k}`, citer, 'What I read', '', 'captured', now(), now());
  run(`INSERT INTO source (id, note_id, user_id, post_id, author_id, title, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    `src_${k}`, `not_${k}`, citer, `pst_${k}`, author, 'How I set buy and sell points', now());
  run(`INSERT INTO citation (id, note_id, source_id, user_id, post_id, author_id, used_for, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    `cit_${k}`, `not_${k}`, `src_${k}`, citer, `pst_${k}`, author, 'the entry rule', now());

  return { k, author, citer, post: `pst_${k}`, source: `src_${k}`, citation: `cit_${k}` };
}

describe('the constraint', () => {
  test('foreign keys are declared on all four previously-bare references', () => {
    const declared = (table) =>
      new Set(db.prepare(`PRAGMA foreign_key_list("${table}")`).all().map((f) => f.from));

    for (const col of ['post_id', 'author_id']) {
      assert.ok(declared('source').has(col), `source.${col} must reference something`);
      assert.ok(declared('citation').has(col), `citation.${col} must reference something`);
    }
  });

  test('they are RESTRICT, not CASCADE — deleting a cited post must not erase the citation', () => {
    for (const t of ['source', 'citation']) {
      for (const f of db.prepare(`PRAGMA foreign_key_list("${t}")`).all()) {
        if (f.from === 'post_id' || f.from === 'author_id') {
          assert.equal(f.on_delete, 'RESTRICT', `${t}.${f.from} must be RESTRICT, got ${f.on_delete}`);
        }
      }
    }
  });

  test('foreign key enforcement is actually ON', () => {
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  });

  test('a hard DELETE of a cited post RAISES instead of orphaning it silently', () => {
    const s = scenario();
    assert.throws(
      () => run('DELETE FROM post WHERE id = ?', s.post),
      /FOREIGN KEY|constraint/i,
      'this is the exact delete that silently orphaned a citation on 2026-08-12',
    );
    // and nothing moved
    assert.ok(one('SELECT id FROM post WHERE id = ?', s.post), 'the post must still be there');
    assert.ok(one('SELECT id FROM citation WHERE id = ?', s.citation), 'the citation must survive');
  });

  test('a hard DELETE of a cited author raises too', () => {
    const s = scenario();
    assert.throws(() => run('DELETE FROM user WHERE id = ?', s.author), /FOREIGN KEY|constraint/i);
  });

  test('the database has no dangling references', () => {
    scenario();
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  test('a source with no post — a plain URL — is still allowed', () => {
    const s = scenario();
    run(`INSERT INTO source (id, note_id, user_id, post_id, author_id, title, url, created_at)
         VALUES (?,?,?,NULL,NULL,?,?,?)`,
      `src_${s.k}_url`, `not_${s.k}`, s.citer, 'A page on the web', 'https://example.test/x', now());
    assert.ok(one('SELECT id FROM source WHERE id = ?', `src_${s.k}_url`));
  });
});

describe('withdrawal', () => {
  /** What POST /api/posts/:id/withdraw writes — kept identical to the route on purpose. */
  const withdraw = (id) =>
    run(`UPDATE post SET withdrawn_at = ?, title = '', body = '', referent = NULL WHERE id = ?`,
      now(), id);

  test('the row survives, and its content does not', () => {
    const s = scenario();
    withdraw(s.post);
    const p = one('SELECT * FROM post WHERE id = ?', s.post);
    assert.ok(p, 'the row must survive so a citation still resolves');
    assert.ok(p.withdrawn_at, 'withdrawn_at must be stamped');
    assert.equal(p.title, '', 'the title must be gone from the database, not hidden by the client');
    assert.equal(p.body, '', 'the body must be gone from the database');
  });

  test('a withdrawn post leaves the feed, and a live one stays', () => {
    const live = scenario();
    const gone = scenario();
    withdraw(gone.post);

    // The same filter the feed and Discover apply.
    const visible = all('SELECT id FROM post WHERE withdrawn_at IS NULL').map((p) => p.id);
    assert.ok(visible.includes(live.post), 'a live post must remain visible');
    assert.ok(!visible.includes(gone.post), 'a withdrawn post must not be rankable');
  });

  test('the citation survives withdrawal — it is the citer\'s record, not the author\'s', () => {
    const s = scenario();
    withdraw(s.post);

    const cit = one('SELECT * FROM citation WHERE id = ?', s.citation);
    assert.ok(cit, 'the citation must survive');
    assert.equal(cit.post_id, s.post, 'and must still resolve to the post');
    assert.equal(cit.used_for, 'the entry rule', 'what was taken from it is unchanged');

    const src = one('SELECT * FROM source WHERE id = ?', s.source);
    assert.ok(src, 'the citer\'s source row must survive too');
  });

  test('a withdrawn post is a tombstone, not a 404 — the row is findable and says so', () => {
    const s = scenario();
    withdraw(s.post);
    const p = one('SELECT * FROM post WHERE id = ?', s.post);
    assert.ok(p && p.withdrawn_at,
      'a citer following their source must reach something that says withdrawn, ' +
      'not a 404 that says it never existed');
  });

  test('withdrawal is not deletion: the post count does not drop', () => {
    const before = one('SELECT COUNT(*) c FROM post').c;
    const s = scenario();
    withdraw(s.post);
    assert.equal(one('SELECT COUNT(*) c FROM post').c, before + 1);
  });
});
