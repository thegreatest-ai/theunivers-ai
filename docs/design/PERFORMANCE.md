# Performance — what was measured, and what changed

Scope: how many bytes leave the machine, and how long the front end takes to become useful.
`OPERATIONS.md` carries the cost model these numbers feed; `SECURITY.md` owns the media headers
that had to survive all of this untouched.

Every figure below was produced by `npm run perf` (`scripts/perf-measure.mjs`) on the commit that
contains this file. Nothing here is estimated, and nothing is described as "faster" without the
number underneath it.

---

## Method

```bash
npm run perf                    # build, weigh the chunks, boot the server, measure the wire
npm run perf -- --json          # the same as data, for diffing two runs
npm test                        # test/serving.test.mjs asserts these properties still hold
```

Three separate measurements, because three different things were wrong:

**1. What the bundle weighs.** Taken from rollup's own output rather than by parsing files,
because only rollup knows which imports are *static* (paid on arrival) and which are *dynamic*
(paid on navigation). That distinction is the whole route-splitting question.

**2. What each route costs cold.** The static-import closure from the entry chunk, plus the chunk
containing the route's own component, plus the CSS Vite splits out alongside it, plus `index.html`.

**3. What actually crosses the network.** The probe uses `node:http`, not `fetch`, on purpose:
`fetch` transparently decompresses, so it reports the size of what the browser ends up with rather
than the size of what was sent. Those two numbers differed by 4x here, and that gap was the single
largest finding.

**Compression figures are brotli quality 9.** Measured on this bundle: q11 gives 287KB but blocks
the event loop for 1706ms, q9 gives 316KB in 41ms. The server caches the compressed result, so the
cost is paid once per file per process either way — the only thing the extra 28KB buys is a 1.7s
stall for whoever arrives first after a deploy.

---

## Before and after

Bytes on the wire for one cold visit, no warm cache, client advertising `gzip, br`.

| | Before | After | |
|---|---|---|---|
| **`/app` — HTML, JS, CSS, favicon** | **1407KB** | **64KB** | −95% |
| `/` — HTML, JS, CSS, favicon | 1407KB | 295KB | −79% |
| `/` including both marketing plates | 3219KB | 2107KB | −35% |
| Entry JavaScript alone | 1228KB | 239KB | −81% |
| Return visit, nothing changed | 1407KB again | ~1KB of 304s | −99.9% |

The `/app` line is the one that mattered. It is the screen someone works on, and it was downloading
1.4MB — of which 1.2MB was the marketing site's 3D engine — to render a list of deals.

Bundle shape either side:

| | Before | After |
|---|---|---|
| JS chunks | 1 | 23 |
| Largest chunk | 1228KB | 973KB (`App`, marketing only, lazy) |
| Shared entry | — | 51KB brotli |
| 3D modules reachable from `/app` | 35 | 0 |

---

## What was actually wrong

### 1. The server compressed nothing at all

The largest single finding, and the one that no build output could have shown.

`vite build` prints a `gzip:` column — 353KB for this bundle — and both `OPERATIONS.md` and the
project's shared understanding had taken that as the shipped figure. It is not a measurement of
this server. It is an estimate of what *a* compressing server would send, and `server/index.mjs`
compressed nothing:

```
curl -H 'Accept-Encoding: gzip, br' → 1,258,023 bytes, no Content-Encoding
```

The client asked for compression, and got 1.2MB of plain JavaScript. Every visit, every visitor.
The real first-visit payload was **3.6x the documented one**.

Fixed in `serveStatic`: brotli when the browser takes it, gzip otherwise, images and fonts left
alone because already-compressed bytes only get bigger. `node:zlib` is a builtin, which is the only
reason this was allowed to live in a server that may not take a dependency.

### 2. Nothing carried a cache header

No `Cache-Control`, no `ETag`, no `Last-Modified`. A returning visitor re-downloaded all of it,
including 1.8MB of marketing imagery, on heuristic caching at best.

Now: Vite content-hashes its own output, so those files are immutable by construction and get a
year. Files copied verbatim out of `public/` are **not** hashed — `nebula.jpg` keeps its name across
a rebuild — so they get 24 hours plus an ETag, and a returning visitor pays ~200 bytes for a 304
instead of 931KB for a file they already have. `index.html` is `no-cache`, because it names the
hashed assets and a stale copy points a browser at files a deploy has already deleted.

`Vary: Accept-Encoding` is set. `OPERATIONS.md` recommends putting Cloudflare in front, and a
shared cache without it will hand a brotli body to a client that never asked for one.

Every request also re-read the file from disk. The compressed bytes are now cached in memory,
keyed by resolved path — `dist/` cannot change while the process lives.

### 3. `/app` downloaded the marketing site

`ARCHITECTURE.md` has always said `/app` loads no Three.js. That was true of the source and false
of the build: `main.jsx` imported both trees statically, rollup had no seam to cut on, and emitted
one 1228KB chunk. Opening `/app` downloaded three, drei, postprocessing, lenis and maath first —
**35 modules of 3D engine, measured, to render a list**.

Every route is now `lazy()`. Vite splits app.css out with the shell, so `/` stopped paying for the
product's stylesheet too (31.3KB of CSS became 7.7KB for `/` and 23.6KB only under `/app`).

This is the claim most likely to break again silently — one careless static import at the top of
`main.jsx` restores it. So `npm run perf` **fails** if any module of the 3D stack reappears in the
`/app` graph, rather than quietly printing a bigger number.

### 4. A 146KB favicon

`logo.png` is 1536x1024 and 146KB, it is referenced nowhere but `<link rel="icon">`, and a browser
draws it at 16px. It was **larger than the entire `/app` bundle**. Replaced with a 96px
`favicon.png` at 2372 bytes — a 98% reduction on an asset every single page load requests.
`logo.png` stays as the source brand file.

