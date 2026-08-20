# Known issues

Everything currently wrong or unfinished, worst first. **If you fix one, delete it here in the same
commit** — a stale known-issues file is worse than none, because people stop trusting it.

Last reviewed: 2026-08-19 · registration is OPEN · **outside users are here** · nothing HIGH is open

**FOUR accounts in production, and TWO OF THEM ARE STRANGERS.** Counted from `/data/pilot.db` on
the live machine on 2026-08-19, not from memory:

| account | since | works | agent |
|---|---|---|---|
| `theonlygreatofficial@gmail.com` — the owner | 2026-08-09 | 0 | — |
| `barhoom.baharoon@hotmail.com` — the owner's second | 2026-08-10 | 4 | 1 |
| `skbahar94@gmail.com` — **not the owner** | 2026-08-12 | 1 | 1 |
| `farifalla@hotmail.co.uk` — **not the owner** | 2026-08-12 | 5 | 1 |

**This file said "two accounts, both the owner's" and "no outside users yet" for a week while two
real people were signed up, publishing, and running agents.** Ten works exist, not zero posts. Every
safety feature shipped since 2026-08-12 — block, report, the moderation ladder, Hidden Words — was
written under the belief that nobody outside was here. They were.

The rule this file already states is the one that broke: **count from the live machine.** The
previous entry said exactly that, and was then left to rot for seven days. A number in a document
is a claim with a date on it, and this one had neither.

**Two `@example.com` walk-test accounts existed on 2026-08-19** and were removed the same day, with
everything hanging off them — agents, works, media rows *and the files on the volume*, comment,
follow, project, note, source, mandate, audit rows, agent thread, sessions. Deleted in dependency
order inside one transaction with `foreign_keys` set **before** `BEGIN`, since the pragma is a
no-op inside one. `PRAGMA foreign_key_check` is clean and no reference dangles. A consistent
backup was taken first with `VACUUM INTO` rather than a file copy, because the database is in WAL
mode and a copy taken mid-write can be torn: `/data/pilot-backup-before-walk-cleanup.db`.
**Remove that backup once you are satisfied** — an unexplained database file on the volume is the
same class of litter as the account it was insurance against.

---

## LOW — an @mention in a flattened reply names a person who may not be unique

A reply to a reply flattens onto the top-level comment carrying `@Name`, taken from `user.name`.
**Names are not unique and may contain spaces**, so `@Cara Smith just after five` is ambiguous about
where the name ends, and two people called Cara are indistinguishable.

It is decoration, not a link — nothing resolves it — so the cost today is a thread that occasionally
reads oddly rather than one that misattributes. The fix is to mention the agent handle, which *is*
unique by database index, but a comment is a person's act and tying its mentions to their agent
conflates two things this product keeps apart deliberately.

Raised by the second-engineer seat while building replies, rather than found later.

## MEDIUM — a shared operator token cannot say WHICH human moderated

Every moderation act — `limit`, `takedown`, `dismiss` — is gated by one `METRICS_TOKEN` held in
the environment. That authenticates *the platform*, not a person. The receipt is honest about it:
it records `source: 'operator-token'` and leaves `report.reviewed_by` NULL rather than naming a
reviewer nothing can corroborate. But the consequence stands — with a second operator there would
be no way to tell which of them acted, and no way to revoke one without rotating the other.

Raised by gemini from the adversary seat, and it is right. Not fixed, deliberately: per-operator
revocable tokens are a credentials subsystem, and there is exactly **one** named operator today
(`ADR-0006`, and the moderation posture ADR when it lands). The moment a second person can
moderate, this becomes the blocking item — a token per operator, the token id in the receipt
payload, revocation without rotation.

**Do not "fix" it by accepting a reviewer name in the request body.** An unverified name in an
audit record is worse than an honest absence: it reads as attribution and backs nothing.

## MEDIUM — the assurance ladder has three rungs and only one is reachable

`shared/assurance.mjs` grades a captured photograph as `self`, `web-attested` or `device-attested`
by comparing the device's own coordinates against an independently resolved position. No resolver
is configured, so there is nothing to compare against and **every capture grades `self`**,
regardless of how good the evidence is.

