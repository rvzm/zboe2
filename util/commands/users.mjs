// cli/commands/users.js
import crypto from "node:crypto";
import { db, insertPlayer, banUser, unbanUser, exileUser, unexileUser, setChatFlag, setAdmFun } from "../../db.js";
import { account_config } from "../../config.js";

// Mirrors server.js hashPassword so CLI-created accounts can log in.
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 150000, 32, "sha256").toString("hex");
}

export async function list() {
  const rows = db.prepare(
    "SELECT id, username, is_admin FROM users ORDER BY id"
  ).all();

  return rows.length
    ? rows.map(r => `${r.id} | ${r.username} | admin=${r.is_admin}`).join("\n")
    : "(no users)";
}

// Bare usernames, one per line — used by the menus' "list" picker.
export async function names() {
  return db.prepare("SELECT username FROM users ORDER BY username").all().map(r => r.username).join("\n");
}

export async function add(username, password) {
  if (!username) return "Usage: users add <username> [password]";
  if (db.prepare("SELECT id FROM users WHERE username = ?").get(username)) {
    return `User already exists: ${username}`;
  }

  const now = Date.now();
  const salt = password ? crypto.randomBytes(16).toString("hex") : "";
  const hash = password ? hashPassword(password, salt) : "";

  const info = db.prepare(`
    INSERT INTO users (username, is_admin, pass_salt, pass_hash, created_at, last_login)
    VALUES (?, 0, ?, ?, ?, ?)
  `).run(username, salt, hash, now, now);

  insertPlayer(info.lastInsertRowid, now); // give them a player row (+ starting Handgun)

  return `Created user: ${username}` +
    (password ? "" : " (no password set — use 'users setpassword' before they can log in)");
}

export async function setpassword(username, password) {
  if (!username || !password) return "Usage: users setpassword <username> <password>";
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  const res = db.prepare(
    "UPDATE users SET pass_salt = ?, pass_hash = ? WHERE username = ?"
  ).run(salt, hash, username);
  return res.changes ? `Password updated for ${username}` : `No such user: ${username}`;
}

export async function remove(username) {
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!user) return `No such user: ${username}`;

  // Remove the user and everything hanging off them.
  db.transaction(() => {
    db.prepare("DELETE FROM player_inventory WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM players WHERE user_id = ?").run(user.id);
    db.prepare("DELETE FROM events WHERE target = ?").run(String(user.id));
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  })();

  return `Deleted user: ${username} (and their player, inventory, and private events)`;
}

export async function setadmin(username, value) {
  const flag = value === "true" || value === "1" ? 1 : 0;
  const res = db.prepare(
    "UPDATE users SET is_admin = ? WHERE username = ?"
  ).run(flag, username);
  return res.changes ? `${username} admin=${flag}` : `No such user: ${username}`;
}

function getUserId(username) {
  return db.prepare("SELECT id FROM users WHERE username = ?").get(username)?.id ?? null;
}

// A ban duration in whole seconds, formatted for humans — mirrors
// server.js's formatDuration (moderation log lines / the default reason).
function formatDuration(seconds) {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

// "24h" / "90m" / "5d" / "300" (bare number = seconds) -> seconds. Returns
// null on anything unparseable so the caller can show a usage error.
function parseDuration(str) {
  const m = /^(\d+)(s|m|h|d)?$/i.exec(String(str || "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[m[2]?.toLowerCase() || "s"];
  return n * mult;
}

export async function admfun(username, value) {
  const id = getUserId(username);
  if (id === null) return `No such user: ${username}`;
  const flag = value === "true" || value === "1";
  setAdmFun(id, flag);
  return `${username} adm_fun=${flag}`;
}

export async function chatflag(username, flag, value) {
  if (!["mute", "deaf", "strict"].includes(flag)) return "Usage: users chatflag <username> <mute|deaf|strict> <0|1>";
  const id = getUserId(username);
  if (id === null) return `No such user: ${username}`;
  const on = value === "true" || value === "1";
  setChatFlag(id, flag, on);
  return `${username} chat_${flag}=${on}`;
}

// users ban <username> [duration] [reason...] — duration defaults to
// account_config.ban_timeout; reason defaults to the standard notice shown
// on the login page.
export async function ban(username, duration, ...reasonParts) {
  if (!username) return "Usage: users ban <username> [duration=24h] [reason...]";
  const id = getUserId(username);
  if (id === null) return `No such user: ${username}`;
  const seconds = duration ? parseDuration(duration) : account_config.ban_timeout;
  if (seconds === null) return `Bad duration "${duration}" — use e.g. 30m, 24h, 3d, or a bare number of seconds.`;
  const label = formatDuration(seconds);
  const reason = reasonParts.join(" ").trim() || `Admin (CLI) Placed a ${label} ban on you`;
  banUser(id, seconds, reason, "CLI");
  return `${username} banned for ${label} — ${reason}`;
}

export async function unban(username) {
  const id = getUserId(username);
  if (id === null) return `No such user: ${username}`;
  unbanUser(id);
  return `${username} unbanned`;
}

export async function exile(username, ...reasonParts) {
  if (!username) return "Usage: users exile <username> [reason...]";
  const id = getUserId(username);
  if (id === null) return `No such user: ${username}`;
  const reason = reasonParts.join(" ").trim() || "Admin (CLI) exiled you";
  exileUser(id, reason, "CLI");
  return `${username} permanently exiled — ${reason}`;
}

export async function unexile(username) {
  const id = getUserId(username);
  if (id === null) return `No such user: ${username}`;
  unexileUser(id);
  return `${username} un-exiled`;
}
