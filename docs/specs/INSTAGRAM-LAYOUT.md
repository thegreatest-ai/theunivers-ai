# Instagram layout and interaction — take the model, not the dress

**Status:** BUILDING  
**Product:** `/app` Bridge social surfaces  
**Source of the numbers:** `docs/specs/INSTAGRAM-SPEC-FINDINGS.md` (live measurement 2026-08-18) and the interaction model every photo social product settled on.

Part 8 of the Instagram spec already drew the IP line this repo will not recross: **functionality is free, trade dress is not.** This brief is the layout and interaction half of that line. It does not copy Instagram's gradient, camera glyph, wordmark, filter names, or icon SVGs. It copies the *model* — the same way a steering wheel is not a trademark.

The practical test stays: put the two home screens side by side on a phone. A distracted person must not tap the wrong one. Colour signature and icon stay ours. Feature list and finger habits may converge.

## What we take

These are established interaction patterns, not Instagram's property.

1. **One 3-column profile grid, flush, 1px gutters, 3:4 cells.** Already the cell shape (`GRID_ASPECT`). What was missing is the *grid*: `auto-fill / minmax(150px)` becomes many columns on a desk and a set of cards. Instagram's index is always three columns, hairline gutters, no chrome on the tile. The foot (shareable, report) belongs in the detail, not under every thumbnail.
2. **The public profile is an index, not a dashboard.** Avatar, handle, follow, then three derived counts (published · followers · following), then name / bio / links, then the grid. Standing, anchors and the receipt chain stay on **You** (`/app/account`) — that is the operating surface, and Instagram's split between profile and Settings is the same split ADR-0002 already made.
3. **Detail is a window, not a page.** Photograph at its true shape on the left (or above, on a phone); caption, action row and comments in a pane. Swipe or arrow keys move a carousel. Dots mark the slide. Previous/Next remain as labelled controls so a screen reader is not left with anonymous chevrons.
4. **Create lives in the top bar on a phone, in the rail on a desk.** Instagram evicted it from the tab bar in Oct 2025. We had a floating ＋, which is neither their old centre tab nor their new top-bar plus. The FAB goes. ＋ opens the existing `CreatePost` window for a photograph — a person publishes works; they do not need an agent first. After Share, they land on You, where the new tile is.
5. **Discover's Works tab is a feed, not a card grid.** Author row, media at the chosen ratio, action row, caption. Agents stay a card grid; market posts stay a list. Three kinds, three shapes — the same reason Discover already has three tabs.
6. **Account and Sign out are not in the phone chrome.** They already live in Settings. A top bar that repeats them is the cropped-header bug in a new costume.

## What we deliberately do not take

- **Likes, double-tap-to-like, public heart counts.** `test/ranking.test.mjs` bans `like` / `reaction` as ranking substrate. PREMIUM-SOCIAL-V1 refuses public like counts as status. Copying the mechanic imports the incentive. Share (a person collecting) and cite (an agent building) remain the two honest acts.
- **Infinite scroll.** A page has a number. Discover already paginates.
- **Stories, Reels, Highlights, the 5-stop gradient, the camera glyph, filter names.**
- **Two-level ranked comments.** Still the open decision in the handoff. Flat chronological comments stay until that decision is written as an ADR.
- **Person-to-person DMs.** Built and removed; the agent is the interface.

## Invariants that still bind

- Three surfaces still disagree: grid 3:4, feed `feedAspect()`, detail the bytes. Conflating them is `cdda5cb`.
- Never invent a count. Published / followers / following are derived in `publicPerson`, same as today.
- `share` is a person, `cite` is an agent. No cite button in front of a person.
- CreatePost keeps `role="dialog"` and `trapFocus`. WorkDetail does not grow a second trap.
- `.wk-detail.cp` (compose) must not inherit the two-pane post layout.

## Tests

Source-reading, because this is layout:

- `.wk-grid` is `repeat(3, 1fr)` with `gap: 1px`; `.wk-shot` is still `aspect-ratio: 3/4`.
- WorkDetail has a swipe target on the stage and labelled previous/next, and uses `feedAspect` nowhere.
- Discover Works does not use `.wk-shot`.
- The FAB class is gone. Create is a control in the rail and in the phone top bar.
- `publicPerson.counts.published` is derived from visible work rows, not stored.

`npm run build && npm test` green. Do not deploy.
