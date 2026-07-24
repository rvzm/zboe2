// db_backbone.js (ESM)
import Database from "better-sqlite3";
import crypto from "node:crypto";
import path from "path";
import { fileURLToPath } from "url";
import { file_config, game_config } from "./config.js";
import { STARTER_SPELLS } from "./magic_backbone.js";
import { QUESTS } from "./quest_backbone.js";
import { ZOMBIE_LOCATIONS, OUTBREAK_LOCATIONS } from "./location_backbone.js";

// Injected once at boot from server.js, which owns the real log() facility —
// db_backbone.js can't import it directly (server.js imports FROM here, so
// the reverse would be circular). No-ops until wired up, but nothing in this
// file logs at module-load time, so that's never actually hit in practice.
let _log = () => {};
export function setLogger(fn) { _log = fn; }

// Quests whose starter descriptor is `{ starter: true }` are granted from
// character creation, the same convention as magic_backbone.js's STARTER_SPELLS.
// Declared here (not beside the other quest functions further down) so the
// startup backfill loop can reference it — a `const` isn't usable before its
// own declaration line runs, unlike the hoisted function declarations below.
export const STARTER_QUESTS = Object.keys(QUESTS).filter((k) => QUESTS[k].starter?.starter === true);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Put the DB somewhere persistent on your VPS.
// This makes a ./data folder beside your app.
export const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", file_config.databaseFile || "zboe.sqlite");
const DB_BASENAME = path.basename(DB_PATH);

// ----- DB provenance stamp -----
// A deterministic fingerprint of (sessionSecret, db filename) — NOT random,
// so the same deployment reproduces the SAME stamp across restarts. It's
// written onto every row this app inserts into game_state/player_inventory/
// events/nuke_votes; a stored value that doesn't match what a run computes
// means that row (or the whole DB file) didn't come from an app instance
// sharing this secret + filename — a swapped-in DB, or rows written directly
// by something that doesn't know the secret. `key` mirrors the users/players
// session_key shape (a 64-hex HMAC); `id` is UUID-shaped for the same reason
// their session_id is, though neither is random here — both are pure
// functions of (secret, filename).
//
// Computed lazily (never memoized at module load): server.js applies
// --set game_config.sessionSecret=... overrides AFTER importing this module
// (ES module imports evaluate before the importing module's own top-level
// code runs), so an eager computation here would freeze in the pre-override
// secret. Reading game_config.sessionSecret fresh on every call — the object
// is shared by reference, not copied — always sees the final, overridden value.
export function computeDbStamp() {
  const key = crypto.createHmac("sha256", game_config.sessionSecret).update(DB_BASENAME).digest("hex");
  const raw = crypto.createHash("sha256").update(`${game_config.sessionSecret}:${DB_BASENAME}:id`).digest("hex");
  const id = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
  return { key, id };
}
// The schema's column defaults (see CREATE TABLE below) — a game_state row
// still carrying these has never been stamped (fresh DB, or one just
// migrated to add the columns), as opposed to a row stamped under a
// different secret/filename.
const STAMP_DEFAULT_KEY = "0000000000000000000000000000000000000000000000000000000000000000";
const STAMP_DEFAULT_ID = "00000";

