// EDITABLE_STATS / setPlayerStat live in db_backbone.js (the single source of truth for
// which player columns are admin-editable and how they clamp).
import { styleText } from "node:util";
import {
  db, GUN_TYPES, GUN_NAMES, giveInventoryItem, EDITABLE_STATS, setPlayerStat, forceLevel,
  SKILLS, SKILL_NAMES, skillLevelCost, equipArmorPiece, equipWeaponSlot, setSelectedSlot,
  updatePlayerLocation,
} from "../../db_backbone.js";
import { ITEMS, ARMOR_PIECES } from "../../item_backbone.js";
import { LOCATION_NAMES } from "../../location_backbone.js";

// Same 5-slot weapon wheel server.js drives its admin/player equip routes off
// (WEAPON_SLOT_KEYS there) — kept as a local mirror since it's a UI-facing
// convention, not registry data.
const WEAPON_SLOT_KEYS = ["melee", "fist", "ranged", "throwing", "zombie"];
const WEAPON_SLOT_COLS = {
  melee: "equipped_melee", fist: "equipped_fist_weapon", ranged: "equipped_ranged",
  throwing: "equipped_throwing", zombie: "equipped_zombie_weapon",
};
// Zombie-themed weapons are eligible for the zombie slot regardless of their
// natural section — identified by key prefix (mirrors server.js's isZombieWeapon).
const isZombieWeapon = (name) => typeof name === "string" && name.startsWith("zombie ");
const weaponSlotOk = (slot, itemName, item) =>
  slot === "melee" ? item.section === "Melee" :
  slot === "fist" ? item.section === "Fist" :
  slot === "ranged" ? item.section === "Ranged" :
  slot === "throwing" ? item.section === "Throwing" :
  isZombieWeapon(itemName);

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

// One line per paperdoll slot: "  head:     Bronze Helm (AP 60, Def 1)" / "  head:     (empty)".
function armorLine(slot, row) {
  const itemName = row[`a_${slot}`];
  const label = `  ${(slot + ":").padEnd(10)}`;
  if (!itemName) return `${label} (empty)`;
  const item = ITEMS[itemName];
  const detail = item ? ` (AP ${item.ap}, Def ${item.defense})` : "";
  return `${label} ${itemName}${detail}`;
}

// One line per weapon-wheel slot, condition/ammo where the slot tracks them
// (the zombie slot has neither — see CLAUDE.md). '*' marks the active slot.
function weaponLine(slot, col, row) {
  const itemName = row[col];
  const active = row.selected_equip_slot === slot ? "*" : " ";
  const label = `  ${active}${(slot + ":").padEnd(10)}`;
  if (!itemName) return `${label} (empty)`;
  let detail = "";
  if (slot === "melee") detail = ` (cond ${row.melee_condition})`;
  else if (slot === "fist") detail = ` (cond ${row.fist_weapon_condition})`;
  else if (slot === "ranged") detail = ` (cond ${row.ranged_condition}, ammo ${row.ranged_ammo})`;
  else if (slot === "throwing") detail = ` (cond ${row.throwing_condition}, ammo ${row.throwing_ammo}/${row.throwing_max_ammo})`;
  return `${label} ${itemName}${detail}`;
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
  const stations = `forge_fired: ${row.forge_fired}   beacon_fired: ${row.beacon_fired}   ` +
    `arcane_table: ${row.arcane_table}   target_scope: ${row.target_scope}   ` +
    `zombie_near: ${row.zombie_near}/${row.zombie_near_health}hp`;

  const guns = GUN_TYPES.map((type, i) => gunLine(`${GUN_NAMES[i]}:`, row, type)).join("\n");

  const armorHeader = paint("bold", paint("cyan", "Armor:"));
  const armor = ARMOR_PIECES.map((slot) => armorLine(slot, row)).join("\n");

  const weaponsHeader = paint("bold", paint("cyan", "Weapon wheel:"));
  const weaponsList = WEAPON_SLOT_KEYS.map((slot) => weaponLine(slot, WEAPON_SLOT_COLS[slot], row)).join("\n");

  const skillsHeader = paint("bold", paint("cyan", "Skills:"));

  return `
${header}
${rule}
${core}
${currency}
${vitals}
${misc}
${stations}
${guns}
${armorHeader}
${armor}
${weaponsHeader}
${weaponsList}
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

// Per-slot armor overview: "slot|equippedItemName|ap|defense" (empty item
// name = slot cleared). Same purpose as guns() but per-slot since a player
// can own dozens of armor items across all 6 slots at once.
export async function armor(username) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  const row = db.prepare("SELECT * FROM players WHERE user_id = ?").get(userId);
  return ARMOR_PIECES.map((slot) => {
    const itemName = row[`a_${slot}`] || "";
    const item = itemName ? ITEMS[itemName] : null;
    return `${slot}|${itemName}|${item?.ap ?? ""}|${item?.defense ?? ""}`;
  }).join("\n");
}

// Owned armor items that fit a given slot, as "Name|owned(0/1)|equipped(0/1)|ap|defense"
// — mirrors guns()'s shape for the interactive equip menu.
export async function armoritems(username, slot) {
  if (!ARMOR_PIECES.includes(slot)) return `Unknown armor slot: ${slot}. Valid: ${ARMOR_PIECES.join(", ")}`;
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  const equipped = db.prepare(`SELECT a_${slot} AS v FROM players WHERE user_id = ?`).get(userId)?.v;
  const owned = db.prepare(
    "SELECT item_name FROM player_inventory WHERE user_id = ? AND quantity > 0"
  ).all(userId).map((r) => r.item_name);
  const lines = [];
  for (const [name, item] of Object.entries(ITEMS)) {
    if (item.type !== "armor" || item.piece !== slot) continue;
    const isOwned = owned.includes(name);
    lines.push(`${name}|${isOwned ? 1 : 0}|${name === equipped ? 1 : 0}|${item.ap}|${item.defense}`);
  }
  return lines.length ? lines.join("\n") : `(no ${slot} armor in the registry)`;
}

// Equip (or "" / "none" to clear) an armor item into one of the 6 paperdoll
// slots. Admin power, same shape as setgun: 'force' grants it first if
// unowned, and (unlike the player-facing route) the Defense-level gate is
// deliberately not enforced here — mirrors /api/admin/player/armor/equip.
export async function setarmor(username, slot, item, force) {
  if (!ARMOR_PIECES.includes(slot)) return `Unknown armor slot: ${slot}. Valid: ${ARMOR_PIECES.join(", ")}`;
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;

  if (!item || item === "none" || item === "") {
    equipArmorPiece(userId, slot, "");
    return `${username}'s ${slot} slot cleared`;
  }
  const reg = ITEMS[item];
  if (!reg || reg.type !== "armor") return `Unknown armor: ${item}`;
  if (reg.piece !== slot) return `${item} doesn't fit the ${slot} slot (fits ${reg.piece})`;

  const owned = db.prepare(
    "SELECT 1 FROM player_inventory WHERE user_id = ? AND item_name = ? AND quantity > 0"
  ).get(userId, item);
  const forcing = force === "force" || force === "true" || force === "1";
  if (!owned && !forcing) return `${username} doesn't own a ${item} (pass 'force' to grant it)`;
  if (!owned) giveInventoryItem(userId, item, 1);

  equipArmorPiece(userId, slot, item);
  return `${username} equipped ${item} in their ${slot} slot${owned ? "" : " (force-granted)"}`;
}

