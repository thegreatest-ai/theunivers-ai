# "Use my location" — the device asks, the server names it

_Brief for the second-engineer seat (Cursor). Branch: `feat/live-location`._

The owner overruled the earlier typed-only decision, and is right to: typing "Dubai Marina" by hand
is not what people mean by adding a location. **Build the real thing — a button that asks the
browser for the device position.** The typed field stays; this fills it in.

`docs/specs/POST-LOCATION.md` shipped the typed half. This is the sensing half, and it does not
replace it.

## The problem that decides the design

`navigator.geolocation` returns **coordinates**. `25.0762, 55.1341` is meaningless to a reader, so
something has to turn it into a name — and a browser cannot, without asking a geocoding service.

That service is why this was deferred: the CSP allows **no external hosts**, and calling one from
the page means a hole in `connect-src`.

**The fix is a server-side proxy.** The browser sends coordinates to *us*; our server asks the
geocoder and returns a name. The page still only ever talks to its own origin, so **the CSP is not
touched at all**, we control the rate limit and the cache, and the third party is swappable in one
file.

## THE DECISIONS

**1. Coordinates are used, then discarded. Only the NAME is stored.**

A raw lat/lng on a public post is precise enough to be someone's front door, and once published it
cannot be recalled. Instagram publishes a *place*, not a fix. So: the browser sends coordinates, the
server resolves a name, and **`work.place` / `work.place_cc` are what get written** — the columns
that already exist. **No lat/lng column. Do not add one.** The coordinates live for the duration of
one HTTP request.

**2. It is still the author's claim, and still says so.**

`placeClaim()` already renders `<where> · added by the author`. That wording does not change when
the name came from a sensor, because `shared/assurance.mjs` is right that a device position is
trivially spoofable, and a *resolved* name is no better. This is a caption. The attested-position
system is a different thing and they must keep looking different.

**3. The author confirms before it is attached.**

The resolved name lands **in the editable text field**, not straight onto the post. A geocoder that
returns the wrong suburb is common, and a location the author never read is one they never agreed
to publish. They can correct it, or clear it, before Share.

**4. Never automatic.** No permission prompt on opening Create-new-post. It fires only on a click of
the button, which is what "enable" means.

## Build

### Server — `POST /api/geocode/reverse`
- Session required. Body `{ lat, lng }`, validated as numbers in range (`lat` −90..90, `lng`
  −180..180); anything else is a 400.
- Resolves via **OpenStreetMap Nominatim** in a new `server/geocode.mjs`, written as **one
  swappable provider** with a single `reverse(lat, lng)` export — the same shape as
  `server/storage.mjs`, and for the same reason.
- Nominatim's usage policy is binding and unmetered use gets blocked: send an identifying
  `User-Agent` naming this app and a contact, and **serialise requests to at most one per second**
  process-wide.
- **Cache** on a coarse key — coordinates rounded to 3 decimals (~110m) — so a person standing still
  does not re-ask, and repeat lookups cost nothing.
- Rate-limit per user and per IP through `server/ratelimit.mjs`, alongside the existing buckets.
- Returns `{ place, place_cc }` only — a short name and an alpha-2 code, both validated against the
  same rules `POST /api/works` already applies, so a geocoder cannot post something the typed field
  would have refused. **Never return the raw geocoder payload**; it carries a full address.
- On failure — timeout, refusal, no result — answer `{ place: null }` with a 200. **A geocoder being
  down is not the author's error**, and the typed field still works.

### Client — make it EASY TO FIND, which it currently is not

The owner's words: *"make it more easy to access"*. The typed field shipped tucked under the
caption textarea, where it reads as an afterthought and is easy to miss entirely.

- Promote location to **its own labelled row in the compose form**, visually distinct from the
  caption block — a pin glyph, the word **Location**, and the controls on one line. It should be
  scannable at a glance while filling the form, not discovered by reading downward.
- **"Use my location" is the primary control** and sits first; the free-text field is the fallback
  beside it. Someone who wants their location should press one obvious button, not type.
- When a location is set, show it as a **removable chip** — the value plus a clear ✕ — so the
  current state is legible without reading an input's contents.
- The same row belongs in `WorkDetail`'s edit form, so changing a location later is the same
  gesture as setting it.
- Keep it keyboard reachable and labelled; a glyph alone is not a label.

### Client — the button itself
- A **"Use my location"** button. On click: `navigator.geolocation.getCurrentPosition`, then
  `POST /api/geocode/reverse`, then fill the text field and country select.
- Handle every branch honestly, because this is the API people get wrong:
  - **permission denied** → "Location is off for this site. You can type it instead." Never re-prompt
    in a loop.
  - **timeout / unavailable** → say so, keep the typed field.
  - **resolved nothing** → say so.
  - **in flight** → a busy state, since GPS can take several seconds.
- One line of plain copy under the button, always visible: **"Your coordinates are used to look up a
  place name and are not saved."** That is a true statement about decision 1, and it should stay
  true — if anyone ever adds a lat/lng column, this line has to change in the same commit.
- `enableHighAccuracy: false`. A suburb name needs no GPS fix, and high accuracy costs battery and
  time for precision this deliberately throws away.

## Tests
- Out-of-range or non-numeric coordinates → 400.
- The route returns only `place`/`place_cc` — assert the raw provider payload does not reach the
  client.
- A provider failure returns 200 with `place: null`, not a 5xx.
- **No lat/lng column exists on `work`** — assert it, because that is the invariant the privacy copy
  depends on.
- The cache serves a second nearby request without a second provider call.
- The typed path still works with the geocoder unreachable.

## Done
`npm run build && npm test` green, rules tested, commit in the house style. Do not deploy.
