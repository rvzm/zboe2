// zboe2
// Zombie Biohazard Outbreak Experiment 2
// Current Version: 2.0.22-RC1
// Current RC: none
import {
  getUserByName, getUserIdByName, getPlayerByUserId, isUserAdmin,
  getLeaderboard, getRecentEvents, getEventTotal,
  insertUser, insertPlayer, ensurePlayer, insertEvent,
  updatePlayerStats,
  updatePlayerJamStatus, updatePlayerGun, updatePlayerAccuracy,
  updatePlayerInventory,
  updatePlayerLocation, updatePlayerHidden, valid_locations,
  increasePlayerCount, decreasePlayerCount,
  updateLastLogin, touchPlayerSeen,
  getGameState, setHuntEnabled, adjustHordeSize,
  getShopItems, purchaseShopItem, updatePlayerGold,
  getInventory, giveInventoryItem, consumeInventoryItem,
  gunAmmoOf, updateGunAmmo, reloadGun, updateGunMaxAmmo, updateGunMaxClips,
  adjustGunCondition, getActivePlayers, damagePlayer,
  applyLevelUp, resetPlayer, getPlayersByLocation,
  setRaidEnabled, adjustBaseHealth, setBaseDestroyedAt, resetGameState,
  recordNukeVote, getNukeVoterIds, clearNukeVotes
} from "./db.js";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import { styleText } from "node:util";
import { game_config, file_config, zombie_config} from "./config.js";

// Colorize text for a given stream only when that stream actually supports color.
// util.styleText no-ops to plain text for non-TTYs, pipes/redirects, and when
// NO_COLOR is set — so callers never have to check whether color is available.
// The try/catch keeps us safe on older Node or an unknown format name.
function paint(format, text, stream = process.stdout) {
  try { return styleText(format, text, { stream }); }
  catch { return text; }
}

const LOG_LEVELS = {
    FULL: 0,
    INFO: 1,   // actions (shoot/reload/…) and tick check results
    WARN: 2,
    ERROR: 3,
    FATAL: 4
};

// Console colors per log level (styleText format names). File output stays plain.
const LOG_COLORS = {
    FULL: "dim",
    INFO: "green",
    WARN: "yellow",
    ERROR: "red",
    FATAL: ["bold", "red"],
};

const LOG_FILE = path.join("logs/", file_config.logFile || "server.log");
fs.mkdirSync("logs/", { recursive: true });
// PID of a backgrounded server, written by the parent when it daemonizes and
// removed by the daemon on exit. Used by --stop.
const PID_FILE = path.join("logs", "zboe.pid");

// Stop a backgrounded server: read its PID file, SIGTERM it, remove the file.
function stopDaemon() {
  let pid;
  try {
    pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
  } catch {
    console.error(paint("yellow", "No PID file — no backgrounded server to stop.", process.stderr));
    process.exit(1);
  }
  if (!pid) {
    console.error("PID file is empty/invalid; removing it.");
    fs.rmSync(PID_FILE, { force: true });
    process.exit(1);
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(paint(["bold", "green"], `Stopped ZBOE (pid ${pid}).`));
  } catch (e) {
    if (e.code === "ESRCH") {
      console.error(`No process with pid ${pid} (stale PID file); cleaning up.`);
    } else {
      console.error(`Failed to stop pid ${pid}: ${e.message}`);
      process.exit(1);
    }
  }
  fs.rmSync(PID_FILE, { force: true });
  process.exit(0);
}

// ----- Runtime options -----
// Config groups that can be overridden for a single run via --set / --key=value.
const CONFIG_GROUPS = { file_config, game_config, zombie_config };

// Coerce a string to the type of the config value it's replacing.
function coerceLike(current, raw) {
  if (typeof current === "number") { const n = Number(raw); return Number.isNaN(n) ? current : n; }
  if (typeof current === "boolean") return raw === "true" || raw === "1";
  return raw;
}

// Override a config value addressed by "group.key" or a bare "key" (searched
// across all groups). Returns null on success, or an error string.
function applyConfigOverride(pathStr, raw) {
  if (pathStr.includes(".")) {
    const [group, key] = pathStr.split(".");
    const obj = CONFIG_GROUPS[group];
    if (!obj || !(key in obj)) return `unknown config path '${pathStr}'`;
    obj[key] = coerceLike(obj[key], raw);
    return null;
  }
  for (const obj of Object.values(CONFIG_GROUPS)) {
    if (pathStr in obj) { obj[pathStr] = coerceLike(obj[pathStr], raw); return null; }
  }
  return `unknown config key '${pathStr}'`;
}

// Declarative option table — add/remove/edit a flag by editing this array.
const CLI_OPTIONS = [
  { test: (a) => a === "--dev",                    apply: () => { game_config.dev = true; },        help: "--dev                  dev mode (log to file)" },
  { test: (a) => a === "--production",             apply: () => { game_config.production = true; }, help: "--production           production mode" },
  { test: (a) => a === "-v" || a === "--verbose",  apply: () => { game_config.verbose = true; },    help: "-v, --verbose          stay in foreground as a live console (else run in background)" },
  { test: (a) => a.startsWith("--debug-level="),   apply: (a) => { game_config.debugLevel = a.split("=")[1]; }, help: "--debug-level=LEVEL    FULL|INFO|WARN|ERROR|FATAL" },
  { test: (a) => a.startsWith("--debug="),         apply: (a) => { game_config.debugLevel = a.split("=")[1]; }, help: "--debug=LEVEL          alias for --debug-level" },
  { test: (a) => a === "--stop",                   apply: () => stopDaemon(),                       help: "--stop                 stop a backgrounded server (via its PID file)" },
  { test: (a) => a === "-h" || a === "--help",     apply: () => { printHelp(); process.exit(0); },  help: "-h, --help             show this help and exit" },
];

