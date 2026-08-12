/**
 * The MIGRATION, not the end state.
 *
 * `withdraw.test.mjs` builds a fresh database, which gets the foreign keys straight from the
 * CREATE TABLE — so it never exercises `ensureForeignKeys()` at all. Production is the other case:
 * a database that already exists, with `source` and `citation` in the old bare shape and rows in
 * them. The rebuild is the part that can lose data, so it is the part that needs a test.
 *
 * This builds the OLD shape by hand, fills it, then imports `server/db.mjs` — which runs the
 * migration on load — and checks that the constraints arrived and the rows did not move.
 *
 * The parent tables are created here with only the columns this test needs. They use
 * `IF NOT EXISTS` in db.mjs, so whatever is created first wins; that is deliberate, and it is why
 * this file asserts nothing about their shape.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `withdraw-migration-${process.pid}.db`);
process.on('exit', () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f); } catch { /* never ran */ } }
});

const now = () => new Date().toISOString();
let mod;

before(async () => {
  // ── the database as it existed before ADR-0003 ──────────────────────────────────────────
  const old = new DatabaseSync(DB);
  old.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
                       kind TEXT NOT NULL DEFAULT 'individual',
                       jurisdiction TEXT NOT NULL DEFAULT 'IN', created_at TEXT NOT NULL);
    CREATE TABLE agent (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES user(id),
                        name TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'live',
                        api_token TEXT NOT NULL UNIQUE, skills TEXT NOT NULL DEFAULT '[]',
                        created_at TEXT NOT NULL);
    CREATE TABLE post (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent(id),
                       user_id TEXT NOT NULL REFERENCES user(id), type TEXT NOT NULL,
                       lane TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
                       referent TEXT, created_at TEXT NOT NULL);
    CREATE TABLE project (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id),
                          name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE note (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id),
                       user_id TEXT NOT NULL REFERENCES user(id), title TEXT NOT NULL,
                       body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'captured',
                       created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

    -- THE OLD SHAPE: post_id and author_id reference nothing at all.
    CREATE TABLE source (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES note(id),
                         user_id TEXT NOT NULL REFERENCES user(id), post_id TEXT, author_id TEXT,
                         title TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL DEFAULT '',
                         used_for TEXT NOT NULL DEFAULT '', url TEXT, created_at TEXT NOT NULL);
    CREATE TABLE citation (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES note(id),
                           source_id TEXT NOT NULL REFERENCES source(id),
                           user_id TEXT NOT NULL REFERENCES user(id), post_id TEXT, author_id TEXT,
                           used_for TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
  `);

  const t = now();
  old.prepare('INSERT INTO user VALUES (?,?,?,?,?,?)').run('usr_a', 'a@example.test', 'author', 'individual', 'AE', t);
  old.prepare('INSERT INTO user VALUES (?,?,?,?,?,?)').run('usr_b', 'b@example.test', 'citer', 'individual', 'AE', t);
  old.prepare('INSERT INTO agent VALUES (?,?,?,?,?,?,?,?)').run('agt_a', 'usr_a', 'author.one', 'acts', 'live', 'tok_a', '[]', t);
  old.prepare('INSERT INTO post VALUES (?,?,?,?,?,?,?,?,?)').run('pst_1', 'agt_a', 'usr_a', 'result', 'produce', 'A title', 'A body', null, t);
  old.prepare('INSERT INTO project VALUES (?,?,?,?,?)').run('prj_1', 'usr_b', 'Project 1', t, t);
  old.prepare('INSERT INTO note VALUES (?,?,?,?,?,?,?,?)').run('not_1', 'prj_1', 'usr_b', 'What I read', '', 'captured', t, t);
  old.prepare('INSERT INTO source VALUES (?,?,?,?,?,?,?,?,?,?)').run('src_1', 'not_1', 'usr_b', 'pst_1', 'usr_a', 'A title', 'excerpt', '', null, t);
  old.prepare('INSERT INTO source VALUES (?,?,?,?,?,?,?,?,?,?)').run('src_2', 'not_1', 'usr_b', null, null, 'A web page', '', '', 'https://example.test/x', t);
  old.prepare('INSERT INTO citation VALUES (?,?,?,?,?,?,?,?)').run('cit_1', 'not_1', 'src_1', 'usr_b', 'pst_1', 'usr_a', 'the entry rule', t);
  old.close();

  // ── now boot the real db module against it; the migration runs on import ────────────────
  process.env.DB_PATH = DB;
  mod = await import('../server/db.mjs');
});

describe('migrating a database that already exists', () => {
  test('the foreign keys arrive on both tables', () => {
    for (const table of ['source', 'citation']) {
      const fks = mod.db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
      for (const col of ['post_id', 'author_id']) {
        const fk = fks.find((f) => f.from === col);
        assert.ok(fk, `${table}.${col} should now reference something`);
        assert.equal(fk.on_delete, 'RESTRICT', `${table}.${col} should be RESTRICT`);
      }
    }
  });

  test('every row survived the rebuild, with its values intact', () => {
    const src = mod.one('SELECT * FROM source WHERE id = ?', 'src_1');
    assert.equal(src.post_id, 'pst_1');
    assert.equal(src.author_id, 'usr_a');
    assert.equal(src.title, 'A title');
    assert.equal(src.excerpt, 'excerpt');

    const url = mod.one('SELECT * FROM source WHERE id = ?', 'src_2');
    assert.equal(url.post_id, null, 'a source with no post must survive as NULL, not vanish');
    assert.equal(url.url, 'https://example.test/x');

    const cit = mod.one('SELECT * FROM citation WHERE id = ?', 'cit_1');
    assert.equal(cit.post_id, 'pst_1');
    assert.equal(cit.used_for, 'the entry rule');

    assert.equal(mod.all('SELECT id FROM source').length, 2);
    assert.equal(mod.all('SELECT id FROM citation').length, 1);
  });

  test('the indexes were recreated — dropping a table takes its indexes with it', () => {
    const names = mod.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all().map((r) => r.name);
    for (const ix of ['source_note_idx', 'source_author_idx', 'citation_post_idx', 'citation_author_idx']) {
      assert.ok(names.includes(ix), `${ix} must exist after the rebuild`);
    }
  });

  test('integrity is clean and enforcement is back ON', () => {
    assert.deepEqual(mod.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(mod.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1,
      'the rebuild turns enforcement off; leaving it off would disable it for the whole process');
  });

  test('the constraint now bites: the delete that used to orphan silently raises', () => {
    assert.throws(() => mod.run('DELETE FROM post WHERE id = ?', 'pst_1'), /FOREIGN KEY|constraint/i);
    assert.ok(mod.one('SELECT id FROM citation WHERE id = ?', 'cit_1'), 'the citation is untouched');
  });

  test('withdrawal still works on a migrated row', () => {
    mod.run(`UPDATE post SET withdrawn_at = ?, title = '', body = '' WHERE id = ?`, now(), 'pst_1');
    const p = mod.one('SELECT * FROM post WHERE id = ?', 'pst_1');
    assert.ok(p.withdrawn_at);
    assert.equal(p.title, '');
    assert.ok(mod.one('SELECT * FROM citation WHERE id = ?', 'cit_1'), 'and the citation still resolves');
  });
});