The ladder is therefore implemented and, in practice, a single rung. A buyer who asks for
`web-attested` before releasing payment finds that nothing ever qualifies, with no indication why —
the same failure shape as navigation that is drawn but unreachable: built, unusable, and looking
finished.

**Fix:** configure a network-position resolver, or say `self` is the only available grade in the
interface until one exists. The second is one line and stops the interface implying a check that
cannot happen.

**Interface half done 2026-08-12 (cursor).** `src/app/Inspect.jsx` now says every capture grades
`self` until a resolver exists. The resolver itself is still unconfigured — a buyer asking for
`web-attested` still cannot get it. Do not close this until one of those two is true in production.

---

## MEDIUM — Messages has no composer for a typed offer

The mockup's composer carries **New offer · Counter · Ask agent · Attach**. Only free text is
built. Those three buttons write orders rather than sentences, so they belong on top of the order
API (`POST /api/agent/orders`, `POST /api/orders/transition`) and would have meant designing an
order form inside a chat box — the wrong place to decide that.

What exists is honest in the meantime: an agent posts a typed card through `meta`, and the screen
renders it. Nothing pretends a person can compose one yet.

---


## LOW — "view only" is an affordance, not a lock

Media is inline-only, opens in an in-app reader, has no save affordance, and its signed URL lasts
ten minutes. **A determined person can still keep a copy** — screenshot, screen recording, or the
network tab within the link's life. This is true of every platform including Instagram, and the
product should never claim otherwise.

If attribution matters more than prevention, watermark the viewer's handle onto images at serve
time. That makes a leak traceable, which deters where a header cannot.

---

## MEDIUM — media lives on the Fly volume, which is ~900MB

Fine for photographs and documents in a pilot. **Wrong for video at any real scale**: twenty-odd
clips fill the disk, and serving them from `bom` costs $0.12/GB — Fly's most expensive egress band.
The same bytes on Cloudflare R2 cost nothing to serve.

Guarded rather than ignored: a 120MB per-person quota, per-type size caps, and `/api/metrics`
reports usage under `scale.volume` — so the day this must move arrives as a warning rather than a
full disk. That reporting was claimed here before it existed; `storageStats()` was exported and
never called. It is real now.

**Eight people at the full quota fill the volume, and so do ~22 videos.** The database shares the
same 900MB. Triggers and the exact shape of an R2 provider are in `docs/specs/SCALING.md`.

**Fix when video is used in earnest:** add an R2 or Tigris provider to `server/storage.mjs`. It is
written as a provider with one implementation precisely so that is a `put`/`get`/`remove` and
nothing else.

---



## LOW — SSE subscribers are per-process

`server/events.mjs` holds open responses in memory, so a publish on machine A never reaches a
subscriber on machine B. Left in memory **deliberately**: a socket cannot live in a database, and
the shared-delivery alternative costs a write and a poll per event, which is worse at one machine
and reintroduces the polling `GET /api/events` exists to remove.

**Fix when a second machine is decided on, in the same change:** an outbox table plus Postgres
`LISTEN`/`NOTIFY`. `publish()` and `publishAll()` keep their signatures. Reasoning and cost in
`docs/specs/SCALING.md`.

---

## LOW — GitHub OAuth has no credentials

`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are unset, so the server reports `Github off` and the
button correctly does not render — no broken link, no error. The code path is finished and tested;
only the credentials are missing.

**Fix:** register an OAuth app on GitHub, then `npm run secret GITHUB_CLIENT_ID` and
`npm run secret GITHUB_CLIENT_SECRET`.

---

## LOW — three codebases still exist

`corridor` (the engine), `verified-work` (the platform build) and this pilot all hold versions of
the same ideas. The mandate and trust rules are already shared by vendoring with a hash gate, which
removes the worst of the drift risk, but the consolidation decision is still open.

---

## Resolved, kept for the lessons

<details><summary>The front door was a black rectangle without WebGL</summary>

`/` is a full-viewport react-three-fiber `<Canvas>` with `Suspense fallback={null}`, and
`index.html` had an empty `#root` and no `<noscript>`. A visitor whose browser could not get a
WebGL context — locked-down enterprise, some mobile, a GPU-blocklisted browser — got solid navy
and zero characters of text. Not a CSP problem: the headless pass confirmed nothing was blocked,
the context simply was not available.