function printHelp() {
  console.log("Usage: node server.js [options]\n\nOptions:");
  for (const opt of CLI_OPTIONS) console.log("  " + opt.help);
  console.log("  --set group.key=value  override a config value for this run (repeatable)");
  console.log("  --group.key=value      shorthand for --set (also accepts a bare --key=value)\n");
  console.log("Config groups: " + Object.keys(CONFIG_GROUPS).join(", "));
}

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];

  const known = CLI_OPTIONS.find((o) => o.test(arg));
  if (known) { known.apply(arg); continue; }

  // --set key=value   (or  --set key value)
  if (arg === "--set") {
    const token = argv[++i] ?? "";
    const eq = token.indexOf("=");
    const p = eq === -1 ? token : token.slice(0, eq);
    const v = eq === -1 ? (argv[++i] ?? "") : token.slice(eq + 1);
    const err = applyConfigOverride(p, v);
    if (err) { console.error(`ERROR: --set ${err}`); process.exit(1); }
    continue;
  }

  // --path=value  (path may be group.key or a bare key)
  if (arg.startsWith("--") && arg.includes("=")) {
    const eq = arg.indexOf("=");
    const err = applyConfigOverride(arg.slice(2, eq), arg.slice(eq + 1));
    if (err) console.error(`WARNING: ${err} (see --help), ignoring '${arg}'`);
    continue;
  }

  console.error(`WARNING: ignoring unknown argument '${arg}'`);
}

if (game_config.dev && game_config.production) {
  console.error("ERROR: --dev and --production cannot be used together.");
  process.exit(1);
}

// In dev, default the console filter to INFO (gameplay without the API-log slop)
// when no level was explicitly chosen. An explicit level — FULL for everything,
// or WARN/ERROR/etc — is left untouched. 'NONE' is the config's unset default.
if (game_config.dev && game_config.debugLevel === "NONE") {
  game_config.debugLevel = "INFO";
}

// Sanity halt: the default sessionSecret must be changed for a real deployment.
// In dev we only warn and continue; anything else is a hard FATAL exit. Printed
// directly (ungated by --verbose) so it's visible before we ever daemonize.
if (game_config.sessionSecret === "changeme") {
  const msg = "game_config.sessionSecret is still the default 'changeme' — set it (config.js or --set game_config.sessionSecret=...) before a production run.";
  const stamp = new Date().toISOString();
  if (game_config.dev) {
    console.warn(paint(["bold", "yellow"], `WARNING: ${msg}`, process.stderr));
    fs.appendFileSync(LOG_FILE, `${stamp} [WARN] - ${msg}\n`);
  } else {
    console.error(paint(["bold", "red"], `FATAL: ${msg}`, process.stderr));
    fs.appendFileSync(LOG_FILE, `${stamp} [FATAL] - ${msg}\n`);
    process.exit(1);
  }
}

function log(level, message, game_config) {

    const timestamp = new Date().toISOString();

    const line =
        `${timestamp} [${level}] - ${message}\n`;

    if (game_config.dev || level === "ERROR" || level === "FATAL") {
        fs.appendFileSync(LOG_FILE, line);
    }

    if (
        game_config.verbose &&
        LOG_LEVELS[level] >= LOG_LEVELS[game_config.debugLevel]
    ) {
        const color = LOG_COLORS[level] || "reset";
        console.log(paint(color, line.trim()));
    }

    if (level === "FATAL") {
        process.exit(1);
    }
}
function startVerboseHeartbeat(config) {
    if (!game_config.verbose)
        return;

    setInterval(() => {
        const mem =
            Math.round(process.memoryUsage().rss / 1024 / 1024);
        console.log(
            `[HEARTBEAT] ${new Date().toISOString()} Server running - Memory=${mem}MB Uptime=${Math.floor(process.uptime())}s`
        );
    }, (game_config.heartbeatSeconds || 30) * 1000);

}
process.on("uncaughtException", (err) => {
    log("FATAL", err.stack || err.message, game_config);
});

process.on("unhandledRejection", (reason) => {
    log("ERROR", String(reason), game_config);
});
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function hashPassword(password, salt) {
  log("FULL", `Hashing password with salt=${salt}`, game_config);
  return crypto.pbkdf2Sync(password, salt, 150000, 32, "sha256").toString("hex");
}

