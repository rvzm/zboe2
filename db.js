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
  xp INTEGER NOT NULL DEFAULT 0,             -- spendable XP (spent on levels)
  lifetime_xp INTEGER NOT NULL DEFAULT 0,    -- total XP ever earned (leaderboard rank)
  level INTEGER NOT NULL DEFAULT 1,
  health INTEGER NOT NULL DEFAULT 100,
  max_health INTEGER NOT NULL DEFAULT 100,
  shield INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  accuracy INTEGER NOT NULL DEFAULT 35,      -- % hit chance
  jammed INTEGER NOT NULL DEFAULT 0,         -- 0/1
  gold INTEGER NOT NULL DEFAULT 0,             -- in-game currency
  horde_tokens INTEGER NOT NULL DEFAULT 0,        -- number of horde tokens player has
  equipped_gun TEXT NOT NULL DEFAULT 'Handgun',
  -- Per-type gun stats. Page stats (ammo/clips/condition/etc) read from the equipped gun's type.
  handgun_ammo INTEGER NOT NULL DEFAULT 6,
  handgun_max_ammo INTEGER NOT NULL DEFAULT 6,
  handgun_clips INTEGER NOT NULL DEFAULT 3,
  handgun_max_clips INTEGER NOT NULL DEFAULT 3,
  handgun_condition INTEGER NOT NULL DEFAULT 100,
  rifle_ammo INTEGER NOT NULL DEFAULT 5,
  rifle_max_ammo INTEGER NOT NULL DEFAULT 5,
  rifle_clips INTEGER NOT NULL DEFAULT 4,
  rifle_max_clips INTEGER NOT NULL DEFAULT 4,
  rifle_condition INTEGER NOT NULL DEFAULT 100,
  shotgun_ammo INTEGER NOT NULL DEFAULT 2,
  shotgun_max_ammo INTEGER NOT NULL DEFAULT 2,
  shotgun_clips INTEGER NOT NULL DEFAULT 6,
  shotgun_max_clips INTEGER NOT NULL DEFAULT 6,
  shotgun_condition INTEGER NOT NULL DEFAULT 100,
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
  target TEXT NOT NULL DEFAULT 'global',     -- 'global' (all players) or a player's user_id
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
  base_health INTEGER NOT NULL DEFAULT 10000,      -- inside/base health pool
  base_destroyed_at INTEGER NOT NULL DEFAULT 0,    -- ts the base fell (0 = intact)
  updated_at INTEGER NOT NULL
);

