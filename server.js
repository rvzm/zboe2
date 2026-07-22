// zboe2
// Zombie Biohazard Outbreak Experiment 2
// Version: see app_version in config.js
import {
  getUserByName, getUserIdByName, getPlayerByUserId, isUserAdmin,
  getLeaderboard, getRecentEvents, clearFeedEvents,
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
  getInventory, giveInventoryItem, consumeInventoryItem, getItemOwners, giveItemToPlayers,
  gunAmmoOf, updateGunAmmo, reloadGun, updateGunMaxAmmo, updateGunMaxClips,
  adjustGunCondition, getActivePlayers, damagePlayer,
  applyLevelUp, resetPlayer, getPlayersByLocation, getPlayersNotAtLocation, getLocationCount, setForgeFired, setBeaconFired,
  equipArmorPiece, adjustArmorCondition, setArcaneTableActive,
  adjustRepairKits, setSentryUntil,
  setRaidEnabled, adjustBaseHealth, setBaseDestroyedAt, resetGameState,
  recordNukeVote, getNukeVoterIds, clearNukeVotes,
  GUN_NAMES, GUN_TYPES,
  listUsers, setUserAdmin, setUserAuth, deleteUserCascade,
  setAdmFun, setChatFlag, banUser, unbanUser, exileUser, unexileUser,
  recordFailedLogin, resetFailedLogin,
  getAuthRecord, setUserSession, setUserLoggedOut, SESSION_LOGGED_OUT,
  EDITABLE_STATS, setPlayerStat, removeInventoryItem, consumeItems, sellItem,
  nextLevelOf, levelCost, forceLevel,
  addShield, increaseMaxShield, healPlayer, addTokens, addMana,
  getPlayerMagic, knowsSpell, learnSpell,
  grantGoldenShots, useGoldenShot,
  ensureDbStamp, rotateDbStamp, hasProvenanceColumns, getLeaderboardRank,
  checkQuestTriggers, recordQuestProgress, setActiveQuest,
} from "./db.js";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";
import { styleText } from "node:util";
import { game_config, file_config, zombie_config, ssl_config, app_version, account_config } from "./config.js";
import https from "node:https";
import http from "node:http";
import { ITEMS, RECIPES, ITEM_TYPES, RANDOM_DROPS, BONUS_DROPS, SUPPLY_DROP_ROLL, SMELT_TYPES, ARMOR_PIECES } from "./item_backbone.js";
import {
  MAGIC_SPELLS, MAGIC_SPELL_CATEGORIES, validateMagicSpells,
  SPELL_ARMOR_BUFFS, SPELL_ARMOR_BUFF_SECONDS, spellApOf,
  MEDITATE_SECONDS, MEDITATE_XP,
} from "./magic.js";
import { QUESTS, QUEST_NAMES, QUEST_OBJECTIVE_TYPES } from "./quest_backbone.js";

// Colorize text for a given stream only when that stream actually supports color.
// util.styleText no-ops to plain text for non-TTYs, pipes/redirects, and when
// NO_COLOR is set — so callers never have to check whether color is available.
// The try/catch keeps us safe on older Node or an unknown format name.
function paint(format, text, stream = process.stdout) {
  try { return styleText(format, text, { stream }); }
  catch { return text; }
}

// A ban duration in whole seconds, formatted for humans (moderation log
// lines, the default ban-reason template) — "24h", "90m", "5s", "3d".
function formatDuration(seconds) {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
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
const CONFIG_GROUPS = { file_config, game_config, zombie_config, ssl_config, account_config };

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

// ----- Dev-only flags -----
// Cheats/conveniences for dev runs. Parsed like any other option (entries
// carry `dev: true` below) but REFUSED without --dev — the post-parse check
// exits with a FATAL pointing at `--dev -h`, which lists them.
const DEV_FLAGS = {
  fastTimers: false,    // -t: every action/craft/meditation timer runs at 3s
  stealthAdmins: false, // -s: admins log in hidden; the tick can't see or hurt them
  adminRegs: false,     // -a: every new registration is created as an admin
  hordeRefill: false,   // -H: refill the horde to z_horde whenever it drops below
  raidRefill: false,    // -r: refill the horde to z_raid whenever it drops below
  zombieCap: 0,         // -z N: hard cap on tick spawns/call-zombie/refills (0 = off)
};
const devFlagsUsed = []; // which dev flags this invocation passed (for the no---dev FATAL)
// -t: every busy timer (location actions, crafts, meditation) runs at 3s.
const devTimerOf = (seconds) => (DEV_FLAGS.fastTimers ? 3 : seconds);

// Declarative option table — add/remove/edit a flag by editing this array.
// `dev: true` rows are the dev-only flags (grouped separately in -h, refused
// without --dev); `takesValue: true` rows get the next argv token (or the
// part after '=') as apply()'s second argument.
const CLI_OPTIONS = [
  { test: (a) => a === "--dev",                    apply: () => { game_config.dev = true; },        help: "--dev                  dev mode (log to file)" },
  { test: (a) => a === "--production",             apply: () => { game_config.production = true; }, help: "--production           production mode" },
  { test: (a) => a === "-v" || a === "--verbose",  apply: () => { game_config.verbose = true; },    help: "-v, --verbose          stay in foreground as a live console (else run in background)" },
  { test: (a) => a.startsWith("--debug-level="),   apply: (a) => { game_config.debugLevel = a.split("=")[1]; }, help: "--debug-level=LEVEL    FULL|INFO|WARN|ERROR|FATAL" },
  { test: (a) => a.startsWith("--debug="),         apply: (a) => { game_config.debugLevel = a.split("=")[1]; }, help: "--debug=LEVEL          alias for --debug-level" },
  { test: (a) => a === "--stop",                   apply: () => stopDaemon(),                       help: "--stop                 stop a backgrounded server (via its PID file)" },
  { test: (a) => a === "--mock-db",                apply: () => { game_config.mockDb = true; },     help: "--mock-db              seed a starter dev DB (3 users, 1 admin) with random passwords" },
  { test: (a) => a === "--rotate-keys",            apply: () => { game_config.rotateKeys = true; }, help: "--rotate-keys          re-key the DB provenance stamp to the current secret+filename, then exit" },
  { test: (a) => a === "-h" || a === "--help",     apply: () => { printHelp(); process.exit(0); },  help: "-h, --help             show this help and exit (with --dev: includes the dev flags)" },
  // Dev-only flags (require --dev; `--dev -h` lists them):
  { dev: true, test: (a) => a === "-t", help: "-t                     every action/craft/meditation timer runs at 3s",
    apply: () => { DEV_FLAGS.fastTimers = true; devFlagsUsed.push("-t"); } },
  { dev: true, test: (a) => a === "-s", help: "-s                     stealth admins: hidden on login, immune to zombie damage/detection",
    apply: () => { DEV_FLAGS.stealthAdmins = true; devFlagsUsed.push("-s"); } },
  { dev: true, test: (a) => a === "-d", help: "-d                     shorthand for --verbose --debug-level=INFO",
    apply: () => { game_config.verbose = true; game_config.debugLevel = "INFO"; devFlagsUsed.push("-d"); } },
  { dev: true, test: (a) => a === "-a", help: "-a                     every new registration is created as an admin",
    apply: () => { DEV_FLAGS.adminRegs = true; devFlagsUsed.push("-a"); } },
  { dev: true, test: (a) => a === "-H", help: "-H                     refill the horde to z_horde whenever it drops below (keeps a hunt rolling)",
    apply: () => { DEV_FLAGS.hordeRefill = true; devFlagsUsed.push("-H"); } },
  { dev: true, test: (a) => a === "-r", help: "-r                     refill the horde to z_raid whenever it drops below (keeps a raid rolling)",
    apply: () => { DEV_FLAGS.raidRefill = true; devFlagsUsed.push("-r"); } },
  { dev: true, takesValue: true, test: (a) => a === "-z" || a.startsWith("-z="),
    help: "-z N                   hard zombie cap: tick spawns/call-zombie/refills never push the horde above N",
    apply: (_a, v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) { console.error(`ERROR: -z needs a positive whole number (got '${v ?? ""}')`); process.exit(1); }
      DEV_FLAGS.zombieCap = n;
      devFlagsUsed.push("-z");
    } },
];

function printHelp() {
  console.log(`zboe2 ${app_version}`);
  console.log("Usage: node server.js [options]\n\nOptions:");
  for (const opt of CLI_OPTIONS.filter((o) => !o.dev)) console.log("  " + opt.help);
  console.log("  --set group.key=value  override a config value for this run (repeatable)");
  console.log("  --group.key=value      shorthand for --set (also accepts a bare --key=value)\n");
  console.log("Config groups: " + Object.keys(CONFIG_GROUPS).join(", "));
  if (game_config.dev) {
    console.log("\nDev-only flags (usable because --dev):");
    for (const opt of CLI_OPTIONS.filter((o) => o.dev)) console.log("  " + opt.help);
  } else {
    console.log("\nDev-only flags exist — run 'node server.js --dev -h' to list them.");
  }
}

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];

  const known = CLI_OPTIONS.find((o) => o.test(arg));
  if (known) {
    const value = known.takesValue
      ? (arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i])
      : undefined;
    known.apply(arg, value);
    continue;
  }

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

