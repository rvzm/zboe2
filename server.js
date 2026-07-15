// zboe2
// Zombie Biohazard Outbreak Experiment 2
// Version: see app_version in config.js
import {
  getUserByName, getUserIdByName, getPlayerByUserId, isUserAdmin,
  getLeaderboard, getRecentEvents,
  insertUser, insertPlayer, ensurePlayer, insertEvent,
  updatePlayerStats,
  setGunJammed, unjamGun, updatePlayerGun, updatePlayerAccuracy,
  updatePlayerInventory,
  updatePlayerLocation, updatePlayerHidden, LOCATION_NAMES, LOCATION_LINKS, ZOMBIE_LOCATIONS,
  LOCATION_ACTIONS, SKILLS, SKILL_NAMES, skillLevelCost, addSkillXp, buySkillLevel,
  increasePlayerCount, decreasePlayerCount,
  updateLastLogin, touchPlayerSeen,
  getGameState, setHuntEnabled, adjustHordeSize,
  purchaseItem, updatePlayerGold,
  getInventory, giveInventoryItem, consumeInventoryItem,
  gunAmmoOf, updateGunAmmo, reloadGun, updateGunMaxAmmo, updateGunMaxClips,
  adjustGunCondition, getActivePlayers, damagePlayer,
  applyLevelUp, resetPlayer, getPlayersByLocation,
  setRaidEnabled, adjustBaseHealth, setBaseDestroyedAt, resetGameState,
  recordNukeVote, getNukeVoterIds, clearNukeVotes,
  GUN_NAMES,
  listUsers, setUserAdmin, setUserAuth, deleteUserCascade,
  getAuthRecord, setUserSession, setUserLoggedOut, SESSION_LOGGED_OUT,
  EDITABLE_STATS, setPlayerStat, removeInventoryItem, consumeItems, sellItem,
  nextLevelOf, levelCost, forceLevel,
  addShield, increaseMaxShield, healPlayer, addTokens,
  grantGoldenShots, useGoldenShot
} from "./db.js";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import { styleText } from "node:util";
import { game_config, file_config, zombie_config, ssl_config, app_version } from "./config.js";
import https from "node:https";
import http from "node:http";
import { ITEMS, RECIPES, ITEM_TYPES, RANDOM_DROPS } from "./item_backbone.js";

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
const CONFIG_GROUPS = { file_config, game_config, zombie_config, ssl_config };

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
  { test: (a) => a === "--mock-db",                apply: () => { game_config.mockDb = true; },     help: "--mock-db              seed a starter dev DB (3 users, 1 admin) with random passwords" },
  { test: (a) => a === "-h" || a === "--help",     apply: () => { printHelp(); process.exit(0); },  help: "-h, --help             show this help and exit" },
];

function printHelp() {
  console.log(`zboe2 ${app_version}`);
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

// Size cap on the log file: at logMaxMB the current log is rotated out to
// <name>.old.log (replacing any previous rotation) and a fresh file starts.
// The console (if attached via --verbose) is warned when this happens. Checked
// once here at startup (the direct appendFileSync writers below don't rotate)
// and again before every log() file write.
const LOG_MAX_BYTES = (file_config.logMaxMB || 3) * 1024 * 1024;
const ROTATED_LOG_FILE = LOG_FILE.replace(/\.log$/, "") + ".old.log";
function rotateLogIfNeeded() {
    let size;
    try { size = fs.statSync(LOG_FILE).size; } catch { return; } // no file yet
    if (size < LOG_MAX_BYTES) return;

    if (game_config.verbose) {
        console.warn(paint(["bold", "yellow"],
            `WARNING: log file is full (${(size / 1024 / 1024).toFixed(1)}MB >= ${file_config.logMaxMB || 3}MB cap) — rotating to ${path.basename(ROTATED_LOG_FILE)}.`,
            process.stderr));
    }
    fs.renameSync(LOG_FILE, ROTATED_LOG_FILE); // replaces the previous .old.log
    fs.appendFileSync(LOG_FILE,
        `${new Date().toISOString()} [WARN] - Log rotated: previous log moved to ${path.basename(ROTATED_LOG_FILE)}\n`);
}
rotateLogIfNeeded();

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

// `fileMessage` (optional) is the redacted version written to the log file — use
// it for anything sensitive (salts, hashes, session tokens/cookies). The console
// still shows the raw `message`; the log file never gets anything usable.
function log(level, message, game_config, fileMessage) {

    const timestamp = new Date().toISOString();
    const prefix = `${timestamp} [${level}] - `;

    if (game_config.dev || level === "ERROR" || level === "FATAL") {
        rotateLogIfNeeded();
        fs.appendFileSync(LOG_FILE, `${prefix}${fileMessage ?? message}\n`);
    }

    if (
        game_config.verbose &&
        LOG_LEVELS[level] >= LOG_LEVELS[game_config.debugLevel]
    ) {
        const color = LOG_COLORS[level] || "reset";
        console.log(paint(color, `${prefix}${message}`));
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
  log("FULL", `Hashing password with salt=${salt}`, game_config, "Hashing password with salt=[redacted]");
  return crypto.pbkdf2Sync(password, salt, 150000, 32, "sha256").toString("hex");
}

// ----- Very simple signed session cookie -----
function sign(value) {
  log("FULL", `Signing value: ${value}`, game_config, "Signing value: [redacted]");
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
    secure: ssl_config.enabled, // Secure cookies whenever we're serving HTTPS
  });
}
// ----- Server-side session pair (anti-hijack layer on top of the signed cookie) -----
// On login we mint a random 25-char key + a UUID. The key is salted with
// sessionSecret (HMAC-SHA256) before it's stored — the DB never holds the raw
// value; the browser carries the raw key + UUID as cookies and every API call
// re-verifies them against BOTH the users and players rows.
const SESSION_KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function makeRawSessionKey() {
  const bytes = crypto.randomBytes(25);
  return Array.from(bytes, (b) => SESSION_KEY_CHARS[b % SESSION_KEY_CHARS.length]).join("");
}
function saltSessionKey(raw) {
  return crypto.createHmac("sha256", game_config.sessionSecret).update(raw).digest("hex");
}
// Mint + persist + set cookies. Called on login and register.
function issueServerSession(res, userId) {
  const rawKey = makeRawSessionKey();
  const sessionId = crypto.randomUUID();
  setUserSession(userId, saltSessionKey(rawKey), sessionId);
  const opts = { httpOnly: true, sameSite: "lax", secure: ssl_config.enabled };
  res.cookie("zboe_skey", rawKey, opts);
  res.cookie("zboe_sid", sessionId, opts);
  log("FULL", `Issued session pair for userId=${userId} (sid=${sessionId})`, game_config, `Issued session pair for userId=${userId} (sid=[redacted])`);
}

function getSession(req) {
  const raw = req.cookies?.zboe_session;
  log("FULL", `Retrieving session cookie: ${raw}`, game_config, "Retrieving session cookie: [redacted]");
  if (!raw) return null;
  const [b64, sig] = raw.split(".");
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  log("FULL", `Session valid for payload: ${b64}`, game_config, "Session valid for payload: [redacted]");
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
  log("FULL", `Authenticating request, session=${JSON.stringify(sess)}`, game_config, `Authenticating request, session for user=${sess?.u ?? "?"}`);
  if (!sess?.u) return res.redirect("/login.html?err=Please%20login");
  const auth = getAuthRecord(sess.u);
  log("FULL", `User lookup result for username=${sess.u}: ${auth ? `id=${auth.id}` : "undefined"}`, game_config);
  if (!auth) return res.redirect("/login.html?err=Please%20login");

  // Server-side session verification: the cookie pair must match the stored
  // pair, and the users/players copies must agree with each other. Any
  // mismatch is a possible hijack/tamper attempt — WARN and bounce.
  if (auth.session_id === SESSION_LOGGED_OUT) {
    log("WARN", `API auth: ${auth.username} presented a session but is logged out`, game_config);
    return res.redirect("/login.html?err=Please%20login");
  }
  const rawKey = req.cookies?.zboe_skey;
  const sid = req.cookies?.zboe_sid;
  if (!rawKey || !sid || sid !== auth.session_id || saltSessionKey(rawKey) !== auth.session_key) {
    log("WARN", `API auth MISMATCH for ${auth.username}: session key/ID rejected (ip=${req.ip})`, game_config);
    return res.redirect("/login.html?err=Session%20invalid");
  }
  if (auth.session_key !== auth.p_session_key || auth.session_id !== auth.p_session_id) {
    log("WARN", `API auth MISMATCH for ${auth.username}: users/players session records disagree (ip=${req.ip})`, game_config);
    return res.redirect("/login.html?err=Session%20invalid");
  }

  log("FULL", `Authenticated user ${auth.username} (id=${auth.id})`, game_config);
  req.user = auth.username;
  req.userId = auth.id;
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
  issueServerSession(res, getUserByName(username).id);
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

  // Double-login guard: an un-logged-out session that's still ACTIVE (seen
  // within the presence window) blocks a second login. A stale session (tab
  // closed without logging out) is simply replaced — rotating the pair kills
  // the old cookies anyway.
  if (rec.session_id !== SESSION_LOGGED_OUT) {
    const p = getPlayerByUserId(rec.id);
    if (p && p.last_seen >= Date.now() - game_config.timeout * 1000) {
      log("WARN", `Double-login blocked for ${username} — session already active (ip=${req.ip})`, game_config);
      return res.redirect("/login.html?err=Already%20logged%20in%20elsewhere");
    }
    log("INFO", `Stale session for ${username} replaced on login`, game_config);
  }

  setSession(res, username);
  issueServerSession(res, rec.id);
  log("FULL", `User ${username} logged in successfully, redirecting to game`, game_config);
  updateLastLogin(rec.id);
  touchPlayerSeen(rec.id);
  increasePlayerCount(rec.id);
  return res.redirect("/game");
});


