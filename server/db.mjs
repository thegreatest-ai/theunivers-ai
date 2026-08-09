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