// Dev flags are refused outright without --dev (same early-CLI exit style as
// the check above — log() isn't initialized this early).
if (devFlagsUsed.length && !game_config.dev) {
  const flags = [...new Set(devFlagsUsed)].join(", ");
  console.error(paint(["bold", "red"],
    `FATAL: ${flags} ${devFlagsUsed.length === 1 ? "is a dev-only flag" : "are dev-only flags"} — add --dev to use ${devFlagsUsed.length === 1 ? "it" : "them"}. Run 'node server.js --dev -h' to see all dev flags.`,
    process.stderr));
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

// Both the --rotate-keys action and the normal provenance check below need
// the session_key/session_id columns to actually exist — a DB that predates
// this feature would otherwise crash them with a raw SQLITE_ERROR. FATAL
// either way (dev or production): there's no reasonable "warn and continue"
// here, since every write this app makes to these four tables would fail.
if (!hasProvenanceColumns()) {
  const msg = "The live DB is missing the session_key/session_id provenance columns — run 'node util/index.mjs database update' (or, for a dev DB, delete data/zboe.sqlite* and let it rebuild) before starting.";
  const pcStamp = new Date().toISOString();
  console.error(paint(["bold", "red"], `FATAL: ${msg}`, process.stderr));
  fs.appendFileSync(LOG_FILE, `${pcStamp} [FATAL] - ${msg}\n`);
  process.exit(1);
}

// --rotate-keys: a one-shot maintenance action, not a normal boot — re-key
// the DB provenance stamp to the CURRENT sessionSecret + db filename (see
// --set above; a rotation is normally paired with rotating sessionSecret in
// config.js/--set first) across all four stamped tables, then exit. Always
// WARNs (both dev and production — unlike the mismatch check below, this
// isn't an anomaly, it's the requested action succeeding) rather than
// FATALing; if the DB's key already matches what this run would compute,
// there's nothing stale to rotate, so it warns that instead and leaves every
// row untouched.
if (game_config.rotateKeys) {
  const r = rotateDbStamp();
  const rkStamp = new Date().toISOString();
  if (r.status === "unchanged") {
    const msg = "DB provenance key already matches the current sessionSecret + filename — nothing to rotate.";
    console.warn(paint(["bold", "yellow"], `WARNING: ${msg}`, process.stderr));
    fs.appendFileSync(LOG_FILE, `${rkStamp} [WARN] - ${msg}\n`);
  } else {
    const msg = "Forcing DB Key rotation, re-keying database";
    console.warn(paint(["bold", "yellow"], `WARNING: ${msg}`, process.stderr));
    fs.appendFileSync(LOG_FILE, `${rkStamp} [WARN] - ${msg}\n`);
    const detail = `Re-keyed ${Object.values(r.counts).reduce((a, b) => a + b, 0)} row(s) — game_state=${r.counts.game_state}, player_inventory=${r.counts.player_inventory}, events=${r.counts.events}, nuke_votes=${r.counts.nuke_votes}.`;
    console.log(paint("cyan", detail));
    fs.appendFileSync(LOG_FILE, `${rkStamp} [INFO] - ${detail}\n`);
  }
  process.exit(0);
}

// DB provenance check: verify (or, on a never-stamped row, establish) this
// DB's stamp — see computeDbStamp/ensureDbStamp in db.js. Run here, AFTER the
// CLI --set overrides above have already been applied, so a run started with
// --set game_config.sessionSecret=... is checked/stamped against the actual
// secret this run is using, not config.js's unmodified default. A mismatch
// means either the secret or the db filename changed since this DB was last
// stamped (deliberate rotation — expected, but worth knowing), or the DB file
// isn't the one this deployment created (swapped in, or genuinely injected).
{
  const r = ensureDbStamp();
  const dbStamp = new Date().toISOString();
  if (r.status === "mismatch") {
    const msg = `DB provenance stamp mismatch — this DB was not stamped by the current sessionSecret + db filename (rotated secret/filename, or an unexpected DB file).`;
    if (game_config.dev) {
      console.warn(paint(["bold", "yellow"], `WARNING: ${msg}`, process.stderr));
      fs.appendFileSync(LOG_FILE, `${dbStamp} [WARN] - ${msg}\n`);
    } else {
      console.error(paint(["bold", "red"], `FATAL: ${msg}`, process.stderr));
      fs.appendFileSync(LOG_FILE, `${dbStamp} [FATAL] - ${msg}\n`);
      process.exit(1);
    }
  } else if (r.status === "stamped") {
    fs.appendFileSync(LOG_FILE, `${dbStamp} [INFO] - DB provenance stamp established (first run against this DB under the current sessionSecret + filename).\n`);
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

// Serve static files from /public. playercard.html (both no-?p= leaderboard
// mode and ?p=<user> card mode) is publicly viewable — express.static
// handles it like any other page; /api/playercard itself decides how much of
// a given player's data an anonymous viewer gets (see tryAuth there).
app.use(express.static(path.join(__dirname, "public")));

// Must run after requireAuth (needs req.userId). Rejects non-admins.
function requireAdmin(req, res, next) {
  if (!isUserAdmin(req.userId)) {
    log("WARN", `Admin-only action denied for ${req.user}`, game_config);
    return res.status(403).json({ ok: false, message: "Admin only." });
  }
  next();
}

// Same verification requireAuth does, but never redirects — for routes that
// serve a valid response either way and just want to know "is there a
// legitimately logged-in user here" (playercard.html's anonymous-vs-logged-in
// view). Returns { userId, username } or null. Deliberately a separate
// function rather than a requireAuth refactor — requireAuth's granular WARN
// logging (which specific check failed, for hijack detection) is worth
// keeping untouched rather than collapsing into a boolean.
function tryAuth(req) {
  const sess = getSession(req);
  if (!sess?.u) return null;
  const auth = getAuthRecord(sess.u);
  if (!auth || auth.session_id === SESSION_LOGGED_OUT) return null;
  const rawKey = req.cookies?.zboe_skey;
  const sid = req.cookies?.zboe_sid;
  if (!rawKey || !sid || sid !== auth.session_id || saltSessionKey(rawKey) !== auth.session_key) return null;
  if (auth.session_key !== auth.p_session_key || auth.session_id !== auth.p_session_id) return null;
  return { userId: auth.id, username: auth.username };
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

  // Ban/exile takes effect immediately, even mid-session — not just at the
  // next login attempt. A verified-legitimate session for a now-banned/exiled
  // account is voided right here, so every subsequent authenticated call
  // (including the game-state poll) bounces to banned.html instead of
  // continuing to act. API calls (fetch/XHR) get a JSON payload the client
  // reacts to; full-page routes (/game, /admin) get a real redirect.
  const banUntil = auth.login_res_set_time + auth.login_res_time * 1000;
  if (auth.user_exiled || (auth.login_restricted && Date.now() < banUntil)) {
    setUserLoggedOut(auth.id);
    const exiled = Boolean(auth.user_exiled);
    log("WARN", `${auth.username}'s active session was killed — currently ${exiled ? "exiled" : "banned"}`, game_config);
    const redirect = `/banned.html?u=${encodeURIComponent(auth.username)}`;
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({
        ok: false, banned: true, exiled,
        admin: exiled ? auth.user_exiled_admin : auth.login_res_admin,
        reason: exiled ? auth.user_exiled_reason : auth.login_res_reason,
        until: exiled ? null : banUntil,
        redirect,
      });
    }
    return res.redirect(redirect);
  }

  log("FULL", `Authenticated user ${auth.username} (id=${auth.id})`, game_config);
  req.user = auth.username;
  req.userId = auth.id;
  // Chat/fun gates (users.adm_fun/chat_mute/chat_deaf/chat_strict) — fetched
  // fresh every request alongside the session check above, so they're never
  // stale within a request even though nothing else caches them.
  req.gates = {
    admFun: Boolean(auth.adm_fun),
    chatMute: Boolean(auth.chat_mute),
    chatDeaf: Boolean(auth.chat_deaf),
    chatStrict: Boolean(auth.chat_strict),
  };
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
    // Dev -a: every registration is an admin.
    if (DEV_FLAGS.adminRegs) {
      setUserAdmin(info.lastInsertRowid, true);
      log("INFO", `[dev -a] ${username} registered as admin`, game_config);
    }
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

  // Exile is permanent and checked before anything else (including the
  // password) — an exiled account never gets to try credentials again.
  if (rec.user_exiled) {
    log("WARN", `Login blocked — ${username} is exiled`, game_config);
    return res.redirect("/login.html?err=" + encodeURIComponent(
      "Your account has been permanently banned, and is not welcome on this server."));
  }

  // Temp ban: auto-lifts once expired, checked right here (no timer needed —
  // the next login attempt after the window passes just clears it).
  if (rec.login_restricted) {
    const liftsAt = rec.login_res_set_time + rec.login_res_time * 1000;
    if (Date.now() < liftsAt) {
      log("WARN", `Login blocked — ${username} is banned until ${new Date(liftsAt).toISOString()}`, game_config);
      return res.redirect("/login.html?err=" + encodeURIComponent(
        `You have been temporarily banned until ${new Date(liftsAt).toLocaleString()}.\nReason: ${rec.login_res_reason}`));
    }
    unbanUser(rec.id);
    log("INFO", `${username}'s temp ban expired — lifted on login attempt`, game_config);
  }

  // Automatic lockout after too many bad passwords in a row — independent of
  // (and much shorter than) an admin-issued temp ban.
  if (rec.failed_login_lockout_until > Date.now()) {
    const mins = Math.ceil((rec.failed_login_lockout_until - Date.now()) / 60000);
    log("WARN", `Login blocked — ${username} is auto-locked out for ${mins}m more`, game_config);
    return res.redirect("/login.html?err=" + encodeURIComponent(
      `Too many failed login attempts — try again in ${mins}m.`));
  }

  const hash = hashPassword(password, rec.pass_salt);
  if (hash !== rec.pass_hash) {
    const count = recordFailedLogin(rec.id, account_config.failed_login_max, account_config.failed_login_lockout_seconds);
    log("WARN", `Password hash mismatch for username=${username} (failed attempt ${count}/${account_config.failed_login_max})`, game_config);
    return res.redirect("/login.html?err=Bad%20login");
  }
  resetFailedLogin(rec.id);

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
  // Dev -s: admins come in hidden — the tick also skips them entirely.
  if (DEV_FLAGS.stealthAdmins && rec.is_admin) {
    updatePlayerHidden(rec.id, 1);
    log("INFO", `[dev -s] ${username} logged in stealthed`, game_config);
  }
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

// Public leaderboard — no auth, feeds the landing page (index.html) and
// playercard.html's no-?p= leaderboard view. Rows are { user, xp (lifetime),
// level }. Optional ?limit= (default 25, matching the old hardcoded value;
// playercard.html asks for more) — capped at 500 so it can't be abused to
// pull the entire players table in one shot.
app.get("/api/leaderboard", (req, res) => {
  const limit = Math.max(1, Math.min(500, Math.round(Number(req.query.limit)) || 25));
  res.json({ leaderboard: getLeaderboard(limit) });
});

// Public (unauthenticated) — banned.html's data source. By the time a player
// lands here their session has already been voided (requireAuth's kill switch
// above, or a blocked /login attempt), so it can't rely on a cookie. Only
// ever reports a *currently active* restriction — an expired temp ban (not
// yet auto-lifted, which only happens on the next real login attempt) reads
// as "not banned" here so a stale tab doesn't show a lapsed ban forever.
app.get("/api/ban-status", (req, res) => {
  const username = String(req.query.u || "").trim();
  const rec = username ? getUserByName(username) : null;
  if (!rec) return res.json({ ok: false });
  if (rec.user_exiled) {
    return res.json({ ok: true, username: rec.username, exiled: true, admin: rec.user_exiled_admin, reason: rec.user_exiled_reason });
  }
  const until = rec.login_res_set_time + rec.login_res_time * 1000;
  if (rec.login_restricted && Date.now() < until) {
    return res.json({ ok: true, username: rec.username, exiled: false, admin: rec.login_res_admin, reason: rec.login_res_reason, until });
  }
  return res.json({ ok: false });
});

// Human-readable label for one quest objective, for the Quest Info UI.
function questObjectiveLabel(obj) {
  switch (obj.type) {
    case "learn_spell": return `Learn ${MAGIC_SPELLS[obj.spell]?.name ?? obj.spell}`;
    case "acquire_item": return `Acquire ${obj.qty}× ${ITEMS[obj.item]?.name ?? obj.item}`;
    case "action": {
      const label = Object.values(LOCATION_ACTIONS).flat().find((a) => a.key === obj.action)?.label;
      return label ?? obj.action;
    }
    case "recipe": {
      const r = RECIPES.find((rr) => rr.key === obj.recipe);
      return r ? `Craft ${r.label}` : obj.recipe;
    }
    case "use_item": return `Use ${ITEMS[obj.item]?.name ?? obj.item}`;
    case "break_horde": return "Break a zombie horde";
    case "clear_raid": return "Clear a zombie raid";
    default: return obj.type;
  }
}

// Shapes the player's quest_active/quest_started/quest_completed/
// quest_objectives columns (db.js) into a UI-friendly payload for the game
// page's Quest Info box + completed-quests modal.
function questsPayloadFor(player) {
  const started = player.quest_started ? player.quest_started.split(",").filter(Boolean) : [];
  const completed = player.quest_completed ? player.quest_completed.split(",").filter(Boolean) : [];
  const activeKey = player.quest_active;
  const progress = player.quest_objectives ? JSON.parse(player.quest_objectives) : {};

  const active = activeKey !== "NONE" && QUESTS[activeKey] ? {
    key: activeKey,
    name: QUESTS[activeKey].name,
    desc: QUESTS[activeKey].desc,
    objectives: QUESTS[activeKey].objectives.map((obj, i) => ({
      label: questObjectiveLabel(obj),
      have: progress[i] ?? 0,
      need: obj.qty,
      done: (progress[i] ?? 0) >= obj.qty,
    })),
    reward: QUESTS[activeKey].reward,
  } : null;

  const started_other = started
    .filter((k) => k !== activeKey && !completed.includes(k) && QUESTS[k])
    .map((k) => ({ key: k, name: QUESTS[k].name, desc: QUESTS[k].desc }));

  const completedList = completed.filter((k) => QUESTS[k])
    .map((k) => ({ key: k, name: QUESTS[k].name, reward: QUESTS[k].reward }));

  return { active, started: started_other, completed: completedList };
}

app.get("/api/game-state", requireAuth, (req, res) => {
  log("FULL", `API request for game state by user ${req.user}`, game_config);
  touchPlayerSeen(req.userId);
  const player = ensurePlayer(req.userId);
  const gameState = getGameState();
  const leaderboard = getLeaderboard(10);
  // chat_deaf hides all chat (player AND admin); chat_strict hides only
  // regular player chat, keeping admin_chat visible — deaf wins if somehow
  // both are set, since it's the stronger restriction.
  let recentEvents = getRecentEvents(80, req.userId).reverse();
  if (req.gates.chatDeaf) recentEvents = recentEvents.filter((e) => e.type !== "chat" && e.type !== "admin_chat");
  else if (req.gates.chatStrict) recentEvents = recentEvents.filter((e) => e.type !== "chat");
  // horde_size in game_state is now the source of truth for the zombie count,
  // and hunt_enabled is the real hunt toggle (both driven by the ticker/button).
  const zombies = gameState.horde_size;
  // Players seen within the timeout window are "online".
  const activeCutoff = Date.now() - game_config.timeout * 1000;
  const actives = getActivePlayers(activeCutoff);
  const online = actives.map((p) => p.username);
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
      ap: baseApOf(actives), // summed armor AP of everyone sheltering inside
      repairKits: gameState.base_repair_kits,
      sentryActive: gameState.sentry_until > Date.now(),
    },
    nuke: baseDestroyed ? nukeVoteStatus() : null,
    huntVote: huntVoteStatus(req.userId, actives),
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
      mana: player.mana,
      maxMana: player.mana_max,
      ammo: gun.ammo,
      maxAmmo: gun.maxAmmo,
      clips: gun.clips,
      maxClips: gun.maxClips,
      acc: player.accuracy,
      cond: gun.condition,
      gold: player.c_gold,
      tokens: player.c_tokens,
      goldenShots: player.golden_shots,
      equippedGun: player.golden_shots > 0 ? "Golden Gun" : equippedGunName(player),
      // Gun switcher: which of the guns are owned / currently equipped.
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
      forgeFired: Boolean(player.forge_fired),   // the Mountains forge (persistent)
      beaconFired: Boolean(player.beacon_fired), // live Bunker supply beacon
      armor: Object.fromEntries(ARMOR_PIECES.map((slot) => [slot, player[`a_${slot}`] || null])), // per-slot equipped item name (null = empty)
      armorAp: armorApOf(player),
      arcaneTableActive: arcaneTableActiveOf(player),
      arcaneTableExpiresAt: player.arcane_table ? player.arcane_table_activated_at + ARCANE_TABLE_WINDOW_MS : 0,
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
      admFun: req.gates.admFun, // sub-permission within admin — gates the 🎉 Fun button specifically
      jammed: gun.jammed, // the equipped gun's jam state (jams are per gun)
    },
    // This location's actions, annotated with lvlOk/toolOk for this player.
    actions: actionsFor(player, locKey),
    quests: questsPayloadFor(player),
    events: recentEvents,
  });
});

