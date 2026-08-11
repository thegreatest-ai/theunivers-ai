# Security

What protects what, and why each control is shaped the way it is. Where a control exists because
something was actually wrong, that is said — a rule whose reason is recorded survives a refactor.

---

## Identity

**Passwords** — scrypt via `node:crypto`, stored as `scrypt$N$r$p$salt$hash`, compared in constant
time (`server/passwords.mjs`). Policy lives in `shared/password-policy.mjs` and is imported by both
the browser and the server: 8+ characters, one capital, one number, one symbol. The browser copy
is a courtesy; **the server copy is the gate**, because anyone can POST straight to the API.

**Sessions** — opaque random tokens in the `session` table. Not JWTs: revocation matters more here
than statelessness, and a JWT you cannot revoke is a problem at exactly the moment you need one.

**OAuth** — Google and GitHub, state signed with `OAUTH_STATE_SECRET`. An account created through
OAuth has `password_hash NULL`.

**`providers.google` means "both variables are set", not "sign-in works".** It cannot mean more:
the redirect URI is only validated by Google, at the moment a user is sent there. Google sign-in
was broken in production for two days behind a `google: true` flag, because the client authorised
`localhost` and nothing else. **A configuration check that tests presence will report a broken
integration as healthy** — the only real test is completing a sign-in.

Rotating an OAuth client, in order, because the wrong order fails confusingly:

1. add BOTH environments' origins and redirect URIs to the new client, exactly — `https`, no
   trailing slash, no `www`
2. set the client **id and secret together**; an id from one client with a secret from another
   passes the consent screen and fails at token exchange
3. complete a real sign-in
4. **then** delete the old client — that is the step that ends an exposure; everything before it
   only stops using the leaked value

Changing client is safe for existing users: the callback matches on `oauth_id` and falls back to
email, so an account is re-linked rather than orphaned.

### Setting a password on an OAuth account

`POST /api/auth/set-password` is two operations, and the difference is the security property:

- **First password** (`password_hash IS NULL`) — a valid session is sufficient. There is no current
  password to prove, and demanding one would make the feature impossible for the accounts that need
  it. This closes a real hole: a Google-only account whose owner loses their Google account is
  otherwise locked out permanently, because forgot-password has nothing to reset.
- **Change** — the current password is required *even though the caller is signed in*. Otherwise a
  borrowed session (someone at your unlocked laptop) converts a temporary compromise into a
  permanent one.

On success **every other session is dropped** and the caller's survives. A password change is what
you do when you fear someone else has access; leaving their session alive would make it theatre.

---

## Not leaking who exists

Three endpoints could otherwise be used to enumerate accounts, and each is closed deliberately:

| Endpoint | The leak | What it does instead |
|---|---|---|
| `POST /api/auth/login` | different errors for "no such user" and "wrong password" | one message for both |
| `POST /api/auth/forgot` | responding differently for a real address | identical response either way |
| `POST /api/auth/forgot` | **timing** — a send takes longer than no send | the send is **not awaited** |

That last one is subtle and worth keeping. Awaiting `sendMail` makes the response measurably
slower when the account exists, which is a reliable oracle no matter how identical the response
body is.

`GET /api/agent-name-available` *does* reveal whether a name is taken — that is inherent to unique
names and true of every username field ever built. It requires a session, so it is not an open
directory-enumeration endpoint.

---

## Password reset

The token is 24 random bytes, single-use, and expires in 30 minutes. It is cleared in the same
statement that sets the new password.

**It leaves the server only inside an email.** It used to be returned in the HTTP response so the
pilot could work without a mailer — that is account takeover as an API: anyone who could POST an
address received a token that reset that account. That convenience is gone permanently, and
`__pilotOnly` appears nowhere in the codebase.

If no mail provider is configured in production the send is dropped and logged, and the caller
still sees the neutral message. **A broken feature, never an open door.**

---

## Rate limiting

`server/ratelimit.mjs`. Fixed-window counters in memory.

> **Per-ACCOUNT limits protect accounts. Per-IP limits protect infrastructure.**

Only the per-account limit stops a targeted attack, because an attacker rotates addresses freely.
The per-IP limit exists to stop one host flooding us — *not* to stop a person signing up. So
per-account is tight and per-IP is generous, because **an IP is a terrible proxy for a person**:
mobile carriers in the UAE and India run carrier-grade NAT, so thousands of real users share one
address, and offices, cafés, universities and VPNs all look the same.

| Bucket | Limit | Purpose |
|---|---|---|
| `loginPerAccount` | 6 / 15 min | the real brute-force defence |
| `loginPerIp` | 100 / 15 min | flood ceiling only |
| `registerPerIp` | 20 / hour | must survive a launch day behind one carrier NAT |
| `forgotPerEmail` | 3 / hour | stops one address being mail-bombed |
| `forgotPerIp` | 30 / hour | flood ceiling |
| `resetPerIp` | 30 / hour | grinding, not guessing — the token is 24 random bytes |

`registerPerIp` was originally **5/hour**, which would have blocked an entire mobile carrier's
users after five signups. It was found by six test signups locking the tester's own machine out for
50 minutes. The limiter did exactly what it was told; what it was told was wrong.

A **successful login refunds an attempt**, so someone who mistypes twice and then succeeds is not
left one typo from a lockout. **Rejected attempts still count**, so an attacker cannot idle until a
window reopens.

### Client IP

```js
req.headers['fly-client-ip'] ?? req.socket?.remoteAddress ?? 'unknown'
```

