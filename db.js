// db.js (ESM)
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { file_config } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Put the DB somewhere persistent on your VPS.
// This makes a ./data folder beside your app.
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", file_config.databaseFile || "zboe.sqlite");

// Display names for the world map — the object keys are ALSO the canonical
// list of valid location keys. basecamp_inside is entered via the base
// toggle, never the map (and hides the map entirely while there).
export const LOCATION_NAMES = {
  basecamp_outside: "Basecamp",
  basecamp_inside: "Inside the Base",
  bunker: "Bunker",
  forest: "Forest",
  lake: "Lake",
  mountains: "Mountains",
  river: "River",
  swamp: "Swamp",
  cave: "Cave",
  town: "Town",
};

// Locations where the zombie pool is active — tick attacks and hunting only
// happen here. Everywhere else is "safe" (the game page swaps Hunt Info for
// Actions there). basecamp_inside counts: zombies besiege the base itself,
// with player hits absorbed as base HP.
export const ZOMBIE_LOCATIONS = new Set([
  "basecamp_outside",
  "basecamp_inside",
  "forest",
  "lake",
  "swamp",
]);

// Travel graph: which locations connect. The Bunker hangs off Basecamp only;
// the Forest is the hub that reaches every other named location.
export const LOCATION_LINKS = {
  basecamp_outside: ["bunker", "forest"],
  basecamp_inside: [],
  bunker: ["basecamp_outside"],
  forest: ["basecamp_outside", "lake", "mountains", "river", "swamp", "cave", "town"],
  lake: ["forest"],
  mountains: ["forest"],
  river: ["forest"],
  swamp: ["forest"],
  cave: ["forest"],
  town: ["forest"],
};

// ----- Skills -----
// Six trainable skills; each has s_<key>_lvl / s_<key>_xp columns on players.
// Skill XP comes from location actions and is SPENT on skill levels (same
// philosophy as the main level): buy the next level when xp >= skillLevelCost.
export const SKILLS = ["magic", "woodcutting", "fishing", "mining", "smithing", "crafting"];
export const SKILL_NAMES = {
  magic: "Magic",
  woodcutting: "Woodcutting",
  fishing: "Fishing",
  mining: "Mining",
  smithing: "Smithing",
  crafting: "Crafting",
};
export function skillLevelCost(targetLevel) { return Math.round(50 * Math.pow(targetLevel, 1.4)); }