// Switch which started-but-incomplete quest is the tracked/active one (see
// setActiveQuest in db.js — objective progress is freshly re-seeded on
// activation, not restored from an earlier stint as active).
app.post("/api/quest/activate", requireAuth, (req, res) => {
  const key = String(req.body.key || "");
  const quest = QUESTS[key];
  if (!quest) return res.status(404).json({ ok: false, message: "Unknown quest." });

  const r = setActiveQuest(req.userId, key);
  if (!r.ok) {
    const message =
      r.reason === "not_started" ? `You haven't started ${quest.name} yet.` :
      r.reason === "already_completed" ? `You've already completed ${quest.name}.` :
      "Couldn't switch quests.";
    return res.status(409).json({ ok: false, message });
  }
  if (r.reason === "already_active") return res.json({ ok: true, message: `Already tracking ${quest.name}.` });
  log("INFO", `${req.user} switched active quest to ${key}`, game_config);
  return res.json({ ok: true, message: `Now tracking: ${quest.name}` });
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

// ----- Hunt vote -----
// A player-triggered alternative to the admin's direct hunt toggle: any
// online player can call a 30s Yes/No poll to flip hunt_enabled. One vote
// globally at a time (the hunt is a single world toggle) — in-memory only,
// same convention as ACTION_BUSY/CAMPFIRES/SPELL_ARMOR_BUFFS, so a restart
// just drops whatever was in progress.
let HUNT_VOTE = null; // { toggleTo, startedBy, expiresAt, ballots: Map<userId,'yes'|'no'>, timer }
const HUNT_VOTE_SECONDS = 30;

// Cancel any in-progress hunt vote (e.g. an admin overrode it directly via
// /api/hunt/toggle) — clears the timer too, so the stale resolve is a no-op
// (resolveHuntVote checks HUNT_VOTE === voteRef before acting).
function cancelHuntVote() {
  if (!HUNT_VOTE) return;
  clearTimeout(HUNT_VOTE.timer);
  HUNT_VOTE = null;
}

function resolveHuntVote(voteRef) {
  if (HUNT_VOTE !== voteRef) return; // superseded/cancelled — ignore this stale timer
  let yes = 0, no = 0;
  for (const v of voteRef.ballots.values()) v === "yes" ? yes++ : no++;
  // Passes with at least one Yes, and either no dissent or Yes outnumbers No.
  const passed = yes >= 1 && (no === 0 || yes > no);
  if (passed) {
    setHuntEnabled(voteRef.toggleTo);
    insertEvent("system", `The hunt vote passed (${yes}-${no}) — the hunt is now ${voteRef.toggleTo ? "enabled" : "disabled"}.`, "public", "global");
    log("INFO", `Hunt vote passed ${yes}-${no} -> hunt_enabled=${voteRef.toggleTo}`, game_config);
  } else {
    insertEvent("system", "The vote was majority no.", "public", "global");
    log("INFO", `Hunt vote failed ${yes}-${no}`, game_config);
  }
  HUNT_VOTE = null;
}

// The hunt-vote status for GET /api/game-state — reuses the caller's already
// -queried active-player list (no extra DB round trip).
function huntVoteStatus(userId, actives) {
  if (!HUNT_VOTE) return null;
  let yes = 0, no = 0;
  for (const v of HUNT_VOTE.ballots.values()) v === "yes" ? yes++ : no++;
  return {
    active: true,
    toggleTo: HUNT_VOTE.toggleTo,
    secondsLeft: Math.max(0, Math.ceil((HUNT_VOTE.expiresAt - Date.now()) / 1000)),
    yes, no,
    myVote: HUNT_VOTE.ballots.get(userId) ?? null,
    // Only meaningful to an admin viewer (drives the client's confirm-before-
    // voting nudge when there are enough non-admins online to decide alone).
    onlineNonAdminCount: actives.filter((p) => !isUserAdmin(p.user_id)).length,
  };
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
// gunType to the per-gun stat columns (handgun_/rifle_/shotgun_/burstrifle_)
// and the shooting behavior below.
const GUNS = Object.fromEntries(
  Object.entries(ITEMS)
    .filter(([, item]) => item.type === "gun")
    .map(([key, item]) => [key, { type: item.gunType }])
);

// ----- Armor -----
// Derived from the registry: every ITEMS entry with type "armor". AP is a
// 1-500 gauge of effectiveness — the equipped armor blocks ap/AP_GAUGE of the
// damage tallied against the player each tick (the final hit calc). Players
// inside the base pool their AP into "Base AP", which deflects base damage
// the same way, capped at BASE_AP_MAX_BLOCK so the base is never invincible.
const AP_GAUGE = 500;
const BASE_AP_MAX_BLOCK = 0.9;
const ARMORS = Object.fromEntries(
  Object.entries(ITEMS).filter(([, item]) => item.type === "armor")
);
// True if itemName is equipped in ANY of the 6 paperdoll slots.
function isArmorEquippedAnywhere(player, itemName) {
  return ARMOR_PIECES.some((slot) => player[`a_${slot}`] === itemName);
}
// Sums AP across all 6 slots. A slot contributes 0 if its item is gone
// (e.g. admin force-removed it) or BROKEN (condition 0) — condition gates AP
// fully off rather than scaling it, matching the binary BROKEN convention
// already shown in the Armor tab UI.
function armorApOf(player) {
  const owned = new Map(getInventory(player.user_id).map((i) => [i.item_name, i]));
  const gearAp = ARMOR_PIECES.reduce((sum, slot) => {
    const name = player[`a_${slot}`];
    if (!name || !ARMORS[name]) return sum;
    const row = owned.get(name);
    if (!row || row.quantity <= 0 || row.condition <= 0) return sum;
    return sum + ARMORS[name].ap;
  }, 0);
  // Gear + temporary spell buff + innate "Base AP" (players.ap_level, bought
  // via the AP Base upgrade) — one total for the hit calc and Base AP pooling.
  return gearAp + spellApOf(player.user_id) + (player.ap_level || 0);
}
// Damage deflected by an AP rating (never more than the damage itself).
function apBlocked(damage, ap) {
  return Math.min(damage, Math.round(damage * Math.min(ap, AP_GAUGE) / AP_GAUGE));
}
// The sentry turret shoots with Rifle logic at this fixed "accuracy rating"
// (feeds both computeHitChance's condition scaling and the pierce roll).
const SENTRY_ACCURACY = 75;

// Base AP = summed AP of everyone sheltering inside (from an active-player list).
function baseApOf(activePlayers) {
  return activePlayers
    .filter((p) => p.location === "basecamp_inside")
    .reduce((sum, p) => sum + armorApOf(p), 0);
}

// accuracyModel: "player"  → player accuracy stat (+ gun condition, TBD), floored.
//                "condition" → base floor scaled by condition only (rifle).
// maxTargets: zombies a single successful shot can drop.
const GUN_BEHAVIOR = {
  handgun:     { accuracyModel: "player",    floor: 5,  maxTargets: 1 },
  rifle:       { accuracyModel: "condition", floor: 60, maxTargets: 1 },
  shotgun:     { accuracyModel: "player",    floor: 5,  maxTargets: 5 },
  burstrifle: { accuracyModel: "player",    floor: 30, maxTargets: 3 },
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

// The Town Arcane Table auto-expires ARCANE_TABLE_WINDOW_MS after activation
// (unlike forge/beacon's persistent on/off toggle) — "active" means both the
// flag is set AND the window hasn't elapsed.
const ARCANE_TABLE_WINDOW_MS = 5 * 60 * 1000;
function arcaneTableActiveOf(player) {
  return Boolean(player.arcane_table) && (Date.now() - player.arcane_table_activated_at) < ARCANE_TABLE_WINDOW_MS;
}

// Can this player use a crafting station right now? Gates both RECIPES and
// LOCATION_ACTIONS that carry a `station`. The forge is the player's own, up
// at the Mountains — fired via the fire_forge action (players.forge_fired),
// persistent until put out.
function stationOk(player, locKey, station) {
  if (!station) return true;
  if (station === "campfire") return campfireUntilOf(player.user_id) > 0;
  if (station === "forge") return locKey === "mountains" && Boolean(player.forge_fired);
  if (station === "beacon") return locKey === "bunker" && Boolean(player.beacon_fired);
  if (station === "arcane_table") return locKey === "town" && arcaneTableActiveOf(player);
  return false;
}
const STATION_MESSAGES = {
  campfire: "You need a campfire burning — build one first.",
  forge: "The forge is cold — get it going at the Mountains first.",
  beacon: "The beacon is not activated — activate it at the Bunker first.",
  arcane_table: "The Arcane Table isn't active — activate it in Town first.",
};

// Antenna/amplifier are passive base_items: OWNING them boosts the supply
// beacon activation roll (+10% / +15%, stacking, capped at 100). `has` is an
// item-name → owned predicate.
function beaconBoost(has) {
  return (has("external antenna") ? 10 : 0) + (has("signal amplifier") ? 15 : 0);
}

// Display string for a recipe's output — a single name, or an { item: qty }
// bundle ("3× cooked meat, 5× firewood"), plus a teaser when the recipe also
// rolls the supply-drop table.
function fmtOutput(r) {
  const base = typeof r.output === "string"
    ? r.output
    : Object.entries(r.output).map(([item, qty]) => `${qty}× ${item}`).join(", ");
  return r.roll === "supply" ? `${base} + a mystery bonus` : base;
}

// The current location's actions, annotated with whether THIS player can run
// each one right now (skill level + required tool). Rows that are recipe
// pointers ({ recipe: key }) expand into action-shaped entries built from the
// item_backbone.js recipe — no success roll (crafts always land), and the
// inputs ride along so the page can show/gate them like /api/craft does.
function actionsFor(player, locKey) {
  const defs = LOCATION_ACTIONS[locKey] || [];
  if (!defs.length) return [];
  const ownedQty = Object.fromEntries(getInventory(player.user_id).map((i) => [i.item_name, i.quantity]));
  const has = (name) => (ownedQty[name] ?? 0) > 0;
  return defs.map((a) => {
    // Pure UI button rows (Magic Table) — always visible at their location,
    // no gating; the page opens the matching modal instead of posting a Do.
    if (a.button) return { key: a.key, button: true, label: a.label };
    if (a.recipe) {
      const r = RECIPES.find((x) => x.key === a.recipe); // existence boot-validated
      return {
        key: r.key, recipe: r.key, label: r.label, timer: devTimerOf(r.timer),
        skill: r.skill, skillName: SKILL_NAMES[r.skill], skillLevel: r.level,
        successRate: 100, grants: fmtOutput(r), xp: r.xp,
        requires: r.requires ?? null, uses: null, inputs: r.inputs,
        station: r.station ?? null, activates: null,
        lvlOk: player[`s_${r.skill}_lvl`] >= r.level,
        toolOk: !r.requires || has(r.requires),
        useOk: true,
        inputsOk: Object.entries(r.inputs).every(([item, qty]) => (ownedQty[item] ?? 0) >= qty),
        stationOk: stationOk(player, locKey, r.station),
      };
    }
    return {
      key: a.key,
      label: a.label,
      timer: devTimerOf(a.timer),
      skill: a.skill,
      skillName: SKILL_NAMES[a.skill],
      skillLevel: a.skillLevel,
      // Beacon activation shows the antenna/amplifier-boosted odds.
      successRate: a.activates === "beacon" ? Math.min(100, a.successRate + beaconBoost(has)) : a.successRate,
      grants: a.grants ?? null,
      trainOnly: Boolean(a.trainOnly),
      xp: a.xp,
      requires: a.requires ?? null,
      uses: a.uses ?? null,
      inputs: null,
      station: a.station ?? null,
      activates: a.activates ?? null,
      lvlOk: player[`s_${a.skill}_lvl`] >= a.skillLevel,
      toolOk: !a.requires || has(a.requires),
      // uses accepts a single item name (qty 1, implicit) or a { item: qty }
      // map (multi-item fuel, e.g. activate_arcane_table's firewood + mana shard).
      useOk: !a.uses ? true : typeof a.uses === "string" ? has(a.uses) : Object.entries(a.uses).every(([item, qty]) => (ownedQty[item] ?? 0) >= qty),
      inputsOk: true,
      stationOk: stationOk(player, locKey, a.station),
    };
  })
  // Only actions the player can actually run right now reach the page —
  // locked ones (skill/tool/materials/station, or an already-lit station)
  // stay hidden until unlocked. The do-handler still enforces every gate.
  .filter((x) =>
    x.button ||
    (x.lvlOk && x.toolOk && x.useOk && x.inputsOk && x.stationOk &&
      !(x.activates === "forge" && player.forge_fired) &&
      !(x.activates === "beacon" && player.beacon_fired) &&
      !(x.activates === "arcane_table" && arcaneTableActiveOf(player)))
  );
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
  // Mana-priced + material inputs + Defense-gated, and repeatable (no owned
  // flag): each buy permanently raises players.ap_level (see armorApOf).
  { key: "ap_base", label: "AP Base", desc: "+10 Base AP (permanent, stacks)", cost: 25, currency: "mana", type: "instant", category: "upgrade",
    inputs: { "firewood": 10, "copper ore": 5, "glowcap": 3 }, defense: 2,
    apply: (uid) => setPlayerStat(uid, "ap_level", (getPlayerByUserId(uid).ap_level || 0) + 10) },
  { key: "clip_holster", label: "Clip Holster",      desc: "+1 max clips (equipped gun)", cost: 120, type: "stat", category: "upgrade", apply: (uid, gun) => updateGunMaxClips(uid, gun, 1) },
  { key: "laser_sight",  label: "Accuracy Potion",   desc: "+5% accuracy",                cost: 200, type: "stat", category: "upgrade", apply: (uid) => updatePlayerAccuracy(uid, 5) },
  { key: "spare_clip",   label: "Spare Clip",        desc: "+1 clip (equipped gun)",      cost: 5,   type: "stat", category: "item", apply: (uid, gun) => updateGunAmmo(uid, gun, 0, 1) },
  { key: "gun_oil",      label: "Gun Oil",           desc: "consumable · restores condition", cost: 25, type: "consumable", category: "item", item: "gun oil" },
  // Gold consumables (drop into inventory, used later).
  { key: "heal_potion",  label: "Healing Potion",    desc: "consumable · +50 health",  cost: 25, type: "consumable", category: "item", item: "healing potion" },
  { key: "shield_potion",label: "Shield Potion",     desc: "consumable · +50 shield",  cost: 60, type: "consumable", category: "item", item: "shield potion" },
  // One-time gun unlocks: bought once, land in inventory, then equippable.
  { key: "buy_rifle",    label: "Rifle",             desc: "one-time · unlocks the Rifle",   cost: 300, type: "gun", category: "item", item: "Rifle" },
  { key: "buy_shotgun",  label: "Shotgun",           desc: "one-time · unlocks the Shotgun", cost: 550, type: "gun", category: "item", item: "Shotgun" },
  { key: "buy_burstrifle",label: "Burst Rifle",     desc: "one-time · unlocks the Burst Rifle", cost: 2500, type: "gun", category: "item", item: "Burst Rifle" },
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
  mana:         (uid, n) => { addMana(uid, n);                return `+${n} mana`; },
  maxShield:    (uid, n) => { increaseMaxShield(uid, n);     return `+${n} max shield`; },
  gunCondition: (uid, n) => { adjustGunCondition(uid, equippedType(getPlayerByUserId(uid)), n); return `+${n} equipped gun condition`; },
  gold:         (uid, n) => { updatePlayerGold(uid, n);      return `+${n} gold`; },
  accuracy:     (uid, n) => { updatePlayerAccuracy(uid, n);  return `+${n} accuracy`; },
  goldenShots:  (uid, n) => { grantGoldenShots(uid, n);      return `+${n} golden shots`; },
  tokens:       (uid, n) => { addTokens(uid, n);             return `+${n} tokens`; },
  // World-scoped verbs (base systems — /api/inventory/use gates these items
  // to the Bunker):
  stockRepairKits: (_uid, n) => {
    const total = adjustRepairKits(n);
    insertEvent("system", `A base repair kit was stocked at the Bunker (${total} ready).`, "public", "global");
    return `stocked ${n} repair kit (${total} ready at the base)`;
  },
  sentryHours: (_uid, n) => {
    setSentryUntil(Date.now() + n * 3600 * 1000);
    insertEvent("system", `🤖 A sentry turret hums to life on the base perimeter (${n}h).`, "public", "global");
    return `sentry turret online for ${n}h`;
  },
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
    if (!item.section) bad.push(`ITEMS["${key}"] has no section (used by the admin panel's Item Registry tabs)`);
    for (const verb of Object.keys(item.use || {}))
      if (!EFFECT_VERBS[verb]) bad.push(`ITEMS["${key}"] uses unknown effect verb "${verb}"`);
    if (item.type === "gun" && !item.gunType) bad.push(`ITEMS["${key}"] is a gun with no gunType`);
    if (item.type === "armor" && !(Number.isFinite(item.ap) && item.ap >= 1 && item.ap <= 500))
      bad.push(`ITEMS["${key}"] is an armor with no valid ap (1-500)`);
    if (item.ap !== undefined && item.type !== "armor") bad.push(`ITEMS["${key}"] has ap but isn't an armor`);
    if (item.type === "armor" && !(Number.isInteger(item.defense) && item.defense >= 1))
      bad.push(`ITEMS["${key}"] is an armor with no valid defense level (int >= 1)`);
    if (item.type === "armor" && !ARMOR_PIECES.includes(item.piece))
      bad.push(`ITEMS["${key}"] is an armor with invalid/missing piece "${item.piece}" (${ARMOR_PIECES.join("/")})`);
  }
  const check = (name, where) => { if (name && !ITEMS[name]) bad.push(`${where} references unknown item "${name}"`); };
  for (const [loc, actions] of Object.entries(LOCATION_ACTIONS))
    for (const a of actions) {
      if (a.button) {
        // A pure UI button row (e.g. the Magic Table) — nothing to cross-check
        // against the registry beyond its own shape.
        if (!a.key || !a.label) bad.push(`LOCATION_ACTIONS.${loc} has a button row missing key/label`);
        continue;
      }
      if (a.recipe) {
        // A recipe pointer: everything else comes from the (separately
        // validated) recipe, so only the reference itself can be wrong.
        if (!RECIPES.find((r) => r.key === a.recipe)) bad.push(`LOCATION_ACTIONS.${loc} references unknown recipe "${a.recipe}"`);
        continue;
      }
      if (!a.key) { bad.push(`LOCATION_ACTIONS.${loc} has an action with no key (typo?): ${JSON.stringify(a).slice(0, 60)}`); continue; }
      if (!SKILLS.includes(a.skill)) bad.push(`LOCATION_ACTIONS.${loc}.${a.key} trains unknown skill "${a.skill}"`);
      check(a.grants, `LOCATION_ACTIONS.${loc}.${a.key}.grants`);
      check(a.requires, `LOCATION_ACTIONS.${loc}.${a.key}.requires`);
      // uses: a single item name (qty 1, implicit), or a { item: qty } map
      // (multi-item fuel consumed atomically up front, committed even on a
      // failed roll) — extended from the single-item-only form to support
      // activate_arcane_table's firewood + mana shard cost.
      if (a.uses !== undefined) {
        if (typeof a.uses === "string") check(a.uses, `LOCATION_ACTIONS.${loc}.${a.key}.uses`);
        else if (a.uses && typeof a.uses === "object" && !Array.isArray(a.uses)) {
          for (const item of Object.keys(a.uses)) check(item, `LOCATION_ACTIONS.${loc}.${a.key}.uses`);
        } else bad.push(`LOCATION_ACTIONS.${loc}.${a.key}.uses must be a single item name or a { item: qty } map`);
      }
      if (a.station && !["campfire", "forge", "beacon", "arcane_table"].includes(a.station)) bad.push(`LOCATION_ACTIONS.${loc}.${a.key} has unknown station "${a.station}"`);
      if (a.activates && !["forge", "beacon", "arcane_table"].includes(a.activates)) bad.push(`LOCATION_ACTIONS.${loc}.${a.key} activates unknown station "${a.activates}"`);
      // trainOnly rows award only skill XP — no grant/activate required (but xp is).
      if (a.trainOnly && !(Number.isFinite(a.xp) && a.xp > 0)) bad.push(`LOCATION_ACTIONS.${loc}.${a.key} is trainOnly with no xp`);
      if (!a.grants && !a.activates && !a.trainOnly) bad.push(`LOCATION_ACTIONS.${loc}.${a.key} neither grants nor activates anything`);
    }
  const FORGE_SECTIONS = ["Ingredients", "Guns", "Tools", "Bronze", "Iron", "Silver", "Gold", "Mythril", "Adamantite", "Syllic"];
  // Admin-panel Recipes tabs (see RECIPE_CATEGORIES/RECIPE_METAL_TYPES below).
  const RECIPE_CATEGORIES = ["food", "potion", "base", "magic", "metal", "misc"];
  const RECIPE_METAL_TYPES = ["armor", "crafting", "tools"];
  for (const r of RECIPES) {
    // output: a single item name, or an { item: qty } bundle.
    if (typeof r.output === "string") check(r.output, `RECIPES.${r.key}.output`);
    else for (const out of Object.keys(r.output || {})) check(out, `RECIPES.${r.key}.output`);
    check(r.requires, `RECIPES.${r.key}.requires`);
    for (const input of Object.keys(r.inputs || {})) check(input, `RECIPES.${r.key}.inputs`);
    if (!SKILLS.includes(r.skill)) bad.push(`RECIPES.${r.key} trains unknown skill "${r.skill}"`);
    if (r.station && !["campfire", "forge", "beacon", "arcane_table"].includes(r.station)) bad.push(`RECIPES.${r.key} has unknown station "${r.station}"`);
    if (r.station === "forge" && !FORGE_SECTIONS.includes(r.section)) bad.push(`RECIPES.${r.key} is a forge recipe with no valid section (${FORGE_SECTIONS.join("/")})`);
    if (r.roll && r.roll !== "supply") bad.push(`RECIPES.${r.key} has unknown roll table "${r.roll}"`);
    if (!RECIPE_CATEGORIES.includes(r.category)) bad.push(`RECIPES.${r.key} has unknown category "${r.category}" (${RECIPE_CATEGORIES.join("/")})`);
    if (r.category === "metal") {
      if (!SMELT_TYPES.includes(r.metal)) bad.push(`RECIPES.${r.key} has category "metal" but invalid metal "${r.metal}" (${SMELT_TYPES.join("/")})`);
      if (!RECIPE_METAL_TYPES.includes(r.metalType)) bad.push(`RECIPES.${r.key} has category "metal" but invalid metalType "${r.metalType}" (${RECIPE_METAL_TYPES.join("/")})`);
    } else if (r.metal || r.metalType) {
      bad.push(`RECIPES.${r.key} has metal/metalType but category isn't "metal"`);
    }
  }
  // The supply-drop table references existing registry items only.
  for (const d of SUPPLY_DROP_ROLL) check(d.key, "SUPPLY_DROP_ROLL");
  for (const u of STATIC_UPGRADES) {
    check(u.item, `STATIC_UPGRADES.${u.key}.item`);
    for (const input of Object.keys(u.inputs || {})) check(input, `STATIC_UPGRADES.${u.key}.inputs`);
  }
  if (bad.length) {
    // Printed ungated (like the sessionSecret halt) so it's visible even
    // without --verbose, then FATAL-logged (which exits).
    console.error(paint(["bold", "red"], `FATAL: item registry validation failed:\n  - ${bad.join("\n  - ")}`, process.stderr));
    log("FATAL", `Item registry validation failed: ${bad.join("; ")}`, game_config);
  }
}

// ----- Magic spell registry sanity (boot-time) -----
// magic.js is data plus its own helpers (see "Magic Backbone" in that file)
// — a typo here dies at boot, not mid-cast.
{
  const bad = validateMagicSpells(LOCATION_NAMES, ITEMS);
  if (bad.length) {
    console.error(paint(["bold", "red"], `FATAL: magic spell registry validation failed:\n  - ${bad.join("\n  - ")}`, process.stderr));
    log("FATAL", `Magic spell registry validation failed: ${bad.join("; ")}`, game_config);
  }
}

// ----- Quest registry sanity (boot-time) -----
// quest_backbone.js is data-only, no imports of its own — every reference it
// makes into the real registries (items/actions/recipes/spells/locations/
// other quests) is checked here, same "typos die at boot" convention as the
// item/magic blocks above.
{
  const bad = [];
  const allActionKeys = new Set(Object.values(LOCATION_ACTIONS).flatMap((rows) => rows.map((r) => r.key).filter(Boolean)));
  const recipeKeys = new Set(RECIPES.map((r) => r.key));
  for (const [key, quest] of Object.entries(QUESTS)) {
    const s = quest.starter;
    if (!s) bad.push(`QUESTS["${key}"] has no starter trigger`);
    else if (s.starter !== true && !s.enter_location && !s.quest && !(s.type === "action" && s.action)) {
      bad.push(`QUESTS["${key}"].starter is an unrecognized shape: ${JSON.stringify(s)}`);
    } else {
      if (s.enter_location && !LOCATION_NAMES[s.enter_location]) bad.push(`QUESTS["${key}"].starter references unknown location "${s.enter_location}"`);
      if (s.type === "action" && !allActionKeys.has(s.action)) bad.push(`QUESTS["${key}"].starter references unknown action "${s.action}"`);
      if (s.quest && !QUESTS[s.quest]) bad.push(`QUESTS["${key}"].starter references unknown quest "${s.quest}"`);
    }
    if (!Array.isArray(quest.objectives) || !quest.objectives.length) bad.push(`QUESTS["${key}"] has no objectives`);
    for (const [i, obj] of (quest.objectives || []).entries()) {
      const where = `QUESTS["${key}"].objectives[${i}]`;
      if (!QUEST_OBJECTIVE_TYPES.includes(obj.type)) { bad.push(`${where} has unknown type "${obj.type}"`); continue; }
      if (!(Number.isFinite(obj.qty) && obj.qty > 0)) bad.push(`${where} (${obj.type}) has no valid qty`);
      if (obj.type === "acquire_item" || obj.type === "use_item") { if (!ITEMS[obj.item]) bad.push(`${where} (${obj.type}) references unknown item "${obj.item}"`); }
      else if (obj.type === "action") { if (!allActionKeys.has(obj.action)) bad.push(`${where} references unknown action "${obj.action}"`); }
      else if (obj.type === "recipe") { if (!recipeKeys.has(obj.recipe)) bad.push(`${where} references unknown recipe "${obj.recipe}"`); }
      else if (obj.type === "learn_spell") { if (!MAGIC_SPELLS[obj.spell]) bad.push(`${where} references unknown spell "${obj.spell}"`); }
    }
    if (!Number.isFinite(quest.reward?.gold) && !Number.isFinite(quest.reward?.xp)) bad.push(`QUESTS["${key}"] has no gold/xp reward`);
  }
  if (bad.length) {
    console.error(paint(["bold", "red"], `FATAL: quest registry validation failed:\n  - ${bad.join("\n  - ")}`, process.stderr));
    log("FATAL", `Quest registry validation failed: ${bad.join("; ")}`, game_config);
  }
}

// Zombie Bits kill drop: a chance per kill EVENT (not per zombie in a
// multi-kill shot) to drop one random crafting material from the Zombie Bits
// pool (item_backbone.js) — the raw material for the zombie-tier armor recipes.
const ZOMBIE_BITS = Object.keys(ITEMS).filter((k) => ITEMS[k].section === "Zombie Bits");
const ZOMBIE_BIT_DROP_CHANCE = 15; // % — tunable

// Shared kill resolution — XP/gold award, horde decrement, the public "kill"
// event, and the horde/raid-break token bonus. Used by both the shoot handler
// (gun kills) and spell casting (attack-type spells). `sourceLabel` is the
// human text for "dropped N zombies with <sourceLabel>" (e.g. "the Rifle —
// the round went clean through", or a spell's name). Returns the bonus note
// text ("" if no token was awarded) to fold into the caller's response message.
function resolveKill(userId, username, killed, gameState, sourceLabel) {
  const hordeBefore = gameState.horde_size;
  const hordeAfter = hordeBefore - killed;
  const wasRaiding = gameState.raid_enabled === "true";

  updatePlayerStats(userId, XP_PER_KILL * killed, killed);
  updatePlayerGold(userId, GOLD_PER_KILL * killed);
  adjustHordeSize(-killed);

  let bitNote = "";
  if (Math.random() * 100 < ZOMBIE_BIT_DROP_CHANCE) {
    const bit = ZOMBIE_BITS[Math.floor(Math.random() * ZOMBIE_BITS.length)];
    giveInventoryItem(userId, bit, 1);
    bitNote = ` …a ${ITEMS[bit].name} drops from the pile.`;
  }
  const noun = killed === 1 ? "a zombie" : `${killed} zombies`;
  insertEvent("kill", `${username} dropped ${noun} with ${sourceLabel} (+${XP_PER_KILL * killed} XP, +${GOLD_PER_KILL * killed} gold)${bitNote}`, "public", "global");

  let bonus = bitNote;
  if (wasRaiding && hordeAfter <= 0) {
    addTokens(userId, 3);
    setRaidEnabled(false);
    insertEvent("system", `${username} ended the raid! (+3 tokens)`, "public", "global");
    bonus += " Raid ended — +3 tokens!";
    recordQuestProgress(userId, "clear_raid", null, 1);
  } else if (!wasRaiding && hordeBefore >= zombie_config.z_horde && hordeAfter < zombie_config.z_horde) {
    addTokens(userId, 1);
    insertEvent("system", `${username} broke the horde (+1 token)`, "public", "global");
    bonus += " Horde broken — +1 token!";
    recordQuestProgress(userId, "break_horde", null, 1);
  }
  return bonus;
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
    else if (type === "burstrifle") targets = Math.min(3, gameState.horde_size);
    else if (type === "rifle" && riflePierces(player, gameState.horde_size)) {
      targets = 2;
      pierced = true;
    }
    killed = Math.min(targets, gameState.horde_size);
  }

  // ---- Kill resolution (shared with spell casting — see resolveKill) ----
  const pierceTag = pierced ? " — the round went clean through" : "";
  const bonus = resolveKill(req.userId, req.user, killed, gameState, `the ${gunLabel}${pierceTag}`);

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
  cancelHuntVote(); // a direct admin override supersedes any in-progress vote
  log("INFO", `${req.user} toggled hunt_enabled -> ${enabled}`, game_config);
  return res.json({ ok: true, huntActive: enabled, message: enabled ? "Hunt enabled." : "Hunt disabled." });
});

// Start a 30s Yes/No poll to flip the hunt — the non-admin alternative to the
// direct toggle above. Vote direction always mirrors that button's semantics
// (flip whatever the current state is). One vote globally at a time.
app.post("/api/hunt/vote/start", requireAuth, (req, res) => {
  if (HUNT_VOTE) return res.status(409).json({ ok: false, message: "A hunt vote is already in progress." });
  const toggleTo = getGameState().hunt_enabled !== "true";
  const voteRef = { toggleTo, startedBy: req.user, expiresAt: Date.now() + HUNT_VOTE_SECONDS * 1000, ballots: new Map(), timer: null };
  voteRef.timer = setTimeout(() => resolveHuntVote(voteRef), HUNT_VOTE_SECONDS * 1000);
  HUNT_VOTE = voteRef;
  log("INFO", `${req.user} started a hunt vote (target: ${toggleTo ? "enable" : "disable"})`, game_config);
  return res.json({ ok: true, message: `Vote started — ${HUNT_VOTE_SECONDS}s to ${toggleTo ? "enable" : "disable"} the hunt.` });
});

// Cast (or change) a ballot on the in-progress hunt vote. Admin votes are
// publicly announced — everyone else's are silent, tallied but not broadcast.
app.post("/api/hunt/vote/cast", requireAuth, (req, res) => {
  if (!HUNT_VOTE) return res.status(409).json({ ok: false, message: "No hunt vote in progress." });
  const vote = String(req.body.vote || "");
  if (vote !== "yes" && vote !== "no") return res.status(400).json({ ok: false, message: "Vote must be yes or no." });
  HUNT_VOTE.ballots.set(req.userId, vote);
  if (isUserAdmin(req.userId)) {
    insertEvent("system", `[Admin] ${req.user} voted ${vote.toUpperCase()} on the hunt vote.`, "public", "global");
  }
  log("INFO", `${req.user} voted ${vote} on the hunt vote`, game_config);
  return res.json({ ok: true, message: `Voted ${vote}.` });
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
  const player = ensurePlayer(req.userId);
  const inv = getInventory(req.userId);
  const ownedQty = Object.fromEntries(inv.map((i) => [i.item_name, i.quantity]));
  const owned = new Set(inv.filter((i) => i.quantity > 0).map((i) => i.item_name));
  res.json(STATIC_UPGRADES.map(({ key, label, desc, cost, type, item, currency, category, inputs, defense }) => ({
    key, label, desc, cost, type,
    currency: currency || "gold",
    category: category || "upgrade",
    owned: type === "gun" ? owned.has(item) : false,
    inputs: inputs ?? null,
    defense: defense ?? null,
    // Server-side affordability for entries with costs the client can't see
    // from state alone (material inputs / Defense gate). Currency itself is
    // still the client's call (it knows gold/tokens/mana live).
    affordable: (!inputs || Object.entries(inputs).every(([n, q]) => (ownedQty[n] ?? 0) >= q))
      && (!defense || player.s_defense_lvl >= defense),
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

  // Skill gate (AP Base needs Defense) — checked before anything is spent.
  if (upgrade.defense && player.s_defense_lvl < upgrade.defense)
    return res.status(409).json({ ok: false, message: `Requires Defense level ${upgrade.defense}.` });

  // Currency check first (nothing spent yet), then material inputs (atomic
  // via consumeItems), then the currency — so a missing ingredient never
  // eats the mana/gold and vice versa.
  if (currency === "token" && player.c_tokens < upgrade.cost)
    return res.status(409).json({ ok: false, message: `Not enough tokens — need ${upgrade.cost}, you have ${player.c_tokens}.` });
  if (currency === "mana" && player.mana < upgrade.cost)
    return res.status(409).json({ ok: false, message: `Not enough mana — need ${upgrade.cost}, you have ${player.mana}.` });
  if (currency === "gold" && player.c_gold < upgrade.cost)
    return res.status(409).json({ ok: false, message: `Not enough gold — need ${upgrade.cost}, you have ${player.c_gold}.` });

  if (upgrade.inputs) {
    const consumed = consumeItems(req.userId, upgrade.inputs);
    if (!consumed.ok) {
      const needs = Object.entries(upgrade.inputs).map(([n, q]) => `${q}× ${n}`).join(", ");
      return res.status(409).json({ ok: false, message: `You're missing materials — needs ${needs}.` });
    }
  }

  if (currency === "token") addTokens(req.userId, -upgrade.cost);
  else if (currency === "mana") addMana(req.userId, -upgrade.cost);
  else updatePlayerGold(req.userId, -upgrade.cost);

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
  // Owned armors: AP from the registry, condition from the inventory row —
  // feeds the Backpack's Armor tab (equip/sell live there), grouped by piece.
  const armors = rawItems
    .filter((i) => ARMORS[i.item_name] && i.quantity > 0)
    .map((i) => ({
      name: i.item_name,
      label: ARMORS[i.item_name].name,
      piece: ARMORS[i.item_name].piece,
      ap: ARMORS[i.item_name].ap,
      value: ARMORS[i.item_name].value ?? 0,
      defense: ARMORS[i.item_name].defense,
      defenseOk: player.s_defense_lvl >= ARMORS[i.item_name].defense,
      condition: i.condition,
      quantity: i.quantity,
      equipped: isArmorEquippedAnywhere(player, i.item_name),
    }));
  res.json({
    items, usable, guns, armors, equipped: equippedGunName(player),
    equippedArmor: Object.fromEntries(ARMOR_PIECES.map((slot) => [slot, player[`a_${slot}`] || null])),
  });
});

// Read-only profile view for playercard.html's ?p=<user> mode — survival/
// currency/location/leaderboard-rank/skills, plus the same inventory
// categories /api/inventory computes, but for an ARBITRARY username rather
// than just the caller. No action endpoints hang off this — it's a display
// card, not a second control surface (equip/use/sell all still only work on
// your own inventory via the routes above).
//
// Publicly viewable — NOT behind requireAuth — but an anonymous request
// (tryAuth returns null) gets a stripped-down payload: health/shield/mana/
// level/Kills/Accuracy/skills/leaderboard rank only. Gold, tokens, location,
// lifetime XP, gun oil count, and every inventory category are held back
// entirely (not just hidden client-side) until the viewer is logged in —
// playercard.html swaps its Currency/Location boxes and Main content box for
// a "Please login" notice based on the `authenticated` flag below.
app.get("/api/playercard", (req, res) => {
  const username = String(req.query.user || "").trim();
  const uid = getUserIdByName(username)?.id;
  if (!uid) return res.status(404).json({ ok: false, message: "No such player." });
  const authenticated = tryAuth(req) !== null;
  const player = ensurePlayer(uid);
  const { rank, total } = getLeaderboardRank(uid);

  const payload = {
    ok: true,
    authenticated,
    username,
    level: player.level,
    health: player.health, maxHealth: player.max_health,
    shield: player.shield, maxShield: player.max_shield,
    mana: player.mana, maxMana: player.mana_max,
    kills: player.kills, accuracy: player.accuracy,
    rank, totalPlayers: total,
    skills: SKILLS.map((s) => ({
      key: s, name: SKILL_NAMES[s], level: player[`s_${s}_lvl`], xp: player[`s_${s}_xp`],
      nextCost: skillLevelCost(player[`s_${s}_lvl`] + 1),
    })),
  };

  if (authenticated) {
    const locKey = locationOf(player);
    const rawItems = getInventory(uid);
    const ownedQty = Object.fromEntries(rawItems.map((i) => [i.item_name, i.quantity]));

    const guns = Object.entries(GUNS)
      .filter(([name]) => (ownedQty[name] ?? 0) > 0)
      .map(([name, g]) => ({ name, equipped: equippedGunName(player) === name, ...gunAmmoOf(player, g.type) }));
    const armors = rawItems
      .filter((i) => ARMORS[i.item_name] && i.quantity > 0)
      .map((i) => ({
        name: i.item_name, label: ARMORS[i.item_name].name, piece: ARMORS[i.item_name].piece, ap: ARMORS[i.item_name].ap,
        defense: ARMORS[i.item_name].defense,
        condition: i.condition, quantity: i.quantity, equipped: isArmorEquippedAnywhere(player, i.item_name),
      }));
    // One helper for the flat (non-gun/armor) categories — same registry
    // lookup shape /api/inventory's `items` array uses, filtered by a
    // predicate over (item name, registry entry).
    const byPred = (pred) => rawItems
      .filter((i) => i.quantity > 0 && ITEMS[i.item_name] && pred(i.item_name, ITEMS[i.item_name]))
      .map((i) => ({
        name: i.item_name, label: ITEMS[i.item_name].name,
        desc: ITEMS[i.item_name].desc ?? "", tier: ITEMS[i.item_name].tier ?? null,
        value: ITEMS[i.item_name].value ?? 0, quantity: i.quantity,
      }));
    const byType = (types) => byPred((_name, it) => types.includes(it.type));

    Object.assign(payload, {
      xp: player.xp, nextLevelCost: levelCost(nextLevelOf(player.level)),
      lifetimeXp: player.lifetime_xp,
      gunOil: ownedQty["gun oil"] ?? 0,
      gold: player.c_gold, tokens: player.c_tokens,
      location: locKey, locationName: LOCATION_NAMES[locKey], zombieZone: ZOMBIE_LOCATIONS.has(locKey),
      gunsOwned: GUN_NAMES.filter((g) => ownedQty[g] > 0),
      guns, armors,
      tools: byType(["tool"]),
      // Potions = the toolbag consumables minus gun oil (that's its own
      // Survival stat above); Food = every other consumable (cooked meals,
      // stews) — lives in the Backpack, not alongside the true potions.
      potions: byPred((name, it) => it.type === "consumable" && it.toolbag && name !== "gun oil"),
      food: byPred((_name, it) => it.type === "consumable" && !it.toolbag),
      materials: byType(["crafting", "trade"]),
      smeltTypes: SMELT_TYPES, // header-row order for the Materials tab (playercard.html groups by name prefix)
      treasure: byType(["treasure"]),
      base: byType(["base_item"]),
      // Learned spells (player_magic) — feeds the main panel's Spells tab.
      spells: getPlayerMagic(uid)
        .filter((k) => MAGIC_SPELLS[k])
        .map((k) => {
          const s = MAGIC_SPELLS[k];
          return { key: k, name: s.name, type: s.type, level: s.level, cost: s.cost, desc: s.desc };
        }),
    });
  }

  res.json(payload);
});

// Equip an armor you own into one of the 6 paperdoll slots (head/torso/legs/
// boots/hands/shield — the other 5 slots are untouched). item: "" (or "none")
// clears that slot. The slot is explicit in the request (not inferred from
// the item) and validated against the item's registry `piece`, so a
// slot/item mismatch 400s rather than silently equipping into the wrong slot.
app.post("/api/armor/equip", requireAuth, (req, res) => {
  const slot = String(req.body.slot || "").trim();
  if (!ARMOR_PIECES.includes(slot)) return res.status(400).json({ ok: false, message: "Unknown armor slot." });
  const armorName = String(req.body.item || "").trim();

  if (!armorName || armorName === "none") {
    equipArmorPiece(req.userId, slot, "");
    insertEvent("item", `You took off your ${slot} armor`, "private", req.userId);
    log("INFO", `${req.user} cleared their ${slot} armor slot`, game_config);
    return res.json({ ok: true, message: `${slot} slot cleared.` });
  }
  const item = ARMORS[armorName];
  if (!item) return res.status(400).json({ ok: false, message: "That isn't an armor." });
  if (item.piece !== slot) return res.status(400).json({ ok: false, message: `${item.name} doesn't go in the ${slot} slot.` });
  const owned = getInventory(req.userId).find((i) => i.item_name === armorName && i.quantity > 0);
  if (!owned) return res.status(409).json({ ok: false, message: `You don't own a ${item.name}.` });
  // Heavier tiers need the Defense skill to wear (registry `defense` level).
  const wearer = ensurePlayer(req.userId);
  if (wearer.s_defense_lvl < item.defense)
    return res.status(409).json({ ok: false, message: `Requires Defense level ${item.defense} to wear the ${item.name}.` });

  equipArmorPiece(req.userId, slot, armorName);
  insertEvent("item", `You equipped the ${item.name} (AP ${item.ap}) in your ${slot} slot`, "private", req.userId);
  log("INFO", `${req.user} equipped ${armorName} in their ${slot} slot`, game_config);
  return res.json({ ok: true, message: `Equipped ${item.name} — AP ${item.ap}.` });
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

// Sell treasure or armor for gold at registry value. Body: item, qty (number
// or "all"). Selling your worn armor keeps the last set on your back: the
// sellable count is qty-1 while it's equipped (unequip first to sell all).
app.post("/api/inventory/sell", requireAuth, (req, res) => {
  const itemName = String(req.body.item || "").trim();
  const item = ITEMS[itemName];
  if (!item || !["treasure", "armor"].includes(item.type))
    return res.status(400).json({ ok: false, message: "That can't be sold." });

  const rawQty = String(req.body.qty || "1").trim().toLowerCase();
  let qty = rawQty === "all" ? Infinity : Math.max(1, Math.round(Number(rawQty)) || 1);
  if (item.type === "armor" && isArmorEquippedAnywhere(ensurePlayer(req.userId), itemName)) {
    const ownedQty = getInventory(req.userId).find((i) => i.item_name === itemName)?.quantity ?? 0;
    const sellable = ownedQty - 1; // the worn set stays
    if (sellable <= 0)
      return res.status(409).json({ ok: false, message: `That's the ${item.name} you're wearing — take it off to sell it.` });
    qty = Math.min(qty, sellable);
  }
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
  // Base systems only hook up to the Bunker's radio gear.
  if (item.type === "base_item" && locationOf(ensurePlayer(req.userId)) !== "bunker")
    return res.status(409).json({ ok: false, message: "Base systems can only be used from the Bunker." });

  const newQty = consumeInventoryItem(req.userId, itemName);
  if (newQty === null) return res.status(409).json({ ok: false, message: `You have no ${item.name} to use.` });

  const note = applyItemEffects(req.userId, item.use);
  insertEvent("item", `You used ${item.name} (${note})`, "private", req.userId);
  log("INFO", `${req.user} used ${itemName} (${newQty} left)`, game_config);
  recordQuestProgress(req.userId, "use_item", itemName, 1);
  return res.json({ ok: true, message: `Used ${item.name} — ${note}.`, quantity: newQty });
});

// Global player chat. Stored as a 'chat' event so it rides the normal feed.
app.post("/api/chat", requireAuth, (req, res) => {
  if (req.gates.chatMute) return res.status(403).json({ ok: false, message: "You are muted from chat." });
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
  if (DEV_FLAGS.zombieCap && getGameState().horde_size >= DEV_FLAGS.zombieCap)
    return res.status(409).json({ ok: false, message: `The horde is capped at ${DEV_FLAGS.zombieCap} (dev -z).` });
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
  insertEvent("level", `${req.user} increased to level ${target}!${bonusNote}`, "public", "global");
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
  insertEvent("level", `${req.user} increased to level ${player.level}! (+${gained} level${gained === 1 ? "" : "s"})`, "public", "global");
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
  checkQuestTriggers(req.userId, { type: "location", location: to });
  return res.json({ ok: true, message: `You arrive at ${LOCATION_NAMES[to]}.` });
});

// "Bonus Drop" (BONUS_DROPS in item_backbone.js) auto-applies to any action
// using one of these skills — no per-action flag needed, unlike RANDOM_DROPS.
const BONUS_DROP_SKILLS = new Set(["foraging", "woodcutting", "magic"]);

// Run a location action. Guards mirror the flags the page shows (skill level,
// required tool, one action at a time); the result rolls when the timer ends.
app.post("/api/action/do", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const locKey = locationOf(player);
  const action = (LOCATION_ACTIONS[locKey] || []).find((a) => (a.key ?? a.recipe) === String(req.body.key || ""));
  if (!action) return res.status(400).json({ ok: false, message: "You can't do that here." });
  // Button rows are UI-only (they open a modal on the page) — nothing to "do".
  if (action.button) return res.status(400).json({ ok: false, message: "That opens on the page — it isn't a timed action." });
  // Recipe-pointer rows are crafts wearing an action costume — hand the whole
  // request to the craft flow (its own busy/skill/station/tool/input guards).
  if (action.recipe) {
    req.body = { key: action.recipe };
    return handleCraft(req, res);
  }

  const busy = busyUntilOf(req.userId);
  if (busy) return res.status(409).json({ ok: false, message: `You're busy for another ${Math.ceil((busy - Date.now()) / 1000)}s.` });
  if (player[`s_${action.skill}_lvl`] < action.skillLevel)
    return res.status(409).json({ ok: false, message: `Requires ${SKILL_NAMES[action.skill]} level ${action.skillLevel}.` });
  if (action.requires) {
    const owned = getInventory(req.userId).some((i) => i.item_name === action.requires && i.quantity > 0);
    if (!owned) return res.status(409).json({ ok: false, message: `You need a ${action.requires} for that.` });
  }
  if (!stationOk(player, locKey, action.station))
    return res.status(409).json({ ok: false, message: STATION_MESSAGES[action.station] || "You can't do that here." });
  if (action.activates === "forge" && player.forge_fired)
    return res.status(409).json({ ok: false, message: "The forge is already going." });
  if (action.activates === "beacon" && player.beacon_fired)
    return res.status(409).json({ ok: false, message: "Your beacon is already live — call in the drop." });
  if (action.activates === "arcane_table" && arcaneTableActiveOf(player))
    return res.status(409).json({ ok: false, message: "The Arcane Table is already active." });
  // `uses` is fuel/feedstock: consumed up front, committed once started (like
  // craft inputs) — a failed roll still burns it. Accepts a single item name
  // (qty 1) or a { item: qty } map (e.g. activate_arcane_table's firewood + mana shard).
  if (action.uses) {
    const usesMap = typeof action.uses === "string" ? { [action.uses]: 1 } : action.uses;
    const used = consumeItems(req.userId, usesMap);
    if (!used.ok) return res.status(409).json({ ok: false, message: `You need ${used.missing.join(", ")} for that.` });
  }

  // Beacon activation: antenna/amplifier owned at start time boost the roll.
  let successRate = action.successRate;
  if (action.activates === "beacon") {
    const owned = new Set(getInventory(req.userId).filter((i) => i.quantity > 0).map((i) => i.item_name));
    successRate = Math.min(100, successRate + beaconBoost((n) => owned.has(n)));
  }

  const timerS = devTimerOf(action.timer); // dev -t: 3s
  const until = Date.now() + timerS * 1000;
  ACTION_BUSY.set(req.userId, { until, key: action.key });
  const username = req.user;
  const userId = req.userId;
  setTimeout(() => {
    ACTION_BUSY.delete(userId);
    const success = Math.random() * 100 < successRate;
    if (success) {
      // Grants an item, activates a station, or (trainOnly) pays out XP alone.
      let gainNote;
      if (action.activates === "forge") {
        setForgeFired(userId, true);
        gainNote = "the forge is fired";
      } else if (action.activates === "beacon") {
        setBeaconFired(userId, true);
        gainNote = "the beacon is live";
      } else if (action.activates === "arcane_table") {
        setArcaneTableActive(userId, true);
        gainNote = "the Arcane Table hums to life";
      } else if (action.trainOnly) {
        gainNote = "your training pays off";
      } else {
        giveInventoryItem(userId, action.grants, 1);
        gainNote = `+1 ${action.grants}`;
        recordQuestProgress(userId, "acquire_item", action.grants, 1);
      }
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
      // "Bonus Drop": a separate, skill-based roll — no action flag needed,
      // applies to any foraging/woodcutting/magic action, stacks independently
      // of the RANDOM_DROPS roll above.
      if (BONUS_DROP_SKILLS.has(action.skill)) {
        const bonus = BONUS_DROPS.find((d) => Math.random() * 100 < d.chance);
        if (bonus) {
          giveInventoryItem(userId, bonus.key, 1);
          dropNote += ` …and a ${bonus.name} turns up!`;
          log("INFO", `${username} ${action.key} bonus drop: ${bonus.key}`, game_config);
        }
      }
      insertEvent("action", `${action.label}: success! ${gainNote}, +${action.xp} ${SKILL_NAMES[action.skill]} XP${dropNote}`, "private", userId);
      log("INFO", `${username} ${action.key} success (${gainNote}, ${action.skill} xp -> ${total})`, game_config);
      checkQuestTriggers(userId, { type: "action", action: action.key });
      recordQuestProgress(userId, "action", action.key, 1);
    } else {
      insertEvent("action", `${action.label}: no luck this time.`, "private", userId);
      log("INFO", `${username} ${action.key} failed the ${successRate}% roll`, game_config);
    }
  }, timerS * 1000);

  insertEvent("action", `${action.text ?? `You started: ${action.label}`} (${timerS}s)`, "private", req.userId);
  log("INFO", `${username} started action ${action.key} at ${locKey} (${timerS}s)`, game_config);
  return res.json({ ok: true, message: `${action.label} — ${timerS}s…`, busyUntil: until });
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

// The Mountains forge toggle. Persistent state (players.forge_fired), so this
// only ever turns it OFF — lighting it goes through the skill-gated fire_forge
// action (which needs firewood and a smithing roll).
app.post("/api/forge/toggle", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  if (locationOf(player) !== "mountains")
    return res.status(409).json({ ok: false, message: "Your forge is up at the Mountains." });
  if (!player.forge_fired)
    return res.status(409).json({ ok: false, message: "The forge is cold — 'Get the Forge Going' lights it." });
  setForgeFired(req.userId, false);
  insertEvent("action", "You bank the coals — the forge goes cold.", "private", req.userId);
  log("INFO", `${req.user} put out their forge`, game_config);
  return res.json({ ok: true, message: "The forge goes cold." });
});

// The Town Arcane Table toggle — off-only, like the forge above, but the
// Arcane Table also auto-expires (ARCANE_TABLE_WINDOW_MS after activation),
// so this just lets a player end the window early.
app.post("/api/arcane-table/toggle", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  if (locationOf(player) !== "town")
    return res.status(409).json({ ok: false, message: "The Arcane Table is in Town." });
  if (!arcaneTableActiveOf(player))
    return res.status(409).json({ ok: false, message: "The Arcane Table isn't active." });
  setArcaneTableActive(req.userId, false);
  insertEvent("action", "You deactivate the Arcane Table.", "private", req.userId);
  log("INFO", `${req.user} deactivated the Arcane Table`, game_config);
  return res.json({ ok: true, message: "The Arcane Table powers down." });
});

// The recipe list, annotated for THIS player: skill/station/inputs readiness.
app.get("/api/craft", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const locKey = locationOf(player);
  const owned = Object.fromEntries(getInventory(req.userId).map((i) => [i.item_name, i.quantity]));
  res.json(RECIPES.map((r) => ({
    key: r.key, label: r.label, skill: r.skill, skillName: SKILL_NAMES[r.skill],
    level: r.level, station: r.station ?? null, requires: r.requires ?? null,
    section: r.section ?? null,
    inputs: r.inputs, output: fmtOutput(r), xp: r.xp, timer: devTimerOf(r.timer),
    lvlOk: player[`s_${r.skill}_lvl`] >= r.level,
    stationOk: stationOk(player, locKey, r.station),
    toolOk: !r.requires || (owned[r.requires] ?? 0) > 0,
    inputsOk: Object.entries(r.inputs).every(([item, qty]) => (owned[item] ?? 0) >= qty),
  })));
});

// Craft a recipe: inputs are consumed up front (committed once started, like a
// spent round); the output + skill XP land when the timer resolves. Named so
// /api/action/do can delegate recipe-pointer actions here.
function handleCraft(req, res) {
  const recipe = RECIPES.find((r) => r.key === String(req.body.key || ""));
  if (!recipe) return res.status(400).json({ ok: false, message: "Unknown recipe." });

  const player = ensurePlayer(req.userId);
  const locKey = locationOf(player);
  const busy = busyUntilOf(req.userId);
  if (busy) return res.status(409).json({ ok: false, message: `You're busy for another ${Math.ceil((busy - Date.now()) / 1000)}s.` });
  if (player[`s_${recipe.skill}_lvl`] < recipe.level)
    return res.status(409).json({ ok: false, message: `Requires ${SKILL_NAMES[recipe.skill]} level ${recipe.level}.` });
  if (!stationOk(player, locKey, recipe.station))
    return res.status(409).json({ ok: false, message: STATION_MESSAGES[recipe.station] || "You can't craft that here." });
  if (recipe.requires) {
    const hasTool = getInventory(req.userId).some((i) => i.item_name === recipe.requires && i.quantity > 0);
    if (!hasTool) return res.status(409).json({ ok: false, message: `You need a ${recipe.requires} for that.` });
  }
  const consumed = consumeItems(req.userId, recipe.inputs);
  if (!consumed.ok)
    return res.status(409).json({ ok: false, message: `Missing ingredients: ${consumed.missing.join(", ")}.` });

  const timerS = devTimerOf(recipe.timer); // dev -t: 3s
  const until = Date.now() + timerS * 1000;
  ACTION_BUSY.set(req.userId, { until, key: recipe.key });
  const userId = req.userId, username = req.user;
  // output is a single item name or an { item: qty } bundle — normalize once.
  const outputs = typeof recipe.output === "string" ? { [recipe.output]: 1 } : recipe.output;
  setTimeout(() => {
    ACTION_BUSY.delete(userId);
    for (const [item, qty] of Object.entries(outputs)) {
      giveInventoryItem(userId, item, qty);
      recordQuestProgress(userId, "acquire_item", item, qty);
    }
    recordQuestProgress(userId, "recipe", recipe.key, 1);
    const outNote = Object.entries(outputs).map(([item, qty]) => `+${qty} ${item}`).join(", ");
    // roll: "supply" — the declarative random-roll picker: walk the
    // SUPPLY_DROP_ROLL table top to bottom, first chance to pass wins.
    let rollNote = "";
    if (recipe.roll === "supply") {
      const bonus = SUPPLY_DROP_ROLL.find((d) => Math.random() * 100 < d.chance);
      if (bonus) {
        giveInventoryItem(userId, bonus.key, 1);
        rollNote = ` …the drop also held a ${ITEMS[bonus.key].name}!`;
        log("INFO", `${username} ${recipe.key} supply roll: ${bonus.key}`, game_config);
      }
    }
    // A beacon is one call for one drop: redeeming a beacon-station craft
    // spends the live beacon (light another to call the next drop).
    if (recipe.station === "beacon") setBeaconFired(userId, false);
    addSkillXp(userId, recipe.skill, recipe.xp);
    insertEvent("action", `${recipe.label}: done! ${outNote}, +${recipe.xp} ${SKILL_NAMES[recipe.skill]} XP${rollNote}`, "private", userId);
    log("INFO", `${username} crafted ${recipe.key} (${outNote})`, game_config);
  }, timerS * 1000);

  insertEvent("action", `You started: ${recipe.label} (${timerS}s)`, "private", req.userId);
  log("INFO", `${username} started craft ${recipe.key} (${timerS}s)`, game_config);
  return res.json({ ok: true, message: `${recipe.label} — ${timerS}s…`, busyUntil: until });
}
app.post("/api/craft", requireAuth, handleCraft);

// Meditate on Magical Theory: a safe-zone timed action granting magic XP.
app.post("/api/meditate", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  if (ZOMBIE_LOCATIONS.has(locationOf(player)))
    return res.status(409).json({ ok: false, message: "Too dangerous to meditate here." });
  const busy = busyUntilOf(req.userId);
  if (busy) return res.status(409).json({ ok: false, message: `You're busy for another ${Math.ceil((busy - Date.now()) / 1000)}s.` });

  const timerS = devTimerOf(MEDITATE_SECONDS); // dev -t: 3s
  const until = Date.now() + timerS * 1000;
  ACTION_BUSY.set(req.userId, { until, key: "meditate" });
  const userId = req.userId, username = req.user;
  setTimeout(() => {
    ACTION_BUSY.delete(userId);
    addSkillXp(userId, "magic", MEDITATE_XP);
    insertEvent("action", `Meditation complete — +${MEDITATE_XP} Magic XP`, "private", userId);
    log("INFO", `${username} meditated (+${MEDITATE_XP} magic xp)`, game_config);
  }, timerS * 1000);

  insertEvent("action", `You sit and meditate on magical theory (${timerS}s)`, "private", req.userId);
  return res.json({ ok: true, message: `Meditating — ${timerS}s…`, busyUntil: until });
});

// The spellbook (registry-driven, magic.js), annotated for THIS player:
// `learned` (player_magic), `lvlOk` (Magic skill), and each learn-map
// ingredient with need/have counts. Feeds three surfaces — the Spells cast
// modal (learned only), the Magic Table learn menu (everything, tabbed by
// `categories`), and the Player Info Spells tab (learned only). Casting goes
// through POST /api/spell/cast; learning through POST /api/spell/learn.
app.get("/api/spells", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const known = new Set(getPlayerMagic(req.userId));
  const ownedQty = Object.fromEntries(getInventory(req.userId).map((i) => [i.item_name, i.quantity]));
  res.json({
    categories: MAGIC_SPELL_CATEGORIES,
    spells: Object.entries(MAGIC_SPELLS).map(([key, s]) => ({
      key, name: s.name, type: s.type, level: s.level, desc: s.desc, cost: s.cost, xp: s.xp, effect: s.effect,
      starter: Boolean(s.starter),
      learned: known.has(key),
      lvlOk: player.s_magic_lvl >= s.level,
      learn: s.learn
        ? Object.entries(s.learn).map(([item, need]) => ({ item, need, have: ownedQty[item] ?? 0 }))
        : null,
    })),
  });
});

// Learn a spell at the Magic Table (Town only): consumes the spell's `learn`
// ingredients (magic.js), requires the Magic level the spell itself needs,
// and records it in player_magic. Instant — no timer, shop-style.
app.post("/api/spell/learn", requireAuth, (req, res) => {
  const key = String(req.body.key || "");
  const spell = MAGIC_SPELLS[key];
  if (!spell) return res.status(404).json({ ok: false, message: "Unknown spell." });

  const player = ensurePlayer(req.userId);
  if (locationOf(player) !== "town")
    return res.status(409).json({ ok: false, message: "The Magic Table is in Town." });
  if (knowsSpell(req.userId, key))
    return res.status(409).json({ ok: false, message: `You already know ${spell.name}.` });
  if (!spell.learn)
    return res.status(409).json({ ok: false, message: `${spell.name} can't be learned here.` });
  if (player.s_magic_lvl < spell.level)
    return res.status(409).json({ ok: false, message: `Requires Magic level ${spell.level}.` });

  const consumed = consumeItems(req.userId, spell.learn);
  if (!consumed.ok) {
    const needs = Object.entries(spell.learn).map(([item, qty]) => `${qty}× ${item}`).join(", ");
    return res.status(409).json({ ok: false, message: `You're missing ingredients — needs ${needs}.` });
  }

  learnSpell(req.userId, key);
  insertEvent("action", `You learned ${spell.name} at the Magic Table!`, "private", req.userId);
  log("INFO", `${req.user} learned spell ${key}`, game_config);
  recordQuestProgress(req.userId, "learn_spell", key, 1);
  return res.json({ ok: true, message: `${spell.name} learned!` });
});

// Cast a spell: spend mana + gain Magic XP, then resolve its effect. Only
// spells the player has learned (player_magic) can be cast.
// - attack: rolls effect.accuracy against the horde (same kill resolution as
//   a gun shot — see resolveKill); a miss still costs the mana/XP, same as a
//   missed shot still spends the round.
// - armor: grants a temporary +effect.ap bonus (on top of equipped armor) for
//   SPELL_ARMOR_BUFF_SECONDS, folded into armorApOf() for the tick's hit calc.
// - heal: restores effect.hp health to the caster (clamped to max_health).
// - aid: restores effect.hp_target health to the caster or, with an optional
//   {target: username}, another player.
// - travel: teleports straight to effect.loc, bypassing the travel graph
//   (same power as the admin teleport).
app.post("/api/spell/cast", requireAuth, (req, res) => {
  const key = String(req.body.key || "");
  const spell = MAGIC_SPELLS[key];
  if (!spell) return res.status(404).json({ ok: false, message: "Unknown spell." });
  if (!knowsSpell(req.userId, key))
    return res.status(409).json({ ok: false, message: `You haven't learned ${spell.name} — visit the Magic Table in Town.` });

  const player = ensurePlayer(req.userId);
  if (player.s_magic_lvl < spell.level)
    return res.status(409).json({ ok: false, message: `Requires Magic level ${spell.level}.` });
  if (player.mana < spell.cost)
    return res.status(409).json({ ok: false, message: `Not enough mana — ${spell.name} costs ${spell.cost}, you have ${player.mana}.` });

  const gameState = getGameState();
  if (spell.type === "attack") {
    if (!ZOMBIE_LOCATIONS.has(locationOf(player)))
      return res.status(409).json({ ok: false, message: "It's quiet here — no zombies in this area." });
    if (gameState.hunt_enabled !== "true")
      return res.status(409).json({ ok: false, message: "The hunt isn't active." });
    if (gameState.horde_size <= 0)
      return res.status(409).json({ ok: false, message: "No zombies to target." });
  }

  // aid: resolve the optional {target: username} BEFORE spending mana/XP —
  // a typo'd name shouldn't cost a cast.
  let aidTargetId = req.userId, aidTargetName = "";
  if (spell.type === "aid") {
    aidTargetName = String(req.body.target || "").trim();
    aidTargetId = aidTargetName ? getUserIdByName(aidTargetName)?.id : req.userId;
    if (!aidTargetId) return res.status(404).json({ ok: false, message: `No such player "${aidTargetName}".` });
  }

  addMana(req.userId, -spell.cost);
  addSkillXp(req.userId, "magic", spell.xp);

  if (spell.type === "attack") {
    const roll = Math.random() * 100;
    if (roll >= spell.effect.accuracy) {
      insertEvent("shoot", `You cast ${spell.name} and it fizzled`, "private", req.userId);
      log("INFO", `${req.user} cast ${key} -> miss (roll=${roll.toFixed(1)} chance=${spell.effect.accuracy})`, game_config);
      return res.json({ ok: true, result: "miss", message: `${spell.name} fizzled!` });
    }
    const killed = Math.min(spell.effect.targets, gameState.horde_size);
    const bonus = resolveKill(req.userId, req.user, killed, gameState, spell.name);
    log("INFO", `${req.user} cast ${key} -> hit x${killed}`, game_config);
    const base = killed > 1 ? `${spell.name} — ${killed} zombies down!` : `${spell.name} — zombie down!`;
    return res.json({ ok: true, result: "hit", killed, message: base + bonus });
  }

  if (spell.type === "armor") {
    SPELL_ARMOR_BUFFS.set(req.userId, { ap: spell.effect.ap, until: Date.now() + SPELL_ARMOR_BUFF_SECONDS * 1000 });
    const mins = SPELL_ARMOR_BUFF_SECONDS / 60;
    insertEvent("item", `You cast ${spell.name} — +${spell.effect.ap} AP for ${mins} minutes`, "private", req.userId);
    log("INFO", `${req.user} cast ${key} -> +${spell.effect.ap} AP (${mins}m)`, game_config);
    return res.json({ ok: true, message: `${spell.name} cast — +${spell.effect.ap} AP for ${mins} minutes.` });
  }

  if (spell.type === "heal") {
    const health = healPlayer(req.userId, spell.effect.hp);
    insertEvent("item", `You cast ${spell.name} — +${spell.effect.hp} health`, "private", req.userId);
    log("INFO", `${req.user} cast ${key} -> heal ${spell.effect.hp} (now ${health})`, game_config);
    return res.json({ ok: true, message: `${spell.name} cast — +${spell.effect.hp} health.` });
  }

  if (spell.type === "aid") {
    const health = healPlayer(aidTargetId, spell.effect.hp_target);
    if (aidTargetId === req.userId) {
      insertEvent("item", `You cast ${spell.name} — +${spell.effect.hp_target} health`, "private", req.userId);
    } else {
      insertEvent("item", `You cast ${spell.name} on ${aidTargetName} — +${spell.effect.hp_target} health`, "private", req.userId);
      insertEvent("item", `${req.user} cast ${spell.name} on you — +${spell.effect.hp_target} health`, "private", aidTargetId);
    }
    log("INFO", `${req.user} cast ${key} on ${aidTargetName || "self"} -> +${spell.effect.hp_target} hp (now ${health})`, game_config);
    return res.json({ ok: true, message: `${spell.name} cast — +${spell.effect.hp_target} health${aidTargetId === req.userId ? "" : ` to ${aidTargetName}`}.` });
  }

  if (spell.type === "travel") {
    updatePlayerLocation(req.userId, spell.effect.loc);
    insertEvent("travel", `You cast ${spell.name} and warp to ${LOCATION_NAMES[spell.effect.loc]}`, "private", req.userId);
    log("INFO", `${req.user} cast ${key} -> travel to ${spell.effect.loc}`, game_config);
    return res.json({ ok: true, message: `${spell.name} — you arrive at ${LOCATION_NAMES[spell.effect.loc]}.` });
  }

  return res.status(500).json({ ok: false, message: "Spell has no effect handler." });
});

// Buy the next level of one skill with MAIN player XP (skills also
// auto-level from their own training XP — see addSkillXp in db.js).
app.post("/api/skill/up", requireAuth, (req, res) => {
  const skill = String(req.body.skill || "");
  if (!SKILLS.includes(skill)) return res.status(400).json({ ok: false, message: "Unknown skill." });

  const r = buySkillLevel(req.userId, skill);
  if (!r.ok) return res.status(409).json({ ok: false, message: `Not enough XP — the next ${SKILL_NAMES[skill]} level costs ${r.cost ?? "?"}.` });

  insertEvent("level", `${req.user}'s ${SKILL_NAMES[skill]} skill increased to level ${r.level}!`, "public", "global");
  log("INFO", `${req.user} bought ${skill} level ${r.level} for ${r.cost} xp`, game_config);
  return res.json({ ok: true, message: `${SKILL_NAMES[skill]} is now level ${r.level} (−${r.cost} XP).` });
});

// Spend one stocked repair kit (game_state.base_repair_kits, stocked by using
// "base repair kit" items at the Bunker) to restore 500 base HP, capped at
// max. You must be sheltering inside to patch the walls.
app.post("/api/base/repair", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  if (locationOf(player) !== "basecamp_inside")
    return res.status(409).json({ ok: false, message: "You need to be inside the base to make repairs." });
  const gs = getGameState();
  if (baseIsDestroyed(gs)) return res.status(409).json({ ok: false, message: "The base is beyond repair kits." });
  if (gs.base_repair_kits <= 0) return res.status(409).json({ ok: false, message: "No repair kits stocked — use a Base Repair Kit at the Bunker." });
  if (gs.base_health >= game_config.baseMaxHealth)
    return res.status(409).json({ ok: false, message: "The base is at full health." });

  adjustRepairKits(-1);
  const heal = Math.min(500, game_config.baseMaxHealth - gs.base_health);
  const newHealth = adjustBaseHealth(heal);
  insertEvent("system", `🔧 ${req.user} used a repair kit — the base is at ${newHealth}/${game_config.baseMaxHealth} HP.`, "public", "global");
  log("INFO", `${req.user} repaired the base +${heal} (${newHealth}/${game_config.baseMaxHealth})`, game_config);
  return res.json({ ok: true, message: `Base repaired +${heal} (${newHealth}/${game_config.baseMaxHealth}).` });
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
  if (goingInside) checkQuestTriggers(req.userId, { type: "location", location: "basecamp_inside" });
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
// A sub-permission within admin — the 🎉 Fun modal/API needs users.adm_fun in
// addition to is_admin (the rest of the panel doesn't).
const adminFunReq = [requireAuth, requireAdmin, (req, res, next) => {
  if (!req.gates.admFun) return res.status(403).json({ ok: false, message: "You don't have Fun access." });
  next();
}];
const uidOf = (username) => getUserIdByName(String(username || "").trim())?.id ?? null;

// --- Users ---
app.get("/api/admin/users", adminReq, (req, res) => {
  // Enriched for the panel's player list: display location + online flag.
  const cutoff = Date.now() - game_config.timeout * 1000;
  res.json(listUsers().map((u) => {
    const locKey = LOCATION_NAMES[u.location] ? u.location : "basecamp_outside";
    return {
      ...u,
      locationName: LOCATION_NAMES[locKey],
      online: (u.last_seen ?? 0) >= cutoff,
      zombieZone: ZOMBIE_LOCATIONS.has(locKey),
    };
  }));
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
  insertEvent("system", `[Admin] ${req.user} added "${username}" to the userlist! Welcome our new companion and wish them luck!`, "public", "global");
  log("INFO", `${req.user} created user ${username} (admin=${admin})`, game_config);
  return res.json({ ok: true, message: `Created ${username}.` + (password ? "" : " (no password set)") });
});

app.post("/api/admin/users/delete", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  if (id === req.userId) return res.status(409).json({ ok: false, message: "You can't delete your own account." });
  deleteUserCascade(id);
  insertEvent("system", `[Admin] ${req.user} removed "${req.body.username}" from the game`, "public", "global");
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

app.post("/api/admin/users/admfun", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const value = req.body.value === "true" || req.body.value === "1";
  setAdmFun(id, value);
  log("INFO", `${req.user} set adm_fun=${value} for ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `${req.body.username} Fun access: ${value ? "granted" : "revoked"}.` });
});

// --- Moderation: chat flags, temp bans, exile ---
app.post("/api/admin/moderation/chatflag", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const flag = String(req.body.flag || "");
  if (!["mute", "deaf", "strict"].includes(flag)) return res.status(400).json({ ok: false, message: "Unknown chat flag." });
  const value = req.body.value === "true" || req.body.value === "1";
  setChatFlag(id, flag, value);
  insertEvent("system", `[Admin] ${req.user} ${value ? "set" : "cleared"} chat_${flag} on ${req.body.username}`, "public", "global");
  log("INFO", `${req.user} set chat_${flag}=${value} for ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `${req.body.username} chat_${flag}: ${value}.` });
});

// Duration is in whole seconds (the panel's dropdown / "custom" field compute
// it client-side); reason is optional and defaults to a standard template.
app.post("/api/admin/moderation/ban", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const seconds = Math.max(1, Math.round(Number(req.body.seconds)) || account_config.ban_timeout);
  const label = formatDuration(seconds);
  const reason = String(req.body.reason || "").trim() || `Admin ${req.user} Placed a ${label} ban on you`;
  banUser(id, seconds, reason, req.user);
  insertEvent("system", `[Admin] ${req.user} placed a ${label} ban on ${req.body.username}: ${reason}`, "public", "global");
  log("INFO", `${req.user} banned ${req.body.username} for ${label} (${reason})`, game_config);
  return res.json({ ok: true, message: `${req.body.username} banned for ${label}.` });
});

app.post("/api/admin/moderation/unban", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  unbanUser(id);
  insertEvent("system", `[Admin] ${req.user} lifted the ban on ${req.body.username}`, "public", "global");
  log("INFO", `${req.user} unbanned ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `${req.body.username} unbanned.` });
});

app.post("/api/admin/moderation/exile", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  if (id === req.userId) return res.status(409).json({ ok: false, message: "You can't exile yourself." });
  const reason = String(req.body.reason || "").trim() || `Admin ${req.user} exiled you`;
  exileUser(id, reason, req.user);
  insertEvent("system", `[Admin] ${req.user} permanently exiled ${req.body.username}: ${reason}`, "public", "global");
  log("WARN", `${req.user} exiled ${req.body.username} (${reason})`, game_config);
  return res.json({ ok: true, message: `${req.body.username} exiled.` });
});

app.post("/api/admin/moderation/unexile", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  unexileUser(id);
  insertEvent("system", `[Admin] ${req.user} lifted the exile on ${req.body.username}`, "public", "global");
  log("INFO", `${req.user} un-exiled ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `${req.body.username} un-exiled.` });
});