// ----- Very simple signed session cookie -----
function sign(value) {
  log("FULL", `Signing value: ${value}`, game_config);
  return crypto.createHmac("sha256", game_config.sessionSecret).update(value).digest("hex");
}
function setSession(res, username) {
  const payload = JSON.stringify({ u: username, t: Date.now() });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = sign(b64);
  log("FULL", `Setting session for ${username}`, game_config);
  res.cookie("zboe_session", `${b64}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // set true behind HTTPS
  });
}
function getSession(req) {
  const raw = req.cookies?.zboe_session;
  log("FULL", `Retrieving session cookie: ${raw}`, game_config);
  if (!raw) return null;
  const [b64, sig] = raw.split(".");
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  log("FULL", `Session valid for payload: ${b64}`, game_config);
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    log("WARN", "Failed to parse session payload", game_config);
    return null;
  }
}

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Returns "timeout" if the player hasn't been seen within game_config.timeout
// seconds, otherwise "active". game_config.timeout is in SECONDS; last_seen is a
// millisecond epoch (Date.now()), so we convert.
function checkPlayerActivity(userId) {
  const player = getPlayerByUserId(userId);

  // No player row, or never seen → treat as timed out.
  if (!player || !player.last_seen) {
    log("FULL", `Activity check userId=${userId}: no last_seen -> timeout`, game_config);
    return "timeout";
  }

  const idleMs = Date.now() - player.last_seen;
  const limitMs = game_config.timeout * 1000;
  const status = idleMs > limitMs ? "timeout" : "active";

  log("FULL",
    `Activity check userId=${userId} idle=${Math.round(idleMs / 1000)}s limit=${game_config.timeout}s -> ${status}`,
    game_config);
  return status;
}

// Must run after requireAuth (needs req.userId). Rejects non-admins.
function requireAdmin(req, res, next) {
  if (!isUserAdmin(req.userId)) {
    log("WARN", `Admin-only action denied for ${req.user}`, game_config);
    return res.status(403).json({ ok: false, message: "Admin only." });
  }
  next();
}

function requireAuth(req, res, next) {
  const sess = getSession(req);
  log("FULL", `Authenticating request, session=${JSON.stringify(sess)}`, game_config);
  if (!sess?.u) return res.redirect("/login.html?err=Please%20login");
  log("FULL", `Looking up user for session username=${sess.u}`, game_config);
  const user = getUserIdByName(sess.u);
  log("FULL", `User lookup result for username=${sess.u}: ${JSON.stringify(user)}`, game_config);
  if (!user) return res.redirect("/login.html?err=Please%20login");
  log("FULL", `Authenticated user ${user.username} (id=${user.id})`, game_config);
  req.user = user.username;
  req.userId = user.id;
  next();
}

// Routes
app.get("/", (req, res) => {
  // Always show public homepage
  log("FULL", "Serving homepage", game_config);
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.get("/login", (_req, res) => res.redirect("/login.html"));
app.get("/register", (_req, res) => res.redirect("/register.html"));

app.post("/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  log("FULL", `Registration attempt for username=${username}`, game_config);
  if (!username || !password) return res.redirect("/register.html?err=Missing%20fields");
  log("FULL", `Validating registration input for username=${username}`, game_config);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.redirect("/register.html?err=Username%203-20%20chars%20letters%2Fnumbers%2F_");
    log("FULL", `Username validation failed for username=${username}`, game_config);
  }
  if (password.length < 4) return res.redirect("/register.html?err=Password%20too%20short");
  log("FULL", `Registration input valid for username=${username}, checking availability`, game_config);
  // check if user exists
  const existing = getUserByName(username);
  if (existing) return res.redirect("/register.html?err=Username%20taken"); log("FULL", `Username ${username} already taken`, game_config);

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  log("FULL", `Registering new user with username=${username}`, game_config);
  try {
    const info = insertUser(username, salt, hash, Date.now());
	insertPlayer(info.lastInsertRowid, Date.now());
    log("FULL", `User ${username} registered successfully with id=${info.lastInsertRowid}`, game_config);

  } catch (e) {
    // If a race condition happens (two requests same username), UNIQUE constraint will throw.
    log("ERROR", `Error inserting user ${username}: ${e.message}`, game_config);
    return res.redirect("/register.html?err=Username%20taken");
  }

  setSession(res, username);
  log("FULL", `Session set for new user ${username}, redirecting to game`, game_config);
  return res.redirect("/game");
});


app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  log("FULL", `Login attempt for username=${username}`, game_config);
  if (!username || !password) return res.redirect("/login.html?err=Missing%20fields");
  const rec = getUserByName(username);
  if (!rec) {
    return res.redirect("/login.html?err=Bad%20login");
    log("WARN", `No user record found for username=${username}`, game_config);
  }

  const hash = hashPassword(password, rec.pass_salt);
  if (hash !== rec.pass_hash) {
     return res.redirect("/login.html?err=Bad%20login");
      log("WARN", `Password hash mismatch for username=${username}`, game_config);
  }

  setSession(res, username);
  log("FULL", `User ${username} logged in successfully, redirecting to game`, game_config);
  updateLastLogin(rec.id);
  touchPlayerSeen(rec.id);
  increasePlayerCount(rec.id);
  return res.redirect("/game");
});


app.post("/logout", (req, res) => {
  res.clearCookie("zboe_session");
  res.redirect("/login.html");
  log("FULL", "User logged out, session cleared", game_config);
  decreasePlayerCount(req.userId);
});

app.get("/game", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "game.html"));
  log("FULL", `Serving game page to authenticated user ${req.user}`, game_config);
});

app.get("/api/game-state", requireAuth, (req, res) => {
  log("FULL", `API request for game state by user ${req.user}`, game_config);
  touchPlayerSeen(req.userId);
  const player = ensurePlayer(req.userId);
  const gameState = getGameState();
  const leaderboard = getLeaderboard(10);
  const recentEvents = getRecentEvents(80, req.userId).reverse();
  const totalEvents = getEventTotal();
  const triggerOutOf = 15;
  const triggerValue = totalEvents % triggerOutOf;
  // horde_size in game_state is now the source of truth for the zombie count,
  // and hunt_enabled is the real hunt toggle (both driven by the ticker/button).
  const zombies = gameState.horde_size;
  // Players seen within the timeout window are "online".
  const activeCutoff = Date.now() - game_config.timeout * 1000;
  const online = getActivePlayers(activeCutoff).map((p) => p.username);
  // Ammo/clips shown on the page come from whichever gun is equipped.
  const gun = gunAmmoOf(player, equippedType(player));

  const hordeStatus = hordeStatusOf(gameState);
  const baseDestroyed = baseIsDestroyed(gameState);

  res.json({
    huntActive: gameState.hunt_enabled === "true",
    horde: hordeStatus === "hunting" || hordeStatus === "raiding",
    hordeStatus,
    raid: hordeStatus === "raiding",
    base: {
      health: gameState.base_health,
      max: game_config.baseMaxHealth,
      destroyed: baseDestroyed,
      destroyedAt: gameState.base_destroyed_at,
    },
    nuke: baseDestroyed ? nukeVoteStatus() : null,
    zombies,
    tickSeconds: zombie_config.z_tic,
    trigger: { value: triggerValue, outOf: triggerOutOf },
    online,
    leaderboard,
    me: {
      id: req.userId,
      user: req.user,
      xp: player.xp,
      level: player.level,
      nextLevel: nextLevelOf(player.level),
      nextLevelCost: levelCost(nextLevelOf(player.level)),
      canLevel: player.xp >= levelCost(nextLevelOf(player.level)),
      kills: player.kills,
      health: player.health,
      maxHealth: player.max_health,
      shield: player.shield,
      ammo: gun.ammo,
      maxAmmo: gun.maxAmmo,
      clips: gun.clips,
      maxClips: gun.maxClips,
      acc: player.accuracy,
      cond: gun.condition,
      gold: player.gold,
      equippedGun: equippedGunName(player),
      location: player.location,
      inside: player.location === "inside",
      isAdmin: isUserAdmin(req.userId),
      jammed: Boolean(player.jammed),
    },
    events: recentEvents,
  });
});

const XP_PER_KILL = 10;
const GOLD_PER_KILL = 5;

// ----- Leveling -----
// Levels step 1..20, then every 5 (25, 30, ...). Cost compounds with level.
// Each level grants +5 accuracy and +5 max health, and heals to the new max.
function nextLevelOf(level) { return level < 20 ? level + 1 : level + 5; }
function levelCost(targetLevel) { return Math.round(100 * Math.pow(targetLevel, 1.6)); }

// ----- Horde status & base -----
function hordeStatusOf(gs) {
  if (gs.raid_enabled === "true") return "raiding";          // persists until cleared
  if (gs.hunt_enabled !== "true") return "hiding";
  if (gs.horde_size >= zombie_config.z_raid) return "raiding";
  if (gs.horde_size >= zombie_config.z_horde) return "hunting";
  return "wandering";
}
function baseIsDestroyed(gs) { return gs.base_health <= 0; }

// Full experiment reset: zombies die, hunt/raid off, base rebuilt.
function experimentReset(reason) {
  resetGameState(game_config.baseMaxHealth);
  insertEvent("system", `The Experiment Resets (${reason}).`, "public", "global");
  log("WARN", `Experiment reset — ${reason}`, game_config);
}

// Nuke-vote tally over currently-active players.
function nukeVoteStatus() {
  const cutoff = Date.now() - game_config.timeout * 1000;
  const activeIds = new Set(getActivePlayers(cutoff).map((p) => p.user_id));
  const votes = getNukeVoterIds().filter((id) => activeIds.has(id)).length;
  const needed = Math.floor(activeIds.size / 2) + 1;
  return { active: activeIds.size, votes, needed };
}

// Pick up to n random distinct elements from arr.
function sampleUpTo(arr, n) {
  if (arr.length <= n) return arr.slice();
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
}

// ----- Guns -----
// Each gun maps to a type, which selects the ammo/clip columns (handgun_/rifle_/
// shotgun_) and the shooting behavior below.
const GUNS = {
  "Handgun": { type: "handgun" },
  "Rifle":   { type: "rifle" },
  "Shotgun": { type: "shotgun" },
};

// accuracyModel: "player"  → player accuracy stat (+ gun condition, TBD), floored.
//                "condition" → base floor scaled by condition only (rifle).
// maxTargets: zombies a single successful shot can drop.
const GUN_BEHAVIOR = {
  handgun: { accuracyModel: "player",    floor: 5,  maxTargets: 1 },
  rifle:   { accuracyModel: "condition", floor: 60, maxTargets: 1 },
  shotgun: { accuracyModel: "player",    floor: 5,  maxTargets: 5 },
};

function equippedGunName(player) {
  return GUNS[player.equipped_gun] ? player.equipped_gun : "Handgun";
}
function equippedType(player) {
  return GUNS[equippedGunName(player)].type;
}

const SHOT_WEAR_CHANCE = 15; // % chance a shot wears the gun
const SHOT_WEAR_AMOUNT = 2;  // condition points lost when it does

// Percent chance a shot connects, based on the gun's condition (0-100).
function computeHitChance(player, behavior, gunCondition) {
  if (behavior.accuracyModel === "condition") {
    // Rifle: high base, impaired only by gun condition.
    return Math.max(5, Math.round(behavior.floor * (gunCondition / 100)));
  }
  // Handgun / Shotgun: player accuracy stat scaled by gun condition, floored.
  return Math.max(behavior.floor, Math.round(player.accuracy * (gunCondition / 100)));
}

// Shotgun: how many zombies a hit drops, scaled by accuracy and gun condition (1–5).
function shotgunTargets(player, gunCondition) {
  const scaled = Math.round(5 * (player.accuracy / 100) * (gunCondition / 100));
  return Math.max(1, Math.min(5, scaled));
}

// ----- Chat censor -----
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function loadCensorWords() {
  try {
    const file = path.join(__dirname, file_config.censorFile || "censor.txt");
    return fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch (err) {
    log("WARN", `Could not read censor file: ${err.message}`, game_config);
    return [];
  }
}
const CENSOR_WORDS = loadCensorWords();
// Whole-word, case-insensitive match; each hit becomes ****.
const CENSOR_REGEX = CENSOR_WORDS.length
  ? new RegExp(`\\b(?:${CENSOR_WORDS.map(escapeRegex).join("|")})\\b`, "gi")
  : null;
function censorText(text) {
  return CENSOR_REGEX ? text.replace(CENSOR_REGEX, "****") : text;
}

// ----- Static shop upgrades (hardcoded; distinct from the DB shop_items catalogue) -----
// 'stat' items apply an instant change to the players row; 'consumable' items
// drop into the player's inventory to be used later.
const STATIC_UPGRADES = [
  { key: "extended_mag", label: "Extended Magazine", desc: "+2 max ammo (equipped gun)",  cost: 150, type: "stat", apply: (uid, gun) => updateGunMaxAmmo(uid, gun, 2) },
  { key: "spare_clip",   label: "Spare Clip",        desc: "+1 clip (equipped gun)",      cost: 5,   type: "stat", apply: (uid, gun) => updateGunAmmo(uid, gun, 0, 1) },
  { key: "clip_holster", label: "Clip Holster",      desc: "+1 max clips (equipped gun)", cost: 120, type: "stat", apply: (uid, gun) => updateGunMaxClips(uid, gun, 1) },
  { key: "laser_sight",  label: "Laser Sight",       desc: "+5% accuracy",                cost: 200, type: "stat", apply: (uid) => updatePlayerAccuracy(uid, 5) },
  { key: "gun_oil",      label: "Gun Oil",           desc: "consumable · restores condition", cost: 40, type: "consumable", item: "gun oil" },
  // One-time gun unlocks: bought once, land in inventory, then equippable.
  { key: "buy_rifle",    label: "Rifle",             desc: "one-time · unlocks the Rifle",   cost: 500, type: "gun", item: "Rifle" },
  { key: "buy_shotgun",  label: "Shotgun",           desc: "one-time · unlocks the Shotgun", cost: 400, type: "gun", item: "Shotgun" },
];

// ----- Usable inventory items (consumed one at a time) -----
const USABLE_ITEMS = {
  "gun oil":        { label: "Gun Oil",        effect: (uid) => { const p = getPlayerByUserId(uid); adjustGunCondition(uid, equippedType(p), 25); }, note: "+25 equipped gun condition" },
  "exchange token": { label: "Exchange Token", effect: (uid) => updatePlayerGold(uid, 50),      note: "+50 gold" },
};

app.post("/api/action/shoot", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const gameState = getGameState();

  // Server-side guards. The client disables the button in these cases, but the
  // client is never trusted — re-check everything here.
  if (gameState.hunt_enabled !== "true")
    return res.status(409).json({ ok: false, message: "The hunt isn't active." });
  if (gameState.horde_size <= 0)
    return res.status(409).json({ ok: false, message: "No zombies to shoot." });
  if (player.jammed)
    return res.status(409).json({ ok: false, message: "Your gun is jammed." });

  const gunName = equippedGunName(player);
  const type = equippedType(player);
  const behavior = GUN_BEHAVIOR[type];
  const { ammo, condition: gunCondition } = gunAmmoOf(player, type);
  if (ammo <= 0)
    return res.status(409).json({ ok: false, message: "Out of ammo — reload." });

  // The round is spent whether or not it connects.
  updateGunAmmo(req.userId, type, -1, 0);

  // Every shot has a chance to wear the gun's condition down a couple of points.
  if (Math.random() * 100 < SHOT_WEAR_CHANCE) {
    const worn = adjustGunCondition(req.userId, type, -SHOT_WEAR_AMOUNT);
    log("INFO", `${req.user} ${gunName} condition wore to ${worn}`, game_config);
  }

  const hitChance = computeHitChance(player, behavior, gunCondition);
  const roll = Math.random() * 100;
  const hit = roll < hitChance;

  if (!hit) {
    // A miss only matters to the shooter — target it at their user_id.
    insertEvent("shoot", `You fired the ${gunName} and missed`, "private", req.userId);
    log("INFO", `${req.user} shoot ${gunName} roll=${roll.toFixed(1)} chance=${hitChance} -> miss`, game_config);
    return res.json({ ok: true, result: "miss", message: "Missed!" });
  }

  // A hit drops up to maxTargets zombies (shotgun spread), capped by the horde.
  const targets = type === "shotgun" ? shotgunTargets(player, gunCondition) : behavior.maxTargets;
  const killed = Math.min(targets, gameState.horde_size);

  updatePlayerStats(req.userId, XP_PER_KILL * killed, killed);
  updatePlayerGold(req.userId, GOLD_PER_KILL * killed);
  adjustHordeSize(-killed);
  const noun = killed === 1 ? "a zombie" : `${killed} zombies`;
  insertEvent("kill", `${req.user} dropped ${noun} (+${XP_PER_KILL * killed} XP, +${GOLD_PER_KILL * killed} gold)`, "public", "global");

  log("INFO", `${req.user} shoot ${gunName} roll=${roll.toFixed(1)} chance=${hitChance} -> hit x${killed}`, game_config);
  return res.json({ ok: true, result: "hit", killed, message: killed > 1 ? `Hit — ${killed} zombies down!` : "Hit — zombie down!" });
});

app.post("/api/action/reload", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const gunName = equippedGunName(player);
  const type = equippedType(player);

  const result = reloadGun(req.userId, type);
  if (!result.ok) {
    const message = result.reason === "no_clips" ? "No clips left to reload." : "Already fully loaded.";
    return res.status(409).json({ ok: false, message });
  }

  insertEvent("reload", `You reloaded the ${gunName}`, "private", req.userId);
  log("INFO", `${req.user} reloaded ${gunName}`, game_config);
  return res.json({ ok: true, message: "Reloaded." });
});

// Flip the global hunt on/off. Admin only.
app.post("/api/hunt/toggle", requireAuth, requireAdmin, (req, res) => {
  const gameState = getGameState();
  const enabled = gameState.hunt_enabled !== "true";
  setHuntEnabled(enabled);
  log("INFO", `${req.user} toggled hunt_enabled -> ${enabled}`, game_config);
  return res.json({ ok: true, huntActive: enabled, message: enabled ? "Hunt enabled." : "Hunt disabled." });
});

// The shop catalogue (read-only for players; managed via the Admin CLI).
app.get("/api/shop", requireAuth, (req, res) => {
  res.json(getShopItems());
});

// Buy one unit of an item with gold. Body: item_name (form-urlencoded).
app.post("/api/shop/buy", requireAuth, (req, res) => {
  const itemName = String(req.body.item_name || "").trim();
  if (!itemName)
    return res.status(400).json({ ok: false, message: "No item specified." });

  const result = purchaseShopItem(req.userId, itemName);
  if (!result.ok) {
    const messages = {
      no_such_item: "That item isn't in the shop.",
      no_player: "Player not found.",
      insufficient_gold: `Not enough gold — need ${result.cost}, you have ${result.gold}.`,
    };
    return res.status(409).json({ ok: false, message: messages[result.reason] || "Purchase failed." });
  }

  insertEvent("shop", `You bought ${itemName}`, "private", req.userId);
  log("INFO", `${req.user} bought ${itemName} for ${result.item.item_cost} gold (gold left ${result.goldLeft})`, game_config);
  return res.json({ ok: true, message: `Bought ${itemName}.`, goldLeft: result.goldLeft });
});

// Static upgrades catalogue (hardcoded stat items, consumables, and one-time
// gun unlocks). 'gun' upgrades carry an `owned` flag so the UI can mark them.
app.get("/api/shop/upgrades", requireAuth, (req, res) => {
  const owned = new Set(getInventory(req.userId).filter((i) => i.quantity > 0).map((i) => i.item_name));
  res.json(STATIC_UPGRADES.map(({ key, label, desc, cost, type, item }) => ({
    key, label, desc, cost, type,
    owned: type === "gun" ? owned.has(item) : false,
  })));
});

app.post("/api/shop/upgrades/buy", requireAuth, (req, res) => {
  const upgrade = STATIC_UPGRADES.find((u) => u.key === String(req.body.key || ""));
  if (!upgrade) return res.status(400).json({ ok: false, message: "Unknown upgrade." });

  const player = ensurePlayer(req.userId);

  // One-time gun unlocks can't be bought twice.
  if (upgrade.type === "gun") {
    const alreadyOwned = getInventory(req.userId).some((i) => i.item_name === upgrade.item && i.quantity > 0);
    if (alreadyOwned) return res.status(409).json({ ok: false, message: `You already own the ${upgrade.item}.` });
  }

  if (player.gold < upgrade.cost)
    return res.status(409).json({ ok: false, message: `Not enough gold — need ${upgrade.cost}, you have ${player.gold}.` });

  updatePlayerGold(req.userId, -upgrade.cost);
  if (upgrade.type === "consumable" || upgrade.type === "gun") giveInventoryItem(req.userId, upgrade.item, 1);
  else upgrade.apply(req.userId, equippedType(player)); // stat upgrades hit the equipped gun's type

  insertEvent("shop", `You bought ${upgrade.label}`, "private", req.userId);
  log("INFO", `${req.user} bought upgrade ${upgrade.key} for ${upgrade.cost} gold`, game_config);
  return res.json({ ok: true, message: `Bought ${upgrade.label}.` });
});

// Player inventory: the full list (gun items flagged), the usable items with
// owned counts, and which gun is currently equipped.
app.get("/api/inventory", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const rawItems = getInventory(req.userId);
  const items = rawItems.map((i) => ({ ...i, isGun: Boolean(GUNS[i.item_name]) }));
  const ownedQty = Object.fromEntries(rawItems.map((i) => [i.item_name, i.quantity]));
  const usable = Object.entries(USABLE_ITEMS).map(([name, def]) => ({
    name, label: def.label, quantity: ownedQty[name] ?? 0,
  }));
  res.json({ items, usable, equipped: equippedGunName(player) });
});

// Equip a gun you own (an inventory item whose name is a known gun).
app.post("/api/inventory/equip", requireAuth, (req, res) => {
  const gunName = String(req.body.item || "").trim();
  if (!GUNS[gunName]) return res.status(400).json({ ok: false, message: "That isn't a gun." });

  const owned = getInventory(req.userId).find((i) => i.item_name === gunName && i.quantity > 0);
  if (!owned) return res.status(409).json({ ok: false, message: `You don't own a ${gunName}.` });

  updatePlayerGun(req.userId, gunName);
  insertEvent("item", `You equipped the ${gunName}`, "private", req.userId);
  log("INFO", `${req.user} equipped ${gunName}`, game_config);
  return res.json({ ok: true, message: `Equipped ${gunName}.` });
});

