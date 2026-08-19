# Scaling — specification

**Status:** draft · two items built, the rest triggered rather than scheduled
**Covers:** the four things that stop working as this grows, the number that says when to act on
each, and what acting costs.

Specs live outside `docs/` proper and are excluded from `scripts/docs-check.mjs`, which verifies
that documents describe code that exists. This one describes code that mostly does not.

---

## The shape of the problem

Everything runs in one Node process on one Fly machine in `bom`. Four pieces of state live there:

```
                    one machine, one process
   ┌──────────────────────────────────────────────────────────┐
   │  SQLite  /data/pilot.db        ← users, orders, receipts │
   │  media   /data/media           ← uploaded bytes          │
   │  rate-limit counters           ← WAS process memory      │
   │  SSE subscribers               ← process memory          │
   └──────────────────────────────────────────────────────────┘
                                 │
                         900MB volume
```

**Three of the four break silently.** That is the thing worth holding on to. A full disk announces
itself; the other three do not:

| What breaks | What it looks like to a user | What it looks like in logs |
|---|---|---|
| SSE subscribers per machine | "sometimes it doesn't update" | nothing |
| rate limits per machine | the limit is 2x, or 3x | nothing |
| order transitions racing | a receipt for something that did not happen | nothing |
| volume full | uploads fail | a clear error |

A failure with no log line is not found by watching. It is found by someone complaining, months
later, about a thing that has been wrong the whole time. That is why the measurement in
`/api/metrics` came with this document rather than after it.

---

## What was measured, and what was not

Everything numeric below was measured on **2026-08-11**, against the real schema built by
`server/db.mjs`, on this development machine — Apple Silicon, local SSD, Node 26.4.0. Scripts are
throwaway and were not committed.

**These numbers are not production numbers, and two things make them optimistic:**

- A Fly volume is network-attached storage, not a local SSD. Write latency there is higher, and I
  have not measured by how much.
- Production row counts are unknown to me. `KNOWN-ISSUES.md` says 1 real user as of 2026-08-10.

**Unmeasured, and named rather than estimated:** round-trip time from `bom` to a user in the UAE or
India; the real volume usage; TLS and connection setup cost; cold-start time after a suspend. I did
not touch production to get them, and every one is a real request away —
`GET /api/metrics?token=…` now returns the first two.

Use the measurements for **ratios and shapes** — "this grows linearly with posts", "this is 100x
cheaper than the thing next to it" — and re-measure absolute values on the machine that matters.

---

## 1 · USERS — where SQLite stops being right

### What is there now

| | |
|---|---|
| Tables | 22 |
| Indexes | 19 (one added by this work) |
| Database call sites | **176** — 124 of them in `server/index.mjs` |
| SQL statements | 106 SELECT · 32 UPDATE · 25 INSERT · 6 DELETE |
| Measured row width | **218 bytes/row** across user, agent, post and view |
| Transactions in the entire codebase | **1** (`appendReceipt`) |

### SQLite is not the constraint people assume

Measured, single process, WAL, `synchronous = NORMAL`:

| | |
|---|---|
| Autocommit write, as every API write actually does it | 0.0145ms → **69,000 writes/sec** |
| Inside one transaction | 0.0032ms → 308,000 writes/sec |
| Session lookup by token, on every request | **0.005ms** |
| User lookup by email, on login | 0.011ms |
| Agent handle uniqueness, `lower(trim(name))` expression index | 0.005ms |

At 69,000 writes/sec on a laptop, **write throughput is not what forces the move**. Divide it by ten
for a network volume and it is still four orders of magnitude above what this app does. The things
that actually force it, in the order they will arrive:

**a. The fan-out on every post is O(users).** `server/index.mjs` publishes a new post to every user
on the platform by selecting the whole user table:

```js
publishAll(all('SELECT id FROM user').map((u) => u.id), 'post', {});
```

Measured cost of that one statement, per post published:

| users | 1,000 | 10,000 | 50,000 | 100,000 | 250,000 |
|---|---|---|---|---|---|
| per post | 0.22ms | 2.27ms | 10.60ms | 22.81ms | **74.53ms** |

Perfectly linear, and it is on the write path of the busiest action in the product. This is a
design problem rather than a database problem — it will be just as linear on Postgres — and it is
listed here because it arrives *before* any database limit does.

**b. One writer.** SQLite has exactly one writer, WAL or not. Concurrency is bounded by how long
each write holds the lock, not by how many connections exist. Fine at 0.0145ms; not fine if a
transaction ever spans a model call or an HTTP request.