// ----- Location actions -----
// The per-location action catalogue. Fields:
//   key         unique id (posted back by the Do button)
//   label       display name
//   timer       seconds the action takes (player is busy until it resolves)
//   skill       which skill it trains / gates it (see SKILLS)
//   skillLevel  minimum skill level required
//   successRate % chance the action succeeds when it resolves
//   grants      inventory item given on success
//   xp          skill XP awarded on success
//   requires    inventory item (tool) that must be OWNED to attempt — not
//               consumed. Omit for no requirement (mushrooms need nothing;
//               mining copper needs a stone pickaxe).
//   drops       true = successful runs also roll the RANDOM_DROPS treasure
//               table (item_backbone.js) for a bonus find.
export const LOCATION_ACTIONS = {
  basecamp_outside: [
    { key: "gather_firewood", label: "Gather Firewood", timer: 10, skill: "woodcutting", skillLevel: 1, successRate: 90, grants: "firewood", xp: 5, drops: true },
  ],
  bunker: [
    { key: "tinker_radio", label: "Tinker with the Radio", timer: 15, skill: "crafting", skillLevel: 3, successRate: 60, grants: "radio part", xp: 10 },
  ],
  forest: [
    { key: "gather_mushrooms", label: "Gather Mushrooms", timer: 8, skill: "crafting", skillLevel: 1, successRate: 90, grants: "mushroom", xp: 5, drops: true },
    { key: "chop_wood", label: "Chop Wood", timer: 15, skill: "woodcutting", skillLevel: 1, successRate: 80, grants: "wood log", requires: "axe", xp: 10, drops: true },
    { key: "trap_game", label: "Trap Game", timer: 15, skill: "crafting", skillLevel: 2, successRate: 70, grants: "raw meat", xp: 8 },
  ],
  lake: [
    { key: "fish_shallows", label: "Fish the Shallows", timer: 15, skill: "fishing", skillLevel: 1, successRate: 75, grants: "raw fish", requires: "fishing rod", xp: 10 },
  ],
  river: [
    { key: "net_minnows", label: "Net Minnows", timer: 10, skill: "fishing", skillLevel: 1, successRate: 85, grants: "minnow", xp: 6 },
  ],
  mountains: [
    { key: "mine_copper", label: "Mine Copper", timer: 20, skill: "mining", skillLevel: 1, successRate: 75, grants: "copper ore", requires: "stone pickaxe", xp: 10 },
    { key: "mine_iron", label: "Mine Iron", timer: 30, skill: "mining", skillLevel: 5, successRate: 60, grants: "iron ore", requires: "stone pickaxe", xp: 20 },
  ],
  swamp: [
    { key: "gather_herbs", label: "Gather Herbs", timer: 10, skill: "crafting", skillLevel: 1, successRate: 85, grants: "swamp herb", xp: 6, drops: true },
  ],
  cave: [
    { key: "harvest_glowcaps", label: "Harvest Glowcaps", timer: 12, skill: "magic", skillLevel: 1, successRate: 80, grants: "glowcap", xp: 8 },
    { key: "channel_leyline", label: "Channel the Ley Line", timer: 20, skill: "magic", skillLevel: 5, successRate: 70, grants: "mana shard", xp: 15 },
  ],
  town: [
    { key: "scavenge_scrap", label: "Scavenge Scrap", timer: 12, skill: "crafting", skillLevel: 1, successRate: 80, grants: "scrap metal", xp: 8 },
    { key: "smith_scrap", label: "Smith at the Old Forge", timer: 20, skill: "smithing", skillLevel: 1, successRate: 70, grants: "crude blade", requires: "hammer", xp: 12 },
  ],
};

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
  -- Server-side session pair (see server.js): HMAC'd key + UUID, rotated on
  -- login. Defaults are the logged-out state ('LOGGED_OUT' + 64 zeros).
  session_key TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  session_id TEXT NOT NULL DEFAULT 'LOGGED_OUT',
  created_at INTEGER NOT NULL,
  last_login INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 1:1 per user (stats)