// Admin-authored chat — its own event type ("admin_chat") so chat_strict
// players (who only see admin chat, not regular player chat) can be told
// apart from a regular /api/chat message. Optionally addressed to one player
// ("[Admin->user] text"); left blank it reads as a broadcast ("[Admin] text").
// Always public — even a targeted message is visible to everyone, same as an
// @mention would be.
app.post("/api/admin/chat", adminReq, (req, res) => {
  const text = censorText(String(req.body.message || "").trim().slice(0, 300));
  if (!text) return res.status(400).json({ ok: false, message: "Empty message." });
  const target = String(req.body.target || "").trim();
  if (!target) { const target = req.user; }
  const label = target ? `[Admin->${target}]` : `[Admin (${req.user})]`;
  insertEvent("admin_chat", `${label} ${text}`, "public", "global");
  log("INFO", `${req.user} sent admin chat${target ? ` to ${target}` : " (broadcast)"}: ${text}`, game_config);
  return res.json({ ok: true });
});

// World Chat & Events panel's "Clear Feed" — wipes the chat/admin_chat/system
// events shown there (not gameplay history) and leaves a marker behind.
app.post("/api/admin/world/chat/clear", adminReq, (req, res) => {
  const removed = clearFeedEvents();
  insertEvent("system", `[Admin] ${req.user} cleared the event feed.`, "public", "global");
  log("INFO", `${req.user} cleared the event feed (${removed} event(s) removed)`, game_config);
  return res.json({ ok: true, message: `Cleared ${removed} event(s).` });
});

