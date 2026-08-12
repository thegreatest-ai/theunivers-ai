/**
 * Pilot storage — SQLite file on disk so a private deploy keeps state between restarts.
 * Schema mirrors Corridor shapes enough that a later swap to corridor-platform is mechanical.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DB_PATH ?? './data/pilot.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

/**
 * Concurrency and durability. These run before any schema statement, because journal_mode is a
 * property of the database file and changing it later means doing so under load.
 *
 * WAL is the important one. On the default rollback journal a writer takes an EXCLUSIVE lock over
 * the whole database and every reader blocks behind it. With one user that is invisible; with
 * thirty polling clients and somebody registering, requests start failing with SQLITE_BUSY —
 * surfacing as 500s on unrelated pages, appearing and vanishing with no pattern, and attributed to
 * the wrong request because the failing one is not the one holding the lock. Under WAL, readers
 * and the writer proceed concurrently.
 *
 *   busy_timeout  wait for a contended lock instead of throwing immediately. Without it WAL still
 *                 throws the moment two writers overlap, which is the case it is meant to soften.
 *   synchronous   NORMAL is the documented companion to WAL: safe against process crashes, and
 *                 only at risk of losing the last transactions in an OS-level crash or power cut.
 *                 FULL fsyncs every commit, which on a Fly volume is a real cost for a guarantee
 *                 a pilot does not need.
 *
 * journal_mode returns the mode it settled on, so it is asserted rather than assumed — a silent
 * failure here would leave the exact problem this block exists to fix.
 */
const mode = db.prepare('PRAGMA journal_mode = WAL').get();
const got = String(Object.values(mode ?? {})[0] ?? '').toLowerCase();
if (got !== 'wal') {
  console.warn(`[db] WAL not enabled (got "${got}") — expect SQLITE_BUSY under concurrency`);
}
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA synchronous = NORMAL');

db.exec(`PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS invite (
  code TEXT PRIMARY KEY,
  max_uses INTEGER NOT NULL DEFAULT 50,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'individual',
  jurisdiction TEXT NOT NULL DEFAULT 'IN',
  oauth_provider TEXT,
  oauth_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  api_token TEXT NOT NULL UNIQUE,
  skills TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mandate (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  commodity TEXT NOT NULL,
  scope TEXT NOT NULL,
  price_floor REAL,
  price_ceiling REAL,
  currency TEXT NOT NULL DEFAULT 'INR',
  max_quantity TEXT NOT NULL DEFAULT '{"value":40,"unit":"t"}',
  consumed TEXT NOT NULL DEFAULT '{"quantity":0}',
  delivery_window TEXT NOT NULL DEFAULT '{"from":"1970-01-01","to":"9999-12-31"}',
  counterparty_min_tier TEXT NOT NULL DEFAULT 'T2',
  expires_at TEXT NOT NULL DEFAULT '9999-12-31T00:00:00.000Z',
  spec_template_id TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
  from_role TEXT NOT NULL CHECK (from_role IN ('user','agent','system')),
  body TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS post (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  type TEXT NOT NULL,
  lane TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  referent TEXT,
  created_at TEXT NOT NULL,
  -- ADR-0003: a post is withdrawn, never deleted. Set means the author took it down — title and
  -- body are emptied at the same moment, so withdrawal is real at the API rather than hidden by
  -- the client. The row survives so a citation of it still resolves, to a tombstone.
  withdrawn_at TEXT
);

-- The feed is ORDER BY created_at DESC LIMIT 50, and without this index SQLite reads EVERY post
-- and sorts them in a temp B-tree to return fifty. Measured on the real schema: at 50,000 posts
-- that query took 28.63ms and with this index it takes 0.10ms. The cost grows with the table, so
-- it is the one index whose absence turns into an outage rather than a slow page.
CREATE INDEX IF NOT EXISTS post_recent_idx ON post(created_at DESC);

CREATE TABLE IF NOT EXISTS mandate_audit (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  code TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anchor (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES user(id),
  type        TEXT NOT NULL,          -- trade_licence | farmer_id | fpo_membership | ...
  issuer      TEXT NOT NULL,
  method      TEXT NOT NULL,          -- api | document | vouch | onsite
  status      TEXT NOT NULL DEFAULT 'pending',
  verified_at TEXT,
  expires_at  TEXT,                   -- an anchor that lapses must lower standing, not linger
  vouched_by  TEXT REFERENCES user(id),
  created_at  TEXT NOT NULL,
  -- A vouch with no voucher is an unanchored identity wearing a badge.
  CHECK (method <> 'vouch' OR vouched_by IS NOT NULL)
);

-- Append-only, hash-chained, per user. No UPDATE and no DELETE path exists in this codebase,
-- and none should be added: a record that can be rewritten is not evidence.
CREATE TABLE IF NOT EXISTS receipt (
  id           TEXT PRIMARY KEY,
  seq          INTEGER NOT NULL,
  user_id      TEXT NOT NULL REFERENCES user(id),
  type         TEXT NOT NULL,         -- payment.released | inspection.passed | dispute.opened | ...
  payload      TEXT NOT NULL,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (user_id, seq)
);
CREATE INDEX IF NOT EXISTS receipt_user_idx ON receipt(user_id);
CREATE INDEX IF NOT EXISTS anchor_user_idx  ON anchor(user_id);

`);

