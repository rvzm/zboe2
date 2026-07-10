// db.js (ESM)
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { file_config } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Put the DB somewhere persistent on your VPS.
// This makes a ./data folder beside your app.
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", file_config.databaseFile || "zboe.sqlite");

export const valid_locations = [
  "base_outside",
  "base_inside",
  "bunker",
  "forest",
  "lake",
  "mountains"
];

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
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL
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
  location TEXT,                             -- current location_name, or NULL if unset
  hidden INTEGER NOT NULL DEFAULT 0,         -- 0/1, hiding at current location
  last_seen INTEGER NOT NULL DEFAULT 0,             -- timestamp of last activity 
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  condition INTEGER NOT NULL DEFAULT 100,
  ammo INTEGER NOT NULL DEFAULT 1,
  clips INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- global event feed
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public', -- public, private, admin
  msg TEXT NOT NULL
);

-- Game State Table (Hunt enabled, horde size/status, raid enabled, etc)
CREATE TABLE IF NOT EXISTS game_state (
  key TEXT PRIMARY KEY,
  hunt_enabled TEXT NOT NULL DEFAULT 'false',
  horde_size INTEGER NOT NULL DEFAULT 0,
  horde_status TEXT NOT NULL DEFAULT 'idle', -- idle, partial, full, raid
  raid_enabled TEXT NOT NULL DEFAULT 'false',
  online_players INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Shop Item and Costs table - Updated via console commands, not player-facing
CREATE TABLE IF NOT EXISTS shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_name TEXT NOT NULL UNIQUE,
  item_cost INTEGER NOT NULL,
  item_type TEXT NOT NULL, -- gun, ammo, clip, medkit, etc
  item_quantity INTEGER NOT NULL DEFAULT 1, -- for stackable items like ammo/medkits
  item_pack_cost INTEGER NOT NULL DEFAULT 0, -- if this item can be sold in a pack/bundle, the cost of the whole pack
  item_pack_quantity INTEGER NOT NULL DEFAULT 0 -- if this item can be sold in a pack/bundle, the quantity of this item in the pack
);

CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);

// Migrate players table for existing DBs created before location/hidden existed.
const playerColumns = db.prepare("PRAGMA table_info(players)").all().map((col) => col.name);

if (!playerColumns.includes("location")) {
  db.exec("ALTER TABLE players ADD COLUMN location TEXT");
}