`Fly-Client-IP` is set by Fly's proxy and cannot be spoofed — the proxy overwrites whatever
arrived. **`X-Forwarded-For` is deliberately ignored.** Anyone can send it, and treating it as
identity would let an attacker mint a fresh limit per request by varying a header — worse than
having no limit at all, because it looks protected.

### Two limitations, written down rather than discovered

- **In memory** — single machine only. A second machine multiplies every limit by the number of
  processes. Moving to two machines means moving this to shared storage first.
- **Fixed window** — allows up to 2× the limit across a boundary. Irrelevant for password guessing,
  where the rate is still bounded by a constant.

---

## Agent authority

Three invariants, and breaking any one of them changes what the product *is*:

1. **Trust tier is derived, never granted.** No write path to a tier exists.
2. **One mandate enforcement site.** `server/guard.mjs` adapts Corridor's shared rules; the
   vendored copy is SHA-256 gated in `npm test`.
3. **Counterparty tier is resolved from anchors, never read from the request body.** Otherwise a
   counterparty asserts their own standing.

An anchor is written with `status: 'pending'`. Nobody has checked it. Writing it as verified on the
user's own say-so would make tier something you can claim, which defeats the entire point.

---

## Secrets

Policy: Keychain-first, masked, never committed, rotate on exposure (`SECRETS-POLICY.md`).

```bash
npm run secret                  # menu of known secrets
npm run secret RESEND_API_KEY   # hidden input → verify → Keychain → Fly
```

The script closes each route by which a key leaks, because every one of them is silent:

| Route | Closed by |
|---|---|
| shell history and `ps` | hidden prompt; the value is never an argument |
| terminal scrollback | input masked as `•` |
| `.env` committed by accident | never written to a file |
| **pasted into a chat** | the script exists so you never need to |

That last row is not hypothetical: `GOOGLE_CLIENT_SECRET` was pasted into a transcript and **still
needs rotating**. The key is handed to Fly over **stdin** via `fly secrets import`, not
`fly secrets set KEY=value`, which would put it in argv.

`MAIL_FROM` is deliberately **not** a secret — it is an address printed on every email — so it
lives in `fly.toml` where it is visible in version control.

`/api/metrics` requires `METRICS_TOKEN` and **404s when the variable is unset**. Off by default, so
a forgotten variable fails closed rather than publishing traffic volume to anyone who asks.

---

## Registration

Open since 2026-08-10 (`INVITE_REQUIRED = "false"`). Only the exact string `"false"` opens it, so a
typo fails closed. To close it again, set `"true"` and deploy.

It stayed shut until four things were true, because the gate was the only thing making their
absence survivable:

1. no reset-token leak
2. SQLite in WAL
3. rate limiting everywhere — **login is not invite-gated**, so the gate had been doing that job by
   accident, purely by keeping the user table tiny
4. **mail reaching strangers** — Resend refuses every non-owner address until a domain is verified

The fourth only surfaced by testing. After (3) everything looked finished: a real reset email had
arrived, `mailConfigured` was true, the key was valid. Opening then would have locked out every
user who forgot a password — the same failure the leak fix prevented, through a different door. It
was found only by sending to an address that was not the account owner's.

---

## Uploaded files

**A media URL is signed, not session-protected.** An `<img src>`, a `<video src>` and a download
link are ordinary browser requests and carry no `Authorization` header — requiring a session meant
every image silently failed and a PDF rendered `{"error":"auth required"}` as its own contents.

The signature covers **the media id and the expiry**, so a link grants exactly one file for a
bounded time and cannot be edited into a link for another. It confers no other authority: it is not
a session, and losing one loses nothing else. Compared in constant time, valid for 24 hours.

**The upload allowlist excludes SVG, HTML and JavaScript.** All can carry script, and a file served
from our own origin runs with our origin's privileges — an uploaded SVG is stored XSS with a
friendly extension. Serving adds `nosniff`, so a browser cannot decide a file is HTML whatever we
labelled it, and only images and video are `inline`; everything else downloads.

**A user's filename never reaches the filesystem.** Files are stored under a generated id and the
original name is a column, which makes path traversal a class of bug that cannot occur rather than
one to remember to prevent.

## A model reading strangers' text

`server/analyse.mjs` is the first place a model reads text written by other people. ADR-0001 says
that text is data and never instruction; this is where the principle becomes code.

Three defences, in order of how much they are worth:

**1. Structural — the only one that survives a successful injection.** The runner can write exactly
two things: `note.body`, and `citation` rows whose source already belongs to that note. It cannot
reach a mandate, an order, a user or another person's note. A perfect injection gets to write a
paragraph into the reader's own file and cite a post the reader themselves filed.

**2. Validation.** Every id the model returns is checked against the sources actually attached, so
it cannot cite something that is not there — and therefore cannot manufacture standing for an
account by naming it.

**3. Framing.** Sources are fenced and declared to be data. Worth doing, worth trusting least: a
framing instruction is a request, and overriding requests is exactly what an injection attempts.

Note also what is not attackable by design: **there is no tier column to grant.** Standing is
derived on read, so "give this account T4" is not a thing that can be written, however
persuasively it is asked for.

Tested in `test/analyse.test.mjs`, including an assertion that enumerates every table the runner
writes to and fails if it is anything but `note` and `citation`.

## Known gaps

See `KNOWN-ISSUES.md`. The security-relevant ones today: `GOOGLE_CLIENT_SECRET` needs rotating,
there is no DMARC record, and rate-limit state is per-process.