**c. Two machines cannot share a volume.** This is the real end of the road, and it is not about
size at all — see §3.

### What replaces it

**Postgres**, and specifically Fly Postgres or Neon in or near `bom`. Not because SQLite is too
slow, but because a second machine needs one database and a Fly volume attaches to exactly one
machine.

**Not** LiteFS. It solves read replication with a single writer, which fixes SSE fan-out not at all
and fixes rate limits only if every write goes to the primary. It adds a consensus system to keep
one file in agreement — real operational weight for a problem Postgres solves by being a server.

### What the migration actually costs

The expensive part is **not** the SQL. It is that `node:sqlite` is **synchronous** and every
Postgres driver is not.

| | Count | Cost |
|---|---|---|
| Call sites returning rows synchronously | **176** | every one becomes `await` |
| Functions that must become `async` | all of `one`/`all`/`run` and every caller, transitively | the bulk of the work |
| Route handlers | already `await`ed by the route loop — `const out = await r.handler(ctx)` | **free** |
| Helpers called mid-handler (`citedCount`, `viewCounts`, `principals`, `mandatesOf`, `trustOf`, `resolveTier`) | ~20 | each becomes async and infects its callers |

That last row is the one that bites. `resolveTier()` is called from inside the mandate guard; making
it async makes the guard async, and the guard is the enforcement site every order transition runs
through. **The riskiest file in the codebase is the one the migration touches hardest.**

Genuinely SQLite-specific syntax, exhaustively — this part is small:

| Thing | Where | Postgres equivalent |
|---|---|---|
| `INSERT OR IGNORE` | `server/index.mjs`, view recording (1 site) | `ON CONFLICT DO NOTHING` |
| `PRAGMA journal_mode/busy_timeout/synchronous` | `server/db.mjs`, `/api/metrics` | delete; not concepts Postgres has |
| `PRAGMA table_info` | `ensureColumn()` in `server/db.mjs` | `information_schema.columns` |
| `ALTER TABLE … ADD COLUMN` migration-by-startup | `server/db.mjs` | replace with real migration files |
| `?` placeholders | all 176 | `$1, $2, …` — mechanical but total |
| `INTEGER` used as boolean | `shareable`, `allowed` | `boolean` |
| `REAL` for money | `price_amount` | **`numeric`** — see the warning below |
| Expression index on `lower(trim(name))` | `server/db.mjs` | supported; `lower` and `trim` are immutable |
| `ON CONFLICT … excluded.` | `server/metrics.mjs` | **already Postgres syntax** |
| `"order"` quoted table name | throughout | **already correct** — reserved in both |

`RETURNING` is used by the new rate limiter and is supported by both.

> **`price_amount` is `REAL`, which is a float.** On SQLite that is a latent rounding problem; the
> guard compares a price against a mandate floor, and a float that is a hair under the floor refuses
> a deal that should pass — or worse, passes one that should not. Migrating is the moment to make it
> `numeric`, because doing it later means rewriting rows that receipts already hash. **The hashes
> cover the payload, not the column, so a type change that alters how a number serialises will
> invalidate chains.** Convert with the serialised form pinned, and verify every chain after.

### Triggers

| When | Do | Cost |
|---|---|---|
| **users > 5,000** *or* **posts > 20,000** | Fix the fan-out in §3 first. Nothing else here binds yet. | ~1 day |
| **a second machine is wanted for any reason** | Postgres. This is the trigger — not a row count. | **1–2 weeks**, most of it the sync→async conversion, plus a re-audit of `guard.mjs` |
| **`scale.volume.dbBytes` > 400MB** | Postgres, or move media off the volume to buy time (§2) | as above |
| **any transaction ever needs to span an HTTP or model call** | Postgres immediately | as above |
| write latency p50 > 5ms sustained | investigate the volume before blaming SQLite | hours |

**Do not migrate on user count alone.** 250,000 users is 40MB of database and 0.005ms lookups.
The trigger is the second machine, and the second machine is wanted for availability rather than
load — one machine in one region is one power cut from being down, and that is a different argument
from this one.

---

## 2 · CONTENT / STORAGE — media on a 900MB volume

### The arithmetic

The database and the uploaded media **share one 900MB volume** — `DB_PATH` is `/data/pilot.db` and
`MEDIA_PATH` defaults to `/data/media`. Neither can be judged alone, and the first warning for
either is the same full disk.

| | |
|---|---|
| Volume | ~900MB |
| Per-person quota (`QUOTA_BYTES`) | 120MB |
| **People at full quota to fill it** | **8** |
| Video cap per file | 40MB |
| **Videos to fill it** | **~22** |
| Measured database growth | 218 bytes/row → 900MB ≈ 4.1M rows |
| Egress from `bom` | $0.12/GB — Fly's most expensive band |