// ----- Skills -----
// Trainable skills; each has s_<key>_lvl / s_<key>_xp columns on players.
// Skill XP comes from location actions and is SPENT on skill levels (same
// philosophy as the main level): buy the next level when xp >= skillLevelCost.
export const SKILLS = ["magic", "defense", "fighting", "woodcutting", "fishing", "mining", "smithing", "crafting", "foraging", "trapping", "alchemy", "cooking"];
export const SKILL_NAMES = {
  magic: "Magic",
  defense: "Defense",
  fighting: "Fighting",
  woodcutting: "Woodcutting",
  fishing: "Fishing",
  mining: "Mining",
  smithing: "Smithing",
  crafting: "Crafting",
  foraging: "Foraging",
  trapping: "Trapping",
  alchemy: "Alchemy",
  cooking: "Cooking"
};
export function skillLevelCost(targetLevel) { return Math.round(50 * Math.pow(targetLevel, 1.4)); }

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
  -- Gates
  adm_fun BOOLEAN NOT NULL DEFAULT 0, -- admin functions (user mgmt, nuke votes, etc)
  chat_mute BOOLEAN NOT NULL DEFAULT 0, -- muted from chat
  chat_deaf BOOLEAN NOT NULL DEFAULT 0, -- deaf to chat
  chat_strict BOOLEAN NOT NULL DEFAULT 0, -- can only see admin-panel chats.
  login_restricted BOOLEAN NOT NULL DEFAULT 0, -- cannot log in (Account Timeout)
  login_res_time INTEGER NOT NULL DEFAULT 0, -- Time restriction lasts
  login_res_set_time INTEGER NOT NULL DEFAULT 0, -- time restriction was placed
  login_res_reason TEXT NOT NULL DEFAULT 'none', -- Restriction reason
  login_res_admin TEXT NOT NULL DEFAULT '', -- who placed the temp ban (banned.html attribution)
  user_exiled BOOLEAN NOT NULL DEFAULT 0, -- cannot log in (Exiled) - exiled users are permanently banned from the game
  user_exiled_reason TEXT NOT NULL DEFAULT 'none', -- Exile reason (banned.html attribution)
  user_exiled_admin TEXT NOT NULL DEFAULT '', -- who placed the exile
  -- Automatic (not admin-issued) lockout after too many bad passwords in a row.
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  failed_login_lockout_until INTEGER NOT NULL DEFAULT 0, -- epoch ms; 0 = not locked
  -- Timestamps (epoch seconds)
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
  kills INTEGER NOT NULL DEFAULT 0,
  accuracy INTEGER NOT NULL DEFAULT 45,      -- % hit chance
  c_gold INTEGER NOT NULL DEFAULT 0,             -- in-game currency
  c_tokens INTEGER NOT NULL DEFAULT 0,        -- number of horde tokens player has
  golden_shots INTEGER NOT NULL DEFAULT 0,     -- remaining Golden Gun power-up shots (0 = not active)

  -- Full Playercard Schema --
  
  --Playercard Base Stats
  health INTEGER NOT NULL DEFAULT 100,
  max_health INTEGER NOT NULL DEFAULT 100,
  shield INTEGER NOT NULL DEFAULT 0,
  max_shield INTEGER NOT NULL DEFAULT 100,
  mana INTEGER NOT NULL DEFAULT 100,
  mana_max INTEGER NOT NULL DEFAULT 100,

  -- Playercard Equipped Weapons
  equipped_gun TEXT NOT NULL DEFAULT 'Handgun',     -- '' = no gun equipped (registry weapon name otherwise)
  equipped_melee TEXT NOT NULL DEFAULT '',          -- '' = no weapon equipped (registry weapon name otherwise)
  equipped_ranged TEXT NOT NULL DEFAULT '',         -- '' = no melee equipped (registry weapon name otherwise)
  equipped_throwing TEXT NOT NULL DEFAULT '',       -- '' = no throwing weapon equipped (registry weapon name otherwise)
  equipped_fist_weapon TEXT NOT NULL DEFAULT '',      -- '' = no fist weapon equipped (registry weapon name otherwise)
  equipped_zombie_weapon TEXT NOT NULL DEFAULT '',  -- '' = no zombie weapon equipped (registry weapon name otherwise)
  selected_equip_slot TEXT NOT NULL DEFAULT 'gun', -- which of the 6 weapon-wheel slots is currently active for combat (gun, melee, fist, ranged, throwing, zombie) — drives game.html's action button/stat boxes

  -- Per-type weapon stats.
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
  
  burstrifle_ammo INTEGER NOT NULL DEFAULT 30,
  burstrifle_max_ammo INTEGER NOT NULL DEFAULT 30,
  burstrifle_clips INTEGER NOT NULL DEFAULT 2,
  burstrifle_max_clips INTEGER NOT NULL DEFAULT 2,
  burstrifle_condition INTEGER NOT NULL DEFAULT 100,
  burstrifle_jammed INTEGER NOT NULL DEFAULT 0,
  
  shotgun_ammo INTEGER NOT NULL DEFAULT 5,
  shotgun_max_ammo INTEGER NOT NULL DEFAULT 5,
  shotgun_clips INTEGER NOT NULL DEFAULT 6,
  shotgun_max_clips INTEGER NOT NULL DEFAULT 6,
  shotgun_condition INTEGER NOT NULL DEFAULT 100,
  shotgun_jammed INTEGER NOT NULL DEFAULT 0,

  railgun_ammo INTEGER NOT NULL DEFAULT 5,
  railgun_max_ammo INTEGER NOT NULL DEFAULT 5,
  railgun_clips INTEGER NOT NULL DEFAULT 2,
  railgun_max_clips INTEGER NOT NULL DEFAULT 2,
  railgun_condition INTEGER NOT NULL DEFAULT 100,
  railgun_jammed INTEGER NOT NULL DEFAULT 0,

  bfg2000_ammo INTEGER NOT NULL DEFAULT 1,
  bfg2000_max_ammo INTEGER NOT NULL DEFAULT 1,
  bfg2000_clips INTEGER NOT NULL DEFAULT 3,
  bfg2000_max_clips INTEGER NOT NULL DEFAULT 3,
  bfg2000_condition INTEGER NOT NULL DEFAULT 100,
  bfg2000_jammed INTEGER NOT NULL DEFAULT 0,

  melee_condition INTEGER NOT NULL DEFAULT 100,

  ranged_condition INTEGER NOT NULL DEFAULT 100,
  ranged_ammo INTEGER NOT NULL DEFAULT 0,
  ranged_crossbow_max_ammo INTEGER NOT NULL DEFAULT 5,
  ranged_bow_max_ammo INTEGER NOT NULL DEFAULT 10,
  ranged_slingshot_max_ammo INTEGER NOT NULL DEFAULT 20,
  ranged_cb_jammed INTEGER NOT NULL DEFAULT 0,
  
  throwing_condition INTEGER NOT NULL DEFAULT 100,
  throwing_ammo INTEGER NOT NULL DEFAULT 0,
  throwing_max_ammo INTEGER NOT NULL DEFAULT 10,
  
  fist_weapon_condition INTEGER NOT NULL DEFAULT 100,


  -- - Playercard Armor — one equipped item name per paperdoll slot ('' = empty).
  -- Condition of whatever's equipped is read live from player_inventory.condition
  -- for that item_name (already tracked there, per stack) — no per-slot condition
  -- column needed; armor is counted in inventory, which carries it's own condition levels.
  ap_level INTEGER NOT NULL DEFAULT 0, -- innate "Base AP" — adds into armorApOf() on top of gear/spells; bought via the AP Base upgrade (mana + materials)
  a_head TEXT NOT NULL DEFAULT '',
  a_torso TEXT NOT NULL DEFAULT '',
  a_legs TEXT NOT NULL DEFAULT '',
  a_boots TEXT NOT NULL DEFAULT '',
  a_hands TEXT NOT NULL DEFAULT '',
  a_shield TEXT NOT NULL DEFAULT '',
  
  -- - Playercard Skills
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
  s_alchemy_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's alchemy skill
  s_alchemy_xp INTEGER NOT NULL DEFAULT 0, -- spendable alchemy XP (spent on skill levels)
  s_trapping_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's trapping skill
  s_trapping_xp INTEGER NOT NULL DEFAULT 0, -- spendable trapping XP (spent on skill levels)
  s_foraging_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's foraging skill
  s_foraging_xp INTEGER NOT NULL DEFAULT 0, -- spendable foraging XP (spent on skill levels)
  s_fighting_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's fighting skill
  s_fighting_xp INTEGER NOT NULL DEFAULT 0, -- spendable fighting XP (spent on skill levels)
  s_defense_lvl INTEGER NOT NULL DEFAULT 1, -- level of the player's defense skill
  s_defense_xp INTEGER NOT NULL DEFAULT 0, -- spendable defense XP (spent on skill levels)
  
  -- - Playercard Location
  location TEXT NOT NULL DEFAULT 'basecamp_outside', -- current location key (see LOCATION_NAMES)
  hidden INTEGER NOT NULL DEFAULT 0,         -- 0/1, hiding at current location
  target_scope TEXT NOT NULL DEFAULT 'World', -- Targeted scope for attacks (World, Location, Nearby) to determine which pool is targeted for attacks
  
  -- - Playercard Quests
  quest_active TEXT NOT NULL DEFAULT 'NONE',     -- '' = no active quest, otherwise QUESTS key (quest_backbone.js)
  quest_objectives TEXT NOT NULL DEFAULT '', -- JSON-encoded object of the active quest's objectives and their completion status (quest_backbone.js)
  quest_started TEXT NOT NULL DEFAULT '', -- comma-separated list of started QUESTS keys (QUEST_NAMES from quest_backbone.js)
  quest_completed TEXT NOT NULL DEFAULT '',  -- comma-separated list of completed QUESTS keys (QUEST_NAMES from quest_backbone.js)
  
  -- - Player Tracking Information
  -- - - Station activations (beacon, forge, Arcane Table) are cleared when the player logs out or the server restarts.
  beacon_fired INTEGER NOT NULL DEFAULT 0,         -- 0/1, live supply beacon at the Bunker (cleared when the drop is redeemed)
  forge_fired INTEGER NOT NULL DEFAULT 0,          -- 0/1, has the player fired the forge yet?
  forge_fired_at INTEGER NOT NULL DEFAULT 0,     -- timestamp of when the player fired the forge
  arcane_table INTEGER NOT NULL DEFAULT 0,        -- 0/1, has the player activated the Arcane Table. 5min time active
  arcane_table_activated_at INTEGER NOT NULL DEFAULT 0, -- timestamp of when the player activated the Arcane Table
  
  -- - - Zombie tracking (for horde attacks and hunting) — the player is only counted if they are in a ZOMBIE_LOCATIONS location, and have zombies near them.
  zombie_near INTEGER NOT NULL DEFAULT 0,          -- Number of zombies near the player, this is an exact count, not a boolean. 0 = no zombies near the player.
  zombie_near_health INTEGER NOT NULL DEFAULT 0, -- Total health of current targeted zombie near the player, this is an exact count, not a boolean. 0 = zombie has been killed, and we're ready for another target if available.
  -- | timestamps for last activity and last update (used for online-player counters and leaderboard sorting)
  last_seen INTEGER NOT NULL DEFAULT 0,             -- timestamp of last activity 
  updated_at INTEGER NOT NULL                       -- timestamp of last update
);

CREATE TABLE IF NOT EXISTS player_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  -- Auth Keys
  session_key TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  session_id TEXT NOT NULL DEFAULT '00000',
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  condition INTEGER NOT NULL DEFAULT 100,
  ammo INTEGER NOT NULL DEFAULT 1,
  clips INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- Per-player magic knowledge (spells learned at the Magic Table in Town).
-- type is 'spell' for now — the column leaves room for future magic rows
-- (enchantments, runes, ...) without another table. name = a MAGIC_SPELLS
-- key (magic_backbone.js). The unique index makes grants/learns idempotent.
CREATE TABLE IF NOT EXISTS player_magic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'spell',
  name TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_magic_row ON player_magic(user_id, type, name);

CREATE TABLE IF NOT EXISTS player_block (
  user_id INTEGER PRIMARY KEY,
  u_grant TEXT NOT NULL DEFAULT 'USER',
  u_time TEXT NOT NULL DEFAULT 'TIMESTAMP',
  u_title TEXT NOT NULL DEFAULT 'AWARD TYPE',
  u_comment TEXT NOT NULL DEFAULT 'COMMENT',
  updated_at INTEGER NOT NULL
);

-- global event feed
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Auth Keys
  session_key TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  session_id TEXT NOT NULL DEFAULT '00000',
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public', -- public, private, admin
  target TEXT NOT NULL DEFAULT 'global',     -- 'global' (all players) or a player's user_id
  msg TEXT NOT NULL
);