-- Vote-to-nuke ballots while the base is destroyed (cleared on experiment reset).
CREATE TABLE IF NOT EXISTS nuke_votes (
  user_id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL
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
  SELECT users.username AS user, players.lifetime_xp AS xp, players.level AS level
  FROM players
  JOIN users ON users.id = players.user_id
  ORDER BY players.lifetime_xp DESC, players.level DESC, users.username ASC
  LIMIT ?
`);
const stmtRecentEvents = db.prepare(`
  SELECT ts, type, msg, target
  FROM events
  WHERE visibility != 'background'
    AND (target = 'global' OR target = @target)
  ORDER BY ts DESC
  LIMIT @limit
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
// All other columns carry NOT NULL defaults (including the per-gun ammo/clips
// and equipped_gun = 'Handgun'), so we only need user_id + updated_at here.
const stmtInsertPlayer = db.prepare(`
  INSERT INTO players (user_id, updated_at)
  VALUES (?, ?)
`);
const stmtInsertEvent = db.prepare(`
  INSERT INTO events (ts, type, visibility, target, msg)
  VALUES (?, ?, ?, ?, ?)
`);

// ----- Query functions -----
export function getUserByName(username) { return stmtUserByName.get(username); }
export function getUserIdByName(username) { return stmtUserIdByName.get(username); }
export function isUserAdmin(userId) { return Boolean(db.prepare(`SELECT is_admin FROM users WHERE id = ?`).get(userId)?.is_admin); }
export function getPlayerByUserId(userId) { return stmtPlayerByUserId.get(userId); }
export function getLeaderboard(limit) { return stmtLeaderboard.all(limit); }
// Returns global events plus events targeted at this specific user_id.
export function getRecentEvents(limit, userId) { return stmtRecentEvents.all({ limit, target: String(userId) }); }
export function getEventCounts() { return stmtEventCounts.all(); }
export function getEventTotal() { return stmtEventTotal.get()?.total ?? 0; }
export function insertUser(username, salt, hash, createdAt) { return stmtInsertUser.run(username, salt, hash, createdAt, createdAt); }
export function insertPlayer(userId, createdAt) {
  const info = stmtInsertPlayer.run(userId, createdAt);
  giveInventoryItem(userId, "Handgun", 1); // everyone starts with (and has equipped) a Handgun
  return info;
}
export function insertEvent(type, msg, visibility = "public", target = "global") { return stmtInsertEvent.run(Date.now(), type, visibility, String(target), msg); }

// Records the moment a user authenticated (account-level metadata on `users`).
export function updateLastLogin(userId) {
  db.prepare(`UPDATE users SET last_login = ? WHERE id = ?`).run(Date.now(), userId);
}

// Marks a player as active "now" — called on each game-state poll so presence
// can be derived from players.last_seen instead of a drifting counter.
export function touchPlayerSeen(userId) {
  db.prepare(`UPDATE players SET last_seen = ? WHERE user_id = ?`).run(Date.now(), userId);
}

// ----- Global game_state accessors -----
export function getGameState() {
  return db.prepare(`SELECT * FROM game_state WHERE key = 'main'`).get();
}

// hunt_enabled is stored as the text 'true' / 'false' (see schema default).
export function setHuntEnabled(enabled) {
  db.prepare(`
    UPDATE game_state
    SET hunt_enabled = ?, updated_at = ?
    WHERE key = 'main'
  `).run(enabled ? "true" : "false", Date.now());
}

// Add (or, with a negative delta, remove) zombies from the horde, floored at 0.
export function adjustHordeSize(delta) {
  db.prepare(`
    UPDATE game_state
    SET horde_size = MAX(0, horde_size + ?), updated_at = ?
    WHERE key = 'main'
  `).run(delta, Date.now());
}

export function setRaidEnabled(enabled) {
  db.prepare(`UPDATE game_state SET raid_enabled = ?, updated_at = ? WHERE key = 'main'`)
    .run(enabled ? "true" : "false", Date.now());
}

// Damage the base, floored at 0. Returns the new base_health.
export function adjustBaseHealth(delta) {
  db.prepare(`UPDATE game_state SET base_health = MAX(0, base_health + ?), updated_at = ? WHERE key = 'main'`)
    .run(delta, Date.now());
  return getGameState().base_health;
}

export function setBaseDestroyedAt(ts) {
  db.prepare(`UPDATE game_state SET base_destroyed_at = ?, updated_at = ? WHERE key = 'main'`)
    .run(ts, Date.now());
}

// Full experiment reset: zombies die, hunt & raid off, base rebuilt to full.
export function resetGameState(baseMaxHealth) {
  db.prepare(`
    UPDATE game_state
    SET hunt_enabled = 'false', horde_size = 0, raid_enabled = 'false',
        horde_status = 'idle', base_health = ?, base_destroyed_at = 0, updated_at = ?
    WHERE key = 'main'
  `).run(baseMaxHealth, Date.now());
  db.prepare("DELETE FROM nuke_votes").run();
}

// ----- Vote-to-nuke -----
export function recordNukeVote(userId) {
  db.prepare("INSERT OR IGNORE INTO nuke_votes (user_id, ts) VALUES (?, ?)").run(userId, Date.now());
}
export function getNukeVoterIds() {
  return db.prepare("SELECT user_id FROM nuke_votes").all().map((r) => r.user_id);
}
export function clearNukeVotes() {
  db.prepare("DELETE FROM nuke_votes").run();
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
    insertPlayer(userId, Date.now()); // also grants the starting Handgun
    player = stmtPlayerByUserId.get(userId);
  }
  return player;
}

// ----- Per-gun ammo/clip helpers -----
// Ammo/clips are stored per gun type (handgun/rifle/shotgun). Column names are
// built from a whitelisted type so they can't be injected.
export const GUN_TYPES = ["handgun", "rifle", "shotgun"];
// Canonical gun item names (map 1:1 to the types above).
export const GUN_NAMES = ["Handgun", "Rifle", "Shotgun"];
function gunCol(type, suffix) {
  if (!GUN_TYPES.includes(type)) throw new Error(`Invalid gun type: ${type}`);
  return `${type}_${suffix}`;
}

// Read the ammo/clip block for one gun type off an already-loaded player row.
export function gunAmmoOf(player, type) {
  return {
    ammo: player[`${type}_ammo`],
    maxAmmo: player[`${type}_max_ammo`],
    clips: player[`${type}_clips`],
    maxClips: player[`${type}_max_clips`],
    condition: player[`${type}_condition`],
  };
}

// Players seen within the last `sinceMs` epoch — i.e. currently active.
export function getActivePlayers(sinceMs) {
  return db.prepare(`
    SELECT p.user_id, u.username, p.health, p.shield, p.location
    FROM players p JOIN users u ON u.id = p.user_id
    WHERE p.last_seen >= ?
  `).all(sinceMs);
}