app.post("/api/inventory/use", requireAuth, (req, res) => {
  const itemName = String(req.body.item || "").trim();
  const def = USABLE_ITEMS[itemName];
  if (!def) return res.status(400).json({ ok: false, message: "That item can't be used." });

  const newQty = consumeInventoryItem(req.userId, itemName);
  if (newQty === null) return res.status(409).json({ ok: false, message: `You have no ${def.label} to use.` });

  def.effect(req.userId);
  insertEvent("item", `You used ${def.label} (${def.note})`, "private", req.userId);
  log("INFO", `${req.user} used ${itemName} (${newQty} left)`, game_config);
  return res.json({ ok: true, message: `Used ${def.label} — ${def.note}.`, quantity: newQty });
});

// Global player chat. Stored as a 'chat' event so it rides the normal feed.
app.post("/api/chat", requireAuth, (req, res) => {
  const raw = String(req.body.message || "").trim();
  if (!raw) return res.status(400).json({ ok: false, message: "Empty message." });

  const text = censorText(raw.slice(0, 300));
  insertEvent("chat", `${req.user}: ${text}`, "public", "global");
  log("INFO", `${req.user} chat: ${text}`, game_config);
  return res.json({ ok: true });
});

// Manually add a zombie to the horde, independent of the spawn ticker.
// Requires the hunt to be active (same rule as the spawn ticker).
app.post("/api/hunt/call-zombie", requireAuth, (req, res) => {
  if (getGameState().hunt_enabled !== "true")
    return res.status(409).json({ ok: false, message: "The hunt isn't active." });
  adjustHordeSize(1);
  insertEvent("spawn", `${req.user} called in a zombie`, "public", "global");
  log("INFO", `${req.user} manually called a zombie`, game_config);
  return res.json({ ok: true, message: "Zombie called in." });
});