-- Chat tables
CREATE TABLE IF NOT EXISTS chat_world (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Auth Keys
  ts INTEGER NOT NULL,
  user TEXT NOT NULL,
  msg TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_support (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user TEXT NOT NULL,
  msg TEXT NOT NULL
);
-- Game State Table (Hunt enabled, horde size/status, raid enabled, etc)
CREATE TABLE IF NOT EXISTS game_state (
  key TEXT PRIMARY KEY,
  -- Auth Keys
  session_key TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  session_id TEXT NOT NULL DEFAULT '00000',
  hunt_enabled TEXT NOT NULL DEFAULT 'false',
  total_z_pool INTEGER NOT NULL DEFAULT 0, -- total number of zombies in the world (all locations)
  horde_size INTEGER NOT NULL DEFAULT 0,
  horde_status TEXT NOT NULL DEFAULT 'idle', -- idle, partial, full, raid
  raid_enabled TEXT NOT NULL DEFAULT 'false',
  online_players INTEGER NOT NULL DEFAULT 0,
  base_health INTEGER NOT NULL DEFAULT 10000,      -- inside/base health pool
  base_destroyed_at INTEGER NOT NULL DEFAULT 0,    -- ts the base fell (0 = intact)
  base_repair_kits INTEGER NOT NULL DEFAULT 0, -- number of repair kits in the base
  sentry_until INTEGER NOT NULL DEFAULT 0,     -- epoch ms the sentry turret protects the base until (0 = offline)
  -- location zombie counts (for horde attacks and hunting) — the player is only counted if they are in a ZOMBIE_LOCATIONS location, and have zombies near them.
  zombies_basecamp_outside INTEGER NOT NULL DEFAULT 0,
  zombies_forest INTEGER NOT NULL DEFAULT 0,
  zombies_lake INTEGER NOT NULL DEFAULT 0,
  zombies_swamp INTEGER NOT NULL DEFAULT 0,
  -- zombie-safe(?) locations, if too many spawn there is a chance for a "zombie break"
  zombies_river INTEGER NOT NULL DEFAULT 0,
  zombies_mountains INTEGER NOT NULL DEFAULT 0,
  zombies_cave INTEGER NOT NULL DEFAULT 0,
  zombies_town INTEGER NOT NULL DEFAULT 0,
  zombie_break INTEGER NOT NULL DEFAULT 0, -- 0/1, a zombie break is in progress (zombies are spawning in safe locations)
  z_break_falltime INTEGER NOT NULL DEFAULT 0, -- epoch ms the zombie break started (0 = no break)
  z_break_defeated_at INTEGER NOT NULL DEFAULT 0, -- epoch ms the Outbreak duration expired and zombies won (0 = not applicable) — mirrors base_destroyed_at; the world freezes on this timer for zombie_config.z_break_reset hours before an Experiment Reset
  -- Timestamps (epoch ms)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Vote-to-nuke ballots while the base is destroyed (cleared on experiment reset).
CREATE TABLE IF NOT EXISTS nuke_votes (
  user_id INTEGER PRIMARY KEY,
  -- Auth Keys
  session_key TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  session_id TEXT NOT NULL DEFAULT '00000',
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
// created_at has no column default (unlike everything else here) — omitting
// it from an INSERT OR IGNORE doesn't error, it just silently no-ops the
// whole insert (NOT NULL violation swallowed by OR IGNORE), leaving the table
// empty on a fresh DB. Must be provided explicitly.
{
  const seedNow = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO game_state (key, created_at, updated_at)
    VALUES ('main', ?, ?)
  `).run(seedNow, seedNow);
}

// Starter spells: every player knows the starter(s) (magic_backbone.js STARTER_SPELLS)
// from creation — this backfills players created before player_magic existed.
// Idempotent via the unique (user_id, type, name) index, so it's safe to run
// every boot.
for (const spellKey of STARTER_SPELLS) {
  db.prepare(`
    INSERT OR IGNORE INTO player_magic (user_id, type, name, updated_at)
    SELECT user_id, 'spell', ?, ? FROM players
  `).run(spellKey, Date.now());
}

// Whether the live schema actually has the provenance-stamp columns yet — a
// DB that predates this feature (or was migrated via `database update` before
// the columns existed) needs that same toolkit run before ensureDbStamp/
// rotateDbStamp can touch it. Checked by server.js first, turning what would
// otherwise be a raw SQLITE_ERROR crash into one clear, actionable message.
export function hasProvenanceColumns() {
  const cols = db.prepare("PRAGMA table_info(game_state)").all().map((c) => c.name);
  return cols.includes("session_key") && cols.includes("session_id");
}

// Verify (or, on a never-stamped row, establish) this DB's provenance stamp.
// Not run automatically at import — server.js calls it once at startup,
// AFTER CLI --set overrides are applied, so an overridden sessionSecret is
// what actually gets checked/stamped rather than config.js's raw default.
// A game_state row still holding the schema's column defaults has never been
// stamped (fresh DB, or one just migrated to add the columns) — that's this
// run's genesis moment, so it's stamped now rather than flagged as foreign.
// An already-stamped row is only ever compared, never overwritten, so a
// mismatch remains as evidence.
export function ensureDbStamp() {
  const gs = db.prepare("SELECT session_key, session_id FROM game_state WHERE key = 'main'").get();
  const expected = computeDbStamp();
  if (gs.session_key === STAMP_DEFAULT_KEY && gs.session_id === STAMP_DEFAULT_ID) {
    db.prepare("UPDATE game_state SET session_key = ?, session_id = ?, updated_at = ? WHERE key = 'main'")
      .run(expected.key, expected.id, Date.now());
    return { status: "stamped", expected };
  }
  const matched = gs.session_key === expected.key && gs.session_id === expected.id;
  return { status: matched ? "ok" : "mismatch", expected, stored: { key: gs.session_key, id: gs.session_id } };
}

// Force-rekey EVERY row in the four stamped tables to whatever the CURRENT
// sessionSecret + db filename computes — used by server.js's --rotate-keys
// flag, typically right after a deliberate sessionSecret rotation. Verifies
// the db's key is actually stale first: if game_state's stored stamp already
// matches what this run would compute, there's nothing to rotate (returns
// "unchanged" without touching any row) — the caller warns instead of
// claiming a rotation happened. Otherwise every row across all four tables
// is unconditionally overwritten with the new stamp (an explicit, deliberate
// action — this is not the same as ensureDbStamp's compare-only default path).
export function rotateDbStamp() {
  const gs = db.prepare("SELECT session_key, session_id FROM game_state WHERE key = 'main'").get();
  const next = computeDbStamp();
  if (gs.session_key === next.key && gs.session_id === next.id) {
    return { status: "unchanged", stamp: next };
  }
  const previous = { key: gs.session_key, id: gs.session_id };
  const now = Date.now();
  const counts = db.transaction(() => ({
    game_state: db.prepare("UPDATE game_state SET session_key = ?, session_id = ?, updated_at = ?").run(next.key, next.id, now).changes,
    player_inventory: db.prepare("UPDATE player_inventory SET session_key = ?, session_id = ?, updated_at = ?").run(next.key, next.id, now).changes,
    events: db.prepare("UPDATE events SET session_key = ?, session_id = ?").run(next.key, next.id).changes,
    nuke_votes: db.prepare("UPDATE nuke_votes SET session_key = ?, session_id = ?").run(next.key, next.id).changes,
  }))();
  return { status: "rotated", stamp: next, previous, counts };
}

// ----- Prepared statements -----
// SELECT * — the login route needs every gate/ban/lockout column, and this is
// the one place they're all read together; easier to keep it broad than to
// re-edit this list every time a new gate column shows up.
const stmtUserByName = db.prepare(`SELECT * FROM users WHERE username = ?`);
// Auth check needs both tables' session pairs in one hit (they must agree),
// plus the chat/fun gates every authenticated request wants on req.gates.
const stmtAuthRecord = db.prepare(`
  SELECT u.id, u.username, u.session_key, u.session_id,
         u.adm_fun, u.chat_mute, u.chat_deaf, u.chat_strict,
         u.login_restricted, u.login_res_time, u.login_res_set_time, u.login_res_reason, u.login_res_admin,
         u.user_exiled, u.user_exiled_reason, u.user_exiled_admin,
         u.created_at, u.last_login,
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

// One player's exact standing — same tie-break order as stmtLeaderboard
// (lifetime_xp DESC, level DESC, username ASC) — plus the total player count,
// for playercard.html's "# of <total>" readout. { rank: null, total } if the
// player row doesn't exist.
export function getLeaderboardRank(userId) {
  const total = db.prepare("SELECT COUNT(*) AS n FROM players").get().n;
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return { rank: null, total };
  const username = db.prepare("SELECT username FROM users WHERE id = ?").get(userId)?.username ?? "";
  const ahead = db.prepare(`
    SELECT COUNT(*) AS n FROM players p JOIN users u ON u.id = p.user_id
    WHERE p.lifetime_xp > @xp
       OR (p.lifetime_xp = @xp AND p.level > @level)
       OR (p.lifetime_xp = @xp AND p.level = @level AND u.username < @username)
  `).get({ xp: player.lifetime_xp, level: player.level, username }).n;
  return { rank: ahead + 1, total };
}
// Returns global events plus events targeted at this specific user_id.
export function getRecentEvents(limit, userId) { return stmtRecentEvents.all({ limit, target: String(userId) }); }
// The admin World Chat & Events panel's "Clear Feed" — wipes just the
// conversational subset shown there (chat/admin_chat/system); gameplay
// history (spawn/kill/attack/death/shoot/etc.) is untouched.
export function clearFeedEvents() {
  return db.prepare(`DELETE FROM events WHERE type IN ('chat', 'admin_chat', 'system')`).run().changes;
}
export function insertUser(username, salt, hash, createdAt) { return stmtInsertUser.run(username, salt, hash, createdAt, createdAt); }
export function insertPlayer(userId, createdAt) {
  const info = stmtInsertPlayer.run(userId, createdAt);
  giveInventoryItem(userId, "Handgun", 1); // everyone starts with (and has equipped) a Handgun
  for (const spellKey of STARTER_SPELLS) learnSpell(userId, spellKey); // ...and the starter spell(s)
  checkQuestTriggers(userId, { type: "starter" }); // ...and the starter quest(s)
  return info;
}
// Prepared inline (not module-level cached) — a module-level db.prepare() runs
// unconditionally at import time, which would hard-crash EVERY server.js
// invocation (even --help) against a DB that predates the session_key/
// session_id columns, before ensureDbStamp's own actionable error ever gets a
// chance to run. Preparing lazily means only an actual call to insertEvent
// fails on an unmigrated DB — same as every other write in this file already.
export function insertEvent(type, msg, visibility = "public", target = "global") {
  const stamp = computeDbStamp();
  return db.prepare(`
    INSERT INTO events (ts, type, visibility, target, msg, session_key, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(Date.now(), type, visibility, String(target), msg, stamp.key, stamp.id);
}

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

// Add (or, with a negative delta, remove) zombies anywhere in the world,
// floored at 0 — the single source of truth for "how many zombies exist,
// period" (World + every Location pool + every player's Nearby pool).
// Transfers between pools (splinter/flow-back/wander/travel-flush) call two
// of these adjust* functions back-to-back with opposite deltas, which nets
// to zero here automatically — only real spawns/kills/admin overrides show
// up as a net change.
export function adjustTotalZPool(delta) {
  db.prepare(`UPDATE game_state SET total_z_pool = MAX(0, total_z_pool + ?), updated_at = ? WHERE key = 'main'`)
    .run(delta, Date.now());
}

// Add (or, with a negative delta, remove) zombies from the horde, floored at
// 0. Mirrors the *actual* (post-clamp) delta into total_z_pool in the same
// statement — both expressions read the pre-update horde_size, so this is
// exact even when the requested delta would have driven horde_size negative.
export function adjustHordeSize(delta) {
  db.prepare(`
    UPDATE game_state
    SET total_z_pool = MAX(0, total_z_pool + (MAX(0, horde_size + ?) - horde_size)),
        horde_size = MAX(0, horde_size + ?),
        updated_at = ?
    WHERE key = 'main'
  `).run(delta, delta, Date.now());
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

// Shared stock of base repair kits (game_state) — stocked by using a
// "base repair kit" at the Bunker, spent by /api/base/repair. Floored at 0.
export function adjustRepairKits(delta) {
  db.prepare(`UPDATE game_state SET base_repair_kits = MAX(0, base_repair_kits + ?), updated_at = ? WHERE key = 'main'`)
    .run(delta, Date.now());
  return getGameState().base_repair_kits;
}

// Sentry turret window: the base ignores zombie damage (and shoots back
// during raids) until this epoch ms. Set by using a "sentry turret" item.
export function setSentryUntil(ts) {
  db.prepare(`UPDATE game_state SET sentry_until = ?, updated_at = ? WHERE key = 'main'`)
    .run(ts, Date.now());
}

export function setBaseDestroyedAt(ts) {
  db.prepare(`UPDATE game_state SET base_destroyed_at = ?, updated_at = ? WHERE key = 'main'`)
    .run(ts, Date.now());
}

// Full experiment reset: zombies die, hunt & raid off, base rebuilt to full.
// Also wipes every zombie-location-pool/Outbreak column — both live and
// reserved-for-Outbreak — so a reset (whether from a destroyed base or a
// defeated Outbreak) never leaves stale zombie counts or a stuck outbreak
// flag behind.
export function resetGameState(baseMaxHealth) {
  db.prepare(`
    UPDATE game_state
    SET hunt_enabled = 'false', horde_size = 0, raid_enabled = 'false',
        horde_status = 'idle', base_health = ?, base_destroyed_at = 0,
        base_repair_kits = 0, sentry_until = 0,
        total_z_pool = 0,
        zombies_basecamp_outside = 0, zombies_forest = 0, zombies_lake = 0, zombies_swamp = 0,
        zombies_river = 0, zombies_mountains = 0, zombies_cave = 0, zombies_town = 0,
        zombie_break = 0, z_break_falltime = 0, z_break_defeated_at = 0,
        updated_at = ?
    WHERE key = 'main'
  `).run(baseMaxHealth, Date.now());
  db.prepare("DELETE FROM nuke_votes").run();
}

// ----- Vote-to-nuke -----
export function recordNukeVote(userId) {
  const stamp = computeDbStamp();
  db.prepare("INSERT OR IGNORE INTO nuke_votes (user_id, ts, session_key, session_id) VALUES (?, ?, ?, ?)")
    .run(userId, Date.now(), stamp.key, stamp.id);
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
// Ammo/clips are stored per gun type (handgun/rifle/shotgun/burstrifle).
// Column names are built from a whitelisted type so they can't be injected.
export const GUN_TYPES = ["handgun", "rifle", "shotgun", "burstrifle", "railgun", "bfg2000"];
// Canonical gun item names (map 1:1 to the types above); list order is the
// display order of the gun switcher / admin gun buttons (by unlock cost).
export const GUN_NAMES = ["Handgun", "Rifle", "Shotgun", "Burst Rifle", "Railgun", "BFG 2000"];
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
// The 6 a_<slot> columns plus ap_level ride along for the tick's armor/Base-AP
// hit calc (armorApOf() needs all 6 equipped-slot names, and player.ap_level —
// previously missing here, so Base AP silently never contributed via this path).
export function getActivePlayers(sinceMs) {
  return db.prepare(`
    SELECT p.user_id, u.username, p.health, p.shield, p.max_health, p.max_shield, p.location, p.ap_level,
           p.a_head, p.a_torso, p.a_legs, p.a_boots, p.a_hands, p.a_shield,
           p.zombie_near, p.zombie_near_health, p.target_scope
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

// Grant/spend mana, clamped to [0, mana_max]. Positive to restore (potions,
// admin), negative to spend (spell casts) — the same signed-amount convention
// as addShield/addTokens. The clamp is the overfill/below-zero safeguard:
// callers that need a hard refusal (e.g. casting without enough mana) check
// player.mana against the cost themselves before calling this. Returns the
// new mana value.
export function addMana(userId, amount) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p) return null;
  const mana = Math.max(0, Math.min(p.mana_max, p.mana + amount));
  db.prepare(`UPDATE players SET mana = ?, updated_at = ? WHERE user_id = ?`).run(mana, Date.now(), userId);
  return mana;
}

// ----- Magic knowledge (player_magic) -----
// Spells learned at the Magic Table in Town (plus the starters granted at
// creation). type is 'spell' today; the column leaves room for future magic
// rows without another table. name = a MAGIC_SPELLS key (magic_backbone.js).
export function getPlayerMagic(userId, type = "spell") {
  return db.prepare(`SELECT name FROM player_magic WHERE user_id = ? AND type = ? ORDER BY id`)
    .all(userId, type).map((r) => r.name);
}
export function knowsSpell(userId, spellKey) {
  return Boolean(db.prepare(`SELECT 1 FROM player_magic WHERE user_id = ? AND type = 'spell' AND name = ?`)
    .get(userId, spellKey));
}
// Idempotent — the unique (user_id, type, name) index makes re-learning a no-op.
export function learnSpell(userId, spellKey) {
  return db.prepare(`INSERT OR IGNORE INTO player_magic (user_id, type, name, updated_at) VALUES (?, 'spell', ?, ?)`)
    .run(userId, spellKey, Date.now());
}

// ----- Quests (quest_backbone.js) -----
// quest_active/quest_started/quest_completed are comma-separated QUESTS keys
// on players; quest_objectives is a JSON object of { objectiveIndex:
// progressCount } for whichever ONE quest is currently active — only the
// active quest is ever progress-tracked, matching the column's own comment.
// (STARTER_QUESTS is declared near the top of the file, not here — see that
// comment for why.)

function questKeyList(csv) { return csv ? csv.split(",").filter(Boolean) : []; }

// Best-effort initial progress for a quest that's about to become active:
// acquire_item/learn_spell objectives check real current state (owning
// enough of the item / already knowing the spell) so a player who met the
// condition before the quest existed for them isn't stuck; every other
// objective type is a momentary event with no "current state" to check, so
// it starts at 0 (standard — you don't get credit for an action performed
// before the quest began).
function seedObjectiveProgress(userId, quest) {
  return Object.fromEntries(quest.objectives.map((obj, i) => {
    if (obj.type === "acquire_item") {
      const owned = db.prepare(`SELECT quantity FROM player_inventory WHERE user_id = ? AND item_name = ?`)
        .get(userId, obj.item)?.quantity ?? 0;
      return [i, Math.min(obj.qty, owned)];
    }
    if (obj.type === "learn_spell") {
      return [i, knowsSpell(userId, obj.spell) ? obj.qty : 0];
    }
    return [i, 0];
  }));
}

// Makes `questKey` the tracked/active quest with freshly-seeded objective
// progress, then immediately resolves it if that seed already satisfies
// every objective (and cascades: completing one quest may auto-activate
// the next, which might ALSO already be satisfied).
function activateQuest(userId, questKey) {
  const quest = QUESTS[questKey];
  if (!quest) return;
  db.prepare(`UPDATE players SET quest_active = ?, quest_objectives = ?, updated_at = ? WHERE user_id = ?`)
    .run(questKey, JSON.stringify(seedObjectiveProgress(userId, quest)), Date.now(), userId);
  _log("INFO", `quest activated: user=${userId} key=${questKey}`);
  completeActiveQuestIfDone(userId);
}

// Begin tracking a quest: idempotent (a no-op if already in quest_started).
// Appends to quest_started (always announced, whether or not it becomes the
// active/tracked quest — a queued quest still belongs in the player's log);
// if no quest is currently active, this one also becomes active (with seeded
// objective progress, see activateQuest).
export function startQuest(userId, questKey) {
  const quest = QUESTS[questKey];
  if (!quest) return;
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  if (quest.quest_level && player.level < quest.quest_level) return;
  const started = questKeyList(player.quest_started);
  if (started.includes(questKey)) return;
  started.push(questKey);
  db.prepare(`UPDATE players SET quest_started = ?, updated_at = ? WHERE user_id = ?`)
    .run(started.join(","), Date.now(), userId);
  insertEvent("action", `Quest started: ${quest.name}`, "private", userId);
  _log("INFO", `quest started: user=${userId} key=${questKey}`);
  if (player.quest_active === "NONE") activateQuest(userId, questKey);
}

// Player-driven switch: makes an already-started, not-yet-completed quest
// the tracked/active one (see activateQuest). Objective progress is always
// freshly re-seeded on activation, not restored from an earlier stint as
// active — only one quest's objectives are ever persisted at a time under
// this schema (quest_objectives holds just the active quest's progress), so
// acquire_item/learn_spell objectives recover via real current state
// (seedObjectiveProgress) but action/recipe/use_item/break_horde/clear_raid
// progress made while a *different* quest was active isn't remembered —
// switch back and redo it. Returns { ok, reason? }.
export function setActiveQuest(userId, questKey) {
  const quest = QUESTS[questKey];
  if (!quest) return { ok: false, reason: "unknown_quest" };
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return { ok: false, reason: "no_player" };
  if (!questKeyList(player.quest_started).includes(questKey)) return { ok: false, reason: "not_started" };
  if (questKeyList(player.quest_completed).includes(questKey)) return { ok: false, reason: "already_completed" };
  if (player.quest_active === questKey) return { ok: true, reason: "already_active" };

  insertEvent("action", `Now tracking: ${quest.name}`, "private", userId);
  activateQuest(userId, questKey);
  return { ok: true };
}

// If the ACTIVE quest has a not-yet-complete objective of `objectiveType`
// whose reference field (item/action/recipe/spell) matches `matchKey` — or
// has no reference field at all, e.g. break_horde/clear_raid — increments
// its progress (capped at qty). No-op if no quest is active or none matches.
// Completion is checked automatically after any progress is recorded.
export function recordQuestProgress(userId, objectiveType, matchKey, amount = 1) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player || player.quest_active === "NONE") return;
  const quest = QUESTS[player.quest_active];
  if (!quest) return;
  const progress = player.quest_objectives ? JSON.parse(player.quest_objectives) : {};
  let changed = false;
  quest.objectives.forEach((obj, i) => {
    if (obj.type !== objectiveType) return;
    const ref = obj.item ?? obj.action ?? obj.recipe ?? obj.spell ?? null;
    if (ref !== null && ref !== matchKey) return;
    const current = progress[i] ?? 0;
    if (current >= obj.qty) return;
    progress[i] = Math.min(obj.qty, current + amount);
    changed = true;
  });
  if (!changed) return;
  db.prepare(`UPDATE players SET quest_objectives = ?, updated_at = ? WHERE user_id = ?`)
    .run(JSON.stringify(progress), Date.now(), userId);
  completeActiveQuestIfDone(userId);
}

// Shared reward-application helper — any { gold, tokens, xp, items, level,
// grant_instant_level } bundle. Used by quest completion below and (from
// server.js) the Outbreak early-end reward (zombie_config.z_break_reward).
// `level` (a count of free instant levels via forceLevel) takes priority
// over the legacy boolean grant_instant_level if a reward somehow carries
// both, so end-users don't end up thinking the two stack. Returns a list of
// human-readable bits (e.g. "+100 gold") for building a reward message.
export function applyReward(userId, reward) {
  if (!reward) return [];
  const bits = [];
  if (reward.gold) { updatePlayerGold(userId, reward.gold); bits.push(`+${reward.gold} gold`); }
  if (reward.tokens) { addTokens(userId, reward.tokens); bits.push(`+${reward.tokens} tokens`); }
  if (reward.xp) { updatePlayerStats(userId, reward.xp, 0); bits.push(`+${reward.xp} XP`); }
  if (reward.items) {
    for (const [item, qty] of Object.entries(reward.items)) {
      giveInventoryItem(userId, item, qty);
      bits.push(`${qty}x ${item}`);
    }
  }
  if (reward.level > 0) {
    forceLevel(userId, reward.level);
    bits.push(`+${reward.level} level${reward.level === 1 ? "" : "s"}`);
  } else if (reward.grant_instant_level) {
    forceLevel(userId, 1);
    bits.push(`+1 level`);
  }
  _log("INFO", `applyReward user=${userId}: ${bits.join(", ") || "nothing"}`);
  return bits;
}

// Grants the reward and advances quest_active to the next started-but-
// incomplete quest (if any) once every objective of the current active
// quest is satisfied. Returns the completed quest's key, or null. Cascades:
// the newly-activated quest is itself seeded and completion-checked, so a
// chain of instantly-satisfied quests resolves in one call.
export function completeActiveQuestIfDone(userId) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player || player.quest_active === "NONE") return null;
  const questKey = player.quest_active;
  const quest = QUESTS[questKey];
  if (!quest) return null;
  const progress = player.quest_objectives ? JSON.parse(player.quest_objectives) : {};
  const done = quest.objectives.every((obj, i) => (progress[i] ?? 0) >= obj.qty);
  if (!done) return null;

  const rewardBits = applyReward(userId, quest.reward);

  const completed = questKeyList(player.quest_completed);
  completed.push(questKey);
  const started = questKeyList(player.quest_started);
  const nextKey = started.find((k) => k !== questKey && !completed.includes(k)) ?? "NONE";

  db.prepare(`UPDATE players SET quest_completed = ?, quest_active = 'NONE', quest_objectives = '', updated_at = ? WHERE user_id = ?`)
    .run(completed.join(","), Date.now(), userId);

  insertEvent("action", `Quest complete: ${quest.name}!${rewardBits.length ? " " + rewardBits.join(", ") : ""}`, "private", userId);
  _log("INFO", `quest completed: user=${userId} key=${questKey} reward=[${rewardBits.join(", ")}]`);

  if (nextKey !== "NONE") activateQuest(userId, nextKey);
  return questKey;
}