// Apply damage: shield absorbs first, then health. Both floored at 0.
export function damagePlayer(userId, amount) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const absorbed = Math.min(p.shield, amount);
  const shield = p.shield - absorbed;
  const health = Math.max(0, p.health - (amount - absorbed));
  db.prepare(`UPDATE players SET shield = ?, health = ?, updated_at = ? WHERE user_id = ?`)
    .run(shield, health, Date.now(), userId);
  return { shield, health, absorbed, healthLost: p.health - health };
}

// Nudge a gun type's condition (negative = wear from firing, positive = repair),
// clamped 0-100. Returns the new value.
export function adjustGunCondition(userId, type, delta) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return null;
  const col = gunCol(type, "condition");
  const newCond = Math.max(0, Math.min(100, player[col] + delta));
  db.prepare(`UPDATE players SET ${col} = ?, updated_at = ? WHERE user_id = ?`)
    .run(newCond, Date.now(), userId);
  return newCond;
}

export function updateGunAmmo(userId, type, ammoChange, clipChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const a = gunCol(type, "ammo"), c = gunCol(type, "clips");
  const newAmmo = Math.max(0, player[a] + ammoChange);
  const newClips = Math.max(0, player[c] + clipChange);
  db.prepare(`UPDATE players SET ${a} = ?, ${c} = ?, updated_at = ? WHERE user_id = ?`)
    .run(newAmmo, newClips, Date.now(), userId);
}

// Reload one gun type: refill ammo to its max, spending one clip. Returns a
// small result so the caller can message the player.
export function reloadGun(userId, type) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return { ok: false, reason: "no_player" };
  const { ammo, maxAmmo, clips } = gunAmmoOf(player, type);
  if (clips <= 0) return { ok: false, reason: "no_clips" };
  if (ammo >= maxAmmo) return { ok: false, reason: "full" };
  updateGunAmmo(userId, type, maxAmmo - ammo, -1);
  return { ok: true };
}

export function updateGunMaxAmmo(userId, type, change) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const col = gunCol(type, "max_ammo");
  const newMax = Math.max(0, player[col] + change);
  db.prepare(`UPDATE players SET ${col} = ?, updated_at = ? WHERE user_id = ?`)
    .run(newMax, Date.now(), userId);
}

export function updateGunMaxClips(userId, type, change) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const col = gunCol(type, "max_clips");
  const newMax = Math.max(0, player[col] + change);
  db.prepare(`UPDATE players SET ${col} = ?, updated_at = ? WHERE user_id = ?`)
    .run(newMax, Date.now(), userId);
}