// ----- Leveling (spend XP) -----
app.post("/api/level/up", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const target = nextLevelOf(player.level);
  const cost = levelCost(target);
  if (player.xp < cost)
    return res.status(409).json({ ok: false, message: `Need ${cost} XP for level ${target}, you have ${player.xp}.` });

  const r = applyLevelUp(req.userId, target, cost);
  insertEvent("level", `You reached level ${target}! (+5 accuracy, +5 max health)`, "private", req.userId);
  log("INFO", `${req.user} leveled to ${target} for ${cost} xp`, game_config);
  return res.json({ ok: true, message: `Level ${target}!`, level: r.level });
});

app.post("/api/level/max", requireAuth, (req, res) => {
  let player = ensurePlayer(req.userId);
  let gained = 0;
  while (gained < 1000) {
    const target = nextLevelOf(player.level);
    const cost = levelCost(target);
    if (player.xp < cost) break;
    applyLevelUp(req.userId, target, cost);
    player = getPlayerByUserId(req.userId);
    gained++;
  }
  if (!gained) return res.status(409).json({ ok: false, message: "Not enough XP for the next level." });
  insertEvent("level", `You spent XP and reached level ${player.level}!`, "private", req.userId);
  return res.json({ ok: true, message: `Reached level ${player.level} (+${gained} levels).`, level: player.level });
});