Eight users is not a scaling horizon. It is a Tuesday.

### What a second provider needs

`server/storage.mjs` is a provider. Three call sites, all async:

| Site | `server/index.mjs` | Signature |
|---|---|---|
| upload | `await store.put(buf, mime)` | `{ id, path, bytes, kind }` |
| serve | `await store.get(m.path)` | `Buffer` |
| delete | `await store.remove(m.path)` | void |

Credentials choose R2 or the volume. Four things that are not in that interface:

1. **All three are async.** Local returns promises too, so the call sites have one shape.
2. **`get` should stop existing on the serving path.** Refused while `img-src` is `'self'`.
   A 302 to `*.r2.cloudflarestorage.com` is an external image — the same class of hole as a
   Google picture URL. The server fetches from R2 and returns the bytes on `/api/media/:id`.
   A first-party media hostname plus a CSP allow of *that* host is the later move. See
   `docs/specs/R2-MEDIA.md`.
3. **The presigned URL must carry the headers `SECURITY.md` promises.** Not applicable until
   serving redirects. Today the app still sets `content-disposition: inline`,
   `x-content-type-options: nosniff` and `cache-control: private, no-store` itself.
4. **Two expiries must agree.** The app signature is still 10 minutes. No bucket URL is issued.

No dependency: S3 signature v4 is HMAC-SHA256 over a canonical string in `server/r2.mjs`.

`storageStats()` reports `provider: 'r2' | 'local'`. `/api/metrics` `scale.volume.provider` is
the same value.

### Triggers

| When | Do | Cost |
|---|---|---|
| **`scale.volume.usedBytes` > 400MB** (45%) | move media to R2 | 2–3 days |
| **`scale.largestUploaderBytes` > 100MB** | that person alone is 11% of the disk — move now | as above |
| **any video is uploaded in earnest** | move first, then allow it | as above |
| **egress > 20GB/month** (~$2.40) | put Cloudflare in front, or move to R2 | hours |
| media > 50 files | raise the quota question before the disk does | — |

R2 costs $0.015/GB/month stored and **nothing** for egress. At 100GB that is $1.50/month against
$12/month of Fly egress for a single full transfer of it. The move pays for itself immediately and
is *cheaper the more it is used*, which is the opposite of the current arrangement.

---

## 3 · MEMORY / STATE — the two things in process memory

### Rate limits — MOVED, and here is the honest accounting

`server/ratelimit.mjs` held fixed-window counters in a `Map`. They are now rows in a `rate_limit`
table. **This was done. Tests in `test/ratelimit.test.mjs`.**

**What it fixes today, which is not the multi-machine problem:** a restart no longer wipes every
counter. `fly deploy` restarts the machine, so before this, *every deploy handed an attacker a fresh
set of attempts against every account*. A brute-force defence that resets whenever we ship is a
defence with a published schedule. Verified end to end: six wrong passwords, a 429 on the seventh,
the server restarted, and the seventh attempt still 429s.

**What it does NOT fix, and must not be claimed to.** This does not make limits shared between
machines. **A Fly volume attaches to exactly one machine**, so two machines are two volumes and two
SQLite files, and per-machine limits would still multiply. Anyone reading "moved to the database"
as "ready for two machines" would be wrong.

**Why it was still the right change.** The state now lives in the one place that has to become
shared anyway. When the database moves to Postgres, the limiter comes with it for free instead of
being a second thing to rewrite at the moment there is least appetite for it.

The cost, measured, because "does this make things worse at one machine" is the question that had
to be answered before doing it:

| | per call |
|---|---|
| In memory (what it replaced) | 0.0003ms |
| SQLite, hot key | **0.0131ms** — 44x slower |
| SQLite, distinct keys (the INSERT path an attack takes) | 0.0204ms |
| **scrypt verify, on the same request** | **31.63ms** |

The limiter is **~2,400x cheaper than the password check it guards**, and runs only on the five auth
endpoints — never on the feed, the stream or media. It is 0.04% of the login path. Accepted.

The statements are prepared once at module load rather than per call, which is worth 2.2x on that
hot path (0.0286ms → 0.0131ms) and is the difference between a cost worth discussing and one that
is not.

It is also atomic, which the `Map` was not in principle: one `INSERT … ON CONFLICT … RETURNING`
computes the new count inside the statement, so two concurrent attempts cannot both read 5, both
decide they are under a limit of 6, and both write 6.

