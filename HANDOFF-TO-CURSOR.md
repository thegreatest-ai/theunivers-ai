# Handoff — everything you need to work on theunivers.ai

_Written 2026-08-19. The repo is the bus: if it is not a file here, it does not exist._

## 0. Where you are

**`~/Studio/projects/theunivers-ai`** — one Node process serving three things from a single origin:
the cinematic marketing site at `/`, the **Bridge** product at `/app`, and the API at `/api/*`.

Live at **https://theunivers.ai** on Fly.io (region `bom`), currently **v84**.
GitHub: `github.com/thegreatest-ai/theunivers-ai` — **public**, so scan before every push.

```bash
npm install
npm run dev:all     # server :8790 + vite :5188
npm test            # 512 tests — run npm run build FIRST or it fails by design
npm run deploy      # build → real-browser render test → fly deploy
```

## 1. Read these first, in this order

| File | Why |
|---|---|
| `docs/ARCHITECTURE.md` | how the pieces fit |
| `docs/KNOWN-ISSUES.md` | everything currently wrong, worst first. **Fix one → delete its entry in the same commit** |
| `docs/SECURITY.md` | auth, rate limits, secrets, and why each control is shaped as it is |
| `docs/decisions/ADR-*.md` | eight decisions that are settled. Do not relitigate them silently |
| `docs/STANDARD.md` | the published standard this product claims to meet |
| `DEPLOY.md` | the ship loop and the secret handling |
| `git log` | the changelog. There is deliberately no CHANGELOG.md |

## 2. The rules that are not negotiable

These are each written because something broke. Breaking one is worse than shipping nothing.

1. **`share` is a PERSON. `cite` is an AGENT. `view` is either.** `test/who-may.test.mjs` is the
   rule as a test. Never put a cite button in front of a person — the route 403s and the interface
   would be lying.
2. **Nothing under an operator rung can be mutated.** `limited_at` / `taken_down_at` → 409 on edit
   and delete. An author under review must not alter what is being reviewed.
3. **Never invent evidence in the interface.** An invented count, an optimistic comment, a success
   toast for a failed request — all the same failure. Render what the server returned.
4. **Withdraw, don't delete** (`ADR-0003`, `ADR-0008`). A post or a commented work is emptied and
   tombstoned so citations still resolve. A 404 tells a citer their source never existed.
5. **Absent renders as absent, never as zero.** A null ratio must not become a collapsed cell.
6. **The server is the gate; the client is the courtesy.** Every limit is enforced server-side.
7. **The CSP allows no external hosts.** No CDN, no webfont, no remote image, no third-party API
   from the page. Reach external services from the SERVER (see `server/geocode.mjs`).
8. **`npm run build` before `npm test`** — `test/renders.test.mjs` fails on a stale `dist/` by design.

## 3. The three surfaces that deliberately disagree

Conflating these caused the worst regression in this repo (`cdda5cb`). Memorise it.

| Surface | Shape | Source |
|---|---|---|
| Profile grid | **3:4, always**, uniform, centre-cropped | `GRID_ASPECT` in `shared/work-ratio.mjs` |
| Discover feed | **the post's chosen ratio** | `feedAspect()` |
| Detail view | **the photograph's true shape** | the media's own dimensions |

The grid does **not** read `work.ratio`. The number is 3:4 because it was measured live, not
remembered — see `docs/specs/INSTAGRAM-SPEC-FINDINGS.md`.

## 4. Where the code lives

```
server/index.mjs        every route. Large and deliberately so — one file, one router
server/db.mjs           schema + the ensureColumn / table-rebuild patterns
server/env.mjs          .env loader. Resolves `keychain:NAME` refs — read the header
server/geocode.mjs      the reverse-geocode provider (swappable, like storage.mjs)
server/storage.mjs      media provider. One implementation; R2 goes here when video is real
shared/                 imported by BOTH server and browser — one definition, no drift
src/app/                the Bridge product (React)
src/App.jsx             the marketing scroll (Three.js). Do not put Three.js in /app
test/                   512 tests. Source-reading tests pin rules a unit test cannot
```

## 5. How work is done here

**A task starts as a file.** Every feature in `docs/specs/` was written as a brief before it was
built — invariants, decisions already made and their reasoning, what to build, what to test, what
NOT to do. Follow the same shape. `docs/specs/HIDDEN-WORDS.md` is the best recent example.

**Commit messages explain WHY.** Read `git log`. They are long on purpose: the reasoning is the
artifact, the diff is just its consequence. A message that says what changed and not why is a
message that will be reversed by somebody who did not know.

**Comments explain WHY.** Same rule, in the code.

## 6. Current state and what is open

**Shipped and live:** auth (password + Google OAuth), agents and mandates, orders with receipts,
Discover, the follow graph, block/report, the full moderation ladder (limit · takedown · dismiss ·
withdraw) with receipts, comments with **Hidden Words** filtering, the create-post window with
ratio · zoom · add-more · location, a 3:4 profile grid, and **avatar upload** — a photograph of
the person, centre-cropped in a circle; initials when absent.

**Highest-value open items** (details in `docs/KNOWN-ISSUES.md`):

1. **No operator interface in the browser.** Releasing a filtered comment or clearing the
   moderation queue is CLI-only.
2. **A shared operator token cannot say WHICH human moderated.** Blocking the moment a second
   person can moderate.
3. **Media lives on a ~900MB Fly volume.** Fine for photos; wrong for video. R2 provider goes in
   `server/storage.mjs`.
4. **Comments are flat and chronological.** Instagram is two-level and ranked. A deliberate
   decision has never been made — currently it is a default.

**The reference material** is in `design/`: `Instagram-Complete-Spec.pdf` (v2.0, measured live
2026-08-18) and `Instagram-Product-Design-Spec.pdf`. Findings extracted in
`docs/specs/INSTAGRAM-SPEC-FINDINGS.md`. Part 8 draws the IP line: **functionality is free, trade
dress is not.** Never the gradient, the glyph, the name, or filter names.

## 7. Two lessons this repo paid for

**ASSERT PRODUCTION FROM PRODUCTION.** Four times a confident claim about the running system —
DMARC, `busy_timeout`, the CORS header, the grid ratio — was drawn from a local file or memory and
was wrong. One curl or one DevTools hour settles it. Extended: **assert other people's products
from their products.**

**LOOK AT WHAT YOU BUILD.** Eight versions of the compose window shipped before anyone opened it in
a browser. Doing so immediately found three faults no test had caught. There is a harness pattern
for this: boot the server on a temp DB, register through the API, drive Chrome over the DevTools
Protocol, screenshot. Use it.

## 8. Do not

- Deploy without running the full gate yourself. Reported test counts are not evidence.
- Touch `.env` or any secret. Secrets are Keychain-first (`npm run secret`), account
  `theunivers-ai`, and `.env` holds `keychain:NAME` references only.
- Commit anything matching `.env*` — it is gitignored, and the repo is public.
- Add a title field to the compose window, reintroduce a square profile grid, or apply zoom in the
  detail view. Each was removed deliberately and each has a test guarding it.