// --- Players ---
app.get("/api/admin/player", adminReq, (req, res) => {
  const id = uidOf(req.query.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const player = getPlayerByUserId(id);
  const inventory = getInventory(id);
  // `max: 1` marks the boolean (0/1) stats — the panel renders those as a toggle.
  const stats = Object.keys(EDITABLE_STATS).map((f) => ({ field: f, value: player[f], max: EDITABLE_STATS[f].max ?? null }));
  const skills = SKILLS.map((s) => ({
    key: s, name: SKILL_NAMES[s],
    level: player[`s_${s}_lvl`], xp: player[`s_${s}_xp`],
    nextCost: skillLevelCost(player[`s_${s}_lvl`] + 1),
  }));
  const guns = GUN_NAMES.map((g) => ({
    name: g,
    owned: inventory.some((i) => i.item_name === g && i.quantity > 0),
    equipped: player.equipped_gun === g,
  }));
  // One entry per paperdoll slot: the currently-equipped piece plus every
  // owned item matching that slot — feeds the admin panel's Armor tab.
  const armors = ARMOR_PIECES.map((slot) => ({
    slot,
    equipped: player[`a_${slot}`] || null,
    owned: inventory
      .filter((i) => ARMORS[i.item_name]?.piece === slot && i.quantity > 0)
      .map((i) => ({ name: i.item_name, label: ARMORS[i.item_name].name, ap: ARMORS[i.item_name].ap, defense: ARMORS[i.item_name].defense, condition: i.condition })),
  }));
  const locKey = locationOf(player);
  res.json({
    ok: true, username: String(req.query.username), level: player.level,
    nextLevelCost: levelCost(nextLevelOf(player.level)),
    equippedGun: player.equipped_gun, stats, skills, inventory, guns, armors,
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
  insertEvent("system", `[Admin] ${req.user} teleported ${req.body.username} to ${LOCATION_NAMES[to]}`, "public", "global");
  log("INFO", `${req.user} moved ${req.body.username} to ${to}`, game_config);
  return res.json({ ok: true, message: `Moved ${req.body.username} to ${LOCATION_NAMES[to]}.` });
});

// Admin power — the same reset a zombie kill triggers (full reset to level
// 1), but attributed to the admin instead of the horde, both in the player's
// own feed and the public world event.
app.post("/api/admin/player/kill", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  resetPlayer(id);
  insertEvent("death", `[Admin] ${req.user} killed you — back to level 1.`, "private", id);
  insertEvent("system", `[Admin] ${req.user} killed ${req.body.username} — they died and lost everything.`, "public", "global");
  log("WARN", `${req.user} admin-killed ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `${req.body.username} killed.` });
});

// Per-location occupancy (all players, online or not — mirrors getLocationCount's
// reserved-for-this purpose) plus bulk teleport tools for the Locations subtab.
app.get("/api/admin/world/locations", adminReq, (req, res) => {
  const cutoff = Date.now() - game_config.timeout * 1000;
  const onlineCounts = {};
  for (const p of getActivePlayers(cutoff)) {
    const lk = locationOf(p);
    onlineCounts[lk] = (onlineCounts[lk] || 0) + 1;
  }
  const locations = Object.entries(LOCATION_NAMES).map(([key, name]) => ({
    key, name, zombie: ZOMBIE_LOCATIONS.has(key),
    count: getLocationCount(key), online: onlineCounts[key] || 0,
  }));
  res.json({ ok: true, locations });
});

// Move everyone at a location inside the base.
app.post("/api/admin/world/locations/empty", adminReq, (req, res) => {
  const location = String(req.body.location || "");
  if (!LOCATION_NAMES[location]) return res.status(400).json({ ok: false, message: "Unknown location." });
  if (location === "basecamp_inside") return res.status(400).json({ ok: false, message: "Everyone here is already inside the base." });
  const players = getPlayersByLocation(location);
  for (const p of players) updatePlayerLocation(p.user_id, "basecamp_inside");
  if (players.length) {
    insertEvent("system", `[Admin] ${req.user} emptied ${LOCATION_NAMES[location]} — ${players.length} player(s) moved inside the base`, "public", "global");
    log("INFO", `${req.user} emptied ${location} (${players.length} players -> basecamp_inside)`, game_config);
  }
  return res.json({ ok: true, message: `Moved ${players.length} player(s) from ${LOCATION_NAMES[location]} into the base.` });
});

// Move everyone NOT at a location to it (admin power — bypasses the travel graph).
app.post("/api/admin/world/locations/teleport-all", adminReq, (req, res) => {
  const location = String(req.body.location || "");
  if (!LOCATION_NAMES[location]) return res.status(400).json({ ok: false, message: "Unknown location." });
  const players = getPlayersNotAtLocation(location);
  for (const p of players) updatePlayerLocation(p.user_id, location);
  if (players.length) {
    insertEvent("system", `[Admin] ${req.user} teleported everyone to ${LOCATION_NAMES[location]} — ${players.length} player(s) moved`, "public", "global");
    log("INFO", `${req.user} teleported all (${players.length} players) -> ${location}`, game_config);
  }
  return res.json({ ok: true, message: `Moved ${players.length} player(s) to ${LOCATION_NAMES[location]}.` });
});

// --- World state (game_state + who's online, with live busy/campfire flags) ---
app.get("/api/admin/world", adminReq, (req, res) => {
  const gs = getGameState();
  const cutoff = Date.now() - game_config.timeout * 1000;
  const activeRaw = getActivePlayers(cutoff);
  const online = activeRaw.map((p) => {
    const lk = locationOf(p);
    return {
      username: p.username, location: lk, locationName: LOCATION_NAMES[lk],
      zombieZone: ZOMBIE_LOCATIONS.has(lk),
      busy: busyUntilOf(p.user_id) > 0, campfire: campfireUntilOf(p.user_id) > 0,
    };
  });
  const destroyed = baseIsDestroyed(gs);
  res.json({
    ok: true,
    hunt: gs.hunt_enabled === "true",
    hordeSize: gs.horde_size,
    hordeStatus: hordeStatusOf(gs),
    raid: gs.raid_enabled === "true",
    base: {
      health: gs.base_health, max: game_config.baseMaxHealth, destroyed,
      ap: baseApOf(activeRaw), // summed armor AP of everyone sheltering inside
      repairKits: gs.base_repair_kits,
      sentryActive: gs.sentry_until > Date.now(),
      // Countdown target for the destroyed-base warning banner.
      resetAt: destroyed && gs.base_destroyed_at ? gs.base_destroyed_at + game_config.experimentResetHours * 3600 * 1000 : null,
    },
    online,
    // World Chat & Events feed — the conversational subset only (not the
    // shoot/travel/action spam), and NOT filtered by the viewing admin's own
    // chat_deaf/chat_strict (those gate the normal player view; this is a
    // moderation surface, it always shows everything).
    events: getRecentEvents(50, req.userId).reverse().filter((e) => ["chat", "admin_chat", "system"].includes(e.type)),
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
  const status = hordeStatusOf(getGameState());
  insertEvent("system", `[Admin] ${req.user} changed the zombie count to ${size} [${status}]`, "public", "global");
  log("INFO", `${req.user} set horde_size ${before} -> ${size}`, game_config);
  return res.json({ ok: true, message: `Horde set to ${size}.` });
});

// Clear the horde to 0 (and drop the raid latch, same as clearing it out by hand).
app.post("/api/admin/world/horde/nuke", adminReq, (req, res) => {
  const before = getGameState().horde_size;
  if (before <= 0) return res.json({ ok: true, message: "The wasteland is already quiet." });
  adjustHordeSize(-before);
  setRaidEnabled(false);
  insertEvent("system", `☢️ [Admin] ${req.user} called in a tactical nuke — all ${before} zombies were vaporized.`, "public", "global");
  log("INFO", `${req.user} nuked the horde (${before} zombies)`, game_config);
  return res.json({ ok: true, message: `Nuked ${before} zombies.` });
});

// Jump straight to the horde/raid threshold — sets the zombie count to exactly
// z_horde or z_raid, which (via hordeStatusOf/latchRaidIfNeeded) triggers the
// matching status change on its own.
app.post("/api/admin/world/horde/instant", adminReq, (req, res) => {
  const tier = req.body.tier === "raid" ? "raid" : "horde";
  const size = tier === "raid" ? zombie_config.z_raid : zombie_config.z_horde;
  const before = getGameState().horde_size;
  adjustHordeSize(size - before);
  latchRaidIfNeeded();
  const status = hordeStatusOf(getGameState());
  insertEvent("system", `[Admin] ${req.user} triggered an instant ${tier} — zombie count set to ${size} [${status}]`, "public", "global");
  log("INFO", `${req.user} triggered instant ${tier}, horde_size ${before} -> ${size}`, game_config);
  return res.json({ ok: true, message: `Instant ${tier}: zombie count set to ${size}.` });
});

// Free admin base fixes — bypass the repair-kit stock / craft-a-turret loop
// entirely, for testing or just fixing a bad tick. Both refuse a destroyed
// base (matching /api/base/repair and the panel's disabled buttons).
app.post("/api/admin/world/base/repair", adminReq, (req, res) => {
  const gs = getGameState();
  if (baseIsDestroyed(gs)) return res.status(409).json({ ok: false, message: "The base is destroyed — reset the experiment first." });
  const newHealth = adjustBaseHealth(game_config.baseMaxHealth - gs.base_health);
  insertEvent("system", `[Admin] ${req.user} refilled the base to full health (${newHealth}/${game_config.baseMaxHealth})`, "public", "global");
  log("INFO", `${req.user} refilled base health to ${newHealth}`, game_config);
  return res.json({ ok: true, message: `Base refilled to ${newHealth}/${game_config.baseMaxHealth}.` });
});

app.post("/api/admin/world/base/sentry", adminReq, (req, res) => {
  const gs = getGameState();
  if (baseIsDestroyed(gs)) return res.status(409).json({ ok: false, message: "The base is destroyed — reset the experiment first." });
  setSentryUntil(Date.now() + 4 * 3600 * 1000);
  insertEvent("system", `[Admin] ${req.user} activated a free sentry turret (4h)`, "public", "global");
  log("INFO", `${req.user} activated a free sentry turret`, game_config);
  return res.json({ ok: true, message: "Sentry turret online for 4h." });
});

// --- Admin Fun (the game page's 🎉 modal) ---
// Self-targeted cheats for the acting admin, plus the world-facing nuke.
// Everything goes through the same whitelisted/clamped helpers as the panel.
app.post("/api/admin/fun", adminFunReq, (req, res) => {
  const what = String(req.body.what || "");
  const uid = req.userId;
  const player = ensurePlayer(uid);

  if (what === "boost") {
    if (player.level < 99) forceLevel(uid, 99 - player.level);
    setPlayerStat(uid, "c_gold", 100000);
    setPlayerStat(uid, "c_tokens", 100);
    setPlayerStat(uid, "accuracy", 100);
    for (const g of GUN_NAMES) giveInventoryItem(uid, g, 1);
    insertEvent("item", "Player Boost: level 99, 100000 gold, 100 tokens, every gun, max accuracy.", "private", uid);
    log("INFO", `${req.user} used admin fun: boost`, game_config);
    return res.json({ ok: true, message: "Boosted — level 99, rich, armed, deadly." });
  }
  if (what === "items") {
    for (const key of Object.keys(ITEMS)) giveInventoryItem(uid, key, 99);
    insertEvent("item", "Admin drop: 99 of every item in existence.", "private", uid);
    log("INFO", `${req.user} used admin fun: items`, game_config);
    return res.json({ ok: true, message: "99 of everything — hope the backpack holds." });
  }
  if (what === "ammo") {
    for (const t of GUN_TYPES) {
      setPlayerStat(uid, `${t}_max_ammo`, 99);
      setPlayerStat(uid, `${t}_ammo`, 99);
      setPlayerStat(uid, `${t}_max_clips`, 99);
      setPlayerStat(uid, `${t}_clips`, 99);
    }
    insertEvent("item", "Bottomless pockets: every gun at 99/99 ammo and clips.", "private", uid);
    log("INFO", `${req.user} used admin fun: ammo`, game_config);
    return res.json({ ok: true, message: "All guns: 99/99 ammo and clips." });
  }
  if (what === "vitals") {
    setPlayerStat(uid, "max_health", 1000);
    setPlayerStat(uid, "health", 1000);
    setPlayerStat(uid, "max_shield", 1000);
    setPlayerStat(uid, "shield", 1000);
    insertEvent("item", "Juggernaut protocol: health and shield at 1000/1000.", "private", uid);
    log("INFO", `${req.user} used admin fun: vitals`, game_config);
    return res.json({ ok: true, message: "Health & shield: 1000/1000." });
  }
  if (what === "nuke") {
    const before = getGameState().horde_size;
    if (before <= 0) return res.json({ ok: true, message: "The wasteland is already quiet." });
    adjustHordeSize(-before);
    setRaidEnabled(false); // a cleared horde ends any raid, same as shooting it out
    insertEvent("system", `☢️ ${req.user} called in a tactical nuke — all ${before} zombies were vaporized.`, "public", "global");
    log("INFO", `${req.user} used admin fun: nuke (${before} zombies)`, game_config);
    return res.json({ ok: true, message: `Nuked ${before} zombies.` });
  }
  return res.status(400).json({ ok: false, message: "Unknown fun." });
});

app.post("/api/admin/player/stat", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const field = String(req.body.field);
  const before = getPlayerByUserId(id)?.[field];
  const r = setPlayerStat(id, field, req.body.value);
  if (!r.ok) return res.status(400).json({ ok: false, message: `Can't set ${req.body.field} (${r.reason}).` });
  // Boolean (0/1) stats read as a toggle; everything else as increased/decreased/set.
  const isBool = EDITABLE_STATS[field]?.max === 1;
  const suffix = field === "accuracy" ? "%" : "";
  const verb = isBool ? "toggled" : r.value > before ? "increased" : r.value < before ? "decreased" : "set";
  const shown = isBool ? (r.value ? "ON" : "OFF") : `${r.value}${suffix}`;
  insertEvent("system", `[Admin] ${req.user} ${verb} ${req.body.username} ${field} to ${shown}`, "public", "global");
  log("INFO", `${req.user} set ${req.body.username}.${req.body.field}=${r.value}`, game_config);
  return res.json({ ok: true, message: `${req.body.field} = ${r.value}` + (r.clamped ? " (clamped)" : ""), value: r.value });
});

app.post("/api/admin/player/inventory/add", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const item = String(req.body.item || "").trim();
  if (!item) return res.status(400).json({ ok: false, message: "Item name required." });
  const qty = Math.max(1, Number(req.body.qty) || 1);
  giveInventoryItem(id, item, qty);
  insertEvent("system", `[Admin] ${req.user} gave ${req.body.username} ${qty}x ${item}`, "public", "global");
  log("INFO", `${req.user} gave ${req.body.username} ${item} x${req.body.qty || 1}`, game_config);
  return res.json({ ok: true, message: `Added ${item} to ${req.body.username}.` });
});

app.post("/api/admin/player/inventory/remove", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const item = String(req.body.item || "").trim();
  const before = getInventory(id).find((i) => i.item_name === item)?.quantity ?? 0;
  const result = removeInventoryItem(id, item, req.body.qty);
  if (result === null) return res.status(409).json({ ok: false, message: `${req.body.username} doesn't have ${item}.` });
  insertEvent("system", `[Admin] ${req.user} took ${before - result}x ${item} from ${req.body.username}`, "public", "global");
  log("INFO", `${req.user} removed ${item} from ${req.body.username}`, game_config);
  return res.json({ ok: true, message: `Removed ${item} (${result} left).` });
});

app.post("/api/admin/player/level", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const steps = Math.trunc(Number(req.body.steps));
  if (!steps) return res.status(400).json({ ok: false, message: "steps must be a non-zero integer." });
  const newLevel = forceLevel(id, steps);
  insertEvent("system", `[Admin] ${req.user} ${steps > 0 ? "increased" : "decreased"} ${req.body.username} level to ${newLevel}`, "public", "global");
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
  insertEvent("system", `[Admin] ${req.user} equipped ${req.body.username} with the ${gun}`, "public", "global");
  log("INFO", `${req.user} equipped ${gun} on ${req.body.username}${owned ? "" : " (forced)"}`, game_config);
  return res.json({ ok: true, message: `Equipped ${gun}${owned ? "" : " (force-granted)"}.` });
});

