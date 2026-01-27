import { db } from "./db.js";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- SQLite statements -----
const stmtUserByName = db.prepare(`SELECT id, username, pass_salt, pass_hash FROM users WHERE username = ?`);
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
const SESSION_SECRET = process.env.SESSION_SECRET || "changeme";
function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
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

function requireAuth(req, res, next) {
  const sess = getSession(req);
  const stmtUserIdByName = db.prepare(`SELECT id, username FROM users WHERE username = ?`);
  const stmtPlayerByUserId = db.prepare(`SELECT * FROM players WHERE user_id = ?`);
  if (!sess?.u) return res.redirect("/login.html?err=Please%20login");
  req.user = sess.u;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZBOE web MVP running on http://localhost:${PORT}`);
});