CREATE TABLE IF NOT EXISTS players (
  user_id INTEGER PRIMARY KEY,
  -- Auth Keys (mirror of users.session_*; API auth verifies both tables agree)
  session_key TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  session_id TEXT NOT NULL DEFAULT 'LOGGED_OUT',
  -- Playercard Stats
  xp INTEGER NOT NULL DEFAULT 0,             -- spendable XP (spent on levels)
  lifetime_xp INTEGER NOT NULL DEFAULT 0,    -- total XP ever earned (leaderboard rank)
  level INTEGER NOT NULL DEFAULT 1,
  health INTEGER NOT NULL DEFAULT 100,
  max_health INTEGER NOT NULL DEFAULT 100,
  shield INTEGER NOT NULL DEFAULT 0,
  max_shield INTEGER NOT NULL DEFAULT 100,
  kills INTEGER NOT NULL DEFAULT 0,
  accuracy INTEGER NOT NULL DEFAULT 35,      -- % hit chance
  gold INTEGER NOT NULL DEFAULT 0,             -- in-game currency
  horde_tokens INTEGER NOT NULL DEFAULT 0,        -- number of horde tokens player has
  golden_shots INTEGER NOT NULL DEFAULT 0,     -- remaining Golden Gun power-up shots (0 = not active)
  equipped_gun TEXT NOT NULL DEFAULT 'Handgun',
  -- Per-type gun stats. Page stats (ammo/clips/condition/etc) read from the equipped gun's type.
  handgun_ammo INTEGER NOT NULL DEFAULT 6,
  handgun_max_ammo INTEGER NOT NULL DEFAULT 6,
  handgun_clips INTEGER NOT NULL DEFAULT 3,
  handgun_max_clips INTEGER NOT NULL DEFAULT 3,
  handgun_condition INTEGER NOT NULL DEFAULT 100,
  handgun_jammed INTEGER NOT NULL DEFAULT 0,   -- 0/1, jam is tracked per gun
  rifle_ammo INTEGER NOT NULL DEFAULT 15,
  rifle_max_ammo INTEGER NOT NULL DEFAULT 15,
  rifle_clips INTEGER NOT NULL DEFAULT 4,
  rifle_max_clips INTEGER NOT NULL DEFAULT 4,
  rifle_condition INTEGER NOT NULL DEFAULT 100,
  rifle_jammed INTEGER NOT NULL DEFAULT 0,
  shotgun_ammo INTEGER NOT NULL DEFAULT 5,
  shotgun_max_ammo INTEGER NOT NULL DEFAULT 5,
  shotgun_clips INTEGER NOT NULL DEFAULT 6,
  shotgun_max_clips INTEGER NOT NULL DEFAULT 6,
  shotgun_condition INTEGER NOT NULL DEFAULT 100,
  shotgun_jammed INTEGER NOT NULL DEFAULT 0,
  -- Playercard Skills
  s_magic_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's magic skill
  s_magic_xp INTEGER NOT NULL DEFAULT 0, -- spendable magic XP (spent on skill levels)
  s_woodcutting_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's woodcutting skill
  s_woodcutting_xp INTEGER NOT NULL DEFAULT 0, -- spendable woodcutting XP (spent on skill levels)
  s_fishing_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's fishing skill
  s_fishing_xp INTEGER NOT NULL DEFAULT 0, -- spendable fishing XP (spent on skill levels)
  s_mining_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's mining skill
  s_mining_xp INTEGER NOT NULL DEFAULT 0, -- spendable mining XP (spent on skill levels)
  s_smithing_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's smithing skill
  s_smithing_xp INTEGER NOT NULL DEFAULT 0, -- spendable smithing XP (spent on skill levels)
  s_crafting_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's crafting skill
  s_crafting_xp INTEGER NOT NULL DEFAULT 0, -- spendable crafting XP (spent on skill levels)
  s_cooking_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's cooking skill
  s_cooking_xp INTEGER NOT NULL DEFAULT 0, -- spendable cooking XP (spent on skill levels)
  location TEXT NOT NULL DEFAULT 'basecamp_outside', -- current location key (see LOCATION_NAMES)
  -- Player Tracking Information
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
const stmtUserByName = db.prepare(`SELECT id, username, pass_salt, pass_hash, session_key, session_id FROM users WHERE username = ?`);
// Auth check needs both tables' session pairs in one hit (they must agree).
const stmtAuthRecord = db.prepare(`
  SELECT u.id, u.username, u.session_key, u.session_id,
         p.session_key AS p_session_key, p.session_id AS p_session_id
  FROM users u LEFT JOIN players p ON p.user_id = u.id
  WHERE u.username = ?
`);
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
export function getAuthRecord(username) { return stmtAuthRecord.get(username); }

// ----- Server-side sessions -----
// The session pair lives on BOTH users and players (written together, and the
// API rejects requests where the two tables disagree). server.js owns the
// key derivation; these just store/clear the values.
export const SESSION_LOGGED_OUT = "LOGGED_OUT";
export const SESSION_KEY_ZERO = "0".repeat(64);

export function setUserSession(userId, sessionKey, sessionId) {
  db.transaction(() => {
    db.prepare("UPDATE users SET session_key = ?, session_id = ? WHERE id = ?")
      .run(sessionKey, sessionId, userId);
    db.prepare("UPDATE players SET session_key = ?, session_id = ?, updated_at = ? WHERE user_id = ?")
      .run(sessionKey, sessionId, Date.now(), userId);
  })();
}

export function setUserLoggedOut(userId) {
  setUserSession(userId, SESSION_KEY_ZERO, SESSION_LOGGED_OUT);
}
export function getUserIdByName(username) { return stmtUserIdByName.get(username); }
export function isUserAdmin(userId) { return Boolean(db.prepare(`SELECT is_admin FROM users WHERE id = ?`).get(userId)?.is_admin); }
export function getPlayerByUserId(userId) { return stmtPlayerByUserId.get(userId); }
export function getLeaderboard(limit) { return stmtLeaderboard.all(limit); }
// Returns global events plus events targeted at this specific user_id.
export function getRecentEvents(limit, userId) { return stmtRecentEvents.all({ limit, target: String(userId) }); }
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
    jammed: Boolean(player[`${type}_jammed`]),
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

// Buy/grant shield, clamped to the player's max_shield capacity. Returns the new shield.
export function addShield(userId, amount) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const shield = Math.max(0, Math.min(p.max_shield, p.shield + amount));
  db.prepare(`UPDATE players SET shield = ?, updated_at = ? WHERE user_id = ?`).run(shield, Date.now(), userId);
  return shield;
}