// Check every quest whose starter trigger matches what just happened, and
// start any that haven't already been started. `trigger` shapes:
//   { type: "starter" }                       — character creation
//   { type: "location", location }             — entered a location
//   { type: "action", action }                 — performed a location action
//   { type: "questComplete", quest }            — completed another quest
export function checkQuestTriggers(userId, trigger) {
  for (const [key, quest] of Object.entries(QUESTS)) {
    const s = quest.starter;
    if (!s) continue;
    const matches =
      (trigger.type === "starter" && s.starter === true) ||
      (trigger.type === "location" && s.enter_location === trigger.location) ||
      (trigger.type === "action" && s.type === "action" && s.action === trigger.action) ||
      (trigger.type === "questComplete" && s.quest === trigger.quest);
    if (matches) startQuest(userId, key);
  }
}

// Starter quests: every player has the starter quest(s) already started —
// backfills players created before quest_* existed. Placed here (not beside
// the STARTER_SPELLS backfill near the top of the file) because startQuest()
// depends on stmtPlayerByUserId and other consts that aren't initialized yet
// that early — module top-level code runs in file order, unlike the hoisted
// function declarations it calls. startQuest() is idempotent, safe every boot.
for (const p of db.prepare("SELECT user_id FROM players").all()) {
  for (const questKey of STARTER_QUESTS) startQuest(p.user_id, questKey);
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
  const tokens = Math.max(0, p.c_tokens + amount);
  db.prepare(`UPDATE players SET c_tokens = ?, updated_at = ? WHERE user_id = ?`).run(tokens, Date.now(), userId);
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

// ----- Weapon wheel (melee/ranged/throwing/zombie slots) -----
// Mirrors the gun accessors above, but the condition columns don't follow a
// regular ${type}_condition naming scheme (fist weapons share the melee slot
// but write fist_weapon_condition, not fist_condition) so callers pass the
// exact column name rather than a type string.
const WEAPON_CONDITION_COLS = ["melee_condition", "ranged_condition", "throwing_condition", "fist_weapon_condition"];
export function adjustWeaponCondition(userId, col, delta) {
  if (!WEAPON_CONDITION_COLS.includes(col)) return null;
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return null;
  const newCond = Math.max(0, Math.min(100, player[col] + delta));
  db.prepare(`UPDATE players SET ${col} = ?, updated_at = ? WHERE user_id = ?`)
    .run(newCond, Date.now(), userId);
  return newCond;
}

export function addRangedAmmo(userId, amount, cap) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const newAmmo = Math.max(0, Math.min(cap, player.ranged_ammo + amount));
  db.prepare(`UPDATE players SET ranged_ammo = ?, updated_at = ? WHERE user_id = ?`)
    .run(newAmmo, Date.now(), userId);
}