// Same shape as the gun-equip route above, but per paperdoll slot. item: ""
// clears the slot.
app.post("/api/admin/player/armor/equip", adminReq, (req, res) => {
  const id = uidOf(req.body.username);
  if (id === null) return res.status(404).json({ ok: false, message: "No such user." });
  const slot = String(req.body.slot || "");
  if (!ARMOR_PIECES.includes(slot)) return res.status(400).json({ ok: false, message: "Unknown armor slot." });
  const armorName = String(req.body.item || "").trim();
  if (!armorName || armorName === "none") {
    equipArmorPiece(id, slot, "");
    insertEvent("system", `[Admin] ${req.user} cleared ${req.body.username}'s ${slot} armor slot`, "public", "global");
    log("INFO", `${req.user} cleared ${req.body.username}'s ${slot} armor slot`, game_config);
    return res.json({ ok: true, message: `${slot} slot cleared.` });
  }
  const item = ARMORS[armorName];
  if (!item) return res.status(400).json({ ok: false, message: "Unknown armor." });
  if (item.piece !== slot) return res.status(400).json({ ok: false, message: `${item.name} doesn't fit the ${slot} slot.` });
  const owned = getInventory(id).some((i) => i.item_name === armorName && i.quantity > 0);
  const force = req.body.force === "true" || req.body.force === "1";
  if (!owned && !force) return res.status(409).json({ ok: false, message: `${req.body.username} doesn't own a ${item.name} (use force).` });
  if (!owned) giveInventoryItem(id, armorName, 1);
  equipArmorPiece(id, slot, armorName);
  insertEvent("system", `[Admin] ${req.user} equipped ${req.body.username} with the ${item.name} (${slot})`, "public", "global");
  log("INFO", `${req.user} equipped ${armorName} on ${req.body.username}'s ${slot} slot${owned ? "" : " (forced)"}`, game_config);
  return res.json({ ok: true, message: `Equipped ${item.name}${owned ? "" : " (force-granted)"}.` });
});