// Booster: raise (or lower) shield capacity, floored at 0. Returns the new max.
export function increaseMaxShield(userId, amount) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const maxShield = Math.max(0, p.max_shield + amount);
  db.prepare(`UPDATE players SET max_shield = ?, updated_at = ? WHERE user_id = ?`).run(maxShield, Date.now(), userId);
  return maxShield;
}

// Grant/heal health, clamped to max_health. Returns the new health.
export function healPlayer(userId, amount) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const health = Math.max(0, Math.min(p.max_health, p.health + amount));
  db.prepare(`UPDATE players SET health = ?, updated_at = ? WHERE user_id = ?`).run(health, Date.now(), userId);
  return health;
}

// Horde/raid tokens (currency). Positive to grant, negative to spend; floored at 0.
export function addTokens(userId, amount) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const tokens = Math.max(0, p.horde_tokens + amount);
  db.prepare(`UPDATE players SET horde_tokens = ?, updated_at = ? WHERE user_id = ?`).run(tokens, Date.now(), userId);
  return tokens;
}

// Golden Gun power-up: add N shots (stacks if bought again). Returns remaining.
export function grantGoldenShots(userId, shots) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const golden = p.golden_shots + shots;
  db.prepare(`UPDATE players SET golden_shots = ?, updated_at = ? WHERE user_id = ?`).run(golden, Date.now(), userId);
  return golden;
}

// Spend one Golden Gun shot. Returns remaining (>=0), or null if none were left.
export function useGoldenShot(userId) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p || p.golden_shots <= 0) return null;
  const golden = p.golden_shots - 1;
  db.prepare(`UPDATE players SET golden_shots = ?, updated_at = ? WHERE user_id = ?`).run(golden, Date.now(), userId);
  return golden;
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
  const { ammo, maxAmmo, clips, jammed } = gunAmmoOf(player, type);
  if (jammed) return { ok: false, reason: "jammed" }; // a jammed gun needs Unjam, not Reload
  if (clips <= 0) return { ok: false, reason: "no_clips" };
  if (ammo >= maxAmmo) return { ok: false, reason: "full" };
  updateGunAmmo(userId, type, maxAmmo - ammo, -1);
  return { ok: true };
}

// Clear a jam: eject the jammed clip and load a fresh one. Costs 1 clip and
// refills ammo to max, like a reload — but works (only) on a jammed gun.
export function unjamGun(userId, type) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return { ok: false, reason: "no_player" };

  const { ammo, maxAmmo, clips, jammed } = gunAmmoOf(player, type);

  if (!jammed) return { ok: false, reason: "not_jammed" };

  if (ammo === 0) {
    if (clips <= 0) return { ok: false, reason: "no_clips" };

    db.prepare(`
      UPDATE players
      SET ${gunCol(type, "jammed")} = 0,
          ${gunCol(type, "ammo")} = ?,
          ${gunCol(type, "clips")} = ${gunCol(type, "clips")} - 1,
          updated_at = ?
      WHERE user_id = ?
    `).run(maxAmmo, Date.now(), userId);

    return { ok: true, method: "clip" };
  }

  db.prepare(`
    UPDATE players
    SET ${gunCol(type, "jammed")} = 0,
        ${gunCol(type, "ammo")} = ${gunCol(type, "ammo")} - 1,
        updated_at = ?
    WHERE user_id = ?
  `).run(Date.now(), userId);

  return { ok: true, method: "ammo" };
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

// ----- Skill XP / levels -----
function skillCols(skill) {
  if (!SKILLS.includes(skill)) throw new Error(`Invalid skill: ${skill}`);
  return { lvl: `s_${skill}_lvl`, xp: `s_${skill}_xp` };
}

