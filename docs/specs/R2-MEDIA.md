# R2 media: video is what fills the volume

_Branch: `cursor/r2-media-475b`._

The Fly volume is ~900MB and the database shares it. Eight people at the 120MB quota fill it;
so do ~22 videos. Serving those bytes from `bom` costs $0.12/GB. Cloudflare R2 stores cheaply
and egresses for nothing. `server/storage.mjs` was written as a provider with one implementation
so this is `put` / `get` / `remove`, not a rewrite. See `docs/specs/SCALING.md` §2.

**This does not turn R2 on in production.** Credentials are unset, like GitHub OAuth. The volume
stays the default. The code is finished so the day video is used in earnest is a secret, not a
rewrite.

## What exists — do not invent a parallel store

Read first: `server/storage.mjs`, `GET /api/media/:id` in `server/index.mjs`, `shared/csp.mjs`,
`docs/SECURITY.md` (inline, `nosniff`, `no-store`, ten-minute signature), SCALING.md §2.

Three call sites: work upload, avatar upload, inspection evidence. Quota and the MIME allowlist
do not move. SVG and HTML stay refused.

## THE DECISIONS

**1. Credentials choose the provider. There is no `STORAGE_PROVIDER` flag.** Same shape as mail:
if `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` are all set, puts
go to R2. If any is missing, the volume. A flag that can disagree with the credentials is a
second source of truth.

**2. Serve from our origin. Do not redirect the browser to R2.** SCALING.md wants a 302 to a
presigned URL so Fly does not pay egress. That is the right cost model and it is refused **while
`img-src` is `'self'`**. A redirect to `*.r2.cloudflarestorage.com` is an external host on the
page — the same class of hole as a Google picture URL. Do not add Cloudflare's storage host to
the CSP to make the 302 work.

The server fetches from R2 and returns the bytes on `/api/media/:id`, with the headers
SECURITY.md already promises (`nosniff`, `content-disposition: inline`, `cache-control: private,
no-store`). Disk is what twenty clips fill; that is what this slice fixes. A first-party media
hostname (`media.theunivers.ai`) plus a CSP allow of that host is a later move, not this one.

**3. No SDK.** S3 signature v4 is HMAC-SHA256 over a canonical string. `node:crypto` already
does that; an AWS client would end the zero-dependency property for a convenience.

**4. Old files stay readable.** A put after R2 is configured writes only to the bucket, so the
volume does not keep filling. `get` reads the volume first, then R2 — unmigrated photographs
keep working. `remove` attempts both. Do not copy the volume into the bucket in this slice.

**5. Do not invent credentials, and do not put them in `fly.toml`.** Secrets go through
`npm run secret`. Tests use `R2_ENDPOINT` against a fake server. Do not deploy.

## Build

### Shared surface
- `put` / `get` / `remove` become async. Local is still files; R2 is `fetch`.
- `store.provider()` is `'r2'` or `'local'`. `/api/metrics` `scale.volume` reports it.

### R2
- `server/r2.mjs` — Sig v4, region `auto`, service `s3`. Optional `R2_ENDPOINT` for tests.

### Call sites
- `GET /api/media/:id` stays same-origin and becomes `async`.
- Work media, avatar, inspection evidence, withdraw/erase `await` the store.

## Tests
- Unset credentials: still the volume, existing upload tests pass.
- One missing env var is not R2.
- Sig v4 is stable for a fixed clock and payload.
- Against a fake S3: put, get, remove; GET `/api/media/:id` still `nosniff` + `inline` + same origin.
- CSP still has no `r2.cloudflarestorage.com`.
- A file that exists only on the local path is still served when R2 is configured.

## Done
`npm run build && npm test` green. Do not deploy. Do not touch `.env`.
