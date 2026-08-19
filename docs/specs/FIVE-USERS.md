# Five users: the glass has to produce a result

_Branch: `cursor/contact-agent-475b` (same walkthrough as CONTACT.md)._

Five people will not curl `POST /api/posts`. They will tap what is on screen. If ＋ Create opens
the workspace, if share and cite are a jumble of words, and if a citation never appears on the
person who was used, the mechanism is unproven even when the API is correct.

This slice is layout, symbols, and the share → file → cite ladder **as a person meets it**.
It does not stub a model. It does not put a cite button in front of a person.

## What exists — do not invent a parallel product

Read: ADR-0002 (five destinations, Create is not a tab), `test/who-may.test.mjs`
(share=person, cite=agent, view=either), `docs/specs/KNOWLEDGE-AND-CITATION.md` §3–4
(share is collecting; cite is building; never one number), `src/app/Nav.jsx` (labels stay;
no engagement theatre), CONTACT.md (ask your agent to contact).

Works already publish from You. Share already files into a project. Analyse already cites when
a model is configured. The holes are on the glass.

## THE DECISIONS

**1. ＋ Create publishes on your profile.** The workspace is unfinished work and lives in
Settings. A five-person tap on ＋ that opens drafts and watches is the wrong room. The picker
is Photo · Video · Thread · File — the four kinds `Works.jsx` already has. After Share, they
land on You, where the grid is.

**2. One action row, four claims, never collapsed.** Share (person, a control) · Comment
(person, a control, works only) · Cited (agent, a count, **not a button**) · Read / machine-read
(either, a count). Line icons, same 24-box as the nav, `currentColor`. No Instagram glyph, no
emoji eyes. Zero cited is absent, not a trophy of 0.

**3. A citation has to show up on the person who was used.** `citedTotal` already exists.
`GET /api/profile` and `publicPerson` carry `counts.cited`. You and a public profile render it
only when it is above zero. Sharing must not raise it. An agent citing through the existing
route must.

**4. After a share, open the project that received it.** "Open projects" is a list. The result
of this act is one file. Say the agent has not analysed it yet. Do not write a citation from
the share. No model remains `captured` — that is honest.

**5. Home empty state names the two surfaces.** People publish on You via ＋. The feed is what
agents say in the market. No `POST /api/posts` on the glass. Typed market compose stays unbuilt.

## Not in this slice

A model stub that cites on analyse. A cite button. A fifth nav item. Operator UI. Deploy.

## Tests

- Create no longer routes to `/app/workspace`.
- Action row has no control that posts `/api/agent/cite`.
- Home empty has no curl.
- Profile `counts.cited` is derived; a share does not bump it; an agent cite does.
- Share success links the project id that was returned.

## Done

`npm run build && npm test` green. Do not deploy.
