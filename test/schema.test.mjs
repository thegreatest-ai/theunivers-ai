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
                   'project', 'note', 'source', 'citation', 'view', 'work', 'media']) {
    assert.ok(created.has(t), `${t} is written to but never created`);
  }
});