Found 2026-08-12 by a real browser load, which is the only thing that could have found it: the
server answers 200 and the bundle is fine.

**Fixed the same day (`0b2ceba`).** `canWebGL()` probes for a context in an effect and the Canvas
is not mounted until the answer is known — `glOk === null` renders no Canvas at all, because a
failed `createContext` during render takes the whole tree down with it, `Overlay` included, before
`SceneBoundary` can help. `glOk === false` skips the Canvas permanently and passes `forceDone` to
the preloader, so the text overlay is the page rather than a thing waiting behind a curtain that
never lifts. `index.html` also carries a real `<noscript>` with the headline and both entry links.

Three states, not two: **not yet probed** is different from **cannot**, and collapsing them is how
the first attempt still rendered blank.

</details>

<details><summary>CORS_ORIGIN `*` — the entry described production, and had never looked at production</summary>

**What the entry claimed:** `.env` carries `CORS_ORIGIN=*`, `.env.example` shipped the same line,
and "until the owner changes the real `.env` and the deploy secret, the running app still sends
`*`."

**What was actually true.** There is no `CORS_ORIGIN` in `fly.toml` `[env]`, and `fly secrets list`
has never held one — `git log -S CORS_ORIGIN -- fly.toml` returns nothing, so it was never there to
remove. Production therefore always took the `|| BASE_URL` branch. Verified against the running
site rather than inferred, on 2026-08-14:

```
$ curl -sD- -o/dev/null https://theunivers.ai/api/health -H 'Origin: https://evil.example'
access-control-allow-origin: https://theunivers.ai
```

The local `.env` really did carry `*`, and it is now `http://localhost:5188`. It never reached the
deploy: `.env` is gitignored and Fly reads its own environment.

**The lesson is the third instance of one already recorded twice in this file** (the DMARC entry,
and `busy_timeout` read over `fly ssh`): a conclusion about the running system, drawn from a file
on this laptop, stated as fact. A response header costs one request to read. **Assert production
from production.** The wrong direction of error matters too — this one reported a live product as
less safe than it was, which spends attention rather than risking data, but a known-issues file
that is wrong in either direction is the thing this file's own header warns about.

</details>

<details><summary>A citation could outlive the post it cited, and nothing noticed</summary>

`source.post_id`, `source.author_id`, `citation.post_id` and `citation.author_id` referenced rows
by id and declared **no foreign key** — only `note_id` and `user_id` did. Deleting a post therefore
did not error; it left every source and citation of that post pointing at content that no longer
existed. On a product whose claim is that a citation is evidence, that is the worst available
shape: a reference that looks intact and resolves to nothing.

Found by tracing the 2026-08-12 account deletion rather than by being hit by it. The affected rows
were removed by hand at the time.

**`CASCADE` or `RESTRICT` turned out to be the wrong question**, and `docs/decisions/ADR-0003-a-post-is-withdrawn-never-deleted.md`
records why. `CASCADE` lets an author erase other people's evidence — post, get cited widely,
delete, and every citer's provenance evaporates. `RESTRICT` alone would have made **takedown
structurally impossible**, since a citation is trivial to obtain and a cited post could then never
be removed. They only conflict if "delete" is assumed to mean `DELETE`.

Settled as `RESTRICT` at the constraint, with **withdrawal** as the user-facing act: `withdrawn_at`
is stamped, title and body are emptied in the same statement, the row survives, and a citation of it
resolves to a tombstone rather than a 404 — because a 404 tells the citer their source never
existed.

Two lessons worth keeping. **SQLite has no `ALTER TABLE ADD CONSTRAINT`**, so this needed the
documented table rebuild, and `PRAGMA foreign_keys` is a no-op inside a transaction — set it after
`BEGIN` and the copy is silently validated against the old shape. And the first version of the
guard used `PRAGMA foreign_key_list` to decide whether to migrate, which returns an empty list for
a table that does not exist yet: an absent table read as one needing migration, and the rebuild
generated `INSERT INTO x__new () SELECT FROM x`. Caught by running it on a fresh database.

