# ADR-0007 — Moderation posture: who reviews, against what, and what a person is told

**Status:** accepted · 2026-08-12 · the §8c default, taken on silence as it said it would be
**Closes:** the last open item in ADR-0005's item 1 (safety)
**Depends on:** `ADR-0003` (withdraw, not delete) · `ADR-0006` (takedown retains, purge destroys)

The default was written into `docs/specs/PREMIUM-SOCIAL-V1.md` §8c on 2026-08-12 and assigned to
the adversary seat, with the rule that **deciding by the end of the round was the job and silence
was consent**. The round closed. It is recorded here rather than left implied, because a posture
nobody wrote down is a posture nobody can be held to — and because the seats' arguments during that
round changed three parts of it, which is worth keeping.

---

## The posture

**1 · A published standard exists before any outside user does.** Enforcement against a person who
was never told the rule is arbitrary, whatever the rule says. Registration is already open, so this
is owed now rather than at some later scale.

**2 · One named human reviews, and it is the person who operates this node.** Not a role, not a
panel, not a queue with a rota. There is one, and the interface must never imply otherwise —
`docs/specs/TAKEDOWN.md` refuses an operator dashboard for the same reason it refuses a second desk.

**3 · The ladder is limit → remove → suspend, and it is ADVISORY.** ADR-0006 settled that: no guard
enforces the order, no waiting period is required, and CSAM, live exploit payloads and credible
threats bypass every rung immediately. Copy that claims a limit is *required* before a removal
would be false, and `claims-check.mjs` should catch it.

**4 · Every enforcement action writes a receipt.** Limit, takedown and suspension each append to the
subject's own chain. A record of conduct is what this product claims to be, and a moderation system
that leaves no record inside it would be the one place the claim did not hold.

**5 · An appeal goes to the same human, and the interface says so.** There is no second desk and no
panel, so the honest sentence is *"your appeal goes directly to the operator of this node"*. Saying
anything vaguer invites a person to imagine an escalation path that does not exist, which is worse
than the plain fact.

**6 · A receipt is an observation, never a verdict.** *"A post was taken down under report X for
this stated reason"* — not *"this person did something wrong"*. The distinction matters most in the
case where the operator was mistaken.

---

## What the round changed

Three things in the original default were wrong or incomplete, and the seats caught all three.

**The operator is named to the affected person, NOT on the public tombstone.** The first draft would
have put *"removed by Operator <name>"* on the card everybody sees. `cursor`'s objection stands: a
public card naming a human on every removal is a targeting surface, and **the people most motivated
to find that name are the ones just removed**. `openclaw` confirmed pseudonymous moderator
communication is ordinary trust-and-safety practice. So the name appears on the appeal path on the
affected person's own account, where it is owed, and nowhere else.

**A reporter is not owed a relationship.** They are told a person will review it, and nothing more —
not the outcome, not the reviewer, not a timeline. A report is a request to look, not the opening of
a correspondence, and promising more would be a promise one human cannot keep.

**"Adjudicable" is a procedure, not a schema.** `gemini` argued the DSA case: a removal must stay
disputable for a window or an appeal cannot be heard. That is right, and ADR-0006 answered it
without a locker — the reversible rung already exists, so the answer is *an operator limits first
when there is any doubt*, as judgement rather than as a guard.

---

## What this obliges

- ~~**Write the standard.**~~ **DONE 2026-08-12 — `docs/STANDARD.md`.** Written against the **Santa
  Clara Principles 2.0**, the reference twelve major platforms endorse, rather than invented. That
  research found **two places where this posture does not meet them**, and the standard discloses
  both in §6 rather than papering over them:

  1. **Appeals are not reviewed by someone uninvolved.** The Principles require review by a person
     "not involved in the initial decision". With one operator that is structurally impossible.
     Claiming a panel would be a lie; routing appeals to a second inbox belonging to the same person
     would be the same lie with a form in front of it. **Closes when a second person can act as
     operator.**
  2. **A reporter is told nothing about the outcome.** The Principles say flaggers should get a log
     of their reports and what happened. §"a reporter is not owed a relationship" above stands, and
     is now a *disclosed deviation* rather than an unexamined preference.

  What the posture does meet: notice of what was actioned and why, durable and surviving suspension;
  the reason and removing party recorded; content identifiable by id; and no automated enforcement
  of any kind.
- **The interface says "advisory"** where it describes the ladder, and **names the operator only on
  the appeal path**.
- **No `moderator` column, no operator dashboard, no second desk** — all three already refused, and
  this ADR is why they stay refused.

## What was rejected

**A panel, a rota, or an appeals board.** There is one person. Describing anything else would be the
same class of claim as a trust tier nobody earned.

**Telling the reporter the outcome.** It sounds like courtesy and is an obligation nobody can meet
at this size, and it leaks a moderation decision about a third party to a stranger who asked about
them.

**Automated enforcement on report volume.** Already structurally refused in the code — no count acts
on anything — and this ADR keeps it that way. A threshold that removes content is a brigading tool.