// ----- Base: go inside / outside -----
app.post("/api/base/toggle", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const goingInside = player.location !== "inside";
  if (goingInside && baseIsDestroyed(getGameState()))
    return res.status(409).json({ ok: false, message: "The base is destroyed — you can't go inside." });

  updatePlayerLocation(req.userId, goingInside ? "inside" : "outside");
  return res.json({ ok: true, message: goingInside ? "You went inside the base." : "You went outside." });
});

// ----- Vote to nuke (only while the base is destroyed) -----
app.post("/api/nuke/vote", requireAuth, (req, res) => {
  if (!baseIsDestroyed(getGameState()))
    return res.status(409).json({ ok: false, message: "The base isn't destroyed." });

  recordNukeVote(req.userId);
  const tally = nukeVoteStatus();
  if (tally.votes >= tally.needed) {
    experimentReset("nuke vote passed");
    return res.json({ ok: true, message: "The vote passed — The Experiment Resets." });
  }
  return res.json({ ok: true, message: `Vote recorded (${tally.votes}/${tally.needed}).` });
});

// ----- Admin: reset the experiment (rebuilds the base) -----
app.post("/api/base/reset", requireAuth, requireAdmin, (req, res) => {
  experimentReset(`reset by ${req.user}`);
  return res.json({ ok: true, message: "Experiment reset." });
});

