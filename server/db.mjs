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
  created_at TEXT NOT NULL
);

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

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS agent_name_unique
         ON agent (lower(trim(name)))`);
ensureColumn('mandate', 'expires_at', `expires_at TEXT DEFAULT '9999-12-31T00:00:00.000Z'`);
ensureColumn('mandate', 'spec_template_id', `spec_template_id TEXT DEFAULT 'default'`);

export function one(sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
