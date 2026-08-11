/**
 * Schema hygiene.
 *
 * A backtick inside a SQL comment terminates the template literal it lives in, and the server then
 * fails to start with "missing ) after argument list" — a message that points at the closing
 * paren rather than at the comment. I have introduced this bug twice, which makes it a category
 * rather than an accident.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'db.mjs'), 'utf8');

test('no backticks inside a db.exec template literal', () => {
  /*
   * The check has to be written carefully, and my first two attempts were not.
   *
   * A scanner that searches for the "closing" backtick and then looks INSIDE for backticks can
   * never find one — the stray backtick IS the closing one it found. So instead: the literal must
   * end at `); and nowhere else. If the first backtick after db.exec(` is not immediately followed
   * by ); then something inside terminated the string early.
   */
  const offenders = [];
  const OPEN = 'db.exec(`';
  let i = 0;
  for (;;) {
    const start = SRC.indexOf(OPEN, i);
    if (start === -1) break;
    const from = start + OPEN.length;
    const first = SRC.indexOf('`', from);
    const proper = SRC.indexOf('`);', from);
    if (first !== proper) {
      offenders.push(`line ${SRC.slice(0, first).split('\n').length}: ` +
                     SRC.split('\n')[SRC.slice(0, first).split('\n').length - 1].trim().slice(0, 60));
      i = first + 1;
    } else {
      i = proper + 3;
    }
  }
  assert.deepEqual(offenders, [],
    'a backtick ends the SQL string early — write comments inside db.exec as prose, not markdown');
});

test('every table the app writes to is created somewhere', () => {
  const created = new Set(
    [...SRC.matchAll(/CREATE TABLE IF NOT EXISTS "?(\w+)"?/g)].map((m) => m[1]));
  for (const t of ['user', 'agent', 'mandate', 'receipt', 'order', 'proposal',
                   'project', 'note', 'source', 'citation', 'view', 'work', 'media',
                   'message', 'agent_message', 'mandate_audit']) {
    assert.ok(created.has(t), `${t} is written to but never created`);
  }
});

test('the feed has an index to order by, and does not sort the whole table', () => {
  /*
   * Not a style preference. /api/feed is ORDER BY created_at DESC LIMIT 50, and without an index
   * SQLite reads every post into a temp B-tree to return fifty of them. Measured on this schema:
   * 28.63ms at 50,000 posts against 0.10ms with the index — and the cost grows with the table, so
   * the absence turns into an outage rather than a slow page. Asserted because nothing else would
   * notice it coming back: the query keeps working, it just gets slower every week.
   */
  assert.match(SRC, /CREATE INDEX IF NOT EXISTS post_recent_idx ON post\(created_at DESC\)/,
    'post(created_at DESC) is what keeps the feed from scanning the whole post table');
});
