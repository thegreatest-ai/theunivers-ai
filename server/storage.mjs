/**
 * File storage.
 *
 * ─── Where bytes live, and why that is a decision rather than a detail ───────────────────
 *
 * Default: the Fly volume, which has ~900MB free. That is fine for photographs and documents in a
 * pilot and WRONG FOR VIDEO AT ANY REAL SCALE — twenty-odd clips fill the disk, and serving them
 * from `bom` costs $0.12/GB, Fly's most expensive egress band.
 *
 * When R2 credentials are all set, puts go to the bucket instead of the volume. Serving still
 * goes through GET /api/media/:id on this origin: img-src is 'self', and a redirect to
 * Cloudflare's storage host would be an external image. See docs/specs/R2-MEDIA.md.
 *
 * Credentials choose the provider. There is no STORAGE_PROVIDER flag to disagree with them.
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
import * as r2 from './r2.mjs';

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

export function provider() {
  return r2.configured() ? 'r2' : 'local';
}

function absOf(rel) {
  return join(ROOT, rel);
}

function contained(abs) {
  return abs.startsWith(ROOT);
}

function localGet(rel) {
  const abs = absOf(rel);
  if (!contained(abs) || !existsSync(abs)) return null;
  return readFileSync(abs);
}

function localRemove(rel) {
  const abs = absOf(rel);
  if (contained(abs) && existsSync(abs)) unlinkSync(abs);
}

function localPut(rel, buffer) {
  const abs = absOf(rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buffer);
}

/**
 * Write bytes and return where they went.
 *
 * Sharded by the first two characters of the id: a single directory with tens of thousands of
 * files is slow to list on most filesystems, and this costs one line to avoid. The same relative
 * path is the R2 object key, so a later move does not rewrite the media row.
 */
export async function put(buffer, mime) {
  const spec = allowed(mime);
  if (!spec) throw new Error(`${mime} is not an accepted file type`);
  if (buffer.length > spec.max) {
    throw new Error(`too large — the limit for ${mime} is ${Math.round(spec.max / 1e6)}MB`);
  }
  const id = `med_${randomUUID().slice(0, 12)}`;
  const rel = `${id.slice(4, 6)}/${id}`;
  if (r2.configured()) await r2.put(rel, buffer, mime);
  else localPut(rel, buffer);
  return { id, path: rel, bytes: buffer.length, kind: spec.kind };
}

/**
 * Read bytes. Local first, so photographs uploaded before R2 was configured still resolve.
 * Then the bucket, if it is on.
 */
export async function get(rel) {
  const local = localGet(rel);
  if (local) return local;
  if (r2.configured()) return r2.get(rel);
  return null;
}

export async function remove(rel) {
  localRemove(rel);
  if (r2.configured()) await r2.remove(rel);
}

export async function sizeOf(rel) {
  const abs = absOf(rel);
  if (contained(abs) && existsSync(abs)) return statSync(abs).size;
  if (r2.configured()) {
    const bytes = await r2.get(rel);
    return bytes ? bytes.length : 0;
  }
  return 0;
}

/** How full the volume is, for /api/metrics — so the move to object storage is a warning. */
export function storageStats(usedBytes) {
  return {
    usedBytes,
    quotaPerUser: QUOTA_BYTES,
    provider: provider(),
    note: provider() === 'r2'
      ? 'R2 holds new uploads; unmigrated files remain on the volume'
      : 'local volume; set R2_* secrets to keep video off the disk — see docs/specs/R2-MEDIA.md',
  };
}