app.post("/logout", (req, res) => {
  // Resolve the user from the signed cookie (no requireAuth here — a broken
  // session should still be able to log out), then void the stored pair:
  // session_id -> LOGGED_OUT, session_key -> all zeros.
  const sess = getSession(req);
  const user = sess?.u ? getUserIdByName(sess.u) : null;
  if (user) {
    setUserLoggedOut(user.id);
    decreasePlayerCount(user.id);
    log("INFO", `${user.username} logged out — session voided`, game_config);
  }
  res.clearCookie("zboe_session");
  res.clearCookie("zboe_skey");
  res.clearCookie("zboe_sid");
  res.redirect("/login.html");
});

app.get("/game", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "game.html"));
  log("FULL", `Serving game page to authenticated user ${req.user}`, game_config);
});

// Web admin panel — the zboe.sh user/player/shop functions. Admin only; a
// non-admin gets bounced to the game rather than the page.
app.get("/admin", requireAuth, (req, res) => {
  if (!isUserAdmin(req.userId)) return res.redirect("/game");
  res.sendFile(path.join(__dirname, "public", "admin.html"));
  log("INFO", `${req.user} opened the admin panel`, game_config);
});

// Public leaderboard — no auth, feeds the landing page (index.html). Rows are
// { user, xp (lifetime), level }, same shape the game page's board uses.
app.get("/api/leaderboard", (_req, res) => {
  res.json({ leaderboard: getLeaderboard(25) });
});

app.get("/api/game-state", requireAuth, (req, res) => {
  log("FULL", `API request for game state by user ${req.user}`, game_config);
  touchPlayerSeen(req.userId);
  const player = ensurePlayer(req.userId);
  const gameState = getGameState();
  const leaderboard = getLeaderboard(10);
  const recentEvents = getRecentEvents(80, req.userId).reverse();
  // horde_size in game_state is now the source of truth for the zombie count,
  // and hunt_enabled is the real hunt toggle (both driven by the ticker/button).
  const zombies = gameState.horde_size;
  // Players seen within the timeout window are "online".
  const activeCutoff = Date.now() - game_config.timeout * 1000;
  const online = getActivePlayers(activeCutoff).map((p) => p.username);
  // Ammo/clips shown on the page come from whichever gun is equipped.
  const gun = gunAmmoOf(player, equippedType(player));
  const locKey = locationOf(player);

  const hordeStatus = hordeStatusOf(gameState);
  const baseDestroyed = baseIsDestroyed(gameState);

  res.json({
    version: app_version,
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
      maxShield: player.max_shield,
      ammo: gun.ammo,
      maxAmmo: gun.maxAmmo,
      clips: gun.clips,
      maxClips: gun.maxClips,
      acc: player.accuracy,
      cond: gun.condition,
      gold: player.gold,
      tokens: player.horde_tokens,
      goldenShots: player.golden_shots,
      equippedGun: player.golden_shots > 0 ? "Golden Gun" : equippedGunName(player),
      // Gun switcher: which of the three guns are owned / currently equipped.
      guns: (() => {
        const owned = new Set(getInventory(req.userId).filter((i) => i.quantity > 0).map((i) => i.item_name));
        return GUN_NAMES.map((g) => ({ name: g, owned: owned.has(g), equipped: equippedGunName(player) === g }));
      })(),
      location: locKey,
      locationName: LOCATION_NAMES[locKey],
      inside: locKey === "basecamp_inside",
      atBase: locKey === "basecamp_outside" || locKey === "basecamp_inside",
      zombieZone: ZOMBIE_LOCATIONS.has(locKey),
      busyUntil: busyUntilOf(req.userId),
      campfireUntil: campfireUntilOf(req.userId),
      skills: SKILLS.map((s) => ({
        key: s,
        name: SKILL_NAMES[s],
        level: player[`s_${s}_lvl`],
        xp: player[`s_${s}_xp`],
        nextCost: skillLevelCost(player[`s_${s}_lvl`] + 1),
      })),
      // Locations reachable from here (empty inside the base — no map there),
      // flagged safe/zombie for the map's color-coded pills.
      map: (LOCATION_LINKS[locKey] || []).map((k) => ({
        key: k, name: LOCATION_NAMES[k], zombie: ZOMBIE_LOCATIONS.has(k),
      })),
      isAdmin: isUserAdmin(req.userId),
      jammed: gun.jammed, // the equipped gun's jam state (jams are per gun)
    },
    // This location's actions, annotated with lvlOk/toolOk for this player.
    actions: actionsFor(player, locKey),
    events: recentEvents,
  });
});

const XP_PER_KILL = 10;
const GOLD_PER_KILL = 5;

// Leveling rules (nextLevelOf/levelCost) live in db.js as the source of truth.

// ----- Horde status & base -----
function hordeStatusOf(gs) {
  if (gs.raid_enabled === "true") return "raiding";          // latched until horde hits 0
  if (gs.hunt_enabled !== "true") return "hiding";
  if (gs.horde_size >= zombie_config.z_horde) return "hunting";
  return "wandering";
}

