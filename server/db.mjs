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
  currency TEXT NOT NULL DEFAULT 'INR',
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
`);

// Migrate older pilot DBs that predate OAuth columns
try {
  const cols = db.prepare('PRAGMA table_info(user)').all().map((c) => c.name);
  if (!cols.includes('oauth_provider')) {
    db.exec('ALTER TABLE user ADD COLUMN oauth_provider TEXT');
  }
  if (!cols.includes('oauth_id')) {
    db.exec('ALTER TABLE user ADD COLUMN oauth_id TEXT');
  }
} catch {
  /* ignore */
}

export function one(sql, ...params) {
  return db.prepare(sql).get(...params) ?? null;
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