// --- Item catalogue (read-only) ---
// Items live in item_backbone.js now, not an admin-editable table — the panel
// shows the registry + recipes for reference; editing means editing the file.
app.get("/api/admin/items", adminReq, (_req, res) => {
  res.json({
    types: ITEM_TYPES,
    smeltTypes: SMELT_TYPES, // metal-tab order for the Recipes box + the Item Registry's crafting side-tabs
    items: Object.entries(ITEMS).map(([key, i]) => ({
      key, name: i.name, type: i.type, section: i.section, desc: i.desc, value: i.value ?? null,
      shop: i.shop ?? null, use: i.use ?? null, gunType: i.gunType ?? null,
    })),
    recipes: RECIPES,
  });
});

// Code-defined static upgrades (potions, boosters, gun unlocks, Golden Gun).
// Read-only — these live in server.js, not the DB, so they're shown for reference.
app.get("/api/admin/upgrades", adminReq, (req, res) => {
  res.json(STATIC_UPGRADES.map(({ key, label, desc, cost, type, currency, category, item }) => ({
    key, label, desc, cost, type, currency: currency || "gold", category: category || "upgrade",
    item: item ?? null, // concrete inventory item this upgrade grants, if any (admin Give button)
  })));
});

// Every player's ownership of one item, for the Items tab's bulk "Give"
// modal — shows online status + current quantity per player before granting.
app.get("/api/admin/items/owners", adminReq, (req, res) => {
  const item = String(req.query.item || "").trim();
  if (!item) return res.status(400).json({ ok: false, message: "Item name required." });
  const cutoff = Date.now() - game_config.timeout * 1000;
  const owners = getItemOwners(item).map((p) => ({
    username: p.username, online: (p.last_seen ?? 0) >= cutoff, quantity: p.quantity,
  }));
  res.json({ ok: true, owners });
});