// Per-slot weapon-wheel overview: "slot|equippedItemName|active(0/1)".
export async function weapons(username) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  const row = db.prepare("SELECT * FROM players WHERE user_id = ?").get(userId);
  return WEAPON_SLOT_KEYS.map((slot) => {
    const itemName = row[WEAPON_SLOT_COLS[slot]] || "";
    return `${slot}|${itemName}|${row.selected_equip_slot === slot ? 1 : 0}`;
  }).join("\n");
}

// Owned weapons that fit a given wheel slot, as "Name|owned(0/1)|equipped(0/1)"
// — mirrors guns()/armoritems()'s shape.
export async function weaponitems(username, slot) {
  if (!WEAPON_SLOT_KEYS.includes(slot)) return `Unknown weapon slot: ${slot}. Valid: ${WEAPON_SLOT_KEYS.join(", ")}`;
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  const equipped = db.prepare(`SELECT ${WEAPON_SLOT_COLS[slot]} AS v FROM players WHERE user_id = ?`).get(userId)?.v;
  const owned = db.prepare(
    "SELECT item_name FROM player_inventory WHERE user_id = ? AND quantity > 0"
  ).all(userId).map((r) => r.item_name);
  const lines = [];
  for (const [name, item] of Object.entries(ITEMS)) {
    if (item.type !== "weapon" || !weaponSlotOk(slot, name, item)) continue;
    const isOwned = owned.includes(name);
    lines.push(`${name}|${isOwned ? 1 : 0}|${name === equipped ? 1 : 0}`);
  }
  return lines.length ? lines.join("\n") : `(no weapons fit the ${slot} slot)`;
}

// Equip (or "" / "none" to clear) a weapon into one of the 5 wheel slots and
// make it the active slot — mirrors /api/admin/player/weapon/equip, same
// force-grant convention as setgun/setarmor.
export async function setweapon(username, slot, item, force) {
  if (!WEAPON_SLOT_KEYS.includes(slot)) return `Unknown weapon slot: ${slot}. Valid: ${WEAPON_SLOT_KEYS.join(", ")}`;
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;

  if (!item || item === "none" || item === "") {
    equipWeaponSlot(userId, slot, "");
    setSelectedSlot(userId, slot);
    return `${username}'s ${slot} slot cleared`;
  }
  const reg = ITEMS[item];
  if (!reg || reg.type !== "weapon") return `Unknown weapon: ${item}`;
  if (!weaponSlotOk(slot, item, reg)) return `${item} doesn't go in the ${slot} slot`;

  const owned = db.prepare(
    "SELECT 1 FROM player_inventory WHERE user_id = ? AND item_name = ? AND quantity > 0"
  ).get(userId, item);
  const forcing = force === "force" || force === "true" || force === "1";
  if (!owned && !forcing) return `${username} doesn't own a ${item} (pass 'force' to grant it)`;
  if (!owned) giveInventoryItem(userId, item, 1);

  equipWeaponSlot(userId, slot, item);
  setSelectedSlot(userId, slot);
  return `${username} equipped ${item} in their ${slot} slot${owned ? "" : " (force-granted)"}`;
}

// Valid location keys/names, one per line — feeds the teleport menu picker.
export async function locations() {
  return Object.entries(LOCATION_NAMES).map(([key, name]) => `${key}|${name}`).join("\n");
}

// Teleport a player to any location, bypassing the travel graph — admin power,
// mirrors /api/admin/player/location.
export async function teleport(username, location) {
  if (!LOCATION_NAMES[location]) return `Unknown location: ${location}. Valid: ${Object.keys(LOCATION_NAMES).join(", ")}`;
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  updatePlayerLocation(userId, location);
  return `${username} moved to ${LOCATION_NAMES[location]}`;
}

// --- convenience one-off setters (kept for direct CLI use) ---
export async function setxp(username, xp) { return setstat(username, "xp", xp); }
export async function setkills(username, kills) { return setstat(username, "kills", kills); }
export async function setgold(username, gold) { return setstat(username, "c_gold", gold); }
