# A location on a post — the author's claim, and nothing more

_Brief for the second-engineer seat (Cursor). Branch: `feat/post-location`._

The owner's request: a location button on Create-new-post so the author can add the place.

## Read this first: this repo already has a position system, and this is NOT it

`shared/assurance.mjs` grades a captured photograph by comparing the device's own coordinates
against an independently resolved position, and its opening doctrine is blunt:

> `navigator.geolocation` is trivially spoofable — DevTools sensors, a browser extension,
> Android's mock-location developer option.

That system exists to make an inspection **evidence**. A place name typed into a post box is the
opposite: unverified, unverifiable, and worth exactly what the author's word is worth.

**So the two must never share a visual language.** An inspection position is graded; a post location
is a caption. If a post's "Jebel Ali, AE" renders like an attested capture position, a buyer can
reasonably read it as checked — and that is the "never invent evidence in the interface" failure
that got `mock.js` deleted, in a new costume.

Label it as the author's, in the interface, in words. Not a badge, not a pin icon borrowed from the
inspection screens.

## THREE DECISIONS

**1. Typed, not sensed. Do not call `navigator.geolocation`.**
The repo's own doctrine says a device coordinate proves nothing, and a browser location prompt on a
create-post screen is a privacy default nobody chose. The author types where it is.

**2. No geocoding service.** The CSP allows no external hosts, and a places API means a key, a
running cost, and a hole in `connect-src` for a decoration. A free-text name plus an optional
country from the `countries.js` list we already ship gives almost all the value at no
architectural cost. The country code is the machine-readable half — it is what a later Discover
filter would use, and it speaks the same alpha-2 as Corridor's `Jurisdiction`.

**3. Optional, removable, and never remembered.** It defaults to empty on every new post. Do not
pre-fill it from the author's last post or their profile country — a location that reappears by
itself is how someone publishes a place they did not mean to. Removing it is `POST /api/works/update`,
which already enforces author-only and 409-under-review.

## Build

### Server
- `work.place` (`TEXT`, nullable) and `work.place_cc` (`TEXT`, nullable, alpha-2).
  `ensureColumn`, as usual. NULL is "no location", which every existing work already is.
- Accept both on `POST /api/works` and `POST /api/works/update`.
- **Validate:** `place` trimmed, **max 80 characters**; `place_cc` must be a code that exists in the
  shared country list or a 400 — an unknown code is a filter that will silently match nothing.
  A `place_cc` with no `place` is allowed (a country alone is a location). A `place` with no
  `place_cc` is allowed too.
- Return both from the works payload and from Discover.
- It is user text on other people's screens: it goes out as data and is rendered as text, never as
  markup, and never interpolated into a URL.

### Client
- A **location control in `CreatePost`**, below the caption: a text field ("Add a location") and a
  country select built from `countries.js`. Both optional, both clearable.
- Shown on `WorkDetail` and on the Discover cell when present, **worded as the author's claim** —
  e.g. a plain line reading `Jebel Ali, AE · added by the author`. Absent renders as absent: no
  empty row, no placeholder, no "Location: —".
- Editable from the existing edit form in `WorkDetail`, alongside title and body.

### Not in scope
Map display, coordinates, a places autocomplete, distance search, and any use of this field in
trust, ranking or assurance. **It must not feed the trust system** — an unverified string that
influenced a tier would be a way to buy standing with a sentence.

## Tests
- `place` over 80 characters → 400. An unknown `place_cc` → 400.
- A country with no place name is accepted; a place name with no country is accepted.
- NULL on a pre-existing work renders nothing at all — no empty row.
- The value round-trips through create, update and Discover.
- **It reaches no trust, ranking or assurance code path** — assert the absence, because this is the
  invariant that would be quietly lost first.
- Update still obeys author-only and 409-under-review.

## Done
`npm run build && npm test` green, rules tested, commit in the house style. Do not deploy.