if (!playerColumns.includes("hidden")) {
  db.exec("ALTER TABLE players ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
}

// Seed the single global game_state row that the online-player counters target.
db.prepare(`
  INSERT OR IGNORE INTO game_state (key, updated_at)
  VALUES ('main', ?)
`).run(Date.now());

// ----- Prepared statements -----
const stmtUserByName = db.prepare(`SELECT id, username, pass_salt, pass_hash FROM users WHERE username = ?`);
const stmtUserIdByName = db.prepare(`SELECT id, username FROM users WHERE username = ?`);
const stmtPlayerByUserId = db.prepare(`SELECT * FROM players WHERE user_id = ?`);
const stmtLeaderboard = db.prepare(`
  SELECT users.username AS user, players.xp
  FROM players
  JOIN users ON users.id = players.user_id
  ORDER BY players.xp DESC, users.username ASC
  LIMIT ?
`);
const stmtRecentEvents = db.prepare(`
  SELECT ts, type, msg
  FROM events
  WHERE visibility != 'background'
  ORDER BY ts DESC
  LIMIT ?
`);
const stmtEventCounts = db.prepare(`
  SELECT type, COUNT(*) AS count
  FROM events
  GROUP BY type
`);
const stmtEventTotal = db.prepare(`SELECT COUNT(*) AS total FROM events`);
const stmtInsertUser = db.prepare(`
  INSERT INTO users (username, is_admin, pass_salt, pass_hash, created_at, last_login)
  VALUES (?, 0, ?, ?, ?, ?)
`);
const stmtInsertPlayer = db.prepare(`
  INSERT INTO players (user_id, xp, kills, ammo, max_ammo, clips, max_clips, accuracy, condition, jammed, updated_at)
  VALUES (?, 0, 0, 6, 6, 3, 3, 35, 100, 0, ?)
`);
const stmtInsertEvent = db.prepare(`
  INSERT INTO events (ts, type, visibility, msg)
  VALUES (?, ?, ?, ?)
`);

// ----- Query functions -----
export function getUserByName(username) { return stmtUserByName.get(username); }
export function getUserIdByName(username) { return stmtUserIdByName.get(username); }
export function getPlayerByUserId(userId) { return stmtPlayerByUserId.get(userId); }
export function getLeaderboard(limit) { return stmtLeaderboard.all(limit); }
export function getRecentEvents(limit) { return stmtRecentEvents.all(limit); }
export function getEventCounts() { return stmtEventCounts.all(); }
export function getEventTotal() { return stmtEventTotal.get()?.total ?? 0; }
export function insertUser(username, salt, hash, createdAt) { return stmtInsertUser.run(username, salt, hash, createdAt, createdAt); }
export function insertPlayer(userId, createdAt) { return stmtInsertPlayer.run(userId, createdAt); }
export function insertEvent(type, msg, visibility = "public") { return stmtInsertEvent.run(Date.now(), type, visibility, msg); }

// Records the moment a user authenticated (account-level metadata on `users`).
export function updateLastLogin(userId) {
  db.prepare(`UPDATE users SET last_login = ? WHERE id = ?`).run(Date.now(), userId);
}

// Marks a player as active "now" — called on each game-state poll so presence
// can be derived from players.last_seen instead of a drifting counter.
export function touchPlayerSeen(userId) {
  db.prepare(`UPDATE players SET last_seen = ? WHERE user_id = ?`).run(Date.now(), userId);
}

export function increasePlayerCount(userId) {
  db.prepare(`
    UPDATE game_state
    SET online_players = online_players + 1, updated_at = ?
    WHERE key = 'main'
  `).run(Date.now());
}

export function decreasePlayerCount(userId) {
  db.prepare(`
    UPDATE game_state
    SET online_players = MAX(0, online_players - 1), updated_at = ?
    WHERE key = 'main'
  `).run(Date.now());
}

export function ensurePlayer(userId) {
  let player = stmtPlayerByUserId.get(userId);
  if (!player) {
    stmtInsertPlayer.run(userId, Date.now());
    player = stmtPlayerByUserId.get(userId);
  }
  return player;
}

// ----- Player update functions -----
export function updatePlayerAmmo(userId, ammoChange, clipChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  const newAmmo = Math.max(0, player.ammo + ammoChange);
  const newClips = Math.max(0, player.clips + clipChange);

  db.prepare(`
    UPDATE players
    SET ammo = ?, clips = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newAmmo, newClips, Date.now(), userId);
}

export function updatePlayerStats(userId, xpChange, killChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  const newXP = Math.max(0, player.xp + xpChange);
  const newKills = Math.max(0, player.kills + killChange);

  db.prepare(`
    UPDATE players
    SET xp = ?, kills = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newXP, newKills, Date.now(), userId);
}

export function updatePlayerCondition(userId, conditionChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  const newCondition = Math.max(0, Math.min(100, player.condition + conditionChange));

  db.prepare(`
    UPDATE players
    SET condition = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newCondition, Date.now(), userId);
}

export function updatePlayerJamStatus(userId, jammed) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  db.prepare(`
    UPDATE players
    SET jammed = ?, updated_at = ?
    WHERE user_id = ?
  `).run(jammed ? 1 : 0, Date.now(), userId);
}

export function updatePlayerGun(userId, gun) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  db.prepare(`
    UPDATE players
    SET equipped_gun = ?, updated_at = ?
    WHERE user_id = ?
  `).run(gun, Date.now(), userId);
}

export function updatePlayerAccuracy(userId, accuracyChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const newAccuracy = Math.max(0, Math.min(100, player.accuracy + accuracyChange));
  db.prepare(`
    UPDATE players
    SET accuracy = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newAccuracy, Date.now(), userId);
}

export function updatePlayerMaxAmmo(userId, maxAmmoChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  const newMaxAmmo = Math.max(0, player.max_ammo + maxAmmoChange);

  db.prepare(`
    UPDATE players
    SET max_ammo = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newMaxAmmo, Date.now(), userId);
}

export function updatePlayerMaxClips(userId, maxClipsChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  const newMaxClips = Math.max(0, player.max_clips + maxClipsChange);

  db.prepare(`
    UPDATE players
    SET max_clips = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newMaxClips, Date.now(), userId);
}

export function updatePlayerInventory(userId, itemName, quantityChange, conditionChange, ammoChange, clipsChange) {
  const item = db.prepare(`
    SELECT id, quantity, condition, ammo, clips
    FROM player_inventory
    WHERE user_id = ? AND item_name = ?
  `).get(userId, itemName);
  if (item) {
    const newQuantity = Math.max(0, item.quantity + quantityChange);
    const newCondition = Math.max(0, Math.min(100, item.condition + conditionChange));
    const newAmmo = Math.max(0, item.ammo + ammoChange);
    const newClips = Math.max(0, item.clips + clipsChange);
    if (newQuantity === 0) {
      db.prepare(`DELETE FROM player_inventory WHERE id = ?`).run(item.id);
    } else {
      db.prepare(`
        UPDATE player_inventory
        SET quantity = ?, condition = ?, ammo = ?, clips = ?, updated_at = ?
        WHERE id = ?
      `).run(newQuantity, newCondition, newAmmo, newClips, Date.now(), item.id);
    }
  }
}

export function updatePlayerLocation(userId, location) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  if (player.location === location) return;

  db.prepare(`
    UPDATE players
    SET location = ?, updated_at = ?
    WHERE user_id = ?
  `).run(location, Date.now(), userId);
}

// Location occupancy is derived from the players table, not a separate table.
const stmtLocationCount = db.prepare(`
  SELECT COUNT(*) AS count FROM players WHERE location = ?
`);
export function getLocationCount(location) { return stmtLocationCount.get(location)?.count ?? 0; }

export function updatePlayerHidden(userId, hidden) {
  db.prepare(`
    UPDATE players
    SET hidden = ?, updated_at = ?
    WHERE user_id = ?
  `).run(hidden ? 1 : 0, Date.now(), userId);
}