export function addThrowingAmmo(userId, amount) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const newAmmo = Math.max(0, Math.min(player.throwing_max_ammo, player.throwing_ammo + amount));
  db.prepare(`UPDATE players SET throwing_ammo = ?, updated_at = ? WHERE user_id = ?`)
    .run(newAmmo, Date.now(), userId);
}

const RANGED_TYPES = ["crossbow", "bow", "slingshot"];
export function updateRangedMaxAmmo(userId, rangedType, change) {
  if (!RANGED_TYPES.includes(rangedType)) return;
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const col = `ranged_${rangedType}_max_ammo`;
  const newMax = Math.max(0, player[col] + change);
  db.prepare(`UPDATE players SET ${col} = ?, updated_at = ? WHERE user_id = ?`)
    .run(newMax, Date.now(), userId);
}

export function updateThrowingMaxAmmo(userId, change) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return;
  const newMax = Math.max(0, player.throwing_max_ammo + change);
  db.prepare(`UPDATE players SET throwing_max_ammo = ?, updated_at = ? WHERE user_id = ?`)
    .run(newMax, Date.now(), userId);
}

export function setRangedJammed(userId, jammed) {
  db.prepare(`UPDATE players SET ranged_cb_jammed = ?, updated_at = ? WHERE user_id = ?`)
    .run(jammed ? 1 : 0, Date.now(), userId);
}

