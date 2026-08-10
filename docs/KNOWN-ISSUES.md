# Known issues

Everything currently wrong or unfinished, worst first. **If you fix one, delete it here in the same
commit** — a stale known-issues file is worse than none, because people stop trusting it.

Last reviewed: 2026-08-10 · registration is OPEN · 1 real user

---

## MEDIUM — the Google OAuth client secret was pasted into a chat transcript

Treat it as public. `SECRETS-POLICY.md` settles it without needing to judge likelihood: exposure
means rotation.

**Fix:** rotate in Google Cloud Console, then `npm run secret GOOGLE_CLIENT_SECRET`.

---

## MEDIUM — no DMARC record

SPF and DKIM are in place for `send.theunivers.ai` and mail is being delivered. DMARC tells
receivers what to do when a message fails both, and its absence is a deliverability ceiling rather
than a fault — Gmail and Outlook increasingly expect it from bulk senders.

**Fix:** add a TXT record at `_dmarc.send.theunivers.ai`, starting permissively:

```
v=DMARC1; p=none; rua=mailto:theonlygreatofficial@gmail.com
```

`p=none` only asks for reports. Tighten to `quarantine` once the reports look clean. **Do not add
this at the root** — the root is Microsoft 365's and has its own posture.

---

## MEDIUM — the Bridge polls every 4 seconds

`src/app/Bridge.jsx:36` runs `setInterval(load, 4000)` against two endpoints, so every open tab
costs 0.5 requests/second whether or not anything changed.

Four costs: CPU (every request hits SQLite), egress (~450KB per ten-minute session, ~9GB/month at
1000 users — see `OPERATIONS.md`), mobile battery, and, ironically, latency — you still wait up to
four seconds to see a message.

**Fix:** Server-Sent Events. The server already knows when a message or post lands.

---

## LOW — rate-limit state is per-process

`server/ratelimit.mjs` holds counters in memory. Correct for one machine, wrong the moment there
are two: per-process limits multiply by the number of processes. **Move this to shared storage
before scaling to a second machine**, not after.

Recovery if a legitimate user is locked out: `fly apps restart theunivers-ai` clears all counters.

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