/**
 * Adds a foreign key to a table that already exists.
 *
 * SQLite has no `ALTER TABLE ADD CONSTRAINT`. The only supported way is the documented table
 * rebuild: build the new shape, copy the rows, drop the old, rename. That is a destructive
 * sequence around live data, so the whole thing runs in one transaction and is checked before it
 * commits.
 *
 * `PRAGMA foreign_keys` is a NO-OP inside a transaction, which is the trap in this procedure: set
 * it after `BEGIN` and it silently does nothing, and the copy is validated against constraints
 * that are still enforcing the OLD shape. It is therefore toggled outside, and restored in a
 * `finally` so an exception cannot leave the connection with constraints off.
 *
 * `needsIt` decides whether to run at all, by asking the table what it already references. That
 * makes this idempotent: every boot calls it, and only the first one does any work.
 */
function ensureForeignKeys(table, { references, create, indexes }) {
  // Column list FIRST, and it doubles as the existence check. PRAGMA foreign_key_list on a table
  // that does not exist returns an empty list rather than throwing, which reads identically to "no
  // constraints yet" — so an absent table looked like one needing migration, and the rebuild then
  // generated `INSERT INTO x__new () SELECT FROM x`. Found by running this on a fresh database.
  const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
  if (cols.length === 0) return;              // not created yet; the CREATE above carries the keys

  const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all();
  if (references.every((col) => fks.some((f) => f.from === col))) return;

  const list = cols.map((c) => `"${c}"`).join(', ');

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(create.replace(`"${table}"`, `"${table}__new"`));
    db.exec(`INSERT INTO "${table}__new" (${list}) SELECT ${list} FROM "${table}"`);
    db.exec(`DROP TABLE "${table}"`);
    db.exec(`ALTER TABLE "${table}__new" RENAME TO "${table}"`);
    for (const ix of indexes) db.exec(ix);

    // Check BEFORE committing. A violation here means existing rows point at something that is
    // gone — exactly the state these constraints exist to prevent — and the right answer is to
    // roll back and look, not to commit a database the constraint would have refused.
    const bad = db.prepare('PRAGMA foreign_key_check').all();
    if (bad.length) {
      throw new Error(
        `${table}: ${bad.length} row(s) reference something that does not exist — ` +
        `${JSON.stringify(bad.slice(0, 3))}. Nothing was changed.`,
      );
    }
    db.exec('COMMIT');
    console.log(`[db] ${table}: foreign keys declared (${references.join(', ')})`);
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// Migrate older pilot DBs
function ensureColumn(table, name, ddl) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch {
    /* ignore */
  }
}

ensureColumn('user', 'oauth_provider', 'oauth_provider TEXT');
ensureColumn('user', 'oauth_id', 'oauth_id TEXT');
ensureColumn('mandate', 'price_ceiling', 'price_ceiling REAL');
ensureColumn('mandate', 'max_quantity', `max_quantity TEXT DEFAULT '{"value":40,"unit":"t"}'`);
ensureColumn('mandate', 'consumed', `consumed TEXT DEFAULT '{"quantity":0}'`);
ensureColumn('mandate', 'delivery_window', `delivery_window TEXT DEFAULT '{"from":"1970-01-01","to":"9999-12-31"}'`);
ensureColumn('mandate', 'counterparty_min_tier', `counterparty_min_tier TEXT DEFAULT 'T2'`);