// Latch a raid ON once the horde reaches z_raid. Once latched, it stays until the
// horde is fully cleared (handled where zombies are killed). Call after any spawn/add.
function latchRaidIfNeeded() {
  const gs = getGameState();
  if (gs.raid_enabled !== "true" && gs.horde_size >= zombie_config.z_raid) {
    setRaidEnabled(true);
    insertEvent("system", "A RAID has begun — the horde swarms the base!", "public", "global");
    log("INFO", `raid latched on (horde=${gs.horde_size} >= z_raid=${zombie_config.z_raid})`, game_config);
    return true;
  }
  return false;
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
// Derived from the item registry: every ITEMS entry with type "gun" maps its
// gunType to the per-gun stat columns (handgun_/rifle_/shotgun_) and the
// shooting behavior below.
const GUNS = Object.fromEntries(
  Object.entries(ITEMS)
    .filter(([, item]) => item.type === "gun")
    .map(([key, item]) => [key, { type: item.gunType }])
);

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

// Player's current location key, hardened against unknown/legacy values
// (rows from before the location system default to Basecamp).
function locationOf(player) {
  return LOCATION_NAMES[player.location] ? player.location : "basecamp_outside";
}

// Players mid-action: userId -> { until (ms), key }. In-memory on purpose —
// a dev-server restart just cancels any running action.
const ACTION_BUSY = new Map();
function busyUntilOf(userId) {
  const b = ACTION_BUSY.get(userId);
  if (!b || b.until <= Date.now()) return 0;
  return b.until;
}

// Campfires: userId -> expiry ms. Built from firewood (Adventure Panel),
// enables campfire-station recipes until it burns out or is put out.
// In-memory like ACTION_BUSY — a restart douses every fire.
const CAMPFIRES = new Map();
const CAMPFIRE_COST = 2;          // firewood consumed to build
const CAMPFIRE_BURN_SECONDS = 300;
function campfireUntilOf(userId) {
  const t = CAMPFIRES.get(userId) || 0;
  return t > Date.now() ? t : 0;
}

// Meditation: a safe-zone timed action granting magic XP (no item, no roll).
const MEDITATE_SECONDS = 20;
const MEDITATE_XP = 8;

// Can this player use a recipe's crafting station right now?
function stationOk(userId, locKey, station) {
  if (!station) return true;
  if (station === "campfire") return campfireUntilOf(userId) > 0;
  if (station === "forge") return locKey === "town";
  return false;
}
const STATION_MESSAGES = {
  campfire: "You need a campfire burning — build one first.",
  forge: "That needs the Old Forge in Town.",
};

// The current location's actions, annotated with whether THIS player can run
// each one right now (skill level + required tool).
function actionsFor(player, locKey) {
  const defs = LOCATION_ACTIONS[locKey] || [];
  if (!defs.length) return [];
  const owned = new Set(getInventory(player.user_id).filter((i) => i.quantity > 0).map((i) => i.item_name));
  return defs.map((a) => ({
    key: a.key,
    label: a.label,
    timer: a.timer,
    skill: a.skill,
    skillName: SKILL_NAMES[a.skill],
    skillLevel: a.skillLevel,
    successRate: a.successRate,
    grants: a.grants,
    xp: a.xp,
    requires: a.requires ?? null,
    lvlOk: player[`s_${a.skill}_lvl`] >= a.skillLevel,
    toolOk: !a.requires || owned.has(a.requires),
  }));
}

const SHOT_WEAR_CHANCE = 15; // % chance a shot wears the gun
const SHOT_WEAR_AMOUNT = 2;  // condition points lost when it does
// Jam chance per shot = missing condition × JAM_FACTOR (%). A pristine gun
// never jams; at condition 60 → 10%, at 0 → 25%. Keep guns oiled.
const JAM_FACTOR = 0.25;

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

// Rifle: in a thick horde (> RIFLE_PIERCE_MIN_HORDE zombies) a round can punch
// clean through and drop a second zombie. Chance scales linearly with player
// accuracy: RIFLE_PIERCE_MIN% at 0 acc → RIFLE_PIERCE_MAX% at 100.
const RIFLE_PIERCE_MIN_HORDE = 5;
const RIFLE_PIERCE_MIN = 15;
const RIFLE_PIERCE_MAX = 65;
function riflePierces(player, hordeSize) {
  if (hordeSize <= RIFLE_PIERCE_MIN_HORDE) return false;
  const chance = RIFLE_PIERCE_MIN + (RIFLE_PIERCE_MAX - RIFLE_PIERCE_MIN) * (player.accuracy / 100);
  return Math.random() * 100 < chance;
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

// ----- Static shop upgrades (hardcoded; distinct from the item registry's shop) -----
// `category` decides which game-page tab it appears on: "upgrade" (permanent
// gun/character boosts) or "item" (consumables & one-time buys, shown on the Shop
// tab alongside registry `shop` items). 'type' still drives buy handling:
// 'stat'/'instant' apply immediately; 'consumable'/'gun' drop into inventory.
const STATIC_UPGRADES = [
  { key: "extended_mag", label: "Extended Magazine", desc: "+2 max ammo (equipped gun)",  cost: 150, type: "stat", category: "upgrade", apply: (uid, gun) => updateGunMaxAmmo(uid, gun, 2) },
  { key: "clip_holster", label: "Clip Holster",      desc: "+1 max clips (equipped gun)", cost: 120, type: "stat", category: "upgrade", apply: (uid, gun) => updateGunMaxClips(uid, gun, 1) },
  { key: "laser_sight",  label: "Accuracy Potion",   desc: "+5% accuracy",                cost: 200, type: "stat", category: "upgrade", apply: (uid) => updatePlayerAccuracy(uid, 5) },
  { key: "spare_clip",   label: "Spare Clip",        desc: "+1 clip (equipped gun)",      cost: 5,   type: "stat", category: "item", apply: (uid, gun) => updateGunAmmo(uid, gun, 0, 1) },
  { key: "gun_oil",      label: "Gun Oil",           desc: "consumable · restores condition", cost: 25, type: "consumable", category: "item", item: "gun oil" },
  // Gold consumables (drop into inventory, used later).
  { key: "heal_potion",  label: "Healing Potion",    desc: "consumable · +50 health",  cost: 25, type: "consumable", category: "item", item: "healing potion" },
  { key: "shield_potion",label: "Shield Potion",     desc: "consumable · +50 shield",  cost: 60, type: "consumable", category: "item", item: "shield potion" },
  // One-time gun unlocks: bought once, land in inventory, then equippable.
  { key: "buy_rifle",    label: "Rifle",             desc: "one-time · unlocks the Rifle",   cost: 500, type: "gun", category: "item", item: "Rifle" },
  { key: "buy_shotgun",  label: "Shotgun",           desc: "one-time · unlocks the Shotgun", cost: 850, type: "gun", category: "item", item: "Shotgun" },
  // Token-purchased (horde/raid tokens), applied instantly.
  { key: "shield_booster", label: "Shield Booster",  desc: "+50 shield capacity",            cost: 5,  currency: "token", type: "instant", category: "item", apply: (uid) => increaseMaxShield(uid, 50) },
  { key: "golden_gun",     label: "Golden Gun",      desc: "power-up · 25 perfect shots",    cost: 25, currency: "token", type: "instant", category: "item", apply: (uid) => grantGoldenShots(uid, 25) },
  // Token → gold exchange; rate is game_config.tokenExchangeGold (--set-able per run).
  { key: "exchange_token", label: "Exchange Token",  desc: `1 token → ${game_config.tokenExchangeGold} gold`, cost: 1, currency: "token", type: "instant", category: "item", msg: `Exchanged 1 token for ${game_config.tokenExchangeGold} gold`, apply: (uid) => updatePlayerGold(uid, game_config.tokenExchangeGold) },
];

// ----- Item effect interpreter -----
// Applies a registry item's declarative `use` block (item_backbone.js). One
// verb → one handler; add a verb here once and every item can use it. Each
// handler returns the human note for the feed message.
const EFFECT_VERBS = {
  heal:         (uid, n) => { healPlayer(uid, n);            return `+${n} health`; },
  shield:       (uid, n) => { addShield(uid, n);             return `+${n} shield`; },
  maxShield:    (uid, n) => { increaseMaxShield(uid, n);     return `+${n} max shield`; },
  gunCondition: (uid, n) => { adjustGunCondition(uid, equippedType(getPlayerByUserId(uid)), n); return `+${n} equipped gun condition`; },
  gold:         (uid, n) => { updatePlayerGold(uid, n);      return `+${n} gold`; },
  accuracy:     (uid, n) => { updatePlayerAccuracy(uid, n);  return `+${n} accuracy`; },
  goldenShots:  (uid, n) => { grantGoldenShots(uid, n);      return `+${n} golden shots`; },
  tokens:       (uid, n) => { addTokens(uid, n);             return `+${n} tokens`; },
};
function applyItemEffects(userId, use) {
  return Object.entries(use).map(([verb, amount]) => EFFECT_VERBS[verb](userId, amount)).join(", ");
}

// ----- Item registry sanity (boot-time) -----
// Every item name referenced anywhere must exist in ITEMS, every type must be
// valid, and every `use` verb must have an interpreter. This is what makes
// "adding an item is adding a row" safe: a typo dies here, loudly, at boot.
{
  const bad = [];
  for (const [key, item] of Object.entries(ITEMS)) {
    if (!ITEM_TYPES.includes(item.type)) bad.push(`ITEMS["${key}"] has invalid type "${item.type}"`);
    for (const verb of Object.keys(item.use || {}))
      if (!EFFECT_VERBS[verb]) bad.push(`ITEMS["${key}"] uses unknown effect verb "${verb}"`);
    if (item.type === "gun" && !item.gunType) bad.push(`ITEMS["${key}"] is a gun with no gunType`);
  }
  const check = (name, where) => { if (name && !ITEMS[name]) bad.push(`${where} references unknown item "${name}"`); };
  for (const [loc, actions] of Object.entries(LOCATION_ACTIONS))
    for (const a of actions) { check(a.grants, `LOCATION_ACTIONS.${loc}.${a.key}.grants`); check(a.requires, `LOCATION_ACTIONS.${loc}.${a.key}.requires`); }
  for (const r of RECIPES) {
    check(r.output, `RECIPES.${r.key}.output`); check(r.requires, `RECIPES.${r.key}.requires`);
    for (const input of Object.keys(r.inputs || {})) check(input, `RECIPES.${r.key}.inputs`);
    if (r.station && !["campfire", "forge"].includes(r.station)) bad.push(`RECIPES.${r.key} has unknown station "${r.station}"`);
  }
  for (const u of STATIC_UPGRADES) check(u.item, `STATIC_UPGRADES.${u.key}.item`);
  if (bad.length) {
    // Printed ungated (like the sessionSecret halt) so it's visible even
    // without --verbose, then FATAL-logged (which exits).
    console.error(paint(["bold", "red"], `FATAL: item registry validation failed:\n  - ${bad.join("\n  - ")}`, process.stderr));
    log("FATAL", `Item registry validation failed: ${bad.join("; ")}`, game_config);
  }
}

app.post("/api/action/shoot", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const gameState = getGameState();

  // Server-side guards. The client disables the button in these cases, but the
  // client is never trusted — re-check everything here.
  if (!ZOMBIE_LOCATIONS.has(locationOf(player)))
    return res.status(409).json({ ok: false, message: "It's quiet here — no zombies in this area." });
  if (gameState.hunt_enabled !== "true")
    return res.status(409).json({ ok: false, message: "The hunt isn't active." });
  if (gameState.horde_size <= 0)
    return res.status(409).json({ ok: false, message: "No zombies to shoot." });
  // Golden Gun is a temporary overlay: while golden_shots remain, it replaces the
  // equipped gun — perfect shot, no ammo/jam/wear, one zombie per shot.
  const golden = player.golden_shots > 0;

  let killed, gunLabel, goldenRemaining = null, pierced = false;
  if (golden) {
    goldenRemaining = useGoldenShot(req.userId);
    gunLabel = "Golden Gun";
    killed = Math.min(1, gameState.horde_size);
  } else {
    const type = equippedType(player);
    const behavior = GUN_BEHAVIOR[type];
    const { ammo, condition: gunCondition, jammed } = gunAmmoOf(player, type);
    gunLabel = equippedGunName(player);
    if (jammed)
      return res.status(409).json({ ok: false, message: `The ${gunLabel} is jammed — clear it first.` });
    if (ammo <= 0)
      return res.status(409).json({ ok: false, message: "Out of ammo — reload." });

    // The round is spent whether or not it connects (or jams).
    updateGunAmmo(req.userId, type, -1, 0);
    if (Math.random() * 100 < SHOT_WEAR_CHANCE) {
      const worn = adjustGunCondition(req.userId, type, -SHOT_WEAR_AMOUNT);
      log("INFO", `${req.user} ${gunLabel} condition wore to ${worn}`, game_config);
    }

    // Jam roll — worn guns misfeed. The stuck round is lost; the gun is out of
    // action until the player clears it (Unjam costs a clip).
    const jamChance = (100 - gunCondition) * JAM_FACTOR;
    if (Math.random() * 100 < jamChance) {
      setGunJammed(req.userId, type, true);
      insertEvent("shoot", `Your ${gunLabel} jammed!`, "private", req.userId);
      log("INFO", `${req.user} ${gunLabel} jammed (cond=${gunCondition} chance=${jamChance.toFixed(1)}%)`, game_config);
      return res.json({ ok: true, result: "jam", message: `The ${gunLabel} jammed! Clear it to keep shooting.` });
    }

    const hitChance = computeHitChance(player, behavior, gunCondition);
    const roll = Math.random() * 100;
    if (roll >= hitChance) {
      insertEvent("shoot", `You fired the ${gunLabel} and missed`, "private", req.userId);
      log("INFO", `${req.user} shoot ${gunLabel} roll=${roll.toFixed(1)} chance=${hitChance} -> miss`, game_config);
      return res.json({ ok: true, result: "miss", message: "Missed!" });
    }
    let targets = behavior.maxTargets;
    if (type === "shotgun") targets = shotgunTargets(player, gunCondition);
    else if (type === "rifle" && riflePierces(player, gameState.horde_size)) {
      targets = 2;
      pierced = true;
    }
    killed = Math.min(targets, gameState.horde_size);
  }

  // ---- Kill resolution (shared) ----
  const hordeBefore = gameState.horde_size;
  const hordeAfter = hordeBefore - killed;
  const wasRaiding = gameState.raid_enabled === "true";

  updatePlayerStats(req.userId, XP_PER_KILL * killed, killed);
  updatePlayerGold(req.userId, GOLD_PER_KILL * killed);
  adjustHordeSize(-killed);
  const noun = killed === 1 ? "a zombie" : `${killed} zombies`;
  const pierceTag = pierced ? " — the round went clean through" : "";
  insertEvent("kill", `${req.user} dropped ${noun} with the ${gunLabel}${pierceTag} (+${XP_PER_KILL * killed} XP, +${GOLD_PER_KILL * killed} gold)`, "public", "global");

  // ---- Tokens for stopping a horde/raid (raid takes precedence) ----
  let bonus = "";
  if (wasRaiding && hordeAfter <= 0) {
    addTokens(req.userId, 3);
    setRaidEnabled(false);
    insertEvent("system", `${req.user} ended the raid! (+3 tokens)`, "public", "global");
    bonus = " Raid ended — +3 tokens!";
  } else if (!wasRaiding && hordeBefore >= zombie_config.z_horde && hordeAfter < zombie_config.z_horde) {
    addTokens(req.userId, 1);
    insertEvent("system", `${req.user} broke the horde (+1 token)`, "public", "global");
    bonus = " Horde broken — +1 token!";
  }

  // ---- Golden Gun depletion ----
  let goldenNote = "";
  if (golden) {
    if (goldenRemaining <= 0) {
      goldenNote = ` Golden Gun spent — back to your ${equippedGunName(player)}.`;
      insertEvent("item", `Your Golden Gun is spent — back to the ${equippedGunName(player)}.`, "private", req.userId);
    } else {
      goldenNote = ` (${goldenRemaining} golden shots left)`;
    }
  }

  log("INFO", `${req.user} shoot ${gunLabel} -> hit x${killed}${golden ? ` golden(${goldenRemaining} left)` : ""}`, game_config);
  const base = pierced ? "Clean through — 2 zombies down!" : killed > 1 ? `Hit — ${killed} zombies down!` : "Hit — zombie down!";
  return res.json({ ok: true, result: "hit", killed, golden, message: base + bonus + goldenNote });
});

app.post("/api/action/reload", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const gunName = equippedGunName(player);
  const type = equippedType(player);

  const result = reloadGun(req.userId, type);
  if (!result.ok) {
    const message =
      result.reason === "jammed" ? `The ${gunName} is jammed — use Unjam.` :
      result.reason === "no_clips" ? "No clips left to reload." : "Already fully loaded.";
    return res.status(409).json({ ok: false, message });
  }
  
  insertEvent("reload", `You reloaded the ${gunName}`, "private", req.userId);
  log("INFO", `${req.user} reloaded ${gunName}`, game_config);
  return res.json({ ok: true, message: "Reloaded." });
});

