import {
  getUserByName, getUserIdByName,
  getLeaderboard, getRecentEvents, getEventCounts, getEventTotal,
  insertUser, insertPlayer, ensurePlayer,
  updatePlayerAmmo, updatePlayerStats, updatePlayerCondition,
  updatePlayerJamStatus, updatePlayerGun, updatePlayerAccuracy,
  updatePlayerMaxAmmo, updatePlayerMaxClips, updatePlayerInventory,
  updatePlayerLocation, updatePlayerHidden, valid_locations
} from "./db.js";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { game_config, file_config} from "./config.js";

const LOG_LEVELS = {
    FULL: 0,
    WARN: 1,
    ERROR: 2,
    FATAL: 3
};

const LOG_FILE = path.join("logs/", file_config.logFile || "server.log");
fs.mkdirSync("logs/", { recursive: true });
for (const arg of process.argv.slice(2)) {

  if (arg === '--dev')
    game_config.dev = true;

  else if (arg === '--production')
    game_config.production = true;

  else if (arg === '-v' || arg === '--verbose')
    game_config.verbose = true;

  else if (arg.startsWith('--debug-level=')) {
    game_config.debugLevel = arg.split('=')[1];
  }
}

const production = process.argv.includes('--production');
if (config.dev && production) {
  console.error(
    'ERROR: --dev and --production cannot be used together.'
  );

  process.exit(1);
}

function log(level, message, config) {

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
        console.log(line.trim());
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
    }, 30000);

}
process.on("uncaughtException", (err) => {
    log("FATAL", err.stack || err.message, config);
});

process.on("unhandledRejection", (reason) => {
    log("ERROR", String(reason), config);
});
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function hashPassword(password, salt) {
  log("FULL", `Hashing password with salt=${salt}`, config);
  return crypto.pbkdf2Sync(password, salt, 150000, 32, "sha256").toString("hex");
}

// ----- Very simple signed session cookie -----
function sign(value) {
  log("FULL", `Signing value: ${value}`, config);
  return crypto.createHmac("sha256", game_config.sessionSecret).update(value).digest("hex");
}
function setSession(res, username) {
  const payload = JSON.stringify({ u: username, t: Date.now() });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = sign(b64);
  log("FULL", `Setting session for ${username}`, config);
  res.cookie("zboe_session", `${b64}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // set true behind HTTPS
  });
}
function getSession(req) {
  const raw = req.cookies?.zboe_session;
  log("FULL", `Retrieving session cookie: ${raw}`, config);
  if (!raw) return null;
  const [b64, sig] = raw.split(".");
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  log("FULL", `Session valid for payload: ${b64}`, config);
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    log("WARN", "Failed to parse session payload", config);
    return null;
  }
}

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  const sess = getSession(req);
  log("FULL", `Authenticating request, session=${JSON.stringify(sess)}`, config);
  if (!sess?.u) return res.redirect("/login.html?err=Please%20login");
  log("FULL", `Looking up user for session username=${sess.u}`, config);
  const user = getUserIdByName(sess.u);
  log("FULL", `User lookup result for username=${sess.u}: ${JSON.stringify(user)}`, config);
  if (!user) return res.redirect("/login.html?err=Please%20login");
  log("FULL", `Authenticated user ${user.username} (id=${user.id})`, config);
  req.user = user.username;
  req.userId = user.id;
  next();
}

// Routes
app.get("/", (req, res) => {
  // Always show public homepage
  log("FULL", "Serving homepage", config);
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.get("/login", (_req, res) => res.redirect("/login.html"));
app.get("/register", (_req, res) => res.redirect("/register.html"));

app.post("/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  log("FULL", `Registration attempt for username=${username}`, config);
  if (!username || !password) return res.redirect("/register.html?err=Missing%20fields");
  log("FULL", `Validating registration input for username=${username}`, config);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.redirect("/register.html?err=Username%203-20%20chars%20letters%2Fnumbers%2F_");
    log("FULL", `Username validation failed for username=${username}`, config);
  }
  if (password.length < 4) return res.redirect("/register.html?err=Password%20too%20short");
  log("FULL", `Registration input valid for username=${username}, checking availability`, config);
  // check if user exists
  const existing = getUserByName(username);
  if (existing) return res.redirect("/register.html?err=Username%20taken"); log("FULL", `Username ${username} already taken`, config);

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  log("FULL", `Registering new user with username=${username}`, config);
  try {
    const info = insertUser(username, salt, hash, Date.now());
	insertPlayer(info.lastInsertRowid, Date.now());
    log("FULL", `User ${username} registered successfully with id=${info.lastInsertRowid}`, config);

  } catch (e) {
    // If a race condition happens (two requests same username), UNIQUE constraint will throw.
    log("ERROR", `Error inserting user ${username}: ${e.message}`, config);
    return res.redirect("/register.html?err=Username%20taken");
  }

  setSession(res, username);
  log("FULL", `Session set for new user ${username}, redirecting to game`, config);
  return res.redirect("/game");
});


app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  log("FULL", `Login attempt for username=${username}`, config);
  if (!username || !password) return res.redirect("/login.html?err=Missing%20fields");
  const rec = getUserByName(username);
  if (!rec) {
    return res.redirect("/login.html?err=Bad%20login");
    log("WARN", `No user record found for username=${username}`, config);
  }

  const hash = hashPassword(password, rec.pass_salt);
  if (hash !== rec.pass_hash) {
     return res.redirect("/login.html?err=Bad%20login");
      log("WARN", `Password hash mismatch for username=${username}`, config);
  }

  setSession(res, username);
  log("FULL", `User ${username} logged in successfully, redirecting to game`, config);
  increasePlayerCount(rec.id);
  return res.redirect("/game");
});


app.post("/logout", (req, res) => {
  res.clearCookie("zboe_session");
  res.redirect("/login.html");
  log("FULL", "User logged out, session cleared", config);
  decreasePlayerCount(req.userId);
});

app.get("/game", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "game.html"));
  log("FULL", `Serving game page to authenticated user ${req.user}`, config);
});

app.get("/api/game-state", requireAuth, (req, res) => {
  log("FULL", `API request for game state by user ${req.user}`, config);
  const player = ensurePlayer(req.userId);
  const leaderboard = getLeaderboard(10);
  const recentEvents = getRecentEvents(80).reverse();
  const countRows = getEventCounts();
  const eventCounts = countRows.reduce((acc, row) => {
    acc[row.type] = row.count;
    return acc;
  }, {});
  const totalEvents = getEventTotal();
  const triggerOutOf = 15;
  const triggerValue = totalEvents % triggerOutOf;
  const zombies = Math.max(0, (eventCounts.spawn || 0) - (eventCounts.kill || 0));
  const lastEvent = recentEvents.at(-1);
  const tickMinutes = Number.parseInt(process.env.HUNT_TICK_MINUTES || "5", 10);

  res.json({
    huntActive: totalEvents > 0,
    horde: lastEvent?.type === "horde",
    zombies,
    tickMinutes: Number.isNaN(tickMinutes) ? 5 : tickMinutes,
    trigger: { value: triggerValue, outOf: triggerOutOf },
    online: [req.user],
    leaderboard,
    me: {
      user: req.user,
      xp: player.xp,
      kills: player.kills,
      ammo: player.ammo,
      maxAmmo: player.max_ammo,
      clips: player.clips,
      maxClips: player.max_clips,
      acc: player.accuracy,
      cond: player.condition,
      jammed: Boolean(player.jammed),
    },
    events: recentEvents,
  });
});



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZBOE web MVP running on http://localhost:${PORT}`);
});
