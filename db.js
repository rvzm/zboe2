// db.js (ESM)
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Put the DB somewhere persistent on your VPS.
// This makes a ./data folder beside your app.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "zboe.sqlite");

import fs from "fs";
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// Recommended pragmas for web apps
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 1:1 per user (stats)
CREATE TABLE IF NOT EXISTS players (
  user_id INTEGER PRIMARY KEY,
  xp INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  ammo INTEGER NOT NULL DEFAULT 6,
  max_ammo INTEGER NOT NULL DEFAULT 6,
  clips INTEGER NOT NULL DEFAULT 3,
  max_clips INTEGER NOT NULL DEFAULT 3,
  accuracy INTEGER NOT NULL DEFAULT 35,      -- % hit chance
  condition INTEGER NOT NULL DEFAULT 100,    -- durability/health
  jammed INTEGER NOT NULL DEFAULT 0,         -- 0/1
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- global event feed
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  msg TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);