// Award skill XP (from actions/crafting/meditation). Two things happen:
//  1. The MAIN progression advances too: the same amount lands in spendable
//     `xp` and `lifetime_xp` (leaderboard) — spending never touches lifetime.
//  2. Skills AUTO-LEVEL: the skill pool is progress toward the next skill
//     level; on reaching skillLevelCost(next) it rolls over (looping for big
//     awards) and a private 'level' event announces each level gained.
// Returns { xp, level, leveled: [newLevels...] }.
export function addSkillXp(userId, skill, amount) {
  const { lvl, xp } = skillCols(skill);
  return db.transaction(() => {
    const p = stmtPlayerByUserId.get(userId);
    if (!p) return null;
    let pool = p[xp] + amount;
    let level = p[lvl];
    const leveled = [];
    while (pool >= skillLevelCost(level + 1)) {
      pool -= skillLevelCost(level + 1);
      level += 1;
      leveled.push(level);
    }
    db.prepare(`
      UPDATE players
      SET ${xp} = ?, ${lvl} = ?, xp = xp + ?, lifetime_xp = lifetime_xp + ?, updated_at = ?
      WHERE user_id = ?
    `).run(pool, level, amount, amount, Date.now(), userId);
    for (const l of leveled) {
      insertEvent("level", `Your ${SKILL_NAMES[skill]} reached level ${l}`, "private", String(userId));
    }
    return { xp: pool, level, leveled };
  })();
}

// Buy the next skill level directly with MAIN player XP (the spendable pool
// funds player levels OR skill levels). The skill's own progress pool is
// untouched. Returns { ok, level, cost } or { ok:false, reason }.
export function buySkillLevel(userId, skill) {
  const { lvl } = skillCols(skill);
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return { ok: false, reason: "no_player" };
  const cost = skillLevelCost(p[lvl] + 1);
  if (p.xp < cost) return { ok: false, reason: "cant_afford", cost };
  db.prepare(`UPDATE players SET ${lvl} = ${lvl} + 1, xp = xp - ?, updated_at = ? WHERE user_id = ?`)
    .run(cost, Date.now(), userId);
  return { ok: true, level: p[lvl] + 1, cost };
}

// ----- Leveling rules (source of truth) -----
// Levels are numerical (always +1). Cost compounds with the target level. Stat
// bonuses (+accuracy/+max health) are granted every level up to 15, then only
// every 5th level after that (20, 25, 30, …).
export const LEVEL_ACC_BONUS = 5;
export const LEVEL_HEALTH_BONUS = 5;
export function nextLevelOf(level) { return level + 1; }
export function prevLevelOf(level) { return Math.max(1, level - 1); }
export function levelCost(targetLevel) { return Math.round(100 * Math.pow(targetLevel, 1.6)); }
export function levelGrantsBonus(level) { return level <= 15 || level % 5 === 0; }

// Spend XP to gain a level: -cost XP, set new level. If the new level grants a
// stat bonus, +accuracy/+max health and heal to the new max; otherwise just the
// level number changes. lifetime_xp is untouched (spending doesn't lose rank).
export function applyLevelUp(userId, newLevel, cost) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const xp = Math.max(0, p.xp - cost);
  let accuracy = p.accuracy, maxHealth = p.max_health, health = p.health;
  if (levelGrantsBonus(newLevel)) {
    accuracy = Math.min(100, p.accuracy + LEVEL_ACC_BONUS);
    maxHealth = p.max_health + LEVEL_HEALTH_BONUS;
    health = maxHealth; // heal to new max on a stat level
  }
  db.prepare(`
    UPDATE players
    SET xp = ?, level = ?, accuracy = ?, max_health = ?, health = ?, updated_at = ?
    WHERE user_id = ?
  `).run(xp, newLevel, accuracy, maxHealth, health, Date.now(), userId);
  return { xp, level: newLevel, accuracy, maxHealth, bonus: levelGrantsBonus(newLevel) };
}

// Admin force-level by `steps` (+/-): applies the full per-level stack — level,
// accuracy & max-health bonuses, and matching lifetime XP — with no spendable-XP
// cost. Level-ups heal to the new max; level-downs floor at level 1. Returns the
// new level, or null if the player is missing.
export function forceLevel(userId, steps) {
  const tx = db.transaction(() => {
    const p = stmtPlayerByUserId.get(userId);
    if (!p) return null;
    let { level, accuracy, max_health: maxHealth, health, lifetime_xp: lifetimeXp } = p;
    const n = Math.trunc(Number(steps)) || 0;
    let bonusApplied = false;
    for (let i = 0; i < Math.abs(n); i++) {
      if (n > 0) {
        const t = nextLevelOf(level);
        lifetimeXp += levelCost(t);
        level = t;
        if (levelGrantsBonus(t)) { // only stat-bonus levels gain stats
          accuracy = Math.min(100, accuracy + LEVEL_ACC_BONUS);
          maxHealth += LEVEL_HEALTH_BONUS;
          bonusApplied = true;
        }
      } else {
        if (level <= 1) break;
        lifetimeXp = Math.max(0, lifetimeXp - levelCost(level));
        if (levelGrantsBonus(level)) { // reverse the bonus the current level granted
          accuracy = Math.max(0, accuracy - LEVEL_ACC_BONUS);
          maxHealth = Math.max(1, maxHealth - LEVEL_HEALTH_BONUS);
        }
        level = prevLevelOf(level);
      }
    }
    health = n > 0 && bonusApplied ? maxHealth : Math.min(health, maxHealth);
    db.prepare(`
      UPDATE players SET level = ?, accuracy = ?, max_health = ?, health = ?, lifetime_xp = ?, updated_at = ?
      WHERE user_id = ?
    `).run(level, accuracy, maxHealth, health, lifetimeXp, Date.now(), userId);
    return level;
  });
  return tx();
}

