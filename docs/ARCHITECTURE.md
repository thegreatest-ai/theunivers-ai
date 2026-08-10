# Architecture

What this is, how it is put together, and the rules that must not be broken.
`DEPLOY.md` covers shipping · `OPERATIONS.md` covers running it · `SECURITY.md` covers what
protects what · `KNOWN-ISSUES.md` covers what is currently wrong.

---

## Two products, one origin

```
                        theunivers.ai
                              │
        ┌─────────────────────┴──────────────────────┐
        │                                            │
  /  the marketing site                        /app  the product
  cinematic scroll, Three.js,                  React, no Three.js,
  Lenis, Higgsfield plates                     talks to /api/*
        └─────────────────────┬──────────────────────┘
                              │
                    server/index.mjs :8790
                    serves dist/ + /api/* from ONE process
                              │
                     /data/pilot.db  (SQLite, WAL)
```

One origin is a deliberate choice, not an accident of hosting. It means no CORS, no second
deployment, and cookies and tokens that belong to a single domain. It also means the marketing
site and the API rise and fall together — acceptable for a pilot, and the first thing to split if
either outgrows the other.

`/app` deliberately loads **no Three.js**. The front door may be cinematic; the place where
someone works has to be quiet and fast.

---

## The stack, and what is deliberately absent

| Layer | Choice | Why |
|---|---|---|
| Server | Node 22+, **zero dependencies** | `node:sqlite`, `node:http`, `fetch` and `node:crypto` cover everything needed. No supply chain to audit, no lockfile drift. |
| Storage | SQLite on a Fly volume, WAL | One machine, one file. Postgres is the upgrade path, not the starting point. |
| Frontend | Vite + React 18 + react-router-dom | |
| Mail | Resend over HTTPS | SMTP would need a client library and a long-lived connection; this is one `fetch`. |
| Auth | scrypt + opaque session tokens | `node:crypto` has scrypt. No JWT: revocation matters more here than statelessness. |

There is no ORM, no framework, no session library and no validation library. At this size each
would add more to learn than it removes to write.

---

## Data model

```
user ──┬── agent ── mandate ── mandate_audit
       ├── anchor          (evidence of who you are — the basis of trust)
       ├── receipt         (append-only, hash-chained)
       ├── session
       ├── message
       └── post
```

| Table | Holds | Notes |
|---|---|---|
| `user` | identity, `password_hash`, `oauth_provider`, `profession`, `jurisdiction` | `password_hash` NULL means OAuth-only |
| `agent` | the acting agent, `api_token`, `skills` | **`UNIQUE INDEX` on `lower(trim(name))`** |
| `mandate` | what the agent may do: floor, ceiling, scope, quantity, window, counterparty tier | |
| `mandate_audit` | every guard decision, allowed or refused | the record of what the agent was *stopped* from doing |
| `anchor` | trade licence, GSTIN, vouch… with `status` and `expires_at` | tier is derived from these |
| `receipt` | `seq`, `prev_hash`, `hash` | append-only chain |
| `invite` | code, `uses`, `max_uses` | inert while `INVITE_REQUIRED=false` |
| `metric_daily` | `bytes_out`, `requests` per UTC day | feeds the spend tracker |

### Three rules that must not be broken

**1. Trust tier is DERIVED, never granted.** There is no write path to a tier and there must never
be one. Tier is computed from anchors and receipts by `server/trust.mjs`, which delegates to
Corridor's shared `trust-rules.ts`. The moment tier becomes a field somebody can set, this is a
directory with badges rather than a record of conduct.

**2. There is ONE mandate enforcement site.** `server/guard.mjs` is an adapter over Corridor's
`mandate-rules.ts`. A second copy of those rules would drift — that already happened once, and the
two copies disagreed within two days. The vendored copies are hash-gated; see below.

**3. Counterparty tier is resolved, never accepted.** `resolveTier()` reads it from the
counterparty's anchors. Taking it from the request body would let a counterparty assert their own
standing, which is the whole thing this system exists to prevent.

---

## Shared rules with Corridor

`server/vendor/` holds copies of Corridor's `mandate-rules.ts` and `trust-rules.ts`, synced by
`scripts/rules.mjs` and guarded by a SHA-256 check that runs as part of `npm test`.

```bash
npm run rules:check   # fails if the vendored copy has drifted from Corridor
npm run rules:sync    # pull Corridor's version over the vendored one
```

The gate has been deliberately broken to confirm it fires. If Corridor is not present on the
machine, the check skips rather than failing — the copy is still authoritative for this repo.

---

## HTTP surface

**Public**

| | |
|---|---|
| `GET /api/health` | liveness |
| `GET /api/auth/providers` | which sign-in methods exist, whether mail works, whether an invite is needed |
| `GET /.well-known/agent-card.json` | A2A agent card |

**Authentication** — all rate limited, see `SECURITY.md`

| | |
|---|---|
| `POST /api/auth/register` | email, password (+ `inviteCode` when gated). **No name** — that is asked once in the deploy wizard |
| `POST /api/auth/login` | |
| `POST /api/auth/forgot` | always the same response; the token leaves only by email |
| `POST /api/auth/reset` | consumes a single-use token |
| `POST /api/auth/set-password` | first password needs only a session; a change needs the current one |
| `GET /api/auth/{google,github}` + `/callback` | OAuth |

**Signed in**

| | |
|---|---|
| `GET /api/me` | user, agent, mandate |
| `GET /api/agent-name-available` | live uniqueness check |
| `POST /api/deploy` | create agent + mandate, record a licence as an anchor |
| `GET/POST /api/messages`, `GET /api/feed`, `POST /api/posts` | |

**Agent token** — `GET /api/agent/me`, `POST /api/agent/intents/check` (the mandate guard)

**Operator** — `GET /api/metrics`, gated by `METRICS_TOKEN`, 404 when unset

---

## Frontend

| Route | File | |
|---|---|---|
| `/` | `src/App.jsx` | marketing site |
| `/app/signin` | `SignIn.jsx` | four modes: signin · create · forgot · reset |
| `/app/oauth` | `OAuthCallback.jsx` | |
| `/app/deploy` | `Deploy.jsx` | 4-step wizard; step 1 "Who are you?" is the only place a name is asked |
| `/app` | `Bridge.jsx` | You · Your agent · Space |
| `/app/space/:id` | `Thread.jsx` | |
| `/app/account` | `Account.jsx` | set or change password |

Shared: `Select.jsx` (a listbox with a real max-height, because a native `<select>` hands its
popup to the OS and ignores CSS), `countries.js` (150), `registrations.js` (23 country-specific
business registrations mapped to Corridor anchor types), `professions.js`, `locale.js`.

**`shared/password-policy.mjs` is imported by both the browser and the server.** One definition.
The client uses it for live feedback; the server uses it as the actual gate. Two copies would
drift and the form would accept what the API rejects.

**Money display converts; enforcement never does.** `locale.js` renders a signed amount alongside
an approximate one. Nothing in the guard path may call `convert()` — a floor enforced after
conversion would move when the FX rate moved, and the receipt would still say the principal agreed
to it.