// Clear a ranged (crossbow) jam: costs 1 ranged_ammo, same convention as
// unjamGun spending a clip — but the shared ranged pool has no clip concept,
// so there's no "reload from a fresh clip" branch, just spend-and-clear.
export function clearRangedJam(userId) {
  const player = stmtPlayerByUserId.get(userId);
  if (!player) return { ok: false, reason: "no_player" };
  if (!player.ranged_cb_jammed) return { ok: false, reason: "not_jammed" };
  if (player.ranged_ammo <= 0) return { ok: false, reason: "no_ammo" };
  db.prepare(`UPDATE players SET ranged_cb_jammed = 0, ranged_ammo = ranged_ammo - 1, updated_at = ? WHERE user_id = ?`)
    .run(Date.now(), userId);
  return { ok: true };
}

const WEAPON_SLOT_COLS = { melee: "equipped_melee", fist: "equipped_fist_weapon", ranged: "equipped_ranged", throwing: "equipped_throwing", zombie: "equipped_zombie_weapon" };
export function equipWeaponSlot(userId, slot, itemName) {
  const col = WEAPON_SLOT_COLS[slot];
  if (!col) return false;
  db.prepare(`UPDATE players SET ${col} = ?, updated_at = ? WHERE user_id = ?`)
    .run(itemName, Date.now(), userId);
  return true;
}

// Which of the 6 weapon-wheel slots (gun/melee/fist/ranged/throwing/zombie)
// is currently active for combat — server-persisted so it survives reloads
// and stays in sync across tabs/sessions, unlike a client-only UI toggle.
const SELECTABLE_SLOTS = ["gun", "melee", "fist", "ranged", "throwing", "zombie"];
export function setSelectedSlot(userId, slot) {
  if (!SELECTABLE_SLOTS.includes(slot)) return false;
  db.prepare(`UPDATE players SET selected_equip_slot = ?, updated_at = ? WHERE user_id = ?`)
    .run(slot, Date.now(), userId);
  return true;
}

// ----- Zombie Location Pool -----
// Three-tier zombie pools: World (game_state.horde_size) -> Location
// (game_state.zombies_<loc>) -> Nearby (players.zombie_near/zombie_near_health,
// personal per-player). Location pools cover all 8 OUTBREAK_LOCATIONS now
// (not just the 4 always-active ZOMBIE_LOCATIONS) — the other 4 columns sit
// at 0 during normal play and only ever get written to during an Outbreak.

// Add (or, with a negative delta, remove) zombies from a location's pool,
// floored at 0. `location` is validated against OUTBREAK_LOCATIONS so the
// column name can't be injected. Mirrors the actual (post-clamp) delta into
// total_z_pool, same exact-under-clamping approach as adjustHordeSize.
export function adjustLocationZombies(location, delta) {
  if (!OUTBREAK_LOCATIONS.has(location)) throw new Error(`Invalid zombie location: ${location}`);
  const col = `zombies_${location}`;
  db.prepare(`
    UPDATE game_state
    SET total_z_pool = MAX(0, total_z_pool + (MAX(0, ${col} + ?) - ${col})),
        ${col} = MAX(0, ${col} + ?),
        updated_at = ?
    WHERE key = 'main'
  `).run(delta, delta, Date.now());
}

// Absolute set (rather than delta) for a location's pool — used by the
// Outbreak trigger/split, which computes exact target values rather than
// deltas. Same total_z_pool mirroring as adjustLocationZombies.
export function setLocationZombies(location, count) {
  if (!OUTBREAK_LOCATIONS.has(location)) throw new Error(`Invalid zombie location: ${location}`);
  const col = `zombies_${location}`;
  const clamped = Math.max(0, Math.round(count));
  db.prepare(`
    UPDATE game_state
    SET total_z_pool = MAX(0, total_z_pool + (? - ${col})),
        ${col} = ?,
        updated_at = ?
    WHERE key = 'main'
  `).run(clamped, clamped, Date.now());
}

// ----- Outbreak state -----
// zombie_break (0/1) is whether an Outbreak is actively running right now.
// z_break_falltime is reused for two mutually-exclusive purposes across
// time (the comment on the column explains why this is safe): while an
// outbreak is active it's the epoch this outbreak STARTED (drives the
// z_break_duration expiry check); once cleared, it's left untouched and
// serves as the "time since the last outbreak" anchor for the z_break_interval
// cooldown gate on the next roll. z_break_defeated_at is separate — it's only
// ever set when zombies WIN (duration expired), mirroring base_destroyed_at's
// "frozen, waiting on a reset timer" convention exactly.
export function setZombieBreak(active) {
  db.prepare(`UPDATE game_state SET zombie_break = ?, updated_at = ? WHERE key = 'main'`)
    .run(active ? 1 : 0, Date.now());
}
export function setZombieBreakFalltime(ts) {
  db.prepare(`UPDATE game_state SET z_break_falltime = ?, updated_at = ? WHERE key = 'main'`)
    .run(ts, Date.now());
}
export function setZombieBreakDefeatedAt(ts) {
  db.prepare(`UPDATE game_state SET z_break_defeated_at = ?, updated_at = ? WHERE key = 'main'`)
    .run(ts, Date.now());
}
// Every player (any online status) currently carrying a nonzero Nearby
// pool — used to sweep everyone's zombie_near into the split when an
// Outbreak triggers (per the design, those zombies are included in the flow).
export function getPlayersWithZombieNear() {
  return db.prepare(`SELECT user_id, zombie_near FROM players WHERE zombie_near > 0`).all();
}

const TARGET_SCOPES = ["World", "Location", "Nearby"];
export function setTargetScope(userId, scope) {
  if (!TARGET_SCOPES.includes(scope)) return false;
  db.prepare(`UPDATE players SET target_scope = ?, updated_at = ? WHERE user_id = ?`)
    .run(scope, Date.now(), userId);
  return true;
}