// Clear a jammed gun: ejects the stuck clip and loads a fresh one — costs 1
// clip and refills ammo (see unjamGun in db.js). Jams are per gun type.
app.post("/api/action/unjam", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const gunName = equippedGunName(player);
  const type = equippedType(player);

  const result = unjamGun(req.userId, type);
  if (!result.ok) {
    const message = result.reason === "not_jammed"
      ? `The ${gunName} isn't jammed.`
      : "No clips left — clearing the jam takes a fresh clip or a single bullet if not empty.";
    return res.status(409).json({ ok: false, message });
  }
  const message =
  result.method === "clip"
    ? "Jam cleared — fresh clip loaded."
    : "Jam cleared — 1 round was used to clear the jam.";
  insertEvent("reload", `You cleared the jam on the ${gunName}`, "private", req.userId);
  log("INFO", `${req.user} unjammed ${gunName}`, game_config);
  return res.json({ ok: true, message });
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
// The shop lists every registry item with a `shop` block (item_backbone.js).
// Tools are one-time purchases: owned ones are flagged so the UI shows "Owned".
app.get("/api/shop", requireAuth, (req, res) => {
  const owned = new Set(getInventory(req.userId).filter((i) => i.quantity > 0).map((i) => i.item_name));
  res.json(Object.entries(ITEMS)
    .filter(([, item]) => item.shop)
    .map(([key, item]) => ({
      key, name: item.name, desc: item.desc, type: item.type,
      cost: item.shop.cost, currency: item.shop.currency || "gold",
      owned: item.type === "tool" && owned.has(key),
    })));
});

// Buy one unit of a registry shop item. Body: item_name = the ITEMS key.
app.post("/api/shop/buy", requireAuth, (req, res) => {
  const itemName = String(req.body.item_name || "").trim();
  const item = ITEMS[itemName];
  if (!item?.shop)
    return res.status(400).json({ ok: false, message: "That item isn't in the shop." });

  // Tools are one-time buys — owning one blocks a re-purchase (same rule as
  // the gun unlocks in the upgrades shop).
  if (item.type === "tool") {
    const alreadyOwned = getInventory(req.userId).some((i) => i.item_name === itemName && i.quantity > 0);
    if (alreadyOwned) return res.status(409).json({ ok: false, message: `You already own a ${item.name}.` });
  }

  const currency = item.shop.currency || "gold";
  const result = purchaseItem(req.userId, itemName, item.shop.cost, currency);
  if (!result.ok) {
    const message = result.reason === "insufficient_funds"
      ? `Not enough ${currency === "token" ? "tokens" : "gold"} — need ${result.cost}, you have ${result.have}.`
      : "Purchase failed.";
    return res.status(409).json({ ok: false, message });
  }

  insertEvent("shop", `You bought ${item.name}`, "private", req.userId);
  log("INFO", `${req.user} bought ${itemName} for ${item.shop.cost} ${currency} (${result.left} left)`, game_config);
  return res.json({ ok: true, message: `Bought ${item.name}.` });
});

// Static upgrades catalogue (hardcoded stat items, consumables, and one-time
// gun unlocks). 'gun' upgrades carry an `owned` flag so the UI can mark them.
app.get("/api/shop/upgrades", requireAuth, (req, res) => {
  const owned = new Set(getInventory(req.userId).filter((i) => i.quantity > 0).map((i) => i.item_name));
  res.json(STATIC_UPGRADES.map(({ key, label, desc, cost, type, item, currency, category }) => ({
    key, label, desc, cost, type,
    currency: currency || "gold",
    category: category || "upgrade",
    owned: type === "gun" ? owned.has(item) : false,
  })));
});

app.post("/api/shop/upgrades/buy", requireAuth, (req, res) => {
  const upgrade = STATIC_UPGRADES.find((u) => u.key === String(req.body.key || ""));
  if (!upgrade) return res.status(400).json({ ok: false, message: "Unknown upgrade." });

  const player = ensurePlayer(req.userId);
  const currency = upgrade.currency || "gold";

  // One-time gun unlocks can't be bought twice.
  if (upgrade.type === "gun") {
    const alreadyOwned = getInventory(req.userId).some((i) => i.item_name === upgrade.item && i.quantity > 0);
    if (alreadyOwned) return res.status(409).json({ ok: false, message: `You already own the ${upgrade.item}.` });
  }

  // Charge the right currency (gold or horde tokens).
  if (currency === "token") {
    if (player.horde_tokens < upgrade.cost)
      return res.status(409).json({ ok: false, message: `Not enough tokens — need ${upgrade.cost}, you have ${player.horde_tokens}.` });
    addTokens(req.userId, -upgrade.cost);
  } else {
    if (player.gold < upgrade.cost)
      return res.status(409).json({ ok: false, message: `Not enough gold — need ${upgrade.cost}, you have ${player.gold}.` });
    updatePlayerGold(req.userId, -upgrade.cost);
  }

  if (upgrade.type === "consumable" || upgrade.type === "gun") giveInventoryItem(req.userId, upgrade.item, 1);
  else upgrade.apply(req.userId, equippedType(player)); // stat/instant upgrades

  insertEvent("shop", upgrade.msg ? `You ${upgrade.msg.charAt(0).toLowerCase()}${upgrade.msg.slice(1)}` : `You bought ${upgrade.label}`, "private", req.userId);
  log("INFO", `${req.user} bought upgrade ${upgrade.key} for ${upgrade.cost} ${currency}`, game_config);
  return res.json({ ok: true, message: upgrade.msg ? `${upgrade.msg}.` : `Bought ${upgrade.label}.` });
});

// Player inventory: the full list (gun items flagged), the usable items with
// owned counts, and which gun is currently equipped.
app.get("/api/inventory", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const rawItems = getInventory(req.userId);
  const items = rawItems.map((i) => {
    const reg = ITEMS[i.item_name];
    return {
      ...i,
      isGun: Boolean(GUNS[i.item_name]),
      desc: reg?.desc ?? null,
      type: reg?.type ?? null,
      tier: reg?.tier ?? null,
      value: reg?.value ?? null,
      toolbag: Boolean(reg?.toolbag),
      usable: Boolean(reg?.use),
    };
  });
  const ownedQty = Object.fromEntries(rawItems.map((i) => [i.item_name, i.quantity]));
  // Usable = any registry item with a `use` block (owned or not — qty 0 rows
  // render greyed out so players can see what exists). `toolbag` marks the
  // quick-access combat consumables (Toolbag tab); the rest are Backpack food.
  const usable = Object.entries(ITEMS)
    .filter(([, item]) => item.use)
    .map(([name, item]) => ({
      name, label: item.name, desc: item.desc,
      toolbag: Boolean(item.toolbag),
      quantity: ownedQty[name] ?? 0,
    }));
  // Owned guns with their live per-gun stats (the stats live on the player
  // row, not the inventory row) — feeds the Backpack's Guns tab.
  const guns = Object.entries(GUNS)
    .filter(([name]) => (ownedQty[name] ?? 0) > 0)
    .map(([name, g]) => ({ name, equipped: equippedGunName(player) === name, ...gunAmmoOf(player, g.type) }));
  res.json({ items, usable, guns, equipped: equippedGunName(player) });
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

// Sell treasure for gold at registry value. Body: item, qty (number or "all").
app.post("/api/inventory/sell", requireAuth, (req, res) => {
  const itemName = String(req.body.item || "").trim();
  const item = ITEMS[itemName];
  if (!item || item.type !== "treasure")
    return res.status(400).json({ ok: false, message: "That can't be sold." });

  const rawQty = String(req.body.qty || "1").trim().toLowerCase();
  const qty = rawQty === "all" ? Infinity : Math.max(1, Math.round(Number(rawQty)) || 1);
  const r = sellItem(req.userId, itemName, qty, item.value || 0);
  if (!r.ok) return res.status(409).json({ ok: false, message: `You don't have any ${item.name} to sell.` });

  insertEvent("shop", `You sold ${r.sold}× ${item.name} for ${r.gold} gold`, "private", req.userId);
  log("INFO", `${req.user} sold ${r.sold}x ${itemName} for ${r.gold} gold`, game_config);
  return res.json({ ok: true, message: `Sold ${r.sold}× ${item.name} for ${r.gold} gold.` });
});

app.post("/api/inventory/use", requireAuth, (req, res) => {
  const itemName = String(req.body.item || "").trim();
  const item = ITEMS[itemName];
  if (!item?.use) return res.status(400).json({ ok: false, message: "That item can't be used." });

  const newQty = consumeInventoryItem(req.userId, itemName);
  if (newQty === null) return res.status(409).json({ ok: false, message: `You have no ${item.name} to use.` });

  const note = applyItemEffects(req.userId, item.use);
  insertEvent("item", `You used ${item.name} (${note})`, "private", req.userId);
  log("INFO", `${req.user} used ${itemName} (${newQty} left)`, game_config);
  return res.json({ ok: true, message: `Used ${item.name} — ${note}.`, quantity: newQty });
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
  if (!ZOMBIE_LOCATIONS.has(locationOf(ensurePlayer(req.userId))))
    return res.status(409).json({ ok: false, message: "It's quiet here — nothing answers your call." });
  if (getGameState().hunt_enabled !== "true")
    return res.status(409).json({ ok: false, message: "The hunt isn't active." });
  adjustHordeSize(1);
  insertEvent("spawn", `${req.user} called in a zombie`, "public", "global");
  log("INFO", `${req.user} manually called a zombie`, game_config);
  latchRaidIfNeeded(); // may cross into raid territory
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
  const bonusNote = r.bonus ? " (+5 accuracy, +5 max health)" : "";
  insertEvent("level", `You reached level ${target}!${bonusNote}`, "private", req.userId);
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
// Travel between world locations (the Map modal). Adjacency comes from
// LOCATION_LINKS in db.js; you can't consult the map from inside the base.
app.post("/api/travel", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const from = locationOf(player);
  if (from === "basecamp_inside")
    return res.status(409).json({ ok: false, message: "You can't travel from inside the base — go outside first." });

  const to = String(req.body.to || "");
  if (!LOCATION_NAMES[to] || to === "basecamp_inside")
    return res.status(400).json({ ok: false, message: "Unknown destination." });
  if (to === from)
    return res.status(409).json({ ok: false, message: `You're already at ${LOCATION_NAMES[to]}.` });
  if (!(LOCATION_LINKS[from] || []).includes(to))
    return res.status(409).json({ ok: false, message: `You can't reach ${LOCATION_NAMES[to]} from ${LOCATION_NAMES[from]}.` });

  updatePlayerLocation(req.userId, to);
  insertEvent("travel", `You traveled to ${LOCATION_NAMES[to]}`, "private", req.userId);
  log("INFO", `${req.user} traveled ${from} -> ${to}`, game_config);
  return res.json({ ok: true, message: `You arrive at ${LOCATION_NAMES[to]}.` });
});

// Run a location action. Guards mirror the flags the page shows (skill level,
// required tool, one action at a time); the result rolls when the timer ends.
app.post("/api/action/do", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const locKey = locationOf(player);
  const action = (LOCATION_ACTIONS[locKey] || []).find((a) => a.key === String(req.body.key || ""));
  if (!action) return res.status(400).json({ ok: false, message: "You can't do that here." });

  const busy = busyUntilOf(req.userId);
  if (busy) return res.status(409).json({ ok: false, message: `You're busy for another ${Math.ceil((busy - Date.now()) / 1000)}s.` });
  if (player[`s_${action.skill}_lvl`] < action.skillLevel)
    return res.status(409).json({ ok: false, message: `Requires ${SKILL_NAMES[action.skill]} level ${action.skillLevel}.` });
  if (action.requires) {
    const owned = getInventory(req.userId).some((i) => i.item_name === action.requires && i.quantity > 0);
    if (!owned) return res.status(409).json({ ok: false, message: `You need a ${action.requires} for that.` });
  }

  const until = Date.now() + action.timer * 1000;
  ACTION_BUSY.set(req.userId, { until, key: action.key });
  const username = req.user;
  const userId = req.userId;
  setTimeout(() => {
    ACTION_BUSY.delete(userId);
    const success = Math.random() * 100 < action.successRate;
    if (success) {
      giveInventoryItem(userId, action.grants, 1);
      const total = addSkillXp(userId, action.skill, action.xp);
      // Foraging/woodcutting bonus: roll the RANDOM_DROPS treasure table
      // (first entry to pass its chance wins; one drop max per action).
      let dropNote = "";
      if (action.drops) {
        const drop = RANDOM_DROPS.find((d) => Math.random() * 100 < d.chance);
        if (drop) {
          giveInventoryItem(userId, drop.key, 1);
          dropNote = ` …and found a ${drop.name}!`;
          log("INFO", `${username} ${action.key} bonus drop: ${drop.key}`, game_config);
        }
      }
      insertEvent("action", `${action.label}: success! +1 ${action.grants}, +${action.xp} ${SKILL_NAMES[action.skill]} XP${dropNote}`, "private", userId);
      log("INFO", `${username} ${action.key} success (+1 ${action.grants}, ${action.skill} xp -> ${total})`, game_config);
    } else {
      insertEvent("action", `${action.label}: no luck this time.`, "private", userId);
      log("INFO", `${username} ${action.key} failed the ${action.successRate}% roll`, game_config);
    }
  }, action.timer * 1000);

  insertEvent("action", `You started: ${action.label} (${action.timer}s)`, "private", req.userId);
  log("INFO", `${username} started action ${action.key} at ${locKey} (${action.timer}s)`, game_config);
  return res.json({ ok: true, message: `${action.label} — ${action.timer}s…`, busyUntil: until });
});

// ----- Adventure Panel: campfire, cooking/crafting, meditation -----

// Build a campfire: consumes firewood, burns for CAMPFIRE_BURN_SECONDS,
// enabling campfire-station recipes (Cook Food).
app.post("/api/campfire", requireAuth, (req, res) => {
  const left = campfireUntilOf(req.userId);
  if (left) return res.status(409).json({ ok: false, message: `Your campfire is already burning (${Math.ceil((left - Date.now()) / 1000)}s left).` });

  const r = consumeItems(req.userId, { firewood: CAMPFIRE_COST });
  if (!r.ok) return res.status(409).json({ ok: false, message: `You need ${CAMPFIRE_COST} firewood to build a campfire.` });

  const until = Date.now() + CAMPFIRE_BURN_SECONDS * 1000;
  CAMPFIRES.set(req.userId, until);
  insertEvent("action", `You built a campfire (burns ${Math.round(CAMPFIRE_BURN_SECONDS / 60)}m)`, "private", req.userId);
  log("INFO", `${req.user} built a campfire`, game_config);
  return res.json({ ok: true, message: "Campfire crackling — time to cook.", campfireUntil: until });
});

// Put the campfire out early (no firewood refund — it's burnt).
app.post("/api/campfire/out", requireAuth, (req, res) => {
  if (!campfireUntilOf(req.userId))
    return res.status(409).json({ ok: false, message: "You don't have a campfire burning." });
  CAMPFIRES.delete(req.userId);
  insertEvent("action", "You put out your campfire", "private", req.userId);
  log("INFO", `${req.user} put out their campfire`, game_config);
  return res.json({ ok: true, message: "Campfire doused." });
});

// The recipe list, annotated for THIS player: skill/station/inputs readiness.
app.get("/api/craft", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const locKey = locationOf(player);
  const owned = Object.fromEntries(getInventory(req.userId).map((i) => [i.item_name, i.quantity]));
  res.json(RECIPES.map((r) => ({
    key: r.key, label: r.label, skill: r.skill, skillName: SKILL_NAMES[r.skill],
    level: r.level, station: r.station ?? null, requires: r.requires ?? null,
    inputs: r.inputs, output: r.output, xp: r.xp, timer: r.timer,
    lvlOk: player[`s_${r.skill}_lvl`] >= r.level,
    stationOk: stationOk(req.userId, locKey, r.station),
    toolOk: !r.requires || (owned[r.requires] ?? 0) > 0,
    inputsOk: Object.entries(r.inputs).every(([item, qty]) => (owned[item] ?? 0) >= qty),
  })));
});

// Craft a recipe: inputs are consumed up front (committed once started, like a
// spent round); the output + skill XP land when the timer resolves.
app.post("/api/craft", requireAuth, (req, res) => {
  const recipe = RECIPES.find((r) => r.key === String(req.body.key || ""));
  if (!recipe) return res.status(400).json({ ok: false, message: "Unknown recipe." });

  const player = ensurePlayer(req.userId);
  const locKey = locationOf(player);
  const busy = busyUntilOf(req.userId);
  if (busy) return res.status(409).json({ ok: false, message: `You're busy for another ${Math.ceil((busy - Date.now()) / 1000)}s.` });
  if (player[`s_${recipe.skill}_lvl`] < recipe.level)
    return res.status(409).json({ ok: false, message: `Requires ${SKILL_NAMES[recipe.skill]} level ${recipe.level}.` });
  if (!stationOk(req.userId, locKey, recipe.station))
    return res.status(409).json({ ok: false, message: STATION_MESSAGES[recipe.station] || "You can't craft that here." });
  if (recipe.requires) {
    const hasTool = getInventory(req.userId).some((i) => i.item_name === recipe.requires && i.quantity > 0);
    if (!hasTool) return res.status(409).json({ ok: false, message: `You need a ${recipe.requires} for that.` });
  }
  const consumed = consumeItems(req.userId, recipe.inputs);
  if (!consumed.ok)
    return res.status(409).json({ ok: false, message: `Missing ingredients: ${consumed.missing.join(", ")}.` });

  const until = Date.now() + recipe.timer * 1000;
  ACTION_BUSY.set(req.userId, { until, key: recipe.key });
  const userId = req.userId, username = req.user;
  setTimeout(() => {
    ACTION_BUSY.delete(userId);
    giveInventoryItem(userId, recipe.output, 1);
    addSkillXp(userId, recipe.skill, recipe.xp);
    insertEvent("action", `${recipe.label}: done! +1 ${recipe.output}, +${recipe.xp} ${SKILL_NAMES[recipe.skill]} XP`, "private", userId);
    log("INFO", `${username} crafted ${recipe.key} (+1 ${recipe.output})`, game_config);
  }, recipe.timer * 1000);

  insertEvent("action", `You started: ${recipe.label} (${recipe.timer}s)`, "private", req.userId);
  log("INFO", `${username} started craft ${recipe.key} (${recipe.timer}s)`, game_config);
  return res.json({ ok: true, message: `${recipe.label} — ${recipe.timer}s…`, busyUntil: until });
});

// Meditate on Magical Theory: a safe-zone timed action granting magic XP.
app.post("/api/meditate", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  if (ZOMBIE_LOCATIONS.has(locationOf(player)))
    return res.status(409).json({ ok: false, message: "Too dangerous to meditate here." });
  const busy = busyUntilOf(req.userId);
  if (busy) return res.status(409).json({ ok: false, message: `You're busy for another ${Math.ceil((busy - Date.now()) / 1000)}s.` });

  const until = Date.now() + MEDITATE_SECONDS * 1000;
  ACTION_BUSY.set(req.userId, { until, key: "meditate" });
  const userId = req.userId, username = req.user;
  setTimeout(() => {
    ACTION_BUSY.delete(userId);
    addSkillXp(userId, "magic", MEDITATE_XP);
    insertEvent("action", `Meditation complete — +${MEDITATE_XP} Magic XP`, "private", userId);
    log("INFO", `${username} meditated (+${MEDITATE_XP} magic xp)`, game_config);
  }, MEDITATE_SECONDS * 1000);

  insertEvent("action", `You sit and meditate on magical theory (${MEDITATE_SECONDS}s)`, "private", req.userId);
  return res.json({ ok: true, message: `Meditating — ${MEDITATE_SECONDS}s…`, busyUntil: until });
});

