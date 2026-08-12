/**
 * Writing a citation, in one place.
 *
 * There were two inserts — `/api/agent/cite` and the analyse runner — carrying the same self-cite
 * rule as two copies of the same comment. That is how a rule drifts: one path gains a column and
 * the other quietly writes NULL into it, and the difference only shows up as a record that cannot
 * be verified months later. Both now call this.
 */
import { createHash, randomUUID } from 'node:crypto';
import { one, run } from './db.mjs';

const now = () => new Date().toISOString();

/**
 * What a post said, hashed. Title and body exactly as they were served.
 *
 * Used in two places for the same reason: a citation binds it at the moment of citing, and a
 * withdrawal or takedown records it immediately before emptying the row. Either way the bytes stop
 * being available and the hash is what remains to argue against.
 */
export const postDigest = (p) => createHash('sha256').update(`${p.title}\n\n${p.body}`).digest('hex');

/** What the cited post was when it was cited. Bound once; never recomputed against live state. */
function stateOf(post) {
  if (!post) return 'unknown';
  if (!post.withdrawn_at) return 'live';
  return post.taken_down_at ? 'removed' : 'withdrawn';
}

/**
 * Record that somebody's agent built on a source.
 *
 * `content_hash` and `cited_state` are bound HERE, at insert. A post that is later withdrawn or
 * taken down leaves this row still saying what was built on — the citer's evidence does not depend
 * on the author's continued consent, and nothing downstream needs recomputing when a root
 * disappears. It is also why no dependency walk belongs in chain verification: the fact is already
 * in the row.
 *
 * Self-citation is recorded and earns nothing: the row is written so the note's provenance stays
 * complete, with `author_id` nulled so it cannot raise its own author's count.
 */
export function insertCitation({ noteId, source, userId, usedFor }) {
  const id = `cit_${randomUUID().slice(0, 8)}`;
  const cited = source.post_id ? one('SELECT * FROM post WHERE id = ?', source.post_id) : null;
  const selfCite = source.author_id === userId;

  run(`INSERT INTO citation (id, note_id, source_id, user_id, post_id, author_id, used_for,
                             content_hash, cited_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, noteId, source.id, userId, source.post_id,
      selfCite ? null : source.author_id,
      String(usedFor ?? '').slice(0, 200),
      // A post already emptied carries its digest in body_sha256; a live one is hashed now.
      cited && !cited.withdrawn_at ? postDigest(cited) : (cited?.body_sha256 ?? null),
      stateOf(cited),
      now());

  return id;
}