`test/withdraw-migration.test.mjs` exists because `test/withdraw.test.mjs` builds a *fresh*
database, which gets the constraints from the CREATE TABLE and never runs the migration at all.
The rebuild is the part that can lose rows, so it is tested against an old-shape database with rows
in it.

</details>


<details><summary>`.env` could not set `DB_PATH`, and said nothing about it</summary>

`server/index.mjs` parsed `.env` in its module body. ES module imports are evaluated **before** any
statement in the importing file, so `db.mjs` had already read `process.env.DB_PATH` and frozen
`./data/pilot.db` into a constant by the time the file was opened. A `DB_PATH` set only in `.env`
was ignored, with no error and no warning — the operator worked against the wrong database
believing otherwise. Four other modules read the environment at import time the same way:
`storage.mjs` (`MEDIA_PATH`), `oauth.mjs` (`OAUTH_STATE_SECRET`), `mail.mjs` (`MAIL_FROM`,
`NODE_ENV`) and `analyse.mjs` (`ANALYSE_MODEL`).

**Why it survived so long: on Fly every variable is a real secret**, set in the actual environment,
where the fallback never applies. The bug was invisible in production and only reachable by a
developer pointing a local run somewhere — which is how it was found.

Fixed by moving the loader into `server/env.mjs`, whose body runs on import, and importing it
first in `index.mjs`. Precedence is unchanged: a real environment variable still beats the file.

**The test is end-to-end, not a lint of import positions.** It boots the real server with `DB_PATH`
set only in a file and asserts the database appears there — the assertion an ordering rule cannot
fake. Verified by reintroducing the late import and watching it fail.

</details>

<details><summary>An order could move without the receipt proving it — and the chain could not tell</summary>

`transition()` ran three separate transactions: the status `UPDATE`, then one receipt append per
party, with nothing around them. A crash between them left the order moved and nothing recording it.

**`verifyChain()` could not detect this.** A receipt that was never written breaks no hash, so the
chain stayed valid while being incomplete — on a product whose claim is that the chain is evidence,
silently missing evidence is the worst available failure. Not theoretical on Fly, where
`auto_stop_machines = "suspend"` and every deploy land in exactly that window.

Fixed by making the move and its receipts one transaction: `inTransaction()` in `receipts.mjs`,
with `appendReceiptIn`/`appendBothIn` that join a transaction the caller already opened rather than
starting their own — SQLite has no nested `BEGIN`. A losing compare-and-swap now throws, which
unwinds the whole thing instead of leaving a half-written step.

Two tests: one for the ordering, and one for the property, because the original shape had the check
in the right *place* and still lost evidence.

</details>

<details><summary>/app/space/:id rendered a guard refusal that never happened</summary>

`Thread.jsx` ignored its `:id` and rendered a fabricated negotiation from `mock.js`, including a
`FLOOR` refusal with a code and a reason. A fair placeholder when nothing was real; indefensible
once genuine threads appeared beside it, because an invented refusal is visually identical to a
recorded one.

**Inventing evidence in the interface is the same failure as a receipt asserting a verdict** —
worse, because it looks like the feature working. Now renders the actual post via
`GET /api/posts/:id`, and shows no negotiation at all, since none is recorded against a post.
`mock.js` is deleted.

</details>

<details><summary>The Bridge polled every 4 seconds — replaced with Server-Sent Events</summary>

`setInterval(load, 4000)` against three endpoints: fifteen requests a minute per open tab, whose
answer was almost always "nothing changed". It cost CPU (each poll hits SQLite, which is the
concurrency WAL had to solve), ~450KB of egress per ten-minute session, phone battery, and — the
part that made it plainly wrong — **up to four seconds of delay showing a message that had already
arrived**.

Replaced by `GET /api/events`, one open connection per tab. `server/events.mjs` publishes when a
message, post, proposal or order transition actually happens.

**Not `new EventSource(...)`.** EventSource cannot set request headers, and the session token
travels in `Authorization`. The usual workaround puts the token in the query string, writing a live
credential into every access log and proxy trace — a poor trade for a smaller client. The stream is
read with `fetch` and a ReadableStream instead, which costs reconnection logic and keeps the
credential in a header.

