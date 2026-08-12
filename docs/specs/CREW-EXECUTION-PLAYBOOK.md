# Crew execution playbook — production scaling

How seats collaborate to ship theunivers premium social surfaces without burning quota or regressing trust.

Companion: `docs/specs/PREMIUM-SOCIAL-V1.md`

---

## Modes

| Mode | Meaning | Command / UI |
|------|---------|--------------|
| **LOOP** | Only owner posts wake seats | Dashboard LOOP · `session mode loop` |
| **OPEN** | Session seats may wake each other (budgeted) | Dashboard OPEN · `session mode open` |

Relay must be running (`launchctl` agent `ai.thegreatest.teamroom-relay`).

---

## Hard rules

1. **Claim before edit** — `teamroom claim --what <path> --by <seat>`  
2. **One mandate guard** — never let chat/UI widen agent authority  
3. **No engagement theatre** — no like-count ranking, no infinite scroll in v1  
4. **Budget honesty** — OPEN wakes cost `maxWakes`; status/relay errors do not wake  
5. **Stay in session thread** for crew handoffs  
6. **Receipts** — every ship post: files touched, test command, residual risk  
7. **Known issues** — if incomplete, update `docs/KNOWN-ISSUES.md` in the same change  

---

## Per-seat checklist (every task)

### Before
- [ ] Read PREMIUM-SOCIAL-V1 §3–5  
- [ ] Claim path(s)  
- [ ] Name the viewpoint you are optimizing (user / individual / owner / agent)

### During
- [ ] Prefer vertical slices over horizontal stubs  
- [ ] Match existing patterns in `server/` and `/app`  
- [ ] Do not add dependencies unless owner-approved  

### After
- [ ] Run relevant tests / smoke  
- [ ] Post Team Room receipt  
- [ ] Release claim if done  
- [ ] Ask Gemini for adversarial pass on trust/privacy diffs  

---

## Production gates (do not skip)

From `docs/specs/SCALING.md`:

| Gate | Check |
|------|-------|
| Fan-out | Social publishes must not `SELECT id FROM user` for all users |
| Metrics | `/api/metrics` still meaningful after change |
| Media | Size caps + dispose/promote path respected |
| Authz | Session/agent token boundaries unchanged |
| SQLite | No “we’ll shard later” without second-machine trigger |

---

## Handoff template (paste into Team Room)

```
RECEIPT · <seat>
Claim: <paths>
Viewpoint: user | individual | business | agent
Done: <1–3 bullets>
Tests: <commands>
Risks: <what remains>
Next: <@seat> please <ask>
```

---

## Ending the session

```bash
cd ~/Studio/products/agent-exchange
node teamroom/teamroom.mjs session mode loop
# or dashboard → LOOP
node teamroom/teamroom.mjs digest
```
