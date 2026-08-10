# Known issues

Everything currently wrong or unfinished, worst first. If you fix one, delete it from here in the
same commit — a stale known-issues file is worse than none, because people stop trusting it.

Last reviewed: 2026-08-10

---

## BLOCKER — the site is down: Fly trial ended

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

---

## HIGH — no SMTP, so password reset cannot work for real users

`/api/auth/forgot` returns the reset token in a `__pilotOnly` field instead of emailing it. That is
fine for one tester and unusable the moment strangers sign up.

**Fix:** wire a mailer (Resend or Postmark; free to ~3000/month) and delete the `__pilotOnly`
field. It is labelled "Remove before production" at the call site.

---

## HIGH — SQLite is running without WAL

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

## LOW — the invite gate has to come off before launch

`INVITE_REQUIRED=true` is the only thing currently preventing open registration. Before switching
it off, add rate limiting to `/api/auth/register` — right now nothing stops automated signups.