// Buy the next level of one skill with MAIN player XP (skills also
// auto-level from their own training XP — see addSkillXp in db.js).
app.post("/api/skill/up", requireAuth, (req, res) => {
  const skill = String(req.body.skill || "");
  if (!SKILLS.includes(skill)) return res.status(400).json({ ok: false, message: "Unknown skill." });

  const r = buySkillLevel(req.userId, skill);
  if (!r.ok) return res.status(409).json({ ok: false, message: `Not enough XP — the next ${SKILL_NAMES[skill]} level costs ${r.cost ?? "?"}.` });

  insertEvent("level", `Your ${SKILL_NAMES[skill]} reached level ${r.level} (bought for ${r.cost} XP)`, "private", req.userId);
  log("INFO", `${req.user} bought ${skill} level ${r.level} for ${r.cost} xp`, game_config);
  return res.json({ ok: true, message: `${SKILL_NAMES[skill]} is now level ${r.level} (−${r.cost} XP).` });
});

app.post("/api/base/toggle", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const locKey = locationOf(player);
  const goingInside = locKey !== "basecamp_inside";
  if (goingInside && locKey !== "basecamp_outside")
    return res.status(409).json({ ok: false, message: "You need to be at Basecamp to enter the base." });
  if (goingInside && baseIsDestroyed(getGameState()))
    return res.status(409).json({ ok: false, message: "The base is destroyed — you can't go inside." });

  updatePlayerLocation(req.userId, goingInside ? "basecamp_inside" : "basecamp_outside");
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

// ==================== Web admin panel API ====================
// All routes are admin-only. Mirrors the users/players Admin CLI groups; the
// item catalogue is read-only (items are code in item_backbone.js).
const adminReq = [requireAuth, requireAdmin];
const uidOf = (username) => getUserIdByName(String(username || "").trim())?.id ?? null;

// --- Users ---
app.get("/api/admin/users", adminReq, (req, res) => {
  // Enriched for the panel's player list: display location + online flag.
  const cutoff = Date.now() - game_config.timeout * 1000;
  res.json(listUsers().map((u) => ({
    ...u,
    locationName: LOCATION_NAMES[u.location] ? LOCATION_NAMES[u.location] : "Basecamp",
    online: (u.last_seen ?? 0) >= cutoff,
  })));
});

app.post("/api/admin/users/add", adminReq, (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const admin = req.body.admin === "true" || req.body.admin === "1" || req.body.admin === "on";
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username))
    return res.status(400).json({ ok: false, message: "Username must be 3-20 letters/numbers/_." });
  if (getUserByName(username))
    return res.status(409).json({ ok: false, message: "Username taken." });

  const now = Date.now();
  const salt = password ? crypto.randomBytes(16).toString("hex") : "";
  const hash = password ? hashPassword(password, salt) : "";
  const info = insertUser(username, salt, hash, now);
  insertPlayer(info.lastInsertRowid, now);
  if (admin) setUserAdmin(info.lastInsertRowid, true);
  log("INFO", `${req.user} created user ${username} (admin=${admin})`, game_config);
  return res.json({ ok: true, message: `Created ${username}.` + (password ? "" : " (no password set)") });
});