// Add (or, with a negative delta, remove) zombies from a player's "nearby"
// pool, floored at 0.
// Mirrors the actual (post-clamp) delta into total_z_pool — a separate
// table from players, so unlike adjustHordeSize/adjustLocationZombies this
// needs a read-then-write transaction rather than one atomic UPDATE.
export function adjustZombieNear(userId, delta) {
  db.transaction(() => {
    const p = stmtPlayerByUserId.get(userId);
    if (!p) return;
    const applied = Math.max(0, p.zombie_near + delta) - p.zombie_near;
    db.prepare(`UPDATE players SET zombie_near = ?, updated_at = ? WHERE user_id = ?`)
      .run(p.zombie_near + applied, Date.now(), userId);
    if (applied !== 0) adjustTotalZPool(applied);
  })();
}

// Absolute set for zombie_near_health, floored at 0 — used both to refill to
// z_hp for the next queued zombie and to zero out when the pool empties.
export function setZombieNearHealth(userId, hp) {
  db.prepare(`UPDATE players SET zombie_near_health = MAX(0, ?), updated_at = ? WHERE user_id = ?`)
    .run(hp, Date.now(), userId);
}

// Single-hit primitive for Nearby-scope combat: apply `dmg` to the player's
// currently-queued nearby zombie. On kill, decrement zombie_near and refill
// health to `zHp` for the next queued zombie (or leave it at 0 if the pool is
// now empty). Returns null if the player had no nearby zombies to hit.
export function damageNearbyZombie(userId, dmg, zHp) {
  const p = stmtPlayerByUserId.get(userId);
  if (!p || p.zombie_near <= 0) return null;
  const remaining = Math.max(0, p.zombie_near_health - dmg);
  let zombieNear = p.zombie_near;
  let zombieNearHealth = remaining;
  let killed = 0;
  if (remaining <= 0) {
    killed = 1;
    zombieNear = Math.max(0, zombieNear - 1);
    zombieNearHealth = zombieNear > 0 ? zHp : 0;
  }
  db.prepare(`UPDATE players SET zombie_near = ?, zombie_near_health = ?, updated_at = ? WHERE user_id = ?`)
    .run(zombieNear, zombieNearHealth, Date.now(), userId);
  // This writes zombie_near directly (not through adjustZombieNear, since
  // health needs to be updated atomically alongside it) — so a real kill
  // here has to mirror into total_z_pool explicitly rather than getting it
  // for free the way adjustZombieNear's callers do.
  if (killed) adjustTotalZPool(-killed);
  _log("FULL", `damageNearbyZombie user=${userId}: dmg=${dmg} remaining=${remaining} killed=${killed}`);
  return { killed, zombieNear, zombieNearHealth };
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
//     awards) and a public 'level' event announces each level gained.
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
    // Leveling up Magic refills mana, same as a player level (see applyLevelUp).
    if (skill === "magic" && leveled.length) {
      db.prepare(`UPDATE players SET mana = mana_max, updated_at = ? WHERE user_id = ?`).run(Date.now(), userId);
    }
    if (leveled.length) {
      const username = db.prepare("SELECT username FROM users WHERE id = ?").get(userId)?.username ?? "";
      for (const l of leveled) {
        insertEvent("level", `${username}'s ${SKILL_NAMES[skill]} skill increased to level ${l}!`, "public", "global");
      }
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
  // Leveling up Magic refills mana, same as a player level (see applyLevelUp).
  const manaRefill = skill === "magic" ? ", mana = mana_max" : "";
  db.prepare(`UPDATE players SET ${lvl} = ${lvl} + 1, xp = xp - ?${manaRefill}, updated_at = ? WHERE user_id = ?`)
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

// Spend XP to gain a level: -cost XP, set new level, refill mana to mana_max
// (every level, not just bonus ones). If the new level grants a stat bonus,
// +accuracy/+max health and heal to the new max; otherwise just the level
// number (and mana) changes. lifetime_xp is untouched (spending doesn't lose rank).
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
  const mana = p.mana_max; // every player level up refills mana, bonus level or not
  db.prepare(`
    UPDATE players
    SET xp = ?, level = ?, accuracy = ?, max_health = ?, health = ?, mana = ?, updated_at = ?
    WHERE user_id = ?
  `).run(xp, newLevel, accuracy, maxHealth, health, mana, Date.now(), userId);
  return { xp, level: newLevel, accuracy, maxHealth, mana, bonus: levelGrantsBonus(newLevel) };
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
    // Death forgets learned spells too — insertPlayer re-grants the starters.
    db.prepare("DELETE FROM player_magic WHERE user_id = ?").run(userId);
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

export function getPlayersNotAtLocation(location) {
  return db.prepare("SELECT user_id FROM players WHERE location != ?").all(location);
}

// The Mountains forge is a persistent per-player flag (unlike the in-memory
// campfire): lit by the fire_forge action, it stays fired across restarts
// until put out (/api/forge/toggle), admin-toggled, or death resets the row.
export function setForgeFired(userId, fired) {
  db.prepare(`UPDATE players SET forge_fired = ?, updated_at = ? WHERE user_id = ?`)
    .run(fired ? 1 : 0, Date.now(), userId);
}

// The Bunker supply beacon, same persistent-flag pattern as the forge: lit by
// activate_supply_beacon, cleared when a beacon-station craft redeems the
// drop (or admin toggle / death). One activation = one supply drop.
export function setBeaconFired(userId, fired) {
  db.prepare(`UPDATE players SET beacon_fired = ?, updated_at = ? WHERE user_id = ?`)
    .run(fired ? 1 : 0, Date.now(), userId);
}

// The Town Arcane Table: unlike the forge/beacon's persistent on/off toggle,
// this auto-expires ARCANE_TABLE_WINDOW_MS (server.js) after activation — the
// timestamp is what lets stationOk() tell "on" apart from "on but expired".
// Still settable off early via /api/arcane-table/toggle, mirroring the pair above.
export function setArcaneTableActive(userId, active) {
  if (active) {
    db.prepare(`UPDATE players SET arcane_table = 1, arcane_table_activated_at = ?, updated_at = ? WHERE user_id = ?`)
      .run(Date.now(), Date.now(), userId);
  } else {
    db.prepare(`UPDATE players SET arcane_table = 0, updated_at = ? WHERE user_id = ?`).run(Date.now(), userId);
  }
}

// Jam state is per gun type (a jammed Rifle doesn't stop the Handgun).
export function setGunJammed(userId, type, jammed) {
  db.prepare(`
    UPDATE players
    SET ${gunCol(type, "jammed")} = ?, updated_at = ?
    WHERE user_id = ?
  `).run(jammed ? 1 : 0, Date.now(), userId);
}

// Paperdoll — mirrors item_backbone.js's ARMOR_PIECES (kept as a separate
// local const rather than importing item_backbone.js here, matching how
// GUN_TYPES/GUN_NAMES are already declared independently in this file).
export const ARMOR_SLOTS = ["head", "torso", "legs", "boots", "hands", "shield"];

// Equip (or with '' unequip) one paperdoll slot. Six independent slots now —
// equipping one never touches the others.
export function equipArmorPiece(userId, slot, itemName) {
  if (!ARMOR_SLOTS.includes(slot)) throw new Error(`Invalid armor slot: ${slot}`);
  db.prepare(`UPDATE players SET a_${slot} = ?, updated_at = ? WHERE user_id = ?`)
    .run(itemName || "", Date.now(), userId);
}

// Nudges one owned item's condition — armor pieces are keyed by whatever name
// is equipped in a slot, and condition already lives on player_inventory (per
// item-name stack), not a dedicated players column. First real caller of
// updatePlayerInventory, which previously had zero call sites.
export function adjustArmorCondition(userId, itemName, delta) {
  updatePlayerInventory(userId, itemName, 0, delta, 0, 0);
  return db.prepare(`SELECT condition FROM player_inventory WHERE user_id = ? AND item_name = ?`)
    .get(userId, itemName)?.condition ?? 0;
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

  // Traveling flushes any "nearby" zombies back into the pool of the
  // location being left (conserves the total zombie count rather than
  // deleting or teleporting them) — the >3 travel block itself is enforced
  // by the caller (server.js's /api/travel), before this ever runs.
  if (player.zombie_near > 0 && ZOMBIE_LOCATIONS.has(player.location)) {
    adjustLocationZombies(player.location, player.zombie_near);
    // Routed through adjustZombieNear (not a raw zombie_near=0 write) so the
    // total_z_pool mirror above is balanced by a matching -zombie_near here,
    // instead of silently drifting the invariant on every travel.
    adjustZombieNear(userId, -player.zombie_near);
    db.prepare(`
      UPDATE players
      SET location = ?, zombie_near_health = 0, updated_at = ?
      WHERE user_id = ?
    `).run(location, Date.now(), userId);
    return;
  }

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
  const newGold = Math.max(0, player.c_gold + goldChange);
  db.prepare(`
    UPDATE players
    SET c_gold = ?, updated_at = ?
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

// Every player's ownership of one specific item — the admin panel's bulk
// "Give" modal (Items tab) needs to show every player's current quantity of
// whatever's about to be granted, not just one player's like getInventoryItem.
export function getItemOwners(itemName) {
  return db.prepare(`
    SELECT u.username, p.user_id, p.last_seen, COALESCE(pi.quantity, 0) AS quantity
    FROM users u
    JOIN players p ON p.user_id = u.id
    LEFT JOIN player_inventory pi ON pi.user_id = p.user_id AND pi.item_name = ?
    ORDER BY u.username
  `).all(itemName);
}

// Grant `quantity` of an item to every listed userId, atomically (all-or-
// nothing — used by the admin panel's bulk "Give" modal so a mid-loop
// failure can't leave some players granted and others not).
export function giveItemToPlayers(userIds, itemName, quantity) {
  const tx = db.transaction(() => {
    for (const userId of userIds) giveInventoryItem(userId, itemName, quantity);
  });
  tx();
}

// Add quantity of an item, stacking onto an existing row if present.
export function giveInventoryItem(userId, itemName, quantity = 1) {
  const owned = getInventoryItem(userId, itemName);
  if (owned) {
    db.prepare(`UPDATE player_inventory SET quantity = quantity + ?, updated_at = ? WHERE id = ?`)
      .run(quantity, Date.now(), owned.id);
  } else {
    const stamp = computeDbStamp();
    db.prepare(`INSERT INTO player_inventory (user_id, item_name, quantity, updated_at, session_key, session_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(userId, itemName, quantity, Date.now(), stamp.key, stamp.id);
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
    db.prepare("UPDATE players SET c_gold = c_gold + ?, updated_at = ? WHERE user_id = ?")
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
  const col = currency === "token" ? "c_tokens" : "c_gold";
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
// Carries the moderation gates/ban state too — the World tab's user list and
// its per-user Actions modal both need these to render current state, and
// the Players tab reuses this same list (the extra columns are just ignored
// there).
export function listUsers() {
  return db.prepare(`
    SELECT u.id, u.username, u.is_admin, p.level, p.location, p.last_seen,
           u.adm_fun, u.chat_mute, u.chat_deaf, u.chat_strict,
           u.login_restricted, u.login_res_time, u.login_res_set_time, u.login_res_reason, u.login_res_admin,
           u.user_exiled, u.user_exiled_reason, u.user_exiled_admin
    FROM users u LEFT JOIN players p ON p.user_id = u.id
    ORDER BY u.id
  `).all();
}
export function setUserAdmin(userId, isAdmin) {
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(isAdmin ? 1 : 0, userId);
}

// Sub-permission within admin: whether this admin has the 🎉 Fun button/API
// (users.adm_fun) — separate from is_admin, which just gates the panel itself.
export function setAdmFun(userId, value) {
  db.prepare("UPDATE users SET adm_fun = ? WHERE id = ?").run(value ? 1 : 0, userId);
}

const CHAT_FLAGS = { mute: "chat_mute", deaf: "chat_deaf", strict: "chat_strict" };
// flag: "mute" | "deaf" | "strict" — see the column comments in the users
// CREATE TABLE for what each one does.
export function setChatFlag(userId, flag, value) {
  const col = CHAT_FLAGS[flag];
  if (!col) throw new Error(`Invalid chat flag: ${flag}`);
  db.prepare(`UPDATE users SET ${col} = ? WHERE id = ?`).run(value ? 1 : 0, userId);
}

// Temp ban: durationSeconds from now. Auto-lifts on the next login attempt
// once it's expired (see the /login route) — nothing needs to run on a timer.
// `admin` is who placed it (attribution shown on banned.html).
export function banUser(userId, durationSeconds, reason, admin) {
  db.prepare(`
    UPDATE users SET login_restricted = 1, login_res_time = ?, login_res_set_time = ?, login_res_reason = ?, login_res_admin = ?
    WHERE id = ?
  `).run(durationSeconds, Date.now(), reason || "none", admin || "", userId);
}
export function unbanUser(userId) {
  db.prepare(`
    UPDATE users SET login_restricted = 0, login_res_time = 0, login_res_set_time = 0, login_res_reason = 'none', login_res_admin = ''
    WHERE id = ?
  `).run(userId);
}

// Exile is permanent and supersedes a temp ban entirely — clears it rather
// than leaving a stale restriction record alongside the exile.
export function exileUser(userId, reason, admin) {
  db.prepare(`
    UPDATE users
    SET user_exiled = 1, user_exiled_reason = ?, user_exiled_admin = ?,
        login_restricted = 0, login_res_time = 0, login_res_set_time = 0, login_res_reason = 'none', login_res_admin = ''
    WHERE id = ?
  `).run(reason || "none", admin || "", userId);
}
export function unexileUser(userId) {
  db.prepare("UPDATE users SET user_exiled = 0, user_exiled_reason = 'none', user_exiled_admin = '' WHERE id = ?").run(userId);
}

// Automatic (not admin-issued) lockout after too many bad passwords in a row.
// Returns the new failed-attempt count so the login route can decide whether
// this attempt just tripped the lockout.
export function recordFailedLogin(userId, maxAttempts, lockoutSeconds) {
  const row = db.prepare("SELECT failed_login_count FROM users WHERE id = ?").get(userId);
  const count = (row?.failed_login_count ?? 0) + 1;
  if (count >= maxAttempts) {
    db.prepare("UPDATE users SET failed_login_count = 0, failed_login_lockout_until = ? WHERE id = ?")
      .run(Date.now() + lockoutSeconds * 1000, userId);
  } else {
    db.prepare("UPDATE users SET failed_login_count = ? WHERE id = ?").run(count, userId);
  }
  return count;
}
export function resetFailedLogin(userId) {
  db.prepare("UPDATE users SET failed_login_count = 0 WHERE id = ?").run(userId);
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
  xp: {}, lifetime_xp: {}, level: {}, kills: {}, c_gold: {}, c_tokens: {}, golden_shots: {},
  health: { maxCol: "max_health" }, max_health: {},
  shield: { maxCol: "max_shield" }, max_shield: {}, accuracy: { max: 100 },
  mana: { maxCol: "mana_max" }, mana_max: {},
  ap_level: {}, // innate "Base AP" (adds into armorApOf)
  hidden: { max: 1 }, forge_fired: { max: 1 }, beacon_fired: { max: 1 },
  arcane_table: { max: 1 }, arcane_table_activated_at: {},
  handgun_ammo: {}, handgun_max_ammo: {}, handgun_clips: {}, handgun_max_clips: {}, handgun_condition: { max: 100 }, handgun_jammed: { max: 1 },
  rifle_ammo: {}, rifle_max_ammo: {}, rifle_clips: {}, rifle_max_clips: {}, rifle_condition: { max: 100 }, rifle_jammed: { max: 1 },
  shotgun_ammo: {}, shotgun_max_ammo: {}, shotgun_clips: {}, shotgun_max_clips: {}, shotgun_condition: { max: 100 }, shotgun_jammed: { max: 1 },
  burstrifle_ammo: {}, burstrifle_max_ammo: {}, burstrifle_clips: {}, burstrifle_max_clips: {}, burstrifle_condition: { max: 100 }, burstrifle_jammed: { max: 1 },
  railgun_ammo: {}, railgun_max_ammo: {}, railgun_clips: {}, railgun_max_clips: {}, railgun_condition: { max: 100 }, railgun_jammed: { max: 1 },
  bfg2000_ammo: {}, bfg2000_max_ammo: {}, bfg2000_clips: {}, bfg2000_max_clips: {}, bfg2000_condition: { max: 100 }, bfg2000_jammed: { max: 1 },
  melee_condition: { max: 100 },
  ranged_condition: { max: 100 }, ranged_ammo: {}, ranged_crossbow_max_ammo: {}, ranged_bow_max_ammo: {}, ranged_slingshot_max_ammo: {}, ranged_cb_jammed: { max: 1 },
  throwing_condition: { max: 100 }, throwing_ammo: {}, throwing_max_ammo: {},
  fist_weapon_condition: { max: 100 },
  zombie_near: {}, zombie_near_health: {},
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
