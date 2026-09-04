'use strict';
// SQLite (node:sqlite, built into Node 24) with the platform schema. One file under DATA_DIR.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- cookie | bearer
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);
CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  lines INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  size INTEGER,
  source_lang TEXT NOT NULL,
  target_lang TEXT NOT NULL,
  engine TEXT NOT NULL,
  status TEXT NOT NULL,          -- uploading | queued | extracting | recognizing | segmenting | translating | rendering | done | failed
  progress REAL NOT NULL DEFAULT 0,
  error TEXT,
  duration REAL,
  task_id INTEGER,
  media_token TEXT,
  cues INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id, created_at DESC);
`;

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'platform.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const stmts = new Map();
  const prep = (sql) => { let s = stmts.get(sql); if (!s) { s = db.prepare(sql); stmts.set(sql, s); } return s; };
  return {
    raw: db,
    get: (sql, ...args) => prep(sql).get(...args),
    all: (sql, ...args) => prep(sql).all(...args),
    run: (sql, ...args) => prep(sql).run(...args),
    close: () => db.close(),
  };
}

module.exports = { openDb };
