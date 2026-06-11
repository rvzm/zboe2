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
  is_admin BOOLEAN NOT NULL DEFAULT 0,
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
  equipped_gun TEXT, -- or INTEGER if you make a weapons table
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  condition INTEGER NOT NULL DEFAULT 100,
  ammo INTEGER NOT NULL DEFAULT 1,
  clips INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES players(user_id) ON DELETE CASCADE
);

-- global event feed
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  msg TEXT NOT NULL
);

-- Game State Table (Hunt enabled, horde size/status, raid enabled, etc)
CREATE TABLE IF NOT EXISTS game_state (
  key TEXT PRIMARY KEY,
  hunt_enabled TEXT NOT NULL DEFAULT 'false',
  horde_size INTEGER NOT NULL DEFAULT 0,
  horde_status TEXT NOT NULL DEFAULT 'idle', -- idle, partial, full, raid
  raid_enabled TEXT NOT NULL DEFAULT 'false',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES players(user_id) ON DELETE CASCADE
);

-- Location Table
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  location_name TEXT NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT 0, -- if true, user is hiding here and can't be found by others or zombies
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES players(user_id) ON DELETE CASCADE
);

-- Shop Item and Costs table - Updated via console commands, not player-facing
CREATE TABLE IF NOT EXISTS shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT NOT NULL UNIQUE,
  item_cost INTEGER NOT NULL,
  item_type TEXT NOT NULL, -- gun, ammo, clip, medkit, etc
  item_quantity INTEGER NOT NULL DEFAULT 1, -- for stackable items like ammo/medkits
  item_pack_cost INTEGER NOT NULL DEFAULT 0 -- if this item can be sold in a pack/bundle, the cost of the whole pack
  item_pack_quantity INTEGER NOT NULL DEFAULT 0 -- if this item can be sold in a pack/bundle, the quantity of this item in the pack
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);
