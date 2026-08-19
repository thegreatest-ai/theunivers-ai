# Avatar upload: a photograph of the person, not initials

_Branch: `feat/avatar-upload`. Second-engineer seat._

From the handoff, ranked first among open items:

> **No avatar upload.** Profiles render initials. Every piece needed already exists — media
> upload, `image-size.mjs`, signed URLs. Small work, largest visible effect.

That is the gap. This closes it.

## What exists to build on — do not invent a parallel system

The upload path for a work is already the whole machine: raw bytes (not multipart), `store.put`,
MIME allowlist, per-person quota, dimensions from the bytes, a signed ten-minute URL, `nosniff`,
inline, no user filename on disk. An avatar is the same bytes through the same door.

Read before writing: `POST /api/works/:id/media` in `server/index.mjs`, `server/storage.mjs`,
`server/image-size.mjs`, `GET /api/media/:id`.

**An avatar is identity presentation, not a work.** Do not create a fake photo-work to hold it —
that would put a profile picture in the 3:4 grid, which is a different surface. The media *row*
is reused; the work table is not.

## THE DECISIONS

**1. One photograph, centre-cropped in a circle, bytes untouched.** Same argument as
`CREATE-POST-AND-RATIO.md`: the server has no image library and must not gain one for this. CSS
`object-fit: cover` on a circle is the crop. No zoom, no focal point, no "Original / 1:1" picker —
an avatar has one shape and it is the circle. Adding zoom here would be the compose-window
mistake (eight versions before anyone looked) applied to a 68px control.

**2. Absent is initials, never a stock face.** The same rule as a null ratio: absent renders as
absent. Inventing a silhouette, a gradient blob, or a numbered placeholder is inventing evidence
of a photograph that was never uploaded. Initials are what the screen already shows, honestly.

**3. Replace replaces; remove deletes.** An avatar is not cited. ADR-0003 and ADR-0008 exist
because other people's records pointed at the thing being erased. Nothing points at an avatar
except the person who set it, so the old bytes go when a new photograph lands, and they go when
the person removes it. Withdraw-don't-delete does not apply. The person remains; only the picture
is gone.

**4. Never a Google (or GitHub) profile URL.** The CSP's `img-src` is `'self'` for product
images. A `lh3.googleusercontent.com` URL in an `<img>` is an external host, and the
non-negotiable rule is that the page talks to no external hosts. OAuth already stores name and
email and not a picture URL — keep it that way. If a provider photo is ever wanted, the *server*
fetches it and stores the bytes. Not this brief.

**5. The server is the gate.** Images only (`store.allowed(mime)?.kind === 'image'`). Same 6MB
cap, same 120MB quota — the avatar counts, because the bytes occupy the same volume. A video,
a PDF, or an SVG is a 415. A session is required; an agent token is not a person presenting
themselves.

**6. Render what the server returned.** A local blob preview while the request is in flight is a
courtesy. The saved face is `person.avatar.url` from the response. A success state for a failed
upload is the same failure as a toast for a comment that 500'd.

## Build

### Schema
- `user.avatar_id TEXT` via `ensureColumn` — the media id, or NULL. No foreign key: clearing it
  and deleting the row is one transaction, and a rebuild of `user` for a pointer we already
  control is ceremony.
- `media.work_id` becomes nullable. Avatar rows have `work_id IS NULL`. Existing work media is
  unchanged. SQLite cannot `ALTER` a `NOT NULL`; use the documented table rebuild. Fresh
  `CREATE TABLE` matches, so a new database never rebuilds.

### Server
- `POST /api/profile/avatar` — raw body, session, image only. Writes a media row with
  `work_id NULL`, sets `user.avatar_id`, removes the previous file if any. Returns
  `{ person }` with a signed URL. Still 200 on a replace — it is the same act.
- `POST /api/profile/avatar/remove` — POST, because this codebase does not DELETE and CORS
  allows GET,POST only. Clears `avatar_id`, deletes the row, removes the bytes. Returns
  `{ person }` with `avatar: null`.
- `publicPerson` and `publicUser` gain `avatar: { id, url } | null`. Null when unset or when
  the media row is gone — never a guessed URL. The URL is the existing `mediaUrl()`.
- Quota check subtracts the current avatar's bytes, so a replace that fits is not refused
  because the old file is still being counted.

### Client
- `src/app/Avatar.jsx` — one component. Photo if `src`, initials otherwise. Used by You,
  Person (including the follow list), and ProfileEdit. Messages stay as handle-initials:
  those circles are agents, and an agent is not a person's face.
- ProfileEdit (`/app/settings/profile`) is where the file is chosen. Own-profile avatar
  links there. `accept` is the image list works already uses. Change photo / Remove photo;
  Remove is absent when there is no photo, so the interface does not offer to delete nothing.
- No crop modal. Circle + `object-fit: cover`. Do not apply `cropStyle` / zoom — those belong
  to the post surfaces, and an avatar is not a post.

## Tests
- Upload a PNG; `GET /api/people/:id` returns a signed URL; fetching it returns the bytes and
  `nosniff`.
- A stranger sees the same photograph. Email / password fields still absent from `publicPerson`.
- A PDF, a video, and an SVG are 415. An agent token is 401.
- Replace deletes the previous file from disk. Remove returns `avatar: null` and initials are
  what the client renders when `src` is missing.
- Quota: the avatar's bytes are in `SUM(media.bytes)`.
- A work's media list does not include the avatar row — `work_id IS NULL` is not a carousel
  slide.
- Source-reading: You.jsx / Person.jsx render `<img>` only from `avatar.url`; they do not
  apply `cropStyle`; oauth.mjs never stores a provider picture URL.
- Absent stays absent: a user with no `avatar_id` has `avatar: null`, not `{}`, not a default
  path.

## Done
`npm run build && npm test` green, rules tested, commit in the house style. Do not deploy.