export function updatePlayerStats(userId, xpChange, killChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;

  const newXP = Math.max(0, player.xp + xpChange);
  // lifetime_xp only ever grows (earned XP), so leaderboard rank survives spending.
  const newLifetime = player.lifetime_xp + Math.max(0, xpChange);
  const newKills = Math.max(0, player.kills + killChange);

  db.prepare(`
    UPDATE players
    SET xp = ?, lifetime_xp = ?, kills = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newXP, newLifetime, newKills, Date.now(), userId);
}

// Spend XP to gain a level: -cost XP, set new level, +5 accuracy & max health,
// and heal to the new max. lifetime_xp is untouched (spending doesn't lose rank).
export function applyLevelUp(userId, newLevel, cost) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const xp = Math.max(0, p.xp - cost);
  const accuracy = p.accuracy + 5;
  const maxHealth = p.max_health + 5;
  db.prepare(`
    UPDATE players
    SET xp = ?, level = ?, accuracy = ?, max_health = ?, health = ?, updated_at = ?
    WHERE user_id = ?
  `).run(xp, newLevel, accuracy, maxHealth, maxHealth, Date.now(), userId);
  return { xp, level: newLevel, accuracy, maxHealth };
}

// Full death reset: wipe the player back to a fresh level-1 state (inventory
// cleared, starting Handgun re-granted). The user account is kept.
export function resetPlayer(userId) {
  db.transaction(() => {
    db.prepare("DELETE FROM player_inventory WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM players WHERE user_id = ?").run(userId);
    insertPlayer(userId, Date.now());
  })();
}

export function getPlayersByLocation(location) {
  return db.prepare("SELECT user_id FROM players WHERE location = ?").all(location);
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

// Adjust a player's gold (floored at 0). Positive to grant, negative to spend.
export function updatePlayerGold(userId, goldChange) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const newGold = Math.max(0, player.gold + goldChange);
  db.prepare(`
    UPDATE players
    SET gold = ?, updated_at = ?
    WHERE user_id = ?
  `).run(newGold, Date.now(), userId);
}

// ----- Inventory helpers -----
export function getInventory(userId) {
  return db.prepare(`
    SELECT item_name, quantity, condition, ammo, clips
    FROM player_inventory
    WHERE user_id = ?
    ORDER BY item_name
  `).all(userId);
}

export function getInventoryItem(userId, itemName) {
  return db.prepare(`
    SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_name = ?
  `).get(userId, itemName);
}

// Add quantity of an item, stacking onto an existing row if present.
export function giveInventoryItem(userId, itemName, quantity = 1) {
  const owned = getInventoryItem(userId, itemName);
  if (owned) {
    db.prepare(`UPDATE player_inventory SET quantity = quantity + ?, updated_at = ? WHERE id = ?`)
      .run(quantity, Date.now(), owned.id);
  } else {
    db.prepare(`INSERT INTO player_inventory (user_id, item_name, quantity, updated_at) VALUES (?, ?, ?, ?)`)
      .run(userId, itemName, quantity, Date.now());
  }
}

// Consume one unit of an item. The row is kept at 0 (not deleted) so a spent
// consumable stays visible-but-unusable in the inventory list. Returns the new
// quantity, or null if the player doesn't own a usable (>0) copy.
export function consumeInventoryItem(userId, itemName) {
  const owned = getInventoryItem(userId, itemName);
  if (!owned || owned.quantity <= 0) return null;
  const newQty = owned.quantity - 1;
  db.prepare(`UPDATE player_inventory SET quantity = ?, updated_at = ? WHERE id = ?`)
    .run(newQty, Date.now(), owned.id);
  return newQty;
}

// ----- Shop accessors (admin-managed catalogue) -----
export function getShopItems() {
  return db.prepare(`SELECT * FROM shop_items ORDER BY item_type, item_name`).all();
}

export function getShopItemByName(name) {
  return db.prepare(`SELECT * FROM shop_items WHERE item_name = ?`).get(name);
}

export function insertShopItem(name, cost, type, quantity = 1, packCost = 0, packQuantity = 0) {
  return db.prepare(`
    INSERT INTO shop_items (item_name, item_cost, item_type, item_quantity, item_pack_cost, item_pack_quantity)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, Number(cost), type, Number(quantity), Number(packCost), Number(packQuantity));
}

// Partial update: pass an object with any of the item_* columns to change.
export function updateShopItem(name, fields) {
  const existing = getShopItemByName(name);
  if (!existing) return null;
  const merged = { ...existing, ...fields };
  db.prepare(`
    UPDATE shop_items
    SET item_cost = ?, item_type = ?, item_quantity = ?, item_pack_cost = ?, item_pack_quantity = ?
    WHERE item_name = ?
  `).run(
    Number(merged.item_cost), merged.item_type, Number(merged.item_quantity),
    Number(merged.item_pack_cost), Number(merged.item_pack_quantity), name
  );
  return getShopItemByName(name);
}

export function deleteShopItem(name) {
  return db.prepare(`DELETE FROM shop_items WHERE item_name = ?`).run(name);
}

// Buy one unit of a shop item with gold, in a single transaction so gold and
// inventory can't drift apart on failure. Returns a small result object.
export function purchaseShopItem(userId, itemName) {
  const tx = db.transaction((userId, itemName) => {
    const item = getShopItemByName(itemName);
    if (!item) return { ok: false, reason: "no_such_item" };

    const player = stmtPlayerByUserId.get(userId);
    if (!player) return { ok: false, reason: "no_player" };
    if (player.gold < item.item_cost) {
      return { ok: false, reason: "insufficient_gold", cost: item.item_cost, gold: player.gold };
    }

    db.prepare(`UPDATE players SET gold = gold - ?, updated_at = ? WHERE user_id = ?`)
      .run(item.item_cost, Date.now(), userId);

    // Stack onto an existing inventory row if the player already owns this item.
    const owned = db.prepare(`SELECT id FROM player_inventory WHERE user_id = ? AND item_name = ?`)
      .get(userId, itemName);
    if (owned) {
      db.prepare(`UPDATE player_inventory SET quantity = quantity + ?, updated_at = ? WHERE id = ?`)
        .run(item.item_quantity, Date.now(), owned.id);
    } else {
      db.prepare(`INSERT INTO player_inventory (user_id, item_name, quantity, updated_at) VALUES (?, ?, ?, ?)`)
        .run(userId, itemName, item.item_quantity, Date.now());
    }

    return { ok: true, item, goldLeft: player.gold - item.item_cost };
  });
  return tx(userId, itemName);
}
