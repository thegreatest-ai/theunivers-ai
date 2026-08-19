/**
 * Cloudflare R2, talked to as S3, with no SDK.
 *
 * Signature Version 4 is HMAC-SHA256 over a canonical string. node:crypto already does that.
 * An AWS client would end the zero-dependency property for a convenience, and this server has
 * no dependencies on purpose.
 *
 * Region is `auto` — that is what R2's S3 API expects, not `us-east-1`.
 *
 * The PAGE never talks to this host. Puts and gets are server-side. Serving still goes through
 * GET /api/media/:id on our origin, because img-src is 'self' and a 302 to
 * *.r2.cloudflarestorage.com would be an external image — see docs/specs/R2-MEDIA.md.
 */
import { createHash, createHmac } from 'node:crypto';

export function r2Credentials() {
  const accountId = String(process.env.R2_ACCOUNT_ID ?? '').trim();
  const accessKey = String(process.env.R2_ACCESS_KEY_ID ?? '').trim();
  const secret = String(process.env.R2_SECRET_ACCESS_KEY ?? '').trim();
  const bucket = String(process.env.R2_BUCKET ?? '').trim();
  if (!accountId || !accessKey || !secret || !bucket) return null;
  const endpoint = String(process.env.R2_ENDPOINT ?? '').trim().replace(/\/$/, '')
    || `https://${accountId}.r2.cloudflarestorage.com`;
  return { accountId, accessKey, secret, bucket, endpoint };
}

export function configured() {
  return r2Credentials() != null;
}

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function amzDate(at) {
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function encodeKey(key) {
  return String(key).split('/').map(encodeURIComponent).join('/');
}

/**
 * Headers that authenticate one request. Exported so a test can pin a signature without
 * standing up a bucket.
 */
export function signedHeaders({ method, url, bodyHash, extra = {}, at = new Date(), credentials }) {
  const creds = credentials ?? r2Credentials();
  if (!creds) throw new Error('R2 is not configured');
  const u = new URL(url);
  const amz = amzDate(at);
  const datestamp = amz.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const scope = `${datestamp}/${region}/${service}/aws4_request`;

  const headers = {
    host: u.host,
    'x-amz-content-sha256': bodyHash,
    'x-amz-date': amz,
    ...extra,
  };

  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const signed = names.join(';');
  const canonicalHeaders = names.map((n) => {
    const key = Object.keys(headers).find((k) => k.toLowerCase() === n);
    return `${n}:${String(headers[key]).trim()}\n`;
  }).join('');

  const query = [...u.searchParams.entries()]
    .sort((a, b) => a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const canonical = [
    method, u.pathname, query, canonicalHeaders, signed, bodyHash,
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amz, scope, sha256Hex(canonical)].join('\n');
  const kDate = hmac(`AWS4${creds.secret}`, datestamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  return headers;
}

function objectUrl(key, creds) {
  return `${creds.endpoint}/${encodeURIComponent(creds.bucket)}/${encodeKey(key)}`;
}

async function call(method, key, { body, mime } = {}) {
  const creds = r2Credentials();
  if (!creds) throw new Error('R2 is not configured');
  const payload = body ?? Buffer.alloc(0);
  const bodyHash = sha256Hex(payload);
  const url = objectUrl(key, creds);
  const extra = {};
  if (mime && method === 'PUT') extra['content-type'] = mime;
  const headers = signedHeaders({ method, url, bodyHash, extra, credentials: creds });
  const res = await fetch(url, {
    method,
    headers,
    body: method === 'PUT' ? payload : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  return res;
}

export async function put(key, buffer, mime) {
  const res = await call('PUT', key, { body: buffer, mime });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 put failed (${res.status}): ${text.slice(0, 180)}`);
  }
}

export async function get(key) {
  const res = await call('GET', key);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 get failed (${res.status}): ${text.slice(0, 180)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function remove(key) {
  const res = await call('DELETE', key);
  if (res.status === 404 || res.ok) return;
  const text = await res.text().catch(() => '');
  throw new Error(`R2 remove failed (${res.status}): ${text.slice(0, 180)}`);
}