// Password is NULLABLE on purpose: OAuth users have no password and must never be given a
// placeholder one. A null here means "this account signs in with a provider", and the login
// handler says so rather than failing with a generic wrong-password.
ensureColumn('user', 'password_hash', 'password_hash TEXT');
ensureColumn('user', 'reset_token', 'reset_token TEXT');
ensureColumn('user', 'reset_expires', 'reset_expires TEXT');

// The anchor's own identifier — the licence number, farmer ID, membership number. Corridor's
// schema stores only a HASH of this, on the argument that the raw value never needs to leave the
// verification job. That is right at scale. In a pilot the verification job is a human reading it,
// so it is kept in the clear here — and that difference is a deliberate, temporary divergence,
// not an oversight. Hash it the moment verification is automated.
ensureColumn('anchor', 'reference', 'reference TEXT');

// What an individual does. Free text on purpose: the dropdown covers the common cases and
// "Other" is where the interesting ones arrive — those answers are the demand signal for which
// trade to open next, so constraining them to a fixed list would discard the useful half.
ensureColumn('user', 'profession', 'profession TEXT');

/**
 * Agent names are unique across the whole platform.
 *
 * THIS INDEX IS THE ENFORCEMENT. The check in POST /api/deploy and the live check as you type are
 * both courtesies — they produce a good error instead of an ugly one. Neither is a guarantee,
 * because check-then-insert is not atomic: two requests claiming the same name can both pass the
 * check before either inserts. Only the database can settle that, so the database does.
 *
 * Normalised on lower(trim(...)) so "Bhosale Trading", "bhosale trading" and " Bhosale Trading "
 * are one name, not three. A name that only differs by case is not a different counterparty — it
 * is the oldest impersonation trick there is, and this product's entire claim is that you can tell
 * who you are dealing with.
 *
 * The expression here MUST stay identical to the lookup in index.mjs. If they drift, the check
 * says free and the insert says taken, which reads as a random unexplainable failure.
 */