**Events carry only a KIND, not the changed object.** The client refetches the one resource
affected, so there is a single code path for "how do I load messages" instead of two that can
disagree. The saving was the polling, not the payload.

**Details that are bugs if omitted:** a heartbeat comment every 25s (proxies drop quiet
connections, and Fly is no exception); `no-transform` and `x-accel-buffering: no` so nothing
buffers the stream; the heartbeat timer cleared on disconnect, or one timer leaks per closed tab;
exponential backoff to 30s, because every tab retrying once a second turns a brief outage into a
long one; and a visible "reconnecting…" state, because a screen that quietly goes stale is worse
than one that admits it.

**Known gap:** `/api/metrics` under-counts stream egress. `measure()` tallies a response when it
ends, and an SSE response ends only on disconnect, so heartbeats and events are not counted. An
undercount of a small number, on a feature whose point is sending far less — recorded rather than
silently accepted.

**Same single-machine constraint as the rate limiter:** subscribers live in memory, so a publish on
machine A never reaches a subscriber on machine B. It must move to a shared bus before a second
machine exists, or half of users see nothing and it looks like "sometimes it doesn't update".

</details>

<details><summary>Google OAuth secret exposed in a transcript — rotated, and a worse bug found on the way</summary>

`GOOGLE_CLIENT_SECRET` was pasted into a chat transcript during setup. Transcripts are stored,
synced and backed up, so the value was treated as public from that moment.

**Resolved 2026-08-11** by creating a new OAuth client and deleting the old one. Deleting the old
client is the step that ends the exposure — rotating a secret while the old client still exists
merely stops *using* the leaked value.

**A worse problem surfaced during the rotation.** The client's authorised URIs were localhost only:

```
origins        http://localhost:5188
redirect URIs  http://localhost:8790/api/auth/google/callback
```

while production sends `https://theunivers.ai/api/auth/google/callback`. **Google sign-in had never
worked in production.** The account that exists was created on 2026-08-09 at 11:13, hours before
the Fly machine was launched — signed in against localhost. The one other user signed up with a
password the following day, and "clicked Google, saw an error, used the form instead" is the
obvious explanation for a signup that nearly did not happen.

Nothing surfaced it. `/api/auth/providers` reports `google: true` whenever both variables are
merely *set*, so every dashboard said the feature was on. **A configuration check that only tests
presence will report a broken integration as healthy.**

**Sequencing that mattered:** the client ID was updated before the secret, leaving production with a
new id and the old client's secret — a pair that passes the consent screen and fails at token
exchange. The sign-in page loading proves the id and redirect URI; only completing a sign-in proves
the secret.

**Why creating a new client was safe:** `server/oauth.mjs` looks a user up by `oauth_id` and falls
back to **email**, so the existing Google account was matched and re-linked to the new client's
subject id rather than orphaned. Verified after the fact.

**Two of my own errors during this, recorded because both were reported as system faults:**

- I flagged the Keychain entry as possibly concatenated. It was not — a Google client id is 71
  characters. The bug was in my shell: `${V:+mask}${V:-fallback}` prints the mask *and then the
  whole value*, because `${V:-…}` returns `V` when `V` is set.
- The original "no DMARC record" entry, corrected separately below.

</details>

<details><summary>DMARC — the entry was wrong, and the fix would have made things worse</summary>

**What the entry claimed:** no DMARC record; add one at `_dmarc.send.theunivers.ai` starting at
`p=none`, tighten to `quarantine` later.

**What was actually true.** A DMARC record existed at the ROOT all along —
`v=DMARC1; p=quarantine; adkim=r; aspf=r` — a GoDaddy default carried over when DNS moved to
Cloudflare. **DMARC inherits down to subdomains unless `sp=` overrides it, and there is no `sp=`**,
so `send.theunivers.ai` was already covered at `quarantine`, and already passing: DKIM signs as
`send.theunivers.ai` and SPF is `send.send.theunivers.ai`, both of which align relaxed against
`theunivers.ai`. That is why the reset email reached an inbox rather than spam under an active
quarantine policy.

