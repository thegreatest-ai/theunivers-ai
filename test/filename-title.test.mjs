/**
 * A filename is not a caption.
 *
 * The composer used to pre-fill Title from the file. Eight works in production still carry
 * one. This is the boot migration that blanks those titles. Nothing is lost: the filename
 * stays on media.filename. An empty title is honest; a generated caption would be inventing
 * evidence. See docs/specs/CONTENT-IDENTITY.md §1.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

const DB = join(tmpdir(), `filename-title-${process.pid}.db`);
process.env.DB_PATH = DB;
process.on('exit', () => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) { try { rmSync(f); } catch { /* never ran */ } }
});

const { blankFilenameTitles, one, run } = await import('../server/db.mjs');

const now = () => new Date().toISOString();

function seed({ id, title, filename }) {
  const uid = `usr_${id}`;
  run('INSERT OR IGNORE INTO user (id, email, name, created_at) VALUES (?,?,?,?)',
    uid, `${uid}@example.test`, id, now());
  run(`INSERT INTO work (id, user_id, kind, title, body, shareable, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    `wrk_${id}`, uid, 'photo', title, '', 1, now());
  run(`INSERT INTO media (id, work_id, user_id, mime, kind, bytes, path, filename, ordinal, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    `med_${id}`, `wrk_${id}`, uid, 'image/jpeg', 'image', 12, `xx/${id}`, filename, 0, now());
}

describe('a title that is just the filename is blanked, and the filename stays', () => {
  test('an exact match is emptied and media.filename is untouched', () => {
    seed({ id: 'exact', title: 'IMG_6551.jpeg', filename: 'IMG_6551.jpeg' });
    blankFilenameTitles();
    const work = one('SELECT title FROM work WHERE id = ?', 'wrk_exact');
    const media = one('SELECT filename FROM media WHERE id = ?', 'med_exact');
    assert.equal(work.title, '', 'the camera\'s name is not a caption');
    assert.equal(media.filename, 'IMG_6551.jpeg', 'nothing is lost — the file still has its name');
  });

  test('a percent-encoded upload header still matches the human filename', () => {
    seed({ id: 'enc', title: 'Farida Baharoon CV.pdf', filename: 'Farida%20Baharoon%20CV.pdf' });
    blankFilenameTitles();
    assert.equal(one('SELECT title FROM work WHERE id = ?', 'wrk_enc').title, '');
    assert.equal(one('SELECT filename FROM media WHERE id = ?', 'med_enc').filename,
      'Farida%20Baharoon%20CV.pdf');
  });

  test('a title the author actually wrote is left alone', () => {
    seed({ id: 'real', title: 'The harbour at dusk', filename: 'IMG_0091.jpeg' });
    blankFilenameTitles();
    assert.equal(one('SELECT title FROM work WHERE id = ?', 'wrk_real').title, 'The harbour at dusk');
  });

  test('the second boot is a no-op — empty stays empty', () => {
    seed({ id: 'twice', title: 'shot.png', filename: 'shot.png' });
    blankFilenameTitles();
    blankFilenameTitles();
    assert.equal(one('SELECT title FROM work WHERE id = ?', 'wrk_twice').title, '');
  });
});