### 5. The server ignored SIGTERM

Found by accident: `perf-measure` hung after printing its results, because the server it had
spawned would not die.

`server/metrics.mjs` registered `SIGINT`/`SIGTERM` handlers that flushed and returned. Registering
a listener **replaces** node's default terminate behaviour, so a handler that never exits leaves
the signal silently ignored. Verified by spawning the server and signalling it: it answered
`/api/health`, took SIGTERM, and was still serving three seconds later.

`fly deploy` and `fly apps restart` send exactly SIGTERM, wait out the grace period, then SIGKILL.
Every restart was a forced kill — and the metrics flush the handler existed for never ran. It now
flushes and exits; a deploy no longer waits out the timeout.

---

## Measured, and deliberately not changed

**Layout shift in the photo grid.** `.wk-shot` already sets `aspect-ratio:1` and the image fills it,
so width/height attributes would add nothing. The video grid did **not**, and an empty `<video>`
reports a default 300x150 until metadata arrives — the grid re-flowed on first clip. That one was
worth a line of CSS.

**`srcset` / `sizes` for uploaded media.** Cannot help. `srcset` picks between sizes that exist, and
only one size of an uploaded photo exists. Adding the attribute would be decoration. `loading="lazy"`
was already there; `decoding="async"` was added, which keeps a 3MB decode off the main thread.

**Dropping the unused Sora 800 weight.** `index.html` requests five Sora weights and the CSS uses
none of them at 800. Removing it saves nothing: Google serves Sora's latin subset as a **single
variable font file shared by every weight** — 33,672 bytes for all five. Space Grotesk likewise at
22,320. The whole font payload is ~62KB from a third party with its own long cache lifetime.
Self-hosting would improve latency and privacy but would move those 56KB onto our own egress at
$0.12/GB. Left alone; it is a latency decision, not a bytes one.

**`design/` (18MB of mockups).** Checked because it was flagged as a risk. It is outside `public/`,
so Vite never copies it and it has never been served. Not a problem.

---

## The one thing still worth real money: uploaded media

Not fixed here, because fixing it properly needs something this server is not allowed to have.

**Uploaded photographs are served at full size into a 150px grid cell.** Measured end to end —
register, upload, read the profile back:

```
uploaded                3,200,000 bytes   (a representative phone photo; the cap is 6MB)
served                  3,200,000 bytes   content-encoding: none
grid cell               150px CSS
useful at DPR2          ~300px, roughly 25KB
```

That is **99% of the bytes discarded by the browser** on a grid of thumbnails. A profile with
twelve photographs costs ~38MB, which from `bom` at $0.12/GB is about half a cent per profile view.

**And it cannot be cached — but not for the reason it looks.** The obvious culprit is
`cache-control: private, no-store` on `/api/media/:id`. That header is deliberate and documented in
`SECURITY.md`, and it is **not** the binding constraint. `mediaUrl()` mints a fresh expiry and
signature on every call, so the URL changes on every profile load:

```
1st load  /api/media/med_f86a…?e=1786451325557&s=7b2872475898361a78c9541539086d74
2nd load  /api/media/med_f86a…?e=1786451326660&s=5326b0e99d3e1c86abe128dbd1b4b74d
```

The cache key changes every response. Relaxing `no-store` on its own would achieve **nothing**,
which is why nothing was relaxed: switching tabs from Photos to Videos and back re-downloads every
image at full size regardless of any header.

### Recommendation, in order

1. **Resize on upload.** The real fix, and it needs a decision this task may not make alone. Three
   routes, none free:
   - a build/runtime dependency such as `sharp` — fastest and best quality, and squarely against
     the zero-dependency rule in `ARCHITECTURE.md`;
   - **resize in the browser before upload** via `canvas`, storing a thumbnail alongside the
     original. Costs the server nothing and adds no dependency, which makes it the most likely
     answer — but it needs a `variant` column on `media` and a second upload per file, so it is a
     schema change and not a front-end change;
   - move media to Cloudflare R2 or Tigris behind an image-resizing CDN. `server/storage.mjs` is
     already written as a provider with one implementation and says this move is coming; egress
     from object storage is also free, which fixes the bandwidth bill at the same time.

   Storing one 300px thumbnail per photo would cut a twelve-photo profile from ~38MB to ~300KB.

2. **Make the media URL stable before touching its cache header.** Round the expiry down to a
   bucket so the same file yields the same URL within that window. Only then is relaxing
   `no-store` to `private, max-age=<remaining life>` worth discussing — and that discussion belongs
   with whoever owns `SECURITY.md`, because a cached file outliving its signed link is exactly what
   the signature exists to prevent. Both halves or neither; either alone is pointless.

3. **Turn on the Cloudflare proxy**, already recommended in `OPERATIONS.md`. It would take the
   1.8MB of static marketing imagery to roughly zero egress. It does nothing for `/api/media`,
   which is correctly `private`.

---

## What the tests hold in place

`test/serving.test.mjs` boots the real server and asserts the properties above, because all of this
is invisible until someone reads a bill:

- JavaScript goes out brotli-encoded, and under 400KB
- gzip is offered when brotli is not accepted, and a client accepting neither still works
- images are not run through the compressor
- `Vary: Accept-Encoding` is set
- content-hashed assets are `immutable`; assets copied from `public/` are not
- `index.html` is `no-cache`
- a revalidation returns 304 with an empty body
- the SPA fallback still serves `/app/*`

And three that are security tests in a performance file — an uploaded file must still come back
`nosniff`, `inline`, `no-store` and **without** an ETag, and an unsigned media request must still be
refused. The static layer gained caching; `/api/media` had to gain none of it.