**Two errors, and the second is the dangerous one.**

1. I checked `_dmarc.send.theunivers.ai`, found nothing, and concluded there was no DMARC — without
   checking the parent, which is the first place to look for an inheriting record.

2. **The recommended fix was weaker than the status quo.** Adding `p=none` on the subdomain would
   have OVERRIDDEN the root's `quarantine` and loosened the posture — an improvement in the diff,
   a regression in effect. Nothing in this repo would have caught it: `claims-check` reads copy,
   `docs-check` reads references, neither reads DNS.

**Resolved 2026-08-11** by adding `_dmarc.send.theunivers.ai` at `p=quarantine` — same strength as
the root, reports redirected from GoDaddy's collector to a mailbox we actually read. Verified
against Cloudflare's nameservers and three public resolvers, with the root and the Microsoft 365 MX
untouched.

**The general lesson, which is the second time in two days:** "I checked X and found nothing" is not
"X does not exist". The same shape as reading `busy_timeout = 0` over `fly ssh` and reporting the
setting as unapplied — the probe was too narrow and the conclusion too broad. When the check is
cheap, check the layer above before declaring an absence.

</details>

<details><summary>Fly trial ended — the site was down for a day (2026-08-09)</summary>

`ERR_CONNECTION_CLOSED`. Not a code fault: the app booted clean and passed health checks every
time, and Fly stopped the machine ~4 minutes later because the trial had expired.

**The lesson: a 200 immediately after `npm run deploy` is not proof the site is up.** The machine
was alive for the minutes it took to answer. Re-check some minutes later before believing a deploy
held. This hid the expiry for two days.
</details>

<details><summary>Reset token returned in the HTTP response</summary>

`/api/auth/forgot` returned the token in a `__pilotOnly` field and logged it. That is account
takeover as an API. Fixed: the token now leaves only inside an email, `__pilotOnly` appears nowhere
in the codebase, and with no provider configured the send is dropped rather than the token exposed.
</details>

<details><summary>SQLite without WAL</summary>

Measured, 8 processes x 400 mixed ops:

| configuration | failed | wall time |
|---|---|---|
| rollback journal, no timeout | 1686 / 3200 | — |
| rollback journal + busy_timeout | 0 | 0.72s |
| WAL, no timeout | 981 / 3200 | — |
| **WAL + busy_timeout (production)** | **0** | **0.16s** |

`busy_timeout` removes the *errors* by making callers wait. WAL removes the *waiting*, ~4x here.
Both are wanted; neither substitutes for the other.

**Reading pragmas in production:** `busy_timeout` and `synchronous` are PER-CONNECTION. Opening a
second connection over `fly ssh` reports that connection's defaults and tells you nothing about the
running server — which briefly looked like the settings had not applied. Only `journal_mode`
persists in the file. Use `/api/metrics` → `storage`.
</details>

<details><summary>No rate limiting at all</summary>

`/api/auth/login` is not invite-gated and had no throttle: unlimited password guessing against any
known address. The invite gate had been doing that job by accident, purely by keeping the user
table tiny.

Then the first limits were too strict — `registerPerIp` at 5/hour would have blocked an entire
carrier-NAT of users. See the principle in `SECURITY.md`.
</details>

<details><summary>Mail could not reach anyone but the account owner</summary>

Everything looked finished — a real reset email had arrived, `mailConfigured: true`, valid key —
and Resend still refused every non-owner address with a 403 until `send.theunivers.ai` was verified.

**Found only by sending to an address that was not the account owner's.** Testing with your own
address proves less than it appears to.

A subdomain was used because the root already carries an SPF record for Microsoft 365 and a domain
may have only one; sending from the root would have meant editing the record the business email
depends on.
</details>

<details><summary>providers.mailer read a variable nothing used</summary>

`GET /api/auth/providers` reported `mailer` from `SMTP_HOST`, which nothing had used since mail
moved to Resend. The API said mail was off while it worked, and the client reads that flag — so the
forgot-password button read "Continue" instead of "Send reset link". Now derived from
`mailConfigured()` so it cannot drift from what actually sends.
</details>