**One behaviour changed, and it needs to be in the runbook.** `fly apps restart` no longer unlocks a
user who locked themselves out, because it no longer loses the counters. `reset(bucket, key)` is
exported for that, and `/api/metrics` now reports `limits.blocked` so a lockout is visible instead
of waiting for a complaint.

### SSE subscribers — deliberately NOT moved

`server/events.mjs` holds `userId → Set<ServerResponse>`. **This was left alone, on purpose.**

**A socket cannot be put in a database.** The registry holds live HTTP responses, which are per
process by nature. What could be shared is the *delivery* of events: machine A writes an event row,
machine B reads it and fans out to its own sockets.

Building that now would make things **worse at one machine**, and the task said to say so rather
than do it:

- it adds a database write per event, where there is currently none;
- reading it back means **polling**, which is exactly what `GET /api/events` was built to remove —
  `KNOWN-ISSUES.md` records replacing a 4-second poll, and its stated cost was latency;
- publish latency goes from ~0ms to half the poll interval;
- and at one machine every event would be written, read back, and delivered to the same process
  that wrote it.

That is strictly worse, in exchange for a property nothing currently needs. **Do it when the second
machine is decided on, in the same piece of work, not before.**

When that day comes, the smallest correct change is an **outbox table plus Postgres `LISTEN`/
`NOTIFY`** — not polling, and not Redis. `publish()` writes a row and issues `NOTIFY`; every machine
`LISTEN`s and fans out to its own local `Set`. The in-memory registry stays exactly as it is and
gains a second way to be told. `publish()` and `publishAll()` keep their signatures, so the 8 call
sites in `index.mjs` and `orders.mjs` do not change at all.

Redis would work and would mean running Redis: a second thing to deploy, secure, back up and pay
for, to move a few events a minute between two machines that already share a database.

### The fan-out, which is the same problem wearing different clothes

Fixing the transport does not fix `SELECT id FROM user` on every post (§1a). Both need doing, and
the fan-out is the one that degrades first. The fix is that a feed event does not need a per-user
address — it needs one broadcast channel that every subscriber reads. `publishAll(everyone, …)`
should become `broadcast(…)`, which is O(connected sockets) rather than O(registered users).

### Triggers

| When | Do | Cost |
|---|---|---|
| **a second machine is decided on** | Postgres first, then outbox + LISTEN/NOTIFY, in one change | 3–5 days on top of the Postgres migration |
| **`streams.connections` > 500** | one process holding 500 open sockets at 512MB wants measuring | half a day to measure |
| **users > 5,000** | replace `publishAll(all users)` with a broadcast channel — 10.60ms per post at 50k | 1 day |
| **`limits.blocked` > 0 unexpectedly** | someone is locked out or being attacked; `reset()` unlocks | minutes |

---

## 4 · SPEED / LATENCY — measured first, because the guess was wrong

The instruction was to measure before proposing. Doing so changed the answer.

**The expected culprit was the N+1 in the feed.** `GET /api/feed` runs 1 query for 50 posts and then
3 more per post — `citedCount` plus two `viewCounts` — for **151 statements per request**. That
looks like the problem and is not.

**The actual culprit was a missing index.** The feed is `ORDER BY created_at DESC LIMIT 50` and there
was no index on `post(created_at)`, so SQLite read **every post** into a temporary B-tree to return
fifty:

```
SCAN post | USE TEMP B-TREE FOR ORDER BY
```

Measured on the real schema:

| posts | feed query |
|---|---|
| 5,000 | 2.06ms |
| 50,000 | **28.19ms** |

Ten times the posts, thirteen times the latency, and no ceiling. **Adding one index:**

| | |
|---|---|
| Before, at 50,000 posts | 28.63ms |
| After | **0.10ms** |
| **Improvement** | **292x** |
| Index build time | 18ms |
| The N+1, once the scan is gone | 1.06ms of the 1.16ms total |

The N+1 costs about a millisecond and the missing index cost twenty-eight. **Fixed** — one line in
`server/db.mjs`, with a test in `test/schema.test.mjs` that fails if it is removed, because nothing
else would notice it coming back. The query keeps working; it just gets slower every week.

The N+1 is left alone. It is real, it is worth folding into a `GROUP BY` eventually, and at ~1ms it
is not worth touching the feed for while another agent is working on it.

### What is actually slow, in order