/**
 * Works — what a person publishes on their own profile.
 *
 * Four kinds, which are the four tabs: photo (one image or a carousel), video, thread (text), and
 * doc (a file). One table rather than four, because they differ only in what is attached — and
 * four tables would mean four of every query that follows.
 *
 * A work is DISTINCT FROM A POST. A post is an agent speaking in the market — an availability, a
 * requirement, a price signal. A work is a person publishing on their profile. They look similar
 * and mean different things, and merging them would make "who said this" ambiguous at exactly the
 * point where the whole product depends on knowing.
 *
 * shareable is per item, because somebody may be glad to have a tutorial filed into a stranger's
 * research and unwilling to have a family photograph analysed at all.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS work (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES user(id),
    kind       TEXT NOT NULL CHECK (kind IN ('photo','video','thread','doc')),
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    shareable  INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS work_user_idx ON work(user_id, kind, created_at);

  /*
   * One row per file. A carousel is several rows against one work, which is why the media table
   * exists at all rather than a path column on the work row.
   *
   * path is generated and filename is what the person called it — the two are kept apart so a
   * user-supplied name never reaches the filesystem.
   */
  CREATE TABLE IF NOT EXISTS media (
    id         TEXT PRIMARY KEY,
    work_id    TEXT NOT NULL REFERENCES work(id),
    user_id    TEXT NOT NULL REFERENCES user(id),
    mime       TEXT NOT NULL,
    kind       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    path       TEXT NOT NULL,
    filename   TEXT NOT NULL DEFAULT '',
    ordinal    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_work_idx ON media(work_id, ordinal);
  CREATE INDEX IF NOT EXISTS media_user_idx ON media(user_id);
`);

/**
 * Projects — where shared things land and turn into something.
 *
 * project → note → source. Shallow on purpose: anything deeper is filing rather than thinking, and
 * a research tool that demands filing gets abandoned.
 *
 * A note is MOVABLE between projects (`project_id` is a plain column, updated by a move). Today's
 * search about one subject and tomorrow's about another only sort themselves out in hindsight, so
 * the structure has to tolerate being reorganised after the fact rather than demanding to be right
 * up front.
 *
 * `source` is one row per shared item, not a paragraph of prose, so provenance is a LIST that can
 * be counted, followed and challenged. It records WHAT WAS TAKEN — the passage used — because
 * "cited this post" is unverifiable and "used this passage for the entry-signal rule" can be
 * checked by the person who wrote it.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS project (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES user(id),
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS project_user_idx ON project(user_id, updated_at);

  CREATE TABLE IF NOT EXISTS note (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project(id),
    user_id    TEXT NOT NULL REFERENCES user(id),
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'captured'
               CHECK (status IN ('captured','analysed','failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS note_project_idx ON note(project_id, updated_at);

  CREATE TABLE IF NOT EXISTS source (
    id          TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL REFERENCES note(id),
    user_id     TEXT NOT NULL REFERENCES user(id),
    -- RESTRICT, per ADR-0003. These two carried no constraint at all until 2026-08-12, so
    -- deleting a post left a citation pointing at content that no longer existed and said
    -- nothing about it. NULL is allowed and meaningful: a source may be a URL rather than a
    -- post on this platform.
    post_id     TEXT REFERENCES post(id) ON DELETE RESTRICT,
    author_id   TEXT REFERENCES user(id) ON DELETE RESTRICT,
    title       TEXT NOT NULL DEFAULT '',
    excerpt     TEXT NOT NULL DEFAULT '',
    used_for    TEXT NOT NULL DEFAULT '',
    url         TEXT,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS source_note_idx   ON source(note_id);
  CREATE INDEX IF NOT EXISTS source_author_idx ON source(author_id);

  /*
   * A CITATION IS NOT A SHARE, and the two must not be one table.
   *
   *   share     a PERSON files something into a project. An act of collecting. Input.
   *   citation  an AGENT used that thing while producing something. An act of building. Output.
   *
   * Plenty of material gets shared and never used, and counting a share as a citation would make
   * the number mean "somebody bookmarked this" while claiming it means "somebody built on this".
   * That is the same overclaiming this codebase refuses in receipts: record what happened, not what
   * it suggests.
   *
   * used_for is the passage or purpose the agent actually took, which is what makes a citation
   * checkable by the creator — and therefore challengeable. "Cited this post" cannot be disputed;
   * "used your entry-signal rule at 04:12" can.
   */
  CREATE TABLE IF NOT EXISTS citation (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL REFERENCES note(id),
    source_id  TEXT NOT NULL REFERENCES source(id),
    user_id    TEXT NOT NULL REFERENCES user(id),   -- whose agent cited it
    -- RESTRICT, per ADR-0003: a citation outlives the WITHDRAWAL of the post it cites, and a
    -- hard delete of a cited post must raise rather than orphan the record silently.
    post_id    TEXT REFERENCES post(id) ON DELETE RESTRICT,
    author_id  TEXT REFERENCES user(id) ON DELETE RESTRICT,  -- who earns the count
    used_for   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS citation_post_idx   ON citation(post_id);
  CREATE INDEX IF NOT EXISTS citation_author_idx ON citation(author_id);

  /*
   * Views, counted separately for a PERSON and for an AGENT, because they are not the same claim.
   *
   *   a person viewed it   somebody looked. Weak, but it is attention.
   *   an agent viewed it   something machine-read it while working. Weaker still — an agent may
   *                        read a hundred posts to use one, and reading is not endorsement.
   *
   * Kept apart so neither can be passed off as the other. Merged into one number, a post read by
   * one agent scanning the feed would look as popular as one read by fifty people.
   *
   * UNIQUE on (post_id, viewer_id, kind) makes a view a DISTINCT VIEWER, not a page load. A
   * refresh-inflated counter is a vanity metric, and this product's whole argument is against
   * numbers that can be manufactured.
   */
  CREATE TABLE IF NOT EXISTS view (
    id         TEXT PRIMARY KEY,
    post_id    TEXT NOT NULL,
    viewer_id  TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('person','agent')),
    created_at TEXT NOT NULL,
    UNIQUE (post_id, viewer_id, kind)
  );
  CREATE INDEX IF NOT EXISTS view_post_idx ON view(post_id, kind);
`);

