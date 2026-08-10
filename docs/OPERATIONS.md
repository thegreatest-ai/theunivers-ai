# Operations

How theunivers.ai is hosted, what it costs, and what to do when it breaks.
`DEPLOY.md` covers the build-and-ship loop; this covers running the thing.

---

## Shape

One Node process on one Fly machine serves everything — marketing site, `/app`, and the API — from
a single origin. No CORS, no second host, cookies on one domain. State is SQLite on a Fly volume
mounted at `/data`.

```
Cloudflare DNS ──▶ Fly (bom / Mumbai) ──▶ node server/index.mjs :8790
                        │                    ├── dist/          static site + /app
                        │                    └── /api/*         the pilot API
                        └── volume theunivers_data ──▶ /data/pilot.db
```

Region is `bom` because the users are in the UAE and India. It is also Fly's most expensive egress
band — see below.

---

## What it costs

Rates from Fly's pricing docs, checked 2026-08-10. Fly requires a card on file for every
organisation, and the free allowances are legacy — honoured only for organisations that predate
the Pay-As-You-Go plan. This account does not qualify, so everything is metered.

| Item | Rate | Now | At ~1000 signups |
|---|---|---|---|
| Compute `shared-cpu-1x` (512MB now, 1GB later) | $3.32 / $5.92 per mo | $3.32 | $5.92 |
| Volume | $0.15/GB/mo | $0.15 (1GB) | $0.45 (3GB) |
| Certificate | $0.10/mo per hostname | $0.10 | $0.10 |
| IPv4 (**shared** — dedicated would be $2) | free | $0 | $0 |
| Egress from `bom` | $0.12/GB | ~$0 | ~$2.50 |
| | | **≈ $3.60/mo** | **≈ $9/mo** |

The egress estimate is built from the real bundle: ~335KB gzipped JS plus ~2MB of images
(`nebula.jpg` 932K, `neural.jpg` 884K), so ~2.4MB per first-time visitor, plus roughly 9GB/month
of the 4-second polling described in KNOWN-ISSUES.

**Two levers, both worth pulling before launch:**

- `min_machines_running = 0` in `fly.toml` (currently `1`). Fly then suspends the machine when idle
  and starts it on the next request, dropping compute to near zero for a pilot nobody is hitting.
  Cost is a cold start on the first visit after a quiet spell — measured at 1.3s in our own logs.
- Turn the Cloudflare proxy on (orange cloud). DNS is already there, and Cloudflare then caches
  those images for free, taking egress to roughly zero. Needs Full TLS mode and a check that the
  Fly certificate still validates — the proxy had to be *off* (grey cloud) for the certificate to
  be issued in the first place.

**The infrastructure is not the bill that matters.** Past 1000 users two other lines dominate:
email (~$20/mo once past a free tier), and model inference. The server currently makes **zero** LLM
calls and Corridor's `llm.ts` is a deterministic stub; the moment agents negotiate for real, that
cost dwarfs $9 of hosting. Decide the model routing before the agents go live, not after the first
invoice — author with a strong model, freeze, run routine turns cheap.

---

## Watching the spend

```bash
npm run spend          # report to the terminal, warns above $15/mo
npm run spend:dash     # the same, plus docs/spend.html
```

Every run appends one row per day to `data/spend-history.json`, so the trend builds itself. Re-running
on the same day replaces that day rather than double-counting it.

**Where the numbers come from, and how far to trust them.** Fly exposes no spend figure through its
API — introspecting the Organization type returns 35 fields, four about billing, and the only one
carrying a number is `creditBalance`, which is credit remaining rather than money spent. Their
Prometheus endpoint needs org-scoped permission a standard CLI token does not carry. So the tracker
prices your real inventory against Fly's published rate card:

| Line | Basis | Trust |
|---|---|---|
| compute, volumes, certs, IPs | fixed monthly rates for things `fly` lists | exact arithmetic |
| egress | counted by the app itself (`server/metrics.mjs`) | slight under-report |
| anything else Fly bills | not visible from inventory | not covered |

Egress under-reports because Fly meters at its edge, including TLS and proxy framing the origin
never sees. **It is a projection, not an invoice** — fly.io/dashboard → Billing is the authority,
and the tool prints that on every run rather than letting a confident number imply more than it knows.

Rates are hard-coded in `scripts/fly-spend.mjs` with a `RATES_CHECKED` date. That is deliberate: a
tracker that silently re-reads a moving price hands you a number that changed for reasons you cannot
see. When Fly changes prices, edit the block and the date so a diff shows exactly what moved.

`METRICS_TOKEN` gates `/api/metrics`. When it is unset the endpoint returns 404 — off by default, so
a forgotten variable fails closed rather than publishing your traffic volume to anyone who asks.

---

## When it breaks

**Site returns `ERR_CONNECTION_CLOSED` / curl gives 000.** The machine is not running. Check
billing first — this exact symptom was the trial ending, not a code fault:

```bash
fly status                 # "trial has ended" means billing, not bugs
fly logs --no-tail | tail -40
```

Distinguish the two cases by whether the app boots. `theunivers Bridge pilot on …` followed by
`Health check … is now passing` means your code is fine and something external stopped the machine.

**A deploy appears to succeed but the site dies minutes later.** Same cause. A 200 immediately
after `npm run deploy` only proves the machine was alive at that instant — it is not proof the
site is up. Re-check a few minutes later before believing a deploy held.

**Inspect the live database:**

```bash
fly ssh console -C "node -e \"
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync('/data/pilot.db');
  console.log(db.prepare('SELECT COUNT(*) c FROM user').get());
\""
```

**Before any migration that adds a UNIQUE index,** check the live data first. A duplicate makes
index creation throw at boot and the app will crash-loop:

```bash
fly ssh console -C "node -e \"…GROUP BY lower(trim(name)) HAVING COUNT(*)>1…\""
```

---

## Backups

Fly takes automatic daily volume snapshots with 5-day retention. Two caveats: snapshots are billed
by stored size, and snapshotting a live SQLite file can capture a torn write — see the WAL note in
KNOWN-ISSUES.

---

## Why Fly rather than Cloudflare Pages or GitHub Pages

Both are static hosts. This app is one process that serves the site *and* runs the API *and* holds
a SQLite file on a persistent disk. GitHub Pages was the original host and had to be abandoned for
exactly that reason: it cannot run `server/index.mjs`. Cloudflare Pages would mean splitting the
API onto Workers and the database onto D1 — a real rewrite. Cloudflare still earns its place in
front as a CDN (above); it just cannot be the origin.
