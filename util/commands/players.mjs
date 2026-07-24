// EDITABLE_STATS / setPlayerStat live in db_backbone.js (the single source of truth for
// which player columns are admin-editable and how they clamp).
import { styleText } from "node:util";
import {
  db, GUN_NAMES, giveInventoryItem, EDITABLE_STATS, setPlayerStat, forceLevel,
  SKILLS, SKILL_NAMES, skillLevelCost,
} from "../../db_backbone.js";

function getUserId(username) {
  return db.prepare("SELECT id FROM users WHERE username = ?").get(username)?.id ?? null;
}

const fmtTime = (ms) => (ms ? new Date(ms).toISOString() : "(never)");

// util.styleText no-ops to plain text for non-TTYs, pipes/redirects, and when
// NO_COLOR is set — so callers never have to check whether color is available.
// The try/catch keeps us safe on older Node or an unknown format name.
function paint(format, text, stream = process.stdout) {
  try { return styleText(format, text, { stream }); }
  catch { return text; }
}

// Same 5-tier condition palette as public/game.html's condTierOf.
function condColor(cond) {
  if (cond >= 85) return "green";
  if (cond >= 61) return "blue";
  if (cond >= 41) return "yellow";
  if (cond >= 21) return "red";
  return "gray";
}

function gunLine(label, row, type) {
  const cond = row[`${type}_condition`];
  const jammed = row[`${type}_jammed`];
  const condText = paint(condColor(cond), String(cond));
  const jamText = jammed ? " " + paint("red", "[JAMMED]") : "";
  return `  ${label.padEnd(12)} ${row[`${type}_ammo`]}/${row[`${type}_max_ammo`]} ammo, ` +
    `${row[`${type}_clips`]}/${row[`${type}_max_clips`]} clips, cond ${condText}${jamText}`;
}

// 4-column skill grid — pad the plain text to a fixed width *before* coloring
// it, since ANSI escape codes would otherwise be counted by padEnd() and break
// column alignment.
function skillsGrid(row) {
  const cells = SKILLS.map((key) => {
    const lvl = row[`s_${key}_lvl`];
    const xp = row[`s_${key}_xp`];
    const cost = skillLevelCost(lvl + 1);
    const plain = `${SKILL_NAMES[key]}: L${lvl} (${xp}/${cost})`;
    return plain.padEnd(22);
  });
  const cols = 4;
  const lines = [];
  for (let i = 0; i < cells.length; i += cols) {
    lines.push("  " + cells.slice(i, i + cols).join(" "));
  }
  return lines.join("\n");
}

export async function stats(username) {
  const row = db.prepare(`
    SELECT u.username, u.last_login, p.*
    FROM players p
    JOIN users u ON u.id = p.user_id
    WHERE u.username = ?
  `).get(username);

  if (!row) return "Player not found";

  const header = paint("bold", row.username);
  const rule = "-".repeat(row.username.length);

  const core = `Core:     level ${row.level}   xp ${row.xp}   lifetime_xp ${row.lifetime_xp}   ` +
    `kills ${row.kills}   ap_level ${row.ap_level}`;
  const currency = `Currency: gold ${paint("yellow", String(row.c_gold))}   ` +
    `tokens ${paint("magenta", String(row.c_tokens))}`;
  const vitals = `Vitals:   health ${paint("red", `${row.health}/${row.max_health}`)}   ` +
    `shield ${paint("blue", `${row.shield}/${row.max_shield}`)}   ` +
    `mana ${paint("magenta", `${row.mana}/${row.mana_max}`)}   accuracy ${row.accuracy}`;
  const misc = `location: ${row.location ?? "(none)"}   hidden: ${row.hidden}   ` +
    `equipped: ${row.equipped_gun}\nlast_login: ${fmtTime(row.last_login)}   ` +
    `last_seen: ${fmtTime(row.last_seen)}`;

  const guns = [
    gunLine("Handgun:", row, "handgun"),
    gunLine("Rifle:", row, "rifle"),
    gunLine("Shotgun:", row, "shotgun"),
    gunLine("BurstRifle:", row, "burstrifle"),
  ].join("\n");

  const skillsHeader = paint("bold", paint("cyan", "Skills:"));

  return `
${header}
${rule}
${core}
${currency}
${vitals}
${misc}
${guns}
${skillsHeader}
${skillsGrid(row)}
`.trim();
}

// Machine-readable "field|value" lines for the interactive stats menu.
export async function statsraw(username) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  const row = db.prepare("SELECT * FROM players WHERE user_id = ?").get(userId);
  return Object.keys(EDITABLE_STATS).map((f) => `${f}|${row[f]}`).join("\n");
}

export async function getstat(username, field) {
  if (!(field in EDITABLE_STATS)) return `Unknown stat: ${field}`;
  const row = db.prepare(`
    SELECT p.${field} AS v FROM players p JOIN users u ON u.id = p.user_id WHERE u.username = ?
  `).get(username);
  return row ? String(row.v) : `No such player: ${username}`;
}

export async function setstat(username, field, value) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;

  const r = setPlayerStat(userId, field, value);
  if (!r.ok) {
    if (r.reason === "bad_field") return `Unknown/uneditable stat: ${field}`;
    if (r.reason === "nan") return `Not a number: ${value}`;
    if (r.reason === "no_player") return `No such player: ${username}`;
    return `Could not set ${field}`;
  }
  return `${username}.${field} = ${r.value}` + (r.clamped ? " (clamped)" : "");
}

// Full-stack level change by +/- steps (same logic as the web admin's level
// control): applies stat + lifetime-XP gains, no spendable-XP cost.
export async function forcelevel(username, steps) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  const n = Math.trunc(Number(steps));
  if (!n) return "steps must be a non-zero integer";
  const newLevel = forceLevel(userId, n);
  return `${username} is now level ${newLevel}`;
}

// Lists guns as "Name|owned(0/1)|equipped(0/1)" for the interactive equip menu.
export async function guns(username) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  const equipped = db.prepare("SELECT equipped_gun FROM players WHERE user_id = ?").get(userId)?.equipped_gun;
  return GUN_NAMES.map((g) => {
    const owned = db.prepare(
      "SELECT 1 FROM player_inventory WHERE user_id = ? AND item_name = ? AND quantity > 0"
    ).get(userId, g);
    return `${g}|${owned ? 1 : 0}|${g === equipped ? 1 : 0}`;
  }).join("\n");
}

// Equip a gun. Only known guns are allowed; pass "force" to grant an unowned one.
export async function setgun(username, gun, force) {
  if (!GUN_NAMES.includes(gun)) return `Unknown gun: ${gun}. Valid: ${GUN_NAMES.join(", ")}`;
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;

  const owned = db.prepare(
    "SELECT 1 FROM player_inventory WHERE user_id = ? AND item_name = ? AND quantity > 0"
  ).get(userId, gun);
  const forcing = force === "force" || force === "true" || force === "1";

  if (!owned && !forcing) return `${username} doesn't own a ${gun} (pass 'force' to grant it)`;
  if (!owned) giveInventoryItem(userId, gun, 1);

  db.prepare("UPDATE players SET equipped_gun = ?, updated_at = ? WHERE user_id = ?")
    .run(gun, Date.now(), userId);

  return `${username} equipped ${gun}${owned ? "" : " (force-granted)"}`;
}

// --- convenience one-off setters (kept for direct CLI use) ---
export async function setxp(username, xp) { return setstat(username, "xp", xp); }
export async function setkills(username, kills) { return setstat(username, "kills", kills); }
export async function setgold(username, gold) { return setstat(username, "c_gold", gold); }