/**
 * Workspace — what you and your agent have in progress.
 *
 * `draft` holds things that are NOT yet real: a post nobody can see, a request not yet sent. A
 * drafted ORDER is not stored here — the order table already has a `drafted` state, and a second
 * home for the same idea would let the two disagree about what a draft order is.
 *
 * `body` is JSON and deliberately loose. A draft is by definition incomplete; validating it into a
 * schema would mean refusing to save the half-finished thing the workspace exists to hold.
 *
 * `watch` is a saved search. `last_seen_at` is what makes "3 new" possible without storing a feed
 * per user — the count is derived by asking how many matching posts arrived since you last looked.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS draft (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES user(id),
    kind       TEXT NOT NULL CHECK (kind IN ('post','request','note')),
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS draft_user_idx ON draft(user_id, updated_at);

  CREATE TABLE IF NOT EXISTS watch (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES user(id),
    label        TEXT NOT NULL,
    commodity    TEXT,
    lane         TEXT,
    min_tier     TEXT NOT NULL DEFAULT 'T0',
    last_seen_at TEXT NOT NULL,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS watch_user_idx ON watch(user_id);
`);

/**
 * Orders — the spine of a deal. See docs/specs/ORDER-AND-INSPECTION.md.
 *
 * "order" is quoted everywhere it appears: ORDER is a SQL keyword and an unquoted table of that
 * name is a syntax error waiting for the first query that forgets.
 *
 * price_amount and price_currency are separate columns rather than a JSON blob because the
 * currency is load-bearing — a floor is enforced in the currency it was agreed in and never
 * converted, so the currency must be as queryable as the number.
 *
 * status has no CHECK constraint listing the states. The state machine lives in
 * shared/order-states.mjs, where the browser can read it too, and duplicating the list here would
 * give two places to update and one to forget.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS "order" (
    id                TEXT PRIMARY KEY,
    buyer_agent_id    TEXT NOT NULL REFERENCES agent(id),
    seller_agent_id   TEXT NOT NULL REFERENCES agent(id),
    commodity         TEXT NOT NULL,
    spec_template_id  TEXT NOT NULL DEFAULT 'default',
    price_amount      REAL NOT NULL,
    price_currency    TEXT NOT NULL,
    quantity          TEXT NOT NULL,
    delivery_window   TEXT NOT NULL,
    inspection_policy TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'drafted',
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS order_buyer_idx  ON "order"(buyer_agent_id, status);
  CREATE INDEX IF NOT EXISTS order_seller_idx ON "order"(seller_agent_id, status);
`);

/**
 * Proposals — what an agent wants to do that it may not do alone.
 *
 * A mandate scope of `negotiate` means "haggle, then bring it back to me". Without somewhere for
 * that decision to land, `negotiate` behaves exactly like `quote` and the scope is decorative.
 * This is where it lands.
 *
 * `intent` is the FULL intent as proposed, stored verbatim. The principal must approve the thing
 * itself, not a summary of it — a summary is written by the same model that wants approval.
 *
 * `guard_code` records why a proposal became unusable, if it did. A mandate can expire or be
 * edited between proposing and deciding, so this is not always NULL on a refusal.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS proposal (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    kind        TEXT NOT NULL,
    intent      TEXT NOT NULL,
    summary     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','refused','invalidated')),
    guard_code  TEXT,
    created_at  TEXT NOT NULL,
    decided_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS proposal_user_idx ON proposal(user_id, status);
`);

/**
 * Agent to agent — the second half of Messages, and the half that has to be handled carefully.
 *
 * THIS IS A SEPARATE TABLE FROM `message`, and it must stay separate.
 *
 * `message.from_role` is a CHECK over user | agent | system, where `agent` means THE AGENT THIS
 * PRINCIPAL DEPLOYED — someone acting on their instructions. A counterparty's agent is a different
 * kind of speaker entirely: it acts for someone else, and per
 * docs/decisions/ADR-0001-chat-cannot-widen-a-mandate.md its words are DATA, never instruction.
 * Putting both in one column would make "who said this" a matter of inference at precisely the
 * point where the product's whole claim is that you can tell. Two tables cannot be confused.
 *
 * `thread_id` is derived from the two agent ids in sorted order rather than stored in a thread
 * table. One conversation per pair, no way to create a second one by accident, and no row that can
 * disagree with its own members.
 *
 * `kind` is CHECKed rather than free text because the interface draws a typed card from it — an
 * untyped conversation is a wall of text, which is the same argument that gave post.type its four
 * types. `terms` is the JSON body of that card; loose on purpose, because what an offer carries
 * differs by commodity and validating it into a schema would refuse the useful half.
 *
 * There is deliberately NO read/unread column. A badge for things that merely happened is a
 * notification habit; Nav.jsx reserves badges for a decision waiting on the principal.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_message (
    id            TEXT PRIMARY KEY,
    thread_id     TEXT NOT NULL,
    from_agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    to_agent_id   TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL DEFAULT 'note'
                  CHECK (kind IN ('note','quote','offer','counter','accept','refuse')),
    body          TEXT NOT NULL,
    terms         TEXT,
    ref           TEXT,
    created_at    TEXT NOT NULL,
    CHECK (from_agent_id <> to_agent_id)
  );
  CREATE INDEX IF NOT EXISTS agent_message_thread_idx ON agent_message(thread_id, created_at);

  /*
   * ─── PHASE 1: people ────────────────────────────────────────────────────────────────────
   *
   * follow is a plain edge, and the PRIMARY KEY on the pair is the whole design: one follow per
   * pair, no duplicate row to reconcile, and "am I following them" is a lookup rather than a count.
   * A self-follow is refused by CHECK rather than by the handler, because a rule enforced in one
   * caller is a rule until somebody writes a second caller.
   *
   * Counts are NOT stored. A follower count is derived, for the same reason "3 new" is derived from
   * watch.last_seen_at: a stored counter and the rows it summarises disagree eventually, and then
   * the number on the screen is a claim nobody can check.
   */
  CREATE TABLE IF NOT EXISTS follow (
    follower_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    followee_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (follower_id, followee_id),
    CHECK (follower_id <> followee_id)
  );
  CREATE INDEX IF NOT EXISTS follow_followee_idx ON follow(followee_id, created_at);

  /*
   * ─── SAFETY ─────────────────────────────────────────────────────────────────────────────
   *
   * Registration is OPEN. There is no invite gate in front of the door, so the first abuse
   * arrives WITH the first audience rather than after it, and these two tables are the floor a
   * product needs before it has one.
   *
   * BLOCK is an edge shaped exactly like follow, and for the same reasons: the primary key on the
   * pair makes blocking twice the same as blocking once, and a self-block is refused by CHECK
   * rather than by a handler, because a rule enforced in one caller lasts until somebody writes a
   * second caller.
   *
   * A block is ONE-WAY and PRIVATE. The blocked party is never told — a notification would make
   * blocking an act of confrontation, which is exactly what somebody being harassed cannot afford.
   */
  CREATE TABLE IF NOT EXISTS block (
    blocker_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
  );
  CREATE INDEX IF NOT EXISTS block_blocked_idx ON block(blocked_id);

  /*
   * A REPORT is a person asking for a human to look. It is deliberately NOT an enforcement
   * mechanism and nothing acts on it automatically: a count of reports that removes content is a
   * brigading tool, and the first people to discover that are the ones you least want to hand it
   * to.
   *
   * subject_kind is CHECKed rather than free text because the reviewer's queue draws a different
   * card per kind, and an untyped report is a pile of strings somebody has to interpret.
   *
   * status starts open and only a reviewer moves it. outcome records what was DONE, which is
   * a different question from what was decided — a dismissed report and an actioned one both close,
   * and only one of them changed anything.
   */
  CREATE TABLE IF NOT EXISTS report (
    id           TEXT PRIMARY KEY,
    reporter_id  TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    subject_kind TEXT NOT NULL CHECK (subject_kind IN ('post','work','person','message')),
    subject_id   TEXT NOT NULL,
    reason       TEXT NOT NULL,
    detail       TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','actioned','dismissed')),
    outcome      TEXT,
    reviewed_by  TEXT REFERENCES user(id),
    created_at   TEXT NOT NULL,
    decided_at   TEXT
  );
  CREATE INDEX IF NOT EXISTS report_open_idx    ON report(status, created_at);
  CREATE INDEX IF NOT EXISTS report_subject_idx ON report(subject_kind, subject_id);

  CREATE INDEX IF NOT EXISTS agent_message_to_idx     ON agent_message(to_agent_id, created_at);
  CREATE INDEX IF NOT EXISTS agent_message_from_idx   ON agent_message(from_agent_id, created_at);
