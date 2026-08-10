# Known issues

Everything currently wrong or unfinished, worst first. If you fix one, delete it from here in the
same commit — a stale known-issues file is worse than none, because people stop trusting it.

Last reviewed: 2026-08-10

---

## RESOLVED 2026-08-10 — Fly trial ended (kept for the lesson)

The site returned `ERR_CONNECTION_CLOSED` for a day. Card added; `billingStatus` is now `CURRENT`
and the site returns 200. The lesson is in OPERATIONS.md and worth repeating: **a 200 immediately
after `npm run deploy` is not proof the site is up.** The machine was alive for the few minutes it
took to answer, then stopped. Re-check some minutes later before believing a deploy held.

<details><summary>original entry</summary>

### BLOCKER — the site is down: Fly trial ended

`https://theunivers.ai` returns `ERR_CONNECTION_CLOSED` (curl: exit 000).

Not a code fault. The app boots clean and passes its health check every time; Fly stops the
machine about four minutes later. From the logs:

```
17:43:27  theunivers Bridge pilot on https://theunivers.ai     ← boots
17:43:28  Health check 'servicecheck-00-http-8790' is passing   ← healthy
17:48:23  Trial machine stopping. To run for longer than 5m0s, add a credit card
18:30:06  Machine stopping. trial has ended
```

`fly status` also refuses: *failed to list active VMs: trial has ended*.

**Fix:** add a card at https://fly.io/trial. Fly requires a card on file for every organisation;
there is no route around it, and the legacy free allowances apply only to organisations that
predate the Pay-As-You-Go plan. The machine is *stopped*, not destroyed — the volume and its data
are intact.

</details>

---

## HIGH — production has no mail provider (the LEAK is fixed; delivery is not)

**The dangerous half is done.** The reset token no longer leaves the server in an HTTP response;
it leaves only inside an email (`server/mail.mjs`). Verified against production: `/api/auth/forgot`
returns nothing but the neutral message.

**The remaining half needs a credential I cannot create.** `RESEND_API_KEY` is unset, so in
production `sendMail` logs an error and drops the message — `/api/metrics` reports
`mailConfigured: false`. Password reset is therefore *safe but non-functional*: a user who forgets
their password currently has no route back in.

**Fix:** create a key at resend.com, verify theunivers.ai as a sending domain (SPF + DKIM records
in Cloudflare — note the existing MS365 MX must not be disturbed), then:

```bash
fly secrets set RESEND_API_KEY=re_… MAIL_FROM='theunivers.ai <noreply@theunivers.ai>'
```

Swapping to Postmark or SES means one more function in `mail.mjs` and no change anywhere else.

---

## ~~HIGH — no SMTP~~ (superseded by the entry above)

`/api/auth/forgot` returns the reset token in a `__pilotOnly` field instead of emailing it. That is
fine for one tester and unusable the moment strangers sign up.

**Fix:** wire a mailer (Resend or Postmark; free to ~3000/month) and delete the `__pilotOnly`
field. It is labelled "Remove before production" at the call site.

---

## RESOLVED 2026-08-10 — SQLite now runs WAL

Verified in production from the server's own connection (`/api/metrics` → `storage`):
`journal_mode = wal`, `busy_timeout = 5000`, `synchronous = 1` (NORMAL).

Measured with 8 concurrent processes × 400 mixed read/write ops:

| configuration | failed | wall time |
|---|---|---|
| rollback journal, no timeout | 1686 / 3200 | — |
| rollback journal + busy_timeout | 0 | 0.72s |
| WAL, no timeout | 981 / 3200 | — |
| **WAL + busy_timeout (production)** | **0** | **0.16s** |

The nuance worth keeping: `busy_timeout` is what removes the *errors* — it makes callers wait
instead of throwing. WAL is what removes the *waiting*, roughly 4x on this workload. Both are
wanted, and neither substitutes for the other.

**Careful when reading pragmas in production:** `busy_timeout` and `synchronous` are PER-CONNECTION.
Opening a second connection over `fly ssh` reports that connection's defaults and tells you nothing
about the running server — only `journal_mode` persists in the file. Use `/api/metrics`.

---

## ~~HIGH — SQLite without WAL~~ (superseded)

`server/db.mjs` sets no PRAGMAs, so the database is on the default rollback journal where a writer
blocks every reader and vice versa. Invisible at one user. At ~30 concurrent it produces
`SQLITE_BUSY` errors that look random and are hard to attribute.

**Fix** (three lines, in `db.mjs` before any query runs):

```js
db.exec('PRAGMA journal_mode = WAL');    // readers no longer block the writer
db.exec('PRAGMA busy_timeout = 5000');   // wait for a lock instead of throwing
db.exec('PRAGMA synchronous = NORMAL');  // safe under WAL, much faster writes
```

Note for backups: snapshotting a live SQLite file mid-write can capture a torn state. With WAL,
checkpoint before snapshotting, or accept that restore may lose the last few writes.

---

## MEDIUM — the Google OAuth client secret was pasted into a chat transcript

Treat it as public. Per SECRETS-POLICY.md, exposure means rotation, not judgement about whether
anyone saw it.

**Fix:** rotate in Google Cloud Console, then `fly secrets set GOOGLE_CLIENT_SECRET=…`.

---

## MEDIUM — the Bridge polls every 4 seconds

`src/app/Bridge.jsx:36` runs `setInterval(load, 4000)` against two endpoints, so every open tab
costs 0.5 requests/second whether or not anything changed. At scale this is both CPU and the
largest single source of egress: a ten-minute session spends ~450KB asking "anything new?".

**Fix:** replace with Server-Sent Events. The server already knows when a message or post lands.

---

## LOW — GitHub OAuth is configured but has no credentials

`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` are empty, so the server reports `Github off` at boot
and the button correctly does not render. The code path is finished and tested; only the
credentials are missing.

---

## RESOLVED 2026-08-10 — rate limiting exists

There is now a limiter (`server/ratelimit.mjs`) on every endpoint that guesses, enumerates or costs
money. Verified in production: the 7th wrong login returns 429 with `Retry-After: 876`.

| endpoint | limit |
|---|---|
| login | 30 / 15 min per IP **and** 6 / 15 min per account |
| register | 5 / hour per IP |
| forgot | 10 / hour per IP **and** 3 / hour per email |
| reset | 10 / hour per IP |

Login is limited on two keys because per-IP alone misses a distributed attack on one account, and
per-account alone misses one host working through many accounts. A successful login refunds an
attempt, so someone who mistypes twice then succeeds is not left one typo from a lockout.

`X-Forwarded-For` is deliberately ignored in favour of `Fly-Client-IP` — anyone can send the former,
and treating it as identity would let an attacker mint a fresh limit per request by varying a
header, which is worse than no limit because it looks protected.

**In memory, so single-machine only.** The moment a second machine runs, per-process limits multiply
by the number of processes and this must move to shared storage.

---

## LOW — the invite gate is still closed

`INVITE_REQUIRED = "true"` in `fly.toml`. The three things that had to be true before opening it —
no token leak, WAL, rate limiting — now are. What remains is a judgement call, not a defect, plus
the mail provider above: opening registration while password reset cannot deliver means anyone who
forgets a password is locked out permanently.

`INVITE_REQUIRED=true` is the only thing currently preventing open registration. Before switching
it off, add rate limiting to `/api/auth/register` — right now nothing stops automated signups.