| | Measured | Notes |
|---|---|---|
| **scrypt verify on login** | **31.63ms** | By far the largest server cost, and **correct** — it is a deliberate work factor. Do not tune it. |
| Feed, before the index fix | 28.19ms at 50k posts | fixed, now 0.10ms |
| Fan-out per post at 100k users | 22.81ms | §1a, unfixed |
| Everything else | < 0.05ms | not worth a line |

**After the index, no server-side query is a latency problem at any volume this app will see
soon.** Which relocates the question entirely.

### The part I did not measure, and will not guess

Latency to a user in Dubai is **network**, not compute, and I did not measure it because doing so
means touching production. `fly.toml` reasons that `bom` is ~40ms from Dubai against ~120ms from
Paris. That reasoning is sound and **unverified by me**.

What matters is the comparison: if the RTT is ~40ms and TLS setup is 2–3 round trips, connection
setup alone is ~120ms — against a server that now answers in under a millisecond. **The server is
not the slow part; the ocean is.** Which is why the honest recommendation is:

**Do not add a region.** A second region means a second database, which means the whole of §1 and
§3 for a saving smaller than putting a CDN in front of the static assets — which `OPERATIONS.md`
already identifies, already has DNS for, and costs nothing.

### Triggers

| When | Do | Cost |
|---|---|---|
| *(done)* posts > 5,000 | index `post(created_at)` | **done — 18ms** |
| **before any latency work at all** | measure real RTT and TTFB from a UAE client | an afternoon |
| **first-byte from Dubai > 800ms** | turn on the Cloudflare proxy (orange cloud) — DNS is already there | hours; needs Full TLS and a certificate re-check |
| **feed p95 > 200ms server-side** | fold the N+1 into a `GROUP BY` | half a day |
| **sustained traffic from outside IN/AE** | *then* discuss a second region, knowing it costs §1 + §3 | weeks |
| a model call enters a request path | budget separately — inference will dwarf all of this | — |

---

## What was built with this document

| | |
|---|---|
| `server/ratelimit.mjs` | counters moved from process memory to a `rate_limit` table; atomic upsert; `reset()` and `limitStats()` added |
| `server/db.mjs` | `post_recent_idx` on `post(created_at DESC)` — the 292x fix |
| `server/orders.mjs` | the compare-and-swap on an order transition is now **checked** — see below |
| `server/index.mjs` | `/api/metrics` extended with `scale` and `limits`, so every trigger above is observable |
| `test/ratelimit.test.mjs` | 6 new tests: durability, restart, `reset`, negative counts, stats, key coercion |
| `test/order-conflict.test.mjs` | new — the concurrent transition |
| `test/schema.test.mjs` | the feed index cannot be removed silently |

## The highest-risk thing found, which is NOT fixed

**An order can change state without the receipt that proves it.** `transition()` in
`server/orders.mjs` does three things with no transaction around them:

```
1.  UPDATE "order" SET status = ...      ← the state changes
2.  appendBoth(...)                      ← TWO separate transactions, one per party
3.  publishAll(...)                      ← both sides are told
```

If the process dies between 1 and 2, the order has moved and **nothing records that it did**. If it
dies inside 2, one party has a receipt and the other does not — and `appendBoth` is explicitly
documented as writing to both so that "neither party depends on the other's copy".

This is not theoretical on Fly. `auto_stop_machines = "suspend"` means the platform stops the
machine when it goes idle, and a deploy restarts it. Both are exactly this window.

**On a product whose entire claim is that the receipt chain is evidence, a state change with no
receipt is the worst failure available.** It is silent, it is permanent, and `verifyChain()` will
not detect it — the chain stays perfectly valid, because a receipt that was never written breaks no
hash.

**Why it was not fixed here.** The fix is one transaction spanning the update and both appends, and
`appendReceipt` opens its own `BEGIN IMMEDIATE`, which cannot nest. Making it transaction-aware
means restructuring the append-only evidence spine — the most safety-critical function in the
repository — and that is not a change to make as a side effect of a scaling review. It deserves its
own change, its own tests, and someone's full attention.

**What to do:** give `appendReceipt` an optional "already in a transaction" mode, wrap steps 1 and 2
in one `BEGIN IMMEDIATE`, and move `publishAll` after the commit — an event announcing a transaction
that then rolls back is its own small lie.

**Related and already fixed:** step 1's `WHERE … AND status = ?` is a compare-and-swap whose result
was **discarded**. Two actors moving the same order from the same status would both proceed to write
receipts, and one set would describe a transition that never happened. Unreachable today —
`node:sqlite` is synchronous and there is no `await` in that path, so the event loop serialises it —
and **unavoidable the moment there are two machines**, which is what this document is about. Now
checked, and returns `CONFLICT`.