app.post("/api/admin/users/delete", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  if (id === req.userId) return res.status(409).json({ ok: false, message: "You can't delete your own account." });
  deleteUserCascade(id);
  log("INFO", `${req.user} deleted user ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `Deleted ${req.body.username}.` });
});

app.post("/api/admin/users/password", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  const password = String(req.body.password || "");
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  if (!password) return res.status(400).json({ ok: false, message: "Password required." });
  const salt = crypto.randomBytes(16).toString("hex");
  setUserAuth(id, salt, hashPassword(password, salt));
  log("INFO", `${req.user} reset password for ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `Password updated for ${req.body.username}.` });
});

app.post("/api/admin/users/admin", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const makeAdmin = req.body.admin === "true" || req.body.admin === "1";
  if (id === req.userId && !makeAdmin) return res.status(409).json({ ok: false, message: "You can't revoke your own admin." });
  setUserAdmin(id, makeAdmin);
  log("INFO", `${req.user} set admin=${makeAdmin} for ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `${req.body.username} admin=${makeAdmin}.` });
});

// --- Players ---
app.get("/api/admin/player", adminReq, (req, res) => {
  const id = uidOf(req.query.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const player = getPlayerByUserId(id);
  const inventory = getInventory(id);
  // `max: 1` marks the boolean (0/1) stats — the panel renders those as a toggle.
  const stats = Object.keys(EDITABLE_STATS).map((f) => ({ field: f, value: player[f], max: EDITABLE_STATS[f].max ?? null }));
  const guns = GUN_NAMES.map((g) => ({
    name: g,
    owned: inventory.some((i) => i.item_name === g && i.quantity > 0),
    equipped: player.equipped_gun === g,
  }));
  const locKey = locationOf(player);
  res.json({
    ok: true, username: String(req.query.username), level: player.level,
    nextLevelCost: levelCost(nextLevelOf(player.level)),
    equippedGun: player.equipped_gun, stats, inventory, guns,
    location: locKey, locationName: LOCATION_NAMES[locKey],
    zombieZone: ZOMBIE_LOCATIONS.has(locKey),
    busyUntil: busyUntilOf(id), campfireUntil: campfireUntilOf(id),
    locations: Object.entries(LOCATION_NAMES).map(([key, name]) => ({ key, name })),
  });
});

// Teleport a player to any location (bypasses the travel graph — admin power).
app.post("/api/admin/player/location", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const to = String(req.body.location || "");
  if (!LOCATION_NAMES[to]) return res.status(400).json({ ok: false, message: "Unknown location." });
  updatePlayerLocation(id, to);
  log("INFO", `${req.user} moved ${req.body.username} to ${to}`, game_config);
  return res.json({ ok: true, message: `Moved ${req.body.username} to ${LOCATION_NAMES[to]}.` });
});

// --- World state (game_state + who's online, with live busy/campfire flags) ---
app.get("/api/admin/world", adminReq, (_req, res) => {
  const gs = getGameState();
  const cutoff = Date.now() - game_config.timeout * 1000;
  const online = getActivePlayers(cutoff).map((p) => {
    const lk = locationOf(p);
    return {
      username: p.username, location: lk, locationName: LOCATION_NAMES[lk],
      zombieZone: ZOMBIE_LOCATIONS.has(lk),
      busy: busyUntilOf(p.user_id) > 0, campfire: campfireUntilOf(p.user_id) > 0,
    };
  });
  res.json({
    ok: true,
    hunt: gs.hunt_enabled === "true",
    hordeSize: gs.horde_size,
    hordeStatus: hordeStatusOf(gs),
    raid: gs.raid_enabled === "true",
    base: { health: gs.base_health, max: game_config.baseMaxHealth, destroyed: baseIsDestroyed(gs) },
    online,
  });
});

// Set the horde to an absolute size (keeps the raid latch rules coherent:
// clearing to 0 ends a raid; growing may latch one on).
app.post("/api/admin/world/horde", adminReq, (req, res) => {
  const size = Math.round(Number(req.body.size));
  if (Number.isNaN(size) || size < 0) return res.status(400).json({ ok: false, message: "Numeric size >= 0 required." });
  const before = getGameState().horde_size;
  adjustHordeSize(size - before);
  if (size === 0) setRaidEnabled(false);
  else latchRaidIfNeeded();
  log("INFO", `${req.user} set horde_size ${before} -> ${size}`, game_config);
  return res.json({ ok: true, message: `Horde set to ${size}.` });
});

app.post("/api/admin/player/stat", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const r = setPlayerStat(id, String(req.body.field), req.body.value);
  if (!r.ok) return res.status(400).json({ ok: false, message: `Can't set ${req.body.field} (${r.reason}).` });
  log("INFO", `${req.user} set ${req.body.username}.${req.body.field}=${r.value}`, game_config);
  return res.json({ ok: true, message: `${req.body.field} = ${r.value}` + (r.clamped ? " (clamped)" : ""), value: r.value });
});