// Bulk grant: give `qty` of one item to every listed player at once — the
// Items tab's Give button (used for Item Registry rows, recipe outputs, and
// static-upgrade items) versus the Player Edit view's one-at-a-time dropdown.
app.post("/api/admin/items/give", adminReq, (req, res) => {
  const item = String(req.body.item || "").trim();
  if (!item) return res.status(400).json({ ok: false, message: "Item name required." });
  // Comma-joined, not a true array — the admin.html api() helper builds
  // POST bodies with plain URLSearchParams(body), which stringifies an
  // array value via Array.prototype.join(",") rather than repeating the key.
  const usernames = String(req.body.usernames || "").split(",").map((u) => u.trim()).filter(Boolean);
  if (!usernames.length) return res.status(400).json({ ok: false, message: "Select at least one player." });
  const qty = Math.max(1, Math.trunc(Number(req.body.qty)) || 1);

  const ids = [];
  for (const username of usernames) {
    const id = uidOf(username);
    if (id === null) return res.status(400).json({ ok: false, message: `No such user: ${username}` });
    ids.push(id);
  }

  giveItemToPlayers(ids, item, qty);
  const roster = usernames.length <= 6 ? usernames.join(", ") : `${usernames.slice(0, 6).join(", ")}, +${usernames.length - 6} more`;
  insertEvent("system", `[Admin] ${req.user} gave ${qty}x ${item} to ${roster} (${usernames.length} player${usernames.length === 1 ? "" : "s"}).`, "public", "global");
  log("INFO", `${req.user} bulk-gave ${item} x${qty} to ${usernames.join(", ")}`, game_config);
  res.json({ ok: true, message: `Gave ${qty}x ${item} to ${usernames.length} player${usernames.length === 1 ? "" : "s"}.` });
});

// The game tick (every z_tic seconds):
//   0. If the base is destroyed, freeze; auto-reset after experimentResetHours.
//   1. Spawn (hunt active): z_chance% to add a zombie.
//   2. Attack by tier: wandering (1 zombie @ z_hit%), hunting (up to 75% of
//      zombies each hit every player), raiding (each zombie @ z_hit/2% hits up
//      to 10 players for double damage; persists until the horde is cleared).
//   Inside players are shielded by the base (2 base damage each, up to 500);
//   base death kills everyone inside; personal health 0 kills that player.
const ARMOR_DEGRADE_CHANCE = 15; // % chance per landed hit — tunable

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

    // Dev -H/-r: keep the horde topped up to the hunting (-H) or raiding (-r)
    // threshold. Runs before the spawn/attack phases so the tier logic sees
    // the restored horde this same tick; -z caps the refill target.
    if ((DEV_FLAGS.hordeRefill || DEV_FLAGS.raidRefill) && gs.hunt_enabled === "true") {
      const floor = DEV_FLAGS.raidRefill ? zombie_config.z_raid : zombie_config.z_horde;
      const target = DEV_FLAGS.zombieCap ? Math.min(floor, DEV_FLAGS.zombieCap) : floor;
      if (gs.horde_size < target) {
        adjustHordeSize(target - gs.horde_size);
        latchRaidIfNeeded();
        insertEvent("spawn", `The horde swells back to ${target}`, "public", "global");
        log("INFO", `[dev ${DEV_FLAGS.raidRefill ? "-r" : "-H"}] horde refilled ${gs.horde_size} -> ${target}`, game_config);
        gs = getGameState();
      }
    }

    // 1) Spawn. A raid doubles the spawn chance. Dev -z: never spawn past the cap.
    const spawnChance = gs.raid_enabled === "true" ? zombie_config.z_chance * 2 : zombie_config.z_chance;
    if (DEV_FLAGS.zombieCap && gs.horde_size >= DEV_FLAGS.zombieCap) {
      // capped — skip the spawn roll entirely
    } else if (gs.hunt_enabled === "true" && Math.random() * 100 < spawnChance) {
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
    // in a safe area and sits this tick out entirely. Dev -s: admins are
    // invisible to the tick — no damage, no targeting, no base absorption.
    const active = getActivePlayers(cutoff)
      .filter((p) => ZOMBIE_LOCATIONS.has(locationOf(p)))
      .filter((p) => !(DEV_FLAGS.stealthAdmins && isUserAdmin(p.user_id)));
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
    // outside players take the hit and may die. The tallied total is checked
    // against the equipped armor's AP as the final hit calc: ap/AP_GAUGE of it
    // is blocked before any shield/health is touched.
    let baseDamage = 0, insideAbsorbed = 0;
    const deaths = [];
    for (const [uid, dmg] of dmgByPlayer) {
      const pl = active.find((a) => a.user_id === uid);
      if (pl.location === "basecamp_inside" && insideAbsorbed < 500) {
        baseDamage += 2; insideAbsorbed++;
      } else {
        const blocked = apBlocked(dmg, armorApOf(pl));
        const dealt = dmg - blocked;
        const r = damagePlayer(uid, dealt);
        const armorNote = blocked > 0 ? `, armor blocked ${blocked}` : "";
        insertEvent("attack", `A zombie hit you for ${dealt}${armorNote} (shield ${r.shield}, health ${r.health})`, "private", uid);
        // Taking a hit trains Defense — scaled from the damage that actually
        // landed (fully-blocked hits teach nothing): raids grind you tougher
        // slowly per point, lighter tiers pay better per point of pain.
        if (dealt > 0) {
          const defXp = raiding ? Math.max(1, Math.floor(dealt / 10)) : Math.max(1, Math.floor(dealt / 5) * 3);
          addSkillXp(uid, "defense", defXp);
          // Chance to strip 1 condition from a random equipped armor piece —
          // only rolls on damage that actually landed, same gate as Defense XP.
          const equippedSlots = ARMOR_PIECES.filter((slot) => pl[`a_${slot}`]);
          if (equippedSlots.length && Math.random() * 100 < ARMOR_DEGRADE_CHANCE) {
            const slot = equippedSlots[Math.floor(Math.random() * equippedSlots.length)];
            const itemName = pl[`a_${slot}`];
            const newCond = adjustArmorCondition(uid, itemName, -1);
            insertEvent("attack", `Your ${itemName} takes a scratch (condition ${newCond})`, "private", uid);
          }
        }
        if (r.health <= 0) deaths.push(pl);
      }
    }

    // Outside deaths.
    for (const d of deaths) {
      resetPlayer(d.user_id);
      insertEvent("death", "You died and lost everything — back to level 1.", "private", d.user_id);
      insertEvent("system", `${d.username} was torn apart by zombies.`, "public", "global");
    }

    // Sentry turret window (game_state.sentry_until): the base ignores all
    // zombie damage, and during a raid the turret returns fire — 50% chance
    // per tick to take a shot with Rifle logic at a fixed 75 "accuracy".
    const sentryActive = gs.sentry_until > Date.now();
    if (sentryActive && baseDamage > 0) {
      log("INFO", `tick: sentry turret absorbed ${baseDamage} base damage`, game_config);
      baseDamage = 0;
    }
    if (sentryActive && raiding && Math.random() < 0.5) {
      const zNow = getGameState().horde_size;
      if (zNow > 0) {
        const sentry = { accuracy: SENTRY_ACCURACY };
        if (Math.random() * 100 < computeHitChance(sentry, GUN_BEHAVIOR.rifle, SENTRY_ACCURACY)) {
          const kills = Math.min(zNow, riflePierces(sentry, zNow) ? 2 : 1);
          adjustHordeSize(-kills);
          const left = zNow - kills;
          insertEvent("kill", `🤖 The sentry turret opens fire — ${kills === 2 ? "a round punches through TWO zombies" : "a zombie drops"}! (${left} remain)`, "public", "global");
          log("INFO", `tick: sentry shot killed ${kills} (horde ${zNow} -> ${left})`, game_config);
          if (left <= 0) {
            setRaidEnabled(false);
            insertEvent("system", "The sentry turret cut down the last of the raid. The horde is broken.", "public", "global");
          }
        } else {
          insertEvent("attack", "🤖 The sentry turret fires into the raid — no hits.", "public", "global");
        }
      }
    }

    // Base damage & possible destruction. The armor of everyone sheltering
    // inside pools into Base AP and deflects base damage with the same hit
    // calc — capped at BASE_AP_MAX_BLOCK so a vault of armored players can
    // blunt a siege but never fully stall it.
    if (baseDamage > 0) {
      const baseAp = baseApOf(active);
      const deflected = Math.min(apBlocked(baseDamage, baseAp), Math.floor(baseDamage * BASE_AP_MAX_BLOCK));
      baseDamage -= deflected;
      if (deflected > 0) log("INFO", `tick: base AP ${baseAp} deflected ${deflected} base damage`, game_config);
    }
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
  `Startup: zboe2 ${app_version} mode=${runMode()} proto=${ssl_config.enabled ? "https" : "http"} debugLevel=${game_config.debugLevel} tick=${zombie_config.z_tic}s timeout=${game_config.timeout}s`
  // Active dev cheats belong in the summary — a -t/-s/-H run behaves nothing like a clean one.
  + (devFlagsUsed.length ? ` devFlags=${[...new Set(devFlagsUsed)].map((f) => (f === "-z" ? `-z=${DEV_FLAGS.zombieCap}` : f)).join(",")}` : "");
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