// Full death reset: wipe the player back to a fresh level-1 state (inventory
// cleared, starting Handgun re-granted). The user account is kept.
export function resetPlayer(userId) {
  db.transaction(() => {
    db.prepare("DELETE FROM player_inventory WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM players WHERE user_id = ?").run(userId);
    insertPlayer(userId, Date.now());
    // The fresh row defaults to logged-out session values — copy the live
    // pair back from users so dying doesn't kick the player's session.
    db.prepare(`
      UPDATE players
      SET session_key = (SELECT session_key FROM users WHERE id = ?),
          session_id  = (SELECT session_id  FROM users WHERE id = ?)
      WHERE user_id = ?
    `).run(userId, userId, userId);
  })();
}

export function getPlayersByLocation(location) {
  return db.prepare("SELECT user_id FROM players WHERE location = ?").all(location);
}

// Jam state is per gun type (a jammed Rifle doesn't stop the Handgun).
export function setGunJammed(userId, type, jammed) {
  db.prepare(`
    UPDATE players
    SET ${gunCol(type, "jammed")} = ?, updated_at = ?
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
// Currently unreferenced: reserved for the planned traversal map / per-location
// actions panel (multiple named locations, some using the zombie pool, some safe).
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

// Consume a recipe's inputs ({ item: qty, ... }) atomically: either the player
// owns everything and it's all deducted, or nothing changes. Returns
// { ok } or { ok:false, missing: [item, ...] }.
export function consumeItems(userId, inputs) {
  const tx = db.transaction(() => {
    const missing = [];
    for (const [item, qty] of Object.entries(inputs)) {
      const row = db.prepare("SELECT quantity FROM player_inventory WHERE user_id = ? AND item_name = ?")
        .get(userId, item);
      if (!row || row.quantity < qty) missing.push(item);
    }
    if (missing.length) return { ok: false, missing };
    for (const [item, qty] of Object.entries(inputs)) {
      db.prepare("UPDATE player_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND item_name = ?")
        .run(qty, Date.now(), userId, item);
    }
    return { ok: true };
  });
  return tx();
}

// Sell `qty` of an item for gold (unit value from the registry), atomically.
// qty is clamped to what's owned (pass Infinity for "all"); the row stays at
// qty 0 when sold out, matching the consumable convention. Returns
// { ok, sold, gold } or { ok:false, reason:"not_owned" }.
export function sellItem(userId, itemName, qty, unitValue) {
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT quantity FROM player_inventory WHERE user_id = ? AND item_name = ?")
      .get(userId, itemName);
    if (!row || row.quantity <= 0) return { ok: false, reason: "not_owned" };
    const n = Math.min(qty, row.quantity);
    const gold = n * unitValue;
    db.prepare("UPDATE player_inventory SET quantity = quantity - ?, updated_at = ? WHERE user_id = ? AND item_name = ?")
      .run(n, Date.now(), userId, itemName);
    db.prepare("UPDATE players SET gold = gold + ?, updated_at = ? WHERE user_id = ?")
      .run(gold, Date.now(), userId);
    return { ok: true, sold: n, gold };
  });
  return tx();
}

// ----- Registry shop purchase -----
// Buy one unit of a registry item (item_backbone.js). The caller (server.js)
// resolves the item + cost/currency from ITEMS; this just moves the money and
// the item in one transaction so they can't drift apart on failure.
export function purchaseItem(userId, itemName, cost, currency = "gold") {
  const col = currency === "token" ? "horde_tokens" : "gold";
  const tx = db.transaction(() => {
    const player = stmtPlayerByUserId.get(userId);
    if (!player) return { ok: false, reason: "no_player" };
    if (player[col] < cost) return { ok: false, reason: "insufficient_funds", cost, have: player[col], currency };

    db.prepare(`UPDATE players SET ${col} = ${col} - ?, updated_at = ? WHERE user_id = ?`)
      .run(cost, Date.now(), userId);
    giveInventoryItem(userId, itemName, 1);
    return { ok: true, left: player[col] - cost };
  });
  return tx();
}

// ===== Admin accessors (for the web admin panel & CLI) =====

// --- Users ---
export function listUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.is_admin, p.level, p.location, p.last_seen
    FROM users u LEFT JOIN players p ON p.user_id = u.id
    ORDER BY u.id
  `).all();
}
export function setUserAdmin(userId, isAdmin) {
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(isAdmin ? 1 : 0, userId);
}
// Caller does the hashing (server.js owns the PBKDF2 params); this just stores it.
export function setUserAuth(userId, salt, hash) {
  db.prepare("UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?").run(salt, hash, userId);
}
export function deleteUserCascade(userId) {
  db.transaction(() => {
    db.prepare("DELETE FROM player_inventory WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM players WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM events WHERE target = ?").run(String(userId));
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  })();
}