app.post("/api/admin/player/inventory/add", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const item = String(req.body.item || "").trim();
  if (!item) return res.status(400).json({ ok: false, message: "Item name required." });
  giveInventoryItem(id, item, Math.max(1, Number(req.body.qty) || 1));
  log("INFO", `${req.user} gave ${req.body.username} ${item} x${req.body.qty || 1}`, game_config);
  return res.json({ ok: true, message: `Added ${item} to ${req.body.username}.` });
});

app.post("/api/admin/player/inventory/remove", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const item = String(req.body.item || "").trim();
  const result = removeInventoryItem(id, item, req.body.qty);
  if (result === null) return res.status(409).json({ ok: false, message: `${req.body.username} doesn't have ${item}.` });
  log("INFO", `${req.user} removed ${item} from ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `Removed ${item} (${result} left).` });
});

app.post("/api/admin/player/level", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const steps = Math.trunc(Number(req.body.steps));
  if (!steps) return res.status(400).json({ ok: false, message: "steps must be a non-zero integer." });
  const newLevel = forceLevel(id, steps);
  log("INFO", `${req.user} force-leveled ${req.body.username} by ${steps} -> ${newLevel}`, game_config);
  return res.json({ ok: true, message: `${req.body.username} is now level ${newLevel}.`, level: newLevel });
});

app.post("/api/admin/player/equip", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const gun = String(req.body.gun || "");
  if (!GUN_NAMES.includes(gun)) return res.status(400).json({ ok: false, message: "Unknown gun." });
  const owned = getInventory(id).some((i) => i.item_name === gun && i.quantity > 0);
  const force = req.body.force === "true" || req.body.force === "1";
  if (!owned && !force) return res.status(409).json({ ok: false, message: `${req.body.username} doesn't own a ${gun} (use force).` });
  if (!owned) giveInventoryItem(id, gun, 1);
  updatePlayerGun(id, gun);
  log("INFO", `${req.user} equipped ${gun} on ${req.body.username}${owned ? "" : " (forced)"}`, game_config);
  return res.json({ ok: true, message: `Equipped ${gun}${owned ? "" : " (force-granted)"}.` });
});