// The game tick (every z_tic seconds):
//   0. If the base is destroyed, freeze; auto-reset after experimentResetHours.
//   1. Spawn (hunt active): z_chance% to add a zombie.
//   2. Attack by tier: wandering (1 zombie @ z_hit%), hunting (up to 75% of
//      zombies each hit every player), raiding (each zombie @ z_hit/2% hits up
//      to 10 players for double damage; persists until the horde is cleared).
//   Inside players are shielded by the base (2 base damage each, up to 500);
//   base death kills everyone inside; personal health 0 kills that player.
function startZombieTicker() {
  const intervalMs = Math.max(1, zombie_config.z_tic) * 1000;
  const resetMs = game_config.experimentResetHours * 3600 * 1000;

  setInterval(() => {
    let gs = getGameState();

    // 0) Destroyed base: everything is frozen until reset.
    if (baseIsDestroyed(gs)) {
      if (gs.base_destroyed_at && Date.now() - gs.base_destroyed_at >= resetMs) {
        experimentReset("24 hours elapsed");
      }
      return;
    }

    // 1) Spawn.
    if (gs.hunt_enabled === "true" && Math.random() * 100 < zombie_config.z_chance) {
      adjustHordeSize(1);
      insertEvent("spawn", "A zombie shambles into the area", "public", "global");
      log("INFO", `tick: spawned a zombie (horde ${gs.horde_size} -> ${gs.horde_size + 1})`, game_config);
    }

    // 2) Attack phase.
    gs = getGameState();
    const z = gs.horde_size;
    if (z <= 0) { if (gs.raid_enabled === "true") setRaidEnabled(false); return; }

    let raiding = gs.raid_enabled === "true";
    if (z >= zombie_config.z_raid && !raiding) {
      setRaidEnabled(true); raiding = true;
      insertEvent("system", "A RAID has begun — the horde swarms the base!", "public", "global");
    }
    if (gs.hunt_enabled !== "true" && !raiding) return; // paused unless a raid is ongoing

    const cutoff = Date.now() - game_config.timeout * 1000;
    const active = getActivePlayers(cutoff);
    if (!active.length) return;

    // Tally damage per player for this tick based on the tier.
    const dmgByPlayer = new Map();
    const addDmg = (uid, d) => dmgByPlayer.set(uid, (dmgByPlayer.get(uid) || 0) + d);

    const tier = raiding ? "raiding" : z >= zombie_config.z_horde ? "hunting" : "wandering";
    if (raiding) {
      const perHit = zombie_config.z_damage * 2;
      for (let i = 0; i < Math.min(z, 2000); i++) {
        if (Math.random() * 100 < zombie_config.z_hit / 2) {
          for (const t of sampleUpTo(active, 10)) addDmg(t.user_id, perHit);
        }
      }
    } else if (z >= zombie_config.z_horde) {
      const attackers = Math.floor(Math.random() * (Math.floor(0.75 * z) + 1));
      if (attackers > 0) for (const p of active) addDmg(p.user_id, attackers * zombie_config.z_damage);
    } else if (Math.random() * 100 < zombie_config.z_hit) {
      for (const p of active) addDmg(p.user_id, zombie_config.z_damage);
    }
    log("INFO", `tick: tier=${tier} zombies=${z} active=${active.length} playersHit=${dmgByPlayer.size}`, game_config);

    // Apply: inside players are absorbed by the base (2 each, up to 500);
    // outside players take the hit and may die.
    let baseDamage = 0, insideAbsorbed = 0;
    const deaths = [];
    for (const [uid, dmg] of dmgByPlayer) {
      const pl = active.find((a) => a.user_id === uid);
      if (pl.location === "inside" && insideAbsorbed < 500) {
        baseDamage += 2; insideAbsorbed++;
      } else {
        const r = damagePlayer(uid, dmg);
        insertEvent("attack", `A zombie hit you for ${dmg} (shield ${r.shield}, health ${r.health})`, "private", uid);
        if (r.health <= 0) deaths.push(pl);
      }
    }

    // Outside deaths.
    for (const d of deaths) {
      resetPlayer(d.user_id);
      insertEvent("death", "You died and lost everything — back to level 1.", "private", d.user_id);
      insertEvent("system", `${d.username} was torn apart by zombies.`, "public", "global");
    }

    // Base damage & possible destruction.
    if (baseDamage > 0) {
      const newBase = adjustBaseHealth(-baseDamage);
      if (newBase <= 0) {
        setBaseDestroyedAt(Date.now());
        setRaidEnabled(false);
        for (const ins of getPlayersByLocation("inside")) {
          resetPlayer(ins.user_id);
          insertEvent("death", "The base fell — you died inside and lost everything.", "private", ins.user_id);
        }
        insertEvent("system", "THE BASE HAS FALLEN. Everyone inside has perished.", "public", "global");
        log("WARN", "Base destroyed — all inside players reset", game_config);
      }
    }
  }, intervalMs);
}

