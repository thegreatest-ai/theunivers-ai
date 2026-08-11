/**
 * File storage.
 *
 * ─── Where bytes live, and why that is a decision rather than a detail ───────────────────
 *
 * Today: the Fly volume, which has ~900MB free. That is fine for photographs and documents in a
 * pilot and WRONG FOR VIDEO AT ANY REAL SCALE — twenty-odd clips fill the disk, and serving them
 * from `bom` costs $0.12/GB, Fly's most expensive egress band. The same bytes on Cloudflare R2
 * cost nothing to serve.
 *
 * So this is written as a provider with one implementation. Moving to R2 or Tigris means adding a
 * second `put`/`get`/`remove` and changing nothing else. The quota below exists to make the day we
 * must move arrive as a warning rather than as a full disk.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 *
 * TWO RULES THAT ARE SECURITY, NOT HOUSEKEEPING:
 *
 *   1. The allowlist excludes SVG and HTML. Both can carry script, and a file served from our own
 *      origin runs with our origin's privileges — an uploaded SVG is a stored XSS with a friendly
 *      extension. Images that cannot execute, video, and PDF only.
 *
 *   2. The user's filename never touches the filesystem. Files are stored under a generated id;
 *      the original name is a column. Path traversal stops being a class of bug rather than a bug
 *      to remember to prevent.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = process.env.MEDIA_PATH
  ?? join(dirname(process.env.DB_PATH ?? './data/pilot.db'), 'media');

/** What may be uploaded, and how big. Sized against a 900MB volume, not against ambition. */
export const LIMITS = {
  'image/jpeg': { max: 6_000_000, kind: 'image' },
  'image/png': { max: 6_000_000, kind: 'image' },
  'image/webp': { max: 6_000_000, kind: 'image' },
  'image/heic': { max: 8_000_000, kind: 'image' },   // what an iPhone actually produces
  'video/mp4': { max: 40_000_000, kind: 'video' },
  'video/quicktime': { max: 40_000_000, kind: 'video' },
  'application/pdf': { max: 15_000_000, kind: 'doc' },
  'text/plain': { max: 1_000_000, kind: 'doc' },
  'text/markdown': { max: 1_000_000, kind: 'doc' },
};

/** Per person, so one enthusiastic uploader cannot take the volume from everyone else. */
export const QUOTA_BYTES = 120_000_000;

export function allowed(mime) {
  return LIMITS[String(mime ?? '').split(';')[0].trim().toLowerCase()] ?? null;
}

/**
 * Write bytes and return where they went.
 *
 * Sharded by the first two characters of the id: a single directory with tens of thousands of
 * files is slow to list on most filesystems, and this costs one line to avoid.
 */
export function put(buffer, mime) {
  const spec = allowed(mime);
  if (!spec) throw new Error(`${mime} is not an accepted file type`);
  if (buffer.length > spec.max) {
    throw new Error(`too large — the limit for ${mime} is ${Math.round(spec.max / 1e6)}MB`);
  }
  const id = `med_${randomUUID().slice(0, 12)}`;
  const rel = join(id.slice(4, 6), id);
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
  return { id, path: rel, bytes: buffer.length, kind: spec.kind };
}

export function get(rel) {
  const abs = join(ROOT, rel);
  // A stored path is generated, never user input — but a containment check costs nothing and
  // makes that guarantee independent of every future caller remembering it.
  if (!abs.startsWith(ROOT) || !existsSync(abs)) return null;
  return readFileSync(abs);
}

export function remove(rel) {
  const abs = join(ROOT, rel);
  if (abs.startsWith(ROOT) && existsSync(abs)) unlinkSync(abs);
}

export function sizeOf(rel) {
  const abs = join(ROOT, rel);
  return abs.startsWith(ROOT) && existsSync(abs) ? statSync(abs).size : 0;
}

/** How full the volume is, for /api/metrics — so the move to object storage is a warning. */
export function storageStats(usedBytes) {
  return {
    usedBytes,
    quotaPerUser: QUOTA_BYTES,
    note: 'local volume; video at scale needs object storage — see server/storage.mjs',
  };
}
