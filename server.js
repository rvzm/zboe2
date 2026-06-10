import { db } from "./db.js";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config, LOG_LEVELS} from "./config.js";

const LOG_DIR = "./logs";
const LOG_FILE = path.join(LOG_DIR, "server.log");

fs.mkdirSync(LOG_DIR, { recursive: true });
for (const arg of process.argv.slice(2)) {

  if (arg === '--dev')
    config.dev = true;

  else if (arg === '--production')
    config.production = true;

  else if (arg === '-v' || arg === '--verbose')
    config.verbose = true;

  else if (arg.startsWith('--debug-level=')) {
    config.debugLevel = arg.split('=')[1];
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

    if (config.debug) {
        fs.appendFileSync(LOG_FILE, line);
    }

    if (
        config.verbose &&
        LOG_LEVELS[level] >= LOG_LEVELS[config.debugLevel]
    ) {
        console.log(line.trim());
    }

    if (level === "FATAL") {
        process.exit(1);
    }
}
function startVerboseHeartbeat(config) {

    if (!config.verbose)
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

// ----- SQLite statements -----
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
  INSERT INTO users (username, pass_salt, pass_hash, created_at)
  VALUES (?, ?, ?, ?)
`);

const stmtInsertPlayer = db.prepare(`
  INSERT INTO players (user_id, xp, kills, ammo, max_ammo, clips, max_clips, accuracy, condition, jammed, updated_at)
  VALUES (?, 0, 0, 6, 6, 3, 3, 35, 100, 0, ?)
`);


function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 150000, 32, "sha256").toString("hex");
}

// ----- Very simple signed session cookie -----
function sign(value) {
  log("FULL", `Signing value: ${value}`, config);
  return crypto.createHmac("sha256", config.sessionSecret).update(value).digest("hex");
}
function setSession(res, username) {
  const payload = JSON.stringify({ u: username, t: Date.now() });
  const b64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = sign(b64);
  res.cookie("zboe_session", `${b64}.${sig}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // set true behind HTTPS
  });
}
function getSession(req) {
  const raw = req.cookies?.zboe_session;
  if (!raw) return null;
  const [b64, sig] = raw.split(".");
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

function ensurePlayer(userId) {
  let player = stmtPlayerByUserId.get(userId);
  if (!player) {
    stmtInsertPlayer.run(userId, Date.now());
    player = stmtPlayerByUserId.get(userId);
  }
  return player;
}

function requireAuth(req, res, next) {
  const sess = getSession(req);
  if (!sess?.u) return res.redirect("/login.html?err=Please%20login");
  const user = stmtUserIdByName.get(sess.u);
  if (!user) return res.redirect("/login.html?err=Please%20login");
  req.user = user.username;
  req.userId = user.id;
  next();
}

// Routes
app.get("/", (req, res) => {
  // Always show public homepage
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


app.get("/login", (_req, res) => res.redirect("/login.html"));
app.get("/register", (_req, res) => res.redirect("/register.html"));

app.post("/register", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password) return res.redirect("/register.html?err=Missing%20fields");
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.redirect("/register.html?err=Username%203-20%20chars%20letters%2Fnumbers%2F_");
  }
  if (password.length < 4) return res.redirect("/register.html?err=Password%20too%20short");

  // check if user exists
  const existing = stmtUserByName.get(username);
  if (existing) return res.redirect("/register.html?err=Username%20taken");

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);

  try {
    const info = stmtInsertUser.run(username, salt, hash, Date.now());
	stmtInsertPlayer.run(info.lastInsertRowid, Date.now());

  } catch (e) {
    // If a race condition happens (two requests same username), UNIQUE constraint will throw.
    return res.redirect("/register.html?err=Username%20taken");
  }

  setSession(res, username);
  return res.redirect("/game");
});


app.post("/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  const rec = stmtUserByName.get(username);
  if (!rec) return res.redirect("/login.html?err=Bad%20login");

  const hash = hashPassword(password, rec.pass_salt);
  if (hash !== rec.pass_hash) return res.redirect("/login.html?err=Bad%20login");

  setSession(res, username);
  return res.redirect("/game");
});


app.post("/logout", (req, res) => {
  res.clearCookie("zboe_session");
  res.redirect("/login.html");
});

app.get("/game", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "game.html"));
});

app.get("/api/game-state", requireAuth, (req, res) => {
  const player = ensurePlayer(req.userId);
  const leaderboard = stmtLeaderboard.all(10);
  const recentEvents = stmtRecentEvents.all(80).reverse();
  const countRows = stmtEventCounts.all();
  const eventCounts = countRows.reduce((acc, row) => {
    acc[row.type] = row.count;
    return acc;
  }, {});
  const totalEvents = stmtEventTotal.get()?.total ?? 0;
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