// --- Item catalogue (read-only) ---
// Items live in item_backbone.js now, not an admin-editable table — the panel
// shows the registry + recipes for reference; editing means editing the file.
app.get("/api/admin/items", adminReq, (_req, res) => {
  res.json({
    types: ITEM_TYPES,
    items: Object.entries(ITEMS).map(([key, i]) => ({
      key, name: i.name, type: i.type, desc: i.desc, value: i.value ?? null,
      shop: i.shop ?? null, use: i.use ?? null, gunType: i.gunType ?? null,
    })),
    recipes: RECIPES,
  });
});

// Code-defined static upgrades (potions, boosters, gun unlocks, Golden Gun).
// Read-only — these live in server.js, not the DB, so they're shown for reference.
app.get("/api/admin/upgrades", adminReq, (req, res) => {
  res.json(STATIC_UPGRADES.map(({ key, label, desc, cost, type, currency, category }) => ({
    key, label, desc, cost, type, currency: currency || "gold", category: category || "upgrade",
  })));
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

    // 1) Spawn. A raid doubles the spawn chance.
    const spawnChance = gs.raid_enabled === "true" ? zombie_config.z_chance * 2 : zombie_config.z_chance;
    if (gs.hunt_enabled === "true" && Math.random() * 100 < spawnChance) {
      adjustHordeSize(1);
      insertEvent("spawn", "A zombie shambles into the area", "public", "global");
      log("INFO", `tick: spawned a zombie (horde ${gs.horde_size} -> ${gs.horde_size + 1})`, game_config);
      latchRaidIfNeeded(); // a spawn may push us into raid territory
    }

    // 2) Attack phase.
    gs = getGameState();
    const z = gs.horde_size;
    if (z <= 0) { if (gs.raid_enabled === "true") setRaidEnabled(false); return; }

    const raiding = gs.raid_enabled === "true";
    if (gs.hunt_enabled !== "true" && !raiding) return; // paused unless a raid is ongoing

    const cutoff = Date.now() - game_config.timeout * 1000;
    // Zombies only reach players in zombie-pool locations; everyone else is
    // in a safe area and sits this tick out entirely.
    const active = getActivePlayers(cutoff).filter((p) => ZOMBIE_LOCATIONS.has(locationOf(p)));
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
      if (pl.location === "basecamp_inside" && insideAbsorbed < 500) {
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
      if (newBase > 0) {
        // World event so everyone sees the base under attack.
        insertEvent("attack", `The base was attacked for ${baseDamage} (${newBase}/${game_config.baseMaxHealth} HP)`, "public", "global");
      } else {
        setBaseDestroyedAt(Date.now());
        setRaidEnabled(false);
        for (const ins of getPlayersByLocation("basecamp_inside")) {
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
  `Startup: zboe2 ${app_version} mode=${runMode()} proto=${ssl_config.enabled ? "https" : "http"} debugLevel=${game_config.debugLevel} tick=${zombie_config.z_tic}s timeout=${game_config.timeout}s`;
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

// --mock-db: seed a starter dev DB — 3 users (1 admin) with random 5-char
// passwords, printed straight to the console (never written to the log file).
// Idempotent: existing users are skipped.
function seedMockDb() {
  const charset = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous chars
  const randPass = () => Array.from({ length: 5 }, () => charset[Math.floor(Math.random() * charset.length)]).join("");
  const specs = [
    { username: "admin",   admin: true },
    { username: "player1", admin: false },
    { username: "player2", admin: false },
  ];
  const now = Date.now();
  const created = [];
  for (const s of specs) {
    if (getUserByName(s.username)) continue;
    const password = randPass();
    const salt = crypto.randomBytes(16).toString("hex");
    const info = insertUser(s.username, salt, hashPassword(password, salt), now);
    insertPlayer(info.lastInsertRowid, now);
    if (s.admin) setUserAdmin(info.lastInsertRowid, true);
    created.push({ ...s, password });
  }
  // Console only — credentials are never sent through log()/the log file.
  if (!created.length) { console.log(paint("yellow", "--mock-db: those users already exist; nothing seeded.")); return; }
  console.log(paint(["bold", "cyan"], "=== Mock dev users (shown once, not logged) ==="));
  for (const c of created) console.log(paint("cyan", `  ${c.username.padEnd(9)} pass: ${c.password}${c.admin ? "   [admin]" : ""}`));
}

if (game_config.mockDb && !process.env.ZBOE_DAEMON) seedMockDb();

const PORT = process.env.PORT || 3000;

// ----- HTTPS (ssl_config in config.js) -----
// With ssl_config.enabled, the app serves TLS directly using the configured
// cert/key (and every cookie above carries Secure). Misconfiguration is fatal:
// an explicit enabled=true with unreadable files should never silently fall
// back to plain HTTP.
const PROTO = ssl_config.enabled ? "https" : "http";
const sslPath = (f) => (path.isAbsolute(f) ? f : path.join(__dirname, f));
function readSslCreds() {
  try {
    return {
      key: fs.readFileSync(sslPath(ssl_config.keyFile)),
      cert: fs.readFileSync(sslPath(ssl_config.certFile)),
    };
  } catch (e) {
    console.error(paint(["bold", "red"], `FATAL: ssl_config.enabled is true but the cert/key can't be read: ${e.message}`, process.stderr));
    log("FATAL", `SSL enabled but cert/key unreadable: ${e.message}`, game_config); // exits
  }
}

// Foreground vs background: --verbose keeps us in the foreground as a live output
// console. Without it, re-spawn ourselves detached, print a couple of lines + the
// child's pid, and release the terminal. ZBOE_DAEMON marks the child so it doesn't
// re-fork; the child then runs the server normally (logging to the file).
if (!game_config.verbose && !process.env.ZBOE_DAEMON) {
  // Validate the SSL files BEFORE forking — the detached child would otherwise
  // die silently (its FATAL only reaches the log file).
  if (ssl_config.enabled) readSslCreds();

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

  console.log(paint(["bold", "green"], `ZBOE web starting on ${PROTO}://localhost:${PORT}`));
  console.log(paint("cyan", startupSummaryLine()));
  const warn = timeoutWarnLine();
  if (warn) console.warn(paint(["bold", "yellow"], warn, process.stderr));
  console.log(paint("dim", `Forked to background — pid ${child.pid} · logs: ${LOG_FILE} · stop with: node server.js --stop`));
  process.exit(0);
}

const server = ssl_config.enabled ? https.createServer(readSslCreds(), app) : http.createServer(app);
server.listen(PORT, () => {
  console.log(paint(["bold", "green"], `ZBOE web running on ${PROTO}://localhost:${PORT}`));
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