`);

/**
 * Inspection jobs and their evidence. See docs/specs/ORDER-AND-INSPECTION.md, build order step 3.
 *
 * An inspection is a JOB, not new party machinery: the inspector is an ordinary agent whose
 * mandate says which spec templates they may judge and what fee they will accept. The job hangs
 * off an order and names the END it covers — origin (before shipment) or arrival — because with
 * arrival-only records "the seller shipped bad goods" and "transit destroyed them" produce
 * identical evidence, and the dispute that will dominate this platform has no resolvable form.
 *
 * `min_assurance` is the floor the commissioner demands, graded in shared/assurance.mjs. `fee` is
 * two columns for the same reason an order's price is — the currency is enforced in the currency
 * it was agreed in, never converted, so it must be as queryable as the number.
 *
 * status has no CHECK listing the states: the machine lives in shared/inspection-states.mjs where
 * the browser reads it too, and a second copy here would be one more place to forget.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS inspection_job (
    id                TEXT PRIMARY KEY,
    order_id          TEXT NOT NULL REFERENCES "order"(id),
    commissioner_id   TEXT NOT NULL REFERENCES agent(id),   -- the party who posted it
    inspector_id      TEXT REFERENCES agent(id),            -- null until claimed
    end               TEXT NOT NULL CHECK (end IN ('origin','arrival')),
    spec_template_id  TEXT NOT NULL DEFAULT 'default',
    fee_amount        REAL NOT NULL,
    fee_currency      TEXT NOT NULL,
    min_assurance     TEXT NOT NULL DEFAULT 'web-attested',
    -- The unannounced fix: a nonce the platform issues at CHECK-IN and a moment it chose. Faking a
    -- reading you did not know would be asked for is materially harder than faking a scheduled one.
    nonce             TEXT,
    nonce_issued_at   TEXT,
    status            TEXT NOT NULL DEFAULT 'posted',
    claimed_at        TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS inspection_order_idx     ON inspection_job(order_id, status);
  CREATE INDEX IF NOT EXISTS inspection_inspector_idx ON inspection_job(inspector_id, status);

  /*
   * Evidence — ONE row per captured frame, written at check-in.
   *
   * What is stored is an OBSERVATION, never a verdict: the coordinates the device reported, the
   * network position we derived independently, the assurance grade and its reasons, the SHA-256 of
   * the image bytes taken AT CAPTURE. "the device reported these coordinates" is true and stays
   * true when challenged; "the inspector was present" is a claim the system cannot support.
   *
   * The image bytes live in the media store, addressed by the same id; only the HASH is the proof,
   * so the file may live anywhere and remain provably the one submitted. EXIF is stripped before
   * storage and never read — EXIF GPS is attacker-controlled, and coordinates come from the fix the
   * platform requested, not from what the file claims about itself.
   *
   * lat/lng are the DEVICE reading, kept queryable. net_lat/net_lng are the independent network
   * reading. The grade is a function of whether they agree — consistency, not location.
   */
  CREATE TABLE IF NOT EXISTS inspection_evidence (
    id            TEXT PRIMARY KEY,
    job_id        TEXT NOT NULL REFERENCES inspection_job(id),
    media_id      TEXT,                                     -- where the stripped bytes were stored
    sha256        TEXT NOT NULL,                            -- the proof; hashed at capture
    nonce         TEXT NOT NULL,                            -- the code that had to be in the shot
    live          INTEGER NOT NULL DEFAULT 0,               -- from a media stream, not a file
    lat           REAL,                                     -- device geolocation
    lng           REAL,
    accuracy_m    REAL,
    net_lat       REAL,                                     -- independent network position
    net_lng       REAL,
    source        TEXT,                                     -- device | network
    assurance     TEXT NOT NULL DEFAULT 'self',
    reasons       TEXT NOT NULL DEFAULT '[]',               -- why the grade landed where it did
    requested_at  TEXT,                                     -- when the platform ASKED for the fix
    observed_at   TEXT,                                     -- when the device REPORTED it
    created_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS evidence_job_idx ON inspection_evidence(job_id, created_at);
`);

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS agent_name_unique
         ON agent (lower(trim(name)))`);
ensureColumn('mandate', 'expires_at', `expires_at TEXT DEFAULT '9999-12-31T00:00:00.000Z'`);
ensureColumn('mandate', 'spec_template_id', `spec_template_id TEXT DEFAULT 'default'`);

// ADR-0003. NULL means live; a timestamp means the author withdrew it. No default — an existing
// post is not withdrawn, and a DEFAULT here would silently take down every post in the table.
ensureColumn('post', 'withdrawn_at', 'withdrawn_at TEXT');

// Phase 1 profile. `links` is a JSON array of {label, url}: loose on purpose, because the useful
// set differs per profession and a schema here would refuse half of it. Validated at the handler,
// where the limits can say why.
ensureColumn('user', 'bio', 'bio TEXT');
ensureColumn('user', 'links', `links TEXT NOT NULL DEFAULT '[]'`);

/*
 * Person-to-person messaging was built on 2026-08-12 and removed the same day: the agent is the
 * interface, so a principal instructs their own agent and the agents talk to each other. There is
 * no human channel to route a deal around the record.
 *
 * These two tables shipped to production before the decision. They are dropped ONLY if empty —
 * a guard, not a formality: if a row ever existed, dropping it silently would destroy somebody's
 * conversation to tidy a schema, and the right answer then is to stop and look.
 */
for (const table of ['person_message', 'person_thread']) {
  try {
    const exists = db.prepare(
      "SELECT 1 x FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!exists) continue;
    const rows = db.prepare(`SELECT COUNT(*) n FROM "${table}"`).get().n;
    if (rows === 0) db.exec(`DROP TABLE "${table}"`);
    else console.warn(`[db] ${table} kept: ${rows} row(s) — it was meant to be empty, so look before dropping it`);
  } catch { /* nothing to drop */ }
}

/*
 * ADR-0003. `source` and `citation` referenced `post` and `user` by id and declared neither, so a
 * deleted post left citations of it pointing at nothing, with no error. Declared RESTRICT: a
 * citation outlives the WITHDRAWAL of what it cites, and a hard delete of cited content must raise.
 *
 * Cheap exactly now — these tables hold no rows in production — and more expensive with every post
 * filed after it.
 */
ensureForeignKeys('source', {
  references: ['post_id', 'author_id'],
  create: `CREATE TABLE "source" (
    id          TEXT PRIMARY KEY,
    note_id     TEXT NOT NULL REFERENCES note(id),
    user_id     TEXT NOT NULL REFERENCES user(id),
    post_id     TEXT REFERENCES post(id) ON DELETE RESTRICT,
    author_id   TEXT REFERENCES user(id) ON DELETE RESTRICT,
    title       TEXT NOT NULL DEFAULT '',
    excerpt     TEXT NOT NULL DEFAULT '',
    used_for    TEXT NOT NULL DEFAULT '',
    url         TEXT,
    created_at  TEXT NOT NULL
  )`,
  indexes: [
    'CREATE INDEX IF NOT EXISTS source_note_idx   ON source(note_id)',
    'CREATE INDEX IF NOT EXISTS source_author_idx ON source(author_id)',
  ],
});

ensureForeignKeys('citation', {
  references: ['post_id', 'author_id'],
  create: `CREATE TABLE "citation" (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL REFERENCES note(id),
    source_id  TEXT NOT NULL REFERENCES source(id),
    user_id    TEXT NOT NULL REFERENCES user(id),
    post_id    TEXT REFERENCES post(id) ON DELETE RESTRICT,
    author_id  TEXT REFERENCES user(id) ON DELETE RESTRICT,
    used_for   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  indexes: [
    'CREATE INDEX IF NOT EXISTS citation_post_idx   ON citation(post_id)',
    'CREATE INDEX IF NOT EXISTS citation_author_idx ON citation(author_id)',
  ],
});

export function one(sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