// --- Editable player stats (whitelisted columns; floored at 0, some capped) ---
// health is capped to the player's dynamic max_health via `maxCol`.
export const EDITABLE_STATS = {
  xp: {}, lifetime_xp: {}, level: {}, kills: {}, gold: {}, horde_tokens: {}, golden_shots: {},
  health: { maxCol: "max_health" }, max_health: {},
  shield: { maxCol: "max_shield" }, max_shield: {}, accuracy: { max: 100 },
  hidden: { max: 1 },
  handgun_ammo: {}, handgun_max_ammo: {}, handgun_clips: {}, handgun_max_clips: {}, handgun_condition: { max: 100 }, handgun_jammed: { max: 1 },
  rifle_ammo: {}, rifle_max_ammo: {}, rifle_clips: {}, rifle_max_clips: {}, rifle_condition: { max: 100 }, rifle_jammed: { max: 1 },
  shotgun_ammo: {}, shotgun_max_ammo: {}, shotgun_clips: {}, shotgun_max_clips: {}, shotgun_condition: { max: 100 }, shotgun_jammed: { max: 1 },
  // Skill levels/XP (one _lvl/_xp pair per entry in SKILLS).
  ...Object.fromEntries(SKILLS.flatMap((s) => [[`s_${s}_lvl`, {}], [`s_${s}_xp`, {}]])),
};

// Set a whitelisted stat, clamped (>=0, plus any max / max_health cap). Returns
// { ok, value, clamped } or { ok:false, reason }.
export function setPlayerStat(userId, field, rawValue) {
  const spec = EDITABLE_STATS[field];
  if (!spec) return { ok: false, reason: "bad_field" };
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return { ok: false, reason: "no_player" };
  const n = Math.round(Number(rawValue));
  if (Number.isNaN(n)) return { ok: false, reason: "nan" };
  let value = Math.max(0, n);
  if (spec.max !== undefined) value = Math.min(spec.max, value);
  if (spec.maxCol) value = Math.min(player[spec.maxCol], value);
  db.prepare(`UPDATE players SET ${field} = ?, updated_at = ? WHERE user_id = ?`)
    .run(value, Date.now(), userId);
  return { ok: true, value, clamped: value !== n };
}

// --- Inventory ---
// Remove `qty` of an item (default: the whole stack). Returns the new quantity
// (0 = removed), or null if the player doesn't own it.
export function removeInventoryItem(userId, itemName, qty) {
  const row = db.prepare("SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_name = ?")
    .get(userId, itemName);
  if (!row) return null;
  const n = Number(qty);
  if (qty === undefined || qty === "" || Number.isNaN(n) || n >= row.quantity) {
    db.prepare("DELETE FROM player_inventory WHERE id = ?").run(row.id);
    return 0;
  }
  const newQty = row.quantity - n;
  db.prepare("UPDATE player_inventory SET quantity = ?, updated_at = ? WHERE id = ?")
    .run(newQty, Date.now(), row.id);
  return newQty;
}