const runMode = () => (game_config.dev ? "dev" : game_config.production ? "production" : "stable");
const startupSummaryLine = () =>
  `Startup: mode=${runMode()} debugLevel=${game_config.debugLevel} tick=${zombie_config.z_tic}s timeout=${game_config.timeout}s`;
const timeoutWarnLine = () =>
  game_config.timeout > 10
    ? `WARNING: timeout=${game_config.timeout}s may be excessive (10s recommended for a closed/frozen page to drop promptly).`
    : null;

// Startup summary — always printed AND written to the log file, ungated by
// debug level or --verbose, so the effective runtime settings are always on record.
function logStartupSummary() {
  const line = startupSummaryLine();
  console.log(paint("cyan", line));
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [INFO] - ${line}\n`);

  const warn = timeoutWarnLine();
  if (warn) {
    console.warn(paint(["bold", "yellow"], warn, process.stderr));
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [WARN] - ${warn}\n`);
  }
}

const PORT = process.env.PORT || 3000;

// Foreground vs background: --verbose keeps us in the foreground as a live output
// console. Without it, re-spawn ourselves detached, print a couple of lines + the
// child's pid, and release the terminal. ZBOE_DAEMON marks the child so it doesn't
// re-fork; the child then runs the server normally (logging to the file).
if (!game_config.verbose && !process.env.ZBOE_DAEMON) {
  // A leftover PID file whose process is gone would confuse --stop; but a live
  // one means a server is likely already running — warn rather than clobber it.
  if (fs.existsSync(PID_FILE)) {
    const prev = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    let alive = false;
    try { process.kill(prev, 0); alive = true; } catch {}
    if (alive) {
      console.error(paint(["bold", "yellow"], `A backgrounded server may already be running (pid ${prev}). Use --stop first.`, process.stderr));
      process.exit(1);
    }
  }

  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ZBOE_DAEMON: "1" },
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid)); // recorded now so --stop works immediately

  console.log(paint(["bold", "green"], `ZBOE web starting on http://localhost:${PORT}`));
  console.log(paint("cyan", startupSummaryLine()));
  const warn = timeoutWarnLine();
  if (warn) console.warn(paint(["bold", "yellow"], warn, process.stderr));
  console.log(paint("dim", `Forked to background — pid ${child.pid} · logs: ${LOG_FILE} · stop with: node server.js --stop`));
  process.exit(0);
}

app.listen(PORT, () => {
  console.log(paint(["bold", "green"], `ZBOE web running on http://localhost:${PORT}`));
  // The daemon removes its PID file on exit so --stop and restart checks stay accurate.
  if (process.env.ZBOE_DAEMON) {
    const cleanup = () => { try { fs.rmSync(PID_FILE, { force: true }); } catch {} };
    process.on("exit", cleanup);
    for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { cleanup(); process.exit(0); });
  }
  logStartupSummary();
  startZombieTicker();
  startVerboseHeartbeat(); // only ticks when --verbose is set
});
