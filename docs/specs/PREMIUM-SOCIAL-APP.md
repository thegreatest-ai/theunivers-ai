# Premium social app — see `PREMIUM-SOCIAL-V1.md`

**This file is a pointer. The canonical brief is `docs/specs/PREMIUM-SOCIAL-V1.md`.**

This document briefly existed as a second brief for the same product, written in parallel with the
crew's on 2026-08-12 and committed without a Team Room claim. Two briefs covering one product is
the exact drift this repository refuses everywhere else — the vendored rules are hash-gated,
`shared/ranking.mjs` is imported by both sides rather than copied, and `scripts/claims-check.mjs`
exists because two descriptions of one truth diverge. A second product thesis would have done the
same thing, more slowly and less visibly.

Everything it held was folded into `PREMIUM-SOCIAL-V1.md`:

- the verified state of the running system, read off the machine rather than remembered
- the invariant list, extended from 5 to 11, each with the reason it exists
- **§3b — what is missing, confirmed against the schema**, including the finding that there is no
  person-to-person messaging anywhere in the product
- the foreign-key warning that governs every delete in this build
- product phases with exit gates (§8b), and the owner's open decisions (§8c)

It is kept as a pointer rather than deleted because a published brief and an earlier commit both
cite this path, and a dead reference is worse than a redirect.
