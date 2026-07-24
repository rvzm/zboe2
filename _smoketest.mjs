// _smoketest.mjs — reusable regression smoketest for zboe2.
//
// Boots a fully isolated scratch instance (own DB file under os.tmpdir(),
// own random port) and exercises the core API surface end to end. Never
// touches the real dev DB (data/zboe.sqlite) or collides with any other
// running instance (e.g. a separate --dev session on port 3000).
//
// Usage: node _smoketest.mjs   (or: npm run smoketest)
// Exits 0 only if every check passes — safe to use as a go/no-go gate
// before calling a change "done".
//
// This file is deliberately standalone (no imports from server.js/db_backbone.js
// beyond the pure-data item_backbone.js) and is meant to be kept current:
// add a check here whenever a new route/feature is built, or a past bug
// (like the RECIPES typos below) deserves a permanent regression guard.

import { spawn } from "node:child_process";
import { styleText } from "node:util";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPES, ITEMS, ARMOR_PIECES, WEAPON_TYPES, WEAPON_ATTACK_EXPORT, WEAPON_FIREARM_TYPES, WEAPON_FIREARM_EXPORT } from "./item_backbone.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function paint(format, text) {
  try { return styleText(format, text); } catch { return text; }
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok });
  const mark = ok ? paint("green", "✓") : paint(["bold", "red"], "✗");
  console.log(`${mark} ${name}${detail ? paint("dim", "  — " + detail) : ""}`);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === "string" ? detail : undefined);
  } catch (e) {
    record(name, false, e.message);
  }
}

console.log(paint(["bold", "cyan"], "== Stage 0: registry sanity (no server needed) =="));
{
  const RECIPE_CATEGORIES = ["food", "potion", "base", "magic", "metal", "misc", "weapon", "armor"];
  const bad = [];
  for (const r of RECIPES) {
    if (!RECIPE_CATEGORIES.includes(r.category)) bad.push(`${r.key}: bad category "${r.category}"`);
    if (r.category === "metal" && (!r.metal || !r.metalType)) bad.push(`${r.key}: metal category missing metal/metalType`);
    if (r.category !== "metal" && (r.metal || r.metalType)) bad.push(`${r.key}: has metal/metalType but category isn't "metal"`);
  }
  record(`every RECIPES row (${RECIPES.length}) has a valid category`, bad.length === 0, bad.slice(0, 5).join("; "));
}
{
  // Armor system regression guard: every armor item has a real paperdoll
  // piece (the head/helm/chestplate/leggings naming mismatch that predated
  // the multi-slot rework), and no recipe's station is a non-string (the
  // array-shaped station bug the zombie-tier recipes used to have).
  const armors = Object.entries(ITEMS).filter(([, i]) => i.type === "armor");
  const badPiece = armors.filter(([, i]) => !ARMOR_PIECES.includes(i.piece)).map(([k]) => k);
  record(`every armor item (${armors.length}) has a valid piece (${ARMOR_PIECES.join("/")})`, badPiece.length === 0, badPiece.slice(0, 5).join(", "));

  const badStation = RECIPES.filter((r) => r.station !== undefined && typeof r.station !== "string").map((r) => r.key);
  record(`no RECIPES row has a non-string station`, badStation.length === 0, badStation.slice(0, 5).join(", "));
}
{
  // Zombie Location Pool: WEAPON_FIREARM_EXPORT is the Nearby-scope gun
  // accuracy/damage model — every WEAPON_FIREARM_TYPES key needs a valid
  // entry, and every WEAPON_TYPES section needs a floor in WEAPON_ATTACK_EXPORT
  // (the boot-crash-then-FATAL bug this regression-guards against: server.js
  // couldn't even boot far enough to run its own validator until the
  // WEAPON_RANGED_TYPES/WEAPON_RANGED_OPTIONS import mismatch was fixed).
  const badFirearm = WEAPON_FIREARM_TYPES.filter((t) => {
    const cfg = WEAPON_FIREARM_EXPORT[t];
    return !cfg || !(Number.isFinite(cfg.dmg) && cfg.dmg >= 0) || !["player", "condition"].includes(cfg.accuracyModel);
  });
  record(`every WEAPON_FIREARM_TYPES entry (${WEAPON_FIREARM_TYPES.length}) has a valid WEAPON_FIREARM_EXPORT row`, badFirearm.length === 0, badFirearm.join(", "));

  const badFloor = WEAPON_TYPES.filter((s) => !Number.isFinite(WEAPON_ATTACK_EXPORT[s]?.floor));
  record(`every WEAPON_TYPES section (${WEAPON_TYPES.length}) has a floor in WEAPON_ATTACK_EXPORT`, badFloor.length === 0, badFloor.join(", "));

  // Gun attack_mod: an item-level { dmg?, acc?, floor? } offset from its base
  // WEAPON_FIREARM_EXPORT[gunType] row. No gun uses it yet — this passes
  // vacuously today and becomes a live guard the moment one does.
  const badMod = Object.entries(ITEMS).filter(([, i]) => i.type === "gun" && i.attack_mod).filter(([, i]) => {
    const m = i.attack_mod;
    const base = WEAPON_FIREARM_EXPORT[i.gunType];
    return !base || ["dmg", "acc", "floor"].some((f) => m[f] !== undefined && !Number.isFinite(m[f])) || (Number.isFinite(m.dmg) && base.dmg + m.dmg < 0);
  }).map(([k]) => k);
  record(`every gun ITEMS row with attack_mod has a valid offset`, badMod.length === 0, badMod.join(", "));
}

console.log(paint(["bold", "cyan"], "\n== Stage 1: isolated boot =="));
const PORT = 20000 + Math.floor(Math.random() * 20000);
// A scratch CWD (not the repo root) for the child: server.js's LOG_FILE is a
// logs/-relative path with no env override (unlike DB_PATH) — spawning from
// the repo root would silently append scratch-run noise into the real
// logs/server.log, a file this script didn't create and shouldn't touch.
const scratchDir = mkdtempSync(path.join(os.tmpdir(), "zboe-smoketest-"));
const DB_PATH = path.join(scratchDir, "smoketest.sqlite");
const BASE = `http://localhost:${PORT}`;

const child = spawn(process.execPath, [path.join(__dirname, "server.js"), "--dev", "--verbose", "--mock-db"], {
  cwd: scratchDir,
  // FORCE_COLOR=0 overrides an ambient FORCE_COLOR in the parent shell (NO_COLOR
  // alone is ignored once FORCE_COLOR is set) — the --mock-db credential
  // regex below expects plain text, and a colorized boot log would silently
  // break it.
  env: { ...process.env, DB_PATH, PORT: String(PORT), FORCE_COLOR: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let childOutput = "";
child.stdout.on("data", (d) => { childOutput += d; });
child.stderr.on("data", (d) => { childOutput += d; });

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + "/api/leaderboard");
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// ---- tiny per-identity cookie jar (fetch doesn't manage one for us) ----
const jars = {};
function cookieHeader(who) { return jars[who] || ""; }
function storeCookies(who, res) {
  const set = res.headers.getSetCookie?.() ?? [];
  if (!set.length) return;
  const existing = Object.fromEntries(
    (jars[who] || "").split("; ").filter(Boolean).map((c) => c.split("="))
  );
  for (const c of set) {
    const pair = c.split(";")[0];
    const eq = pair.indexOf("=");
    existing[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  jars[who] = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join("; ");
}
// method GET/POST; body (if present) is sent form-urlencoded. redirect is
// left manual so 302s (register/login/logout) can be inspected directly.
async function req(who, method, urlPath, body) {
  const opts = { method, headers: { Cookie: cookieHeader(who) }, redirect: "manual" };
  if (body) {
    opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    opts.body = new URLSearchParams(body);
  }
  const res = await fetch(BASE + urlPath, opts);
  storeCookies(who, res);
  let json = null;
  try { json = await res.clone().json(); } catch { /* not JSON (redirect page etc.) */ }
  return { status: res.status, location: res.headers.get("location"), json, res };
}

let exitCode = 1;
try {
  const booted = await waitForServer();
  record("server boots and responds", booted, booted ? undefined : childOutput.slice(-1500));
  if (!booted) throw new Error("server did not boot — aborting remaining checks");

  // --mock-db prints the seeded admin/player1/player2 passwords to console
  // only (never the log file) — parse them out of the captured output.
  const passwords = {};
  for (const m of childOutput.matchAll(/^\s*(\w+)\s+pass:\s*(\S+)/gm)) passwords[m[1]] = m[2];
  record("mock-db credentials captured", Object.keys(passwords).length === 3,
    Object.keys(passwords).join(", "));

  // The shipped dev config's zombie_config.z_break_fall (50) is deliberately
  // below the recommended 75 — confirms the boot-time sanity WARN fires
  // (always, not gated dev/production).
  record("boot WARN fires for zombie_config.z_break_fall < 75",
    /z_break_fall is \d+ \(below the recommended 75\)/.test(childOutput));

  console.log(paint(["bold", "cyan"], "\n== Stage 2: backend API coverage =="));

  await check("GET /api/leaderboard (public, unauthenticated)", async () => {
    const r = await fetch(BASE + "/api/leaderboard");
    if (!r.ok) throw new Error(`status ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j?.leaderboard)) throw new Error("expected { leaderboard: [...] }");
  });

  const testUser = "smoketest_" + Math.random().toString(36).slice(2, 8);
  await check("register a fresh user", async () => {
    const r = await req(testUser, "POST", "/register", { username: testUser, password: "testpass123" });
    if (r.status !== 302) throw new Error(`expected 302, got ${r.status}`);
    if (/err=/.test(r.location || "")) throw new Error(`redirected with error: ${r.location}`);
  });

  await check("login as the fresh user", async () => {
    const r = await req(testUser, "POST", "/login", { username: testUser, password: "testpass123" });
    if (r.status !== 302 || /err=/.test(r.location || "")) throw new Error(`login failed: ${r.status} ${r.location}`);
  });

  await check("logout clears the session (subsequent /api/game-state redirects)", async () => {
    const out = await req(testUser, "POST", "/logout");
    if (out.status !== 302) throw new Error(`logout: expected 302, got ${out.status}`);
    const gs = await req(testUser, "GET", "/api/game-state");
    if (gs.status < 300 || gs.status >= 400) throw new Error(`expected a redirect after logout, got ${gs.status}`);
  });

  await check("login as admin", async () => {
    const r = await req("admin", "POST", "/login", { username: "admin", password: passwords.admin });
    if (r.status !== 302 || /err=/.test(r.location || "")) throw new Error(`login failed: ${r.status} ${r.location}`);
  });

  await check("login as player1", async () => {
    const r = await req("player1", "POST", "/login", { username: "player1", password: passwords.player1 });
    if (r.status !== 302 || /err=/.test(r.location || "")) throw new Error(`login failed: ${r.status} ${r.location}`);
  });

  await check("GET /api/game-state (player1)", async () => {
    const r = await req("player1", "GET", "/api/game-state");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.json?.me || !r.json?.actions) throw new Error("missing me/actions in payload");
  });

  await check("POST /api/travel (player1: basecamp_outside -> forest)", async () => {
    const r = await req("player1", "POST", "/api/travel", { to: "forest" });
    if (!r.json?.ok) throw new Error(r.json?.message || `status ${r.status}`);
  });

  await check("POST /api/travel (player1: forest -> basecamp_outside)", async () => {
    const r = await req("player1", "POST", "/api/travel", { to: "basecamp_outside" });
    if (!r.json?.ok) throw new Error(r.json?.message || `status ${r.status}`);
  });

  await check("POST /api/action/do (plain action: gather_firewood)", async () => {
    const r = await req("player1", "POST", "/api/action/do", { key: "gather_firewood" });
    if (!r.json?.ok) throw new Error(r.json?.message || `status ${r.status}`);
  });

  await check("GET /api/craft (annotated recipe list)", async () => {
    const r = await req("player1", "GET", "/api/craft");
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`status ${r.status}`);
    if (!r.json.length) throw new Error("expected a non-empty recipe list");
  });

  await check("GET /api/craft (arcane_table station present)", async () => {
    const r = await req("player1", "GET", "/api/craft");
    const arcane = (r.json || []).filter((rec) => rec.station === "arcane_table");
    if (!arcane.length) throw new Error("expected at least one arcane_table recipe");
  });

  await check("POST /api/action/do (activate_arcane_table, graceful failure — wrong location or missing level/ingredients)", async () => {
    const r = await req("player1", "POST", "/api/action/do", { key: "activate_arcane_table" });
    if (r.json?.ok) return "started (player already had ingredients/level?)";
    // Player isn't necessarily in Town at this point in the run (400 = wrong
    // location, "can't do that here"), so either graceful failure is a pass —
    // this check just guards against a crash, not a specific gate.
    if (![400, 409].includes(r.status) || !r.json?.message) throw new Error(`expected a well-formed 400/409, got ${r.status} ${JSON.stringify(r.json)}`);
  });

  // Recipe-pointer location actions delegate straight to this same handler,
  // so exercising it directly covers that path too without needing to set
  // up travel/tools/ingredients for a real one. A fresh player has no
  // ingredients, so a well-formed 409 (not a crash) is the expected pass.
  await check("POST /api/craft (graceful failure on missing ingredients)", async () => {
    const r = await req("player1", "POST", "/api/craft", { key: "craft_mana_potion" });
    if (r.json?.ok) return "unexpectedly succeeded (player already had ingredients?)";
    if (r.status !== 409 || !r.json?.message) throw new Error(`expected a well-formed 409, got ${r.status} ${JSON.stringify(r.json)}`);
  });

  await check("GET /api/shop + POST /api/shop/buy (graceful failure, no gold)", async () => {
    const shop = await req("player1", "GET", "/api/shop");
    if (!Array.isArray(shop.json) || !shop.json.length) throw new Error("expected a non-empty shop list");
    const r = await req("player1", "POST", "/api/shop/buy", { item_name: shop.json[0].key });
    if (r.json?.ok) return "unexpectedly succeeded (player already had gold?)";
    if (r.status !== 409 || !r.json?.message) throw new Error(`expected a well-formed 409, got ${r.status}`);
  });

  await check("GET /api/inventory", async () => {
    const r = await req("player1", "GET", "/api/inventory");
    if (r.status !== 200 || !r.json?.items) throw new Error(`status ${r.status}`);
  });

  await check("POST /api/armor/equip (grant + slot-aware equip round trip)", async () => {
    const grant = await req("admin", "POST", "/api/admin/player/inventory/add", { username: "player1", item: "bronze helm", qty: 1 });
    if (!grant.json?.ok) throw new Error(`grant: ${grant.json?.message || grant.status}`);
    const equip = await req("player1", "POST", "/api/armor/equip", { item: "bronze helm", slot: "head" });
    if (!equip.json?.ok) throw new Error(`equip: ${equip.json?.message || equip.status}`);
    const inv = await req("player1", "GET", "/api/inventory");
    const row = (inv.json?.armors || []).find((a) => a.name === "bronze helm");
    if (!row || row.piece !== "head" || !row.equipped) throw new Error(`armors[] row missing/wrong: ${JSON.stringify(row)}`);
  });

  await check("POST /api/action/reload (graceful: already full)", async () => {
    const r = await req("player1", "POST", "/api/action/reload");
    if (r.json?.ok) return "reloaded (gun wasn't full)";
    if (r.status !== 409 || !r.json?.message) throw new Error(`expected a well-formed 409, got ${r.status}`);
  });

  await check("POST /api/level/up (graceful failure, no XP)", async () => {
    const r = await req("player1", "POST", "/api/level/up");
    if (r.json?.ok) return "unexpectedly leveled (player already had XP?)";
    if (r.status !== 409 || !r.json?.message) throw new Error(`expected a well-formed 409, got ${r.status}`);
  });

  // Combat/magic need an active hunt with zombies — set that up via admin
  // first (fresh scratch DB always starts hunt_enabled=false, horde=0).
  await check("admin: enable hunt + set horde (setup for shoot/spell-cast)", async () => {
    const hunt = await req("admin", "POST", "/api/hunt/toggle");
    if (!hunt.json?.ok || !hunt.json?.huntActive) throw new Error(`hunt toggle: ${JSON.stringify(hunt.json)}`);
    const horde = await req("admin", "POST", "/api/admin/world/horde", { size: 5 });
    if (!horde.json?.ok) throw new Error(`horde set: ${JSON.stringify(horde.json)}`);
  });

  await check("POST /api/action/shoot (player1, hunt active)", async () => {
    const r = await req("player1", "POST", "/api/action/shoot");
    if (!r.json?.ok) throw new Error(r.json?.message || `status ${r.status}`);
  });

  await check("GET /api/spells + POST /api/spell/cast (starter spell)", async () => {
    const spells = await req("player1", "GET", "/api/spells");
    if (!spells.json?.spells) throw new Error("expected a spells payload");
    const r = await req("player1", "POST", "/api/spell/cast", { key: "magic missle" });
    if (!r.json?.ok) throw new Error(r.json?.message || `status ${r.status}`);
  });

  console.log(paint(["bold", "cyan"], "\n== Stage 2b: admin API coverage =="));

  await check("GET /api/admin/world", async () => {
    const r = await req("admin", "GET", "/api/admin/world");
    if (r.status !== 200 || !r.json?.base) throw new Error(`status ${r.status}`);
  });

  await check("GET /api/admin/users", async () => {
    const r = await req("admin", "GET", "/api/admin/users");
    if (r.status !== 200 || !Array.isArray(r.json?.users ?? r.json)) throw new Error(`status ${r.status}`);
  });

  await check("POST /api/admin/player/inventory/add (single-grant regression)", async () => {
    const r = await req("admin", "POST", "/api/admin/player/inventory/add", { username: "player2", item: "gun oil", qty: 3 });
    if (!r.json?.ok) throw new Error(r.json?.message || `status ${r.status}`);
  });

  await check("GET /api/admin/items (types + smeltTypes + categorized recipes)", async () => {
    const r = await req("admin", "GET", "/api/admin/items");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!Array.isArray(r.json?.types) || !r.json.types.length) throw new Error("missing types");
    if (!Array.isArray(r.json?.smeltTypes) || !r.json.smeltTypes.length) throw new Error("missing smeltTypes");
    const missingCat = (r.json.recipes || []).filter((rec) => !rec.category);
    if (missingCat.length) throw new Error(`${missingCat.length} recipes missing category in the live API response`);
    const keys = new Set((r.json.items || []).map((i) => i.key));
    if (!keys.has("hi-potion")) throw new Error("hi-potion missing from the registry");
    if (!keys.has("iron armor set")) throw new Error("iron armor set missing from the registry");
  });

  await check("GET /api/admin/upgrades (item field shape)", async () => {
    const r = await req("admin", "GET", "/api/admin/upgrades");
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`status ${r.status}`);
    if (!("item" in (r.json[0] || {}))) throw new Error("upgrades missing item field");
  });

  await check("GET /api/admin/items/owners + POST /api/admin/items/give (bulk grant round trip)", async () => {
    const before = await req("admin", "GET", "/api/admin/items/owners?item=" + encodeURIComponent("healing potion"));
    if (!before.json?.ok) throw new Error(`owners (before): ${JSON.stringify(before.json)}`);
    const give = await req("admin", "POST", "/api/admin/items/give", { item: "healing potion", qty: 7, usernames: "player1,player2" });
    if (!give.json?.ok) throw new Error(`give: ${give.json?.message || give.status}`);
    const after = await req("admin", "GET", "/api/admin/items/owners?item=" + encodeURIComponent("healing potion"));
    const p1 = after.json.owners.find((o) => o.username === "player1");
    if (!p1 || p1.quantity < 7) throw new Error(`expected player1 to own >=7 healing potion, got ${p1?.quantity}`);
  });

  console.log(paint(["bold", "cyan"], "\n== Stage 2c: quests + weapon system + heal picker =="));

  await check("GET /api/game-state (quests field present, online carries objects)", async () => {
    const r = await req("player1", "GET", "/api/game-state");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.json?.quests || typeof r.json.quests !== "object") throw new Error("missing quests payload");
    if (!Array.isArray(r.json.online)) throw new Error("online should be an array");
    if (r.json.online.length && typeof r.json.online[0] !== "object") throw new Error("online entries should be objects, not bare strings");
    if (r.json.online.length && !("health" in r.json.online[0])) throw new Error("online entries missing health field");
  });

  await check("GET /api/playercard (quests present when authenticated, absent when not)", async () => {
    const authed = await req("player1", "GET", "/api/playercard?user=player1");
    if (!authed.json?.ok || !authed.json.quests) throw new Error("expected quests in authenticated payload");
    const anonRes = await fetch(BASE + "/api/playercard?user=player1");
    const anon = await anonRes.json();
    if (!anon.ok) throw new Error("expected ok=true for anonymous view");
    if (anon.authenticated) throw new Error("expected authenticated=false for anonymous request");
    if (anon.quests) throw new Error("quests should be withheld from an unauthenticated view");
  });

  await check("POST /api/weapon/equip (melee/ranged/throwing/zombie round trip + wrong-slot rejection)", async () => {
    const grants = [["Baseball Bat", "melee"], ["Bow", "ranged"], ["Throwing Knives", "throwing"], ["zombie sword", "zombie"]];
    for (const [item, slot] of grants) {
      const grant = await req("admin", "POST", "/api/admin/player/inventory/add", { username: "player1", item, qty: 1 });
      if (!grant.json?.ok) throw new Error(`grant ${item}: ${grant.json?.message || grant.status}`);
      const equip = await req("player1", "POST", "/api/weapon/equip", { slot, item });
      if (!equip.json?.ok) throw new Error(`equip ${item} into ${slot}: ${equip.json?.message || equip.status}`);
    }
    const inv = await req("player1", "GET", "/api/inventory");
    const bat = (inv.json?.weapons || []).find((w) => w.name === "Baseball Bat");
    if (!bat || bat.equippedSlot !== "melee") throw new Error(`Baseball Bat not equipped in melee slot: ${JSON.stringify(bat)}`);
    const bow = (inv.json?.weapons || []).find((w) => w.name === "Bow");
    if (!bow || bow.equippedSlot !== "ranged") throw new Error(`Bow not equipped in ranged slot: ${JSON.stringify(bow)}`);

    const wrongSlot = await req("player1", "POST", "/api/weapon/equip", { slot: "ranged", item: "Baseball Bat" });
    if (wrongSlot.json?.ok || wrongSlot.status !== 400) throw new Error(`expected a 400 rejecting Baseball Bat in the ranged slot, got ${wrongSlot.status} ${JSON.stringify(wrongSlot.json)}`);
  });

  await check("POST /api/weapon/equip (fist is an independent slot — doesn't evict melee, rejects fist items from melee)", async () => {
    const grant = await req("admin", "POST", "/api/admin/player/inventory/add", { username: "player1", item: "Spiked Knuckles", qty: 1 });
    if (!grant.json?.ok) throw new Error(`grant Spiked Knuckles: ${grant.json?.message || grant.status}`);
    const equip = await req("player1", "POST", "/api/weapon/equip", { slot: "fist", item: "Spiked Knuckles" });
    if (!equip.json?.ok) throw new Error(`equip Spiked Knuckles into fist: ${equip.json?.message || equip.status}`);

    const inv = await req("player1", "GET", "/api/inventory");
    const bat = (inv.json?.weapons || []).find((w) => w.name === "Baseball Bat");
    if (!bat || bat.equippedSlot !== "melee") throw new Error(`Baseball Bat was evicted from melee by the fist equip: ${JSON.stringify(bat)}`);
    const knuckles = (inv.json?.weapons || []).find((w) => w.name === "Spiked Knuckles");
    if (!knuckles || knuckles.equippedSlot !== "fist") throw new Error(`Spiked Knuckles not equipped in fist slot: ${JSON.stringify(knuckles)}`);
    if (!inv.json?.equippedWeapons || inv.json.equippedWeapons.fist !== "Spiked Knuckles") throw new Error(`equippedWeapons.fist missing/wrong: ${JSON.stringify(inv.json?.equippedWeapons)}`);

    const wrongSlot = await req("player1", "POST", "/api/weapon/equip", { slot: "melee", item: "Spiked Knuckles" });
    if (wrongSlot.json?.ok || wrongSlot.status !== 400) throw new Error(`expected a 400 rejecting a Fist item in the melee slot, got ${wrongSlot.status} ${JSON.stringify(wrongSlot.json)}`);
  });

  await check("POST /api/weapon/select (quick-swap) + selectedSlot round trip through /api/game-state and /api/inventory", async () => {
    const select = await req("player1", "POST", "/api/weapon/select", { slot: "fist" });
    if (!select.json?.ok) throw new Error(`select fist: ${select.json?.message || select.status}`);
    const gs = await req("player1", "GET", "/api/game-state");
    if (gs.json?.me?.selectedSlot !== "fist") throw new Error(`expected me.selectedSlot "fist", got ${JSON.stringify(gs.json?.me?.selectedSlot)}`);
    if (!gs.json?.me?.weapons?.fist || gs.json.me.weapons.fist.name !== "Spiked Knuckles") throw new Error(`me.weapons.fist missing/wrong: ${JSON.stringify(gs.json?.me?.weapons?.fist)}`);
    const inv = await req("player1", "GET", "/api/inventory");
    if (inv.json?.selectedSlot !== "fist") throw new Error(`expected /api/inventory selectedSlot "fist", got ${JSON.stringify(inv.json?.selectedSlot)}`);

    const bad = await req("player1", "POST", "/api/weapon/select", { slot: "bogus" });
    if (bad.json?.ok || bad.status !== 400) throw new Error(`expected a 400 for an unknown slot, got ${bad.status} ${JSON.stringify(bad.json)}`);
  });

  await check("admin: refill horde for weapon-attack checks", async () => {
    const horde = await req("admin", "POST", "/api/admin/world/horde", { size: 10 });
    if (!horde.json?.ok) throw new Error(JSON.stringify(horde.json));
  });

  await check("POST /api/action/attack (melee while targeting World — 409, attack-reach gate)", async () => {
    const r = await req("player1", "POST", "/api/action/attack", { slot: "melee" });
    if (r.json?.ok || r.status !== 409) throw new Error(`expected a 409 (too far away), got ${r.status} ${JSON.stringify(r.json)}`);
  });

  await check("POST /api/target/select (Nearby rejected with zombie_near=0, accepted once seeded)", async () => {
    const empty = await req("player1", "POST", "/api/target/select", { scope: "Nearby" });
    if (empty.json?.ok || empty.status !== 409) throw new Error(`expected a 409 with no nearby zombies, got ${empty.status} ${JSON.stringify(empty.json)}`);

    const near = await req("admin", "POST", "/api/admin/player/stat", { username: "player1", field: "zombie_near", value: 3 });
    if (!near.json?.ok) throw new Error(`seed zombie_near: ${near.json?.message || near.status}`);
    const hp = await req("admin", "POST", "/api/admin/player/stat", { username: "player1", field: "zombie_near_health", value: 20 });
    if (!hp.json?.ok) throw new Error(`seed zombie_near_health: ${hp.json?.message || hp.status}`);

    const select = await req("player1", "POST", "/api/target/select", { scope: "Nearby" });
    if (!select.json?.ok) throw new Error(`select Nearby: ${select.json?.message || select.status}`);
    const gs = await req("player1", "GET", "/api/game-state");
    if (gs.json?.targetScope !== "Nearby") throw new Error(`expected targetScope "Nearby", got ${JSON.stringify(gs.json?.targetScope)}`);
    if (gs.json?.nearbyZombies !== 3) throw new Error(`expected nearbyZombies 3, got ${JSON.stringify(gs.json?.nearbyZombies)}`);
  });

  await check("POST /api/action/attack (melee, Nearby scope — real HP combat, Fighting XP on hit, World/Location untouched)", async () => {
    const worldBefore = (await req("player1", "GET", "/api/game-state")).json.zombies;
    const before = await req("player1", "GET", "/api/game-state");
    const fightingBefore = before.json.me.skills.find((s) => s.key === "fighting");
    let landed = false;
    for (let i = 0; i < 25 && !landed; i++) {
      const r = await req("player1", "POST", "/api/action/attack", { slot: "melee" });
      if (!r.json?.ok) throw new Error(r.json?.message || `status ${r.status}`);
      if (r.json.result === "hit") landed = true;
    }
    if (!landed) throw new Error("melee attack never landed a hit in 25 tries");
    const after = await req("player1", "GET", "/api/game-state");
    const fightingAfter = after.json.me.skills.find((s) => s.key === "fighting");
    if (!(fightingAfter.xp > fightingBefore.xp || fightingAfter.level > fightingBefore.level))
      throw new Error("Fighting skill XP/level did not increase after a landed hit");
    if (after.json.zombies !== worldBefore) throw new Error(`World pool changed from a Nearby-scope kill: ${worldBefore} -> ${after.json.zombies}`);
  });

  await check("POST /api/travel (blocked with zombie_near > 3, allowed once <= 3)", async () => {
    const bump = await req("admin", "POST", "/api/admin/player/stat", { username: "player1", field: "zombie_near", value: 4 });
    if (!bump.json?.ok) throw new Error(`seed zombie_near=4: ${bump.json?.message || bump.status}`);
    const blocked = await req("player1", "POST", "/api/travel", { to: "forest" });
    if (blocked.json?.ok || blocked.status !== 409) throw new Error(`expected a 409 (too many zombies), got ${blocked.status} ${JSON.stringify(blocked.json)}`);

    const drop = await req("admin", "POST", "/api/admin/player/stat", { username: "player1", field: "zombie_near", value: 2 });
    if (!drop.json?.ok) throw new Error(`seed zombie_near=2: ${drop.json?.message || drop.status}`);
    const allowed = await req("player1", "POST", "/api/travel", { to: "forest" });
    if (!allowed.json?.ok) throw new Error(`expected travel to succeed with zombie_near=2: ${allowed.json?.message || allowed.status}`);
    const gs = await req("player1", "GET", "/api/game-state");
    if (gs.json?.nearbyZombies !== 0) throw new Error(`expected zombie_near flushed to 0 after travel, got ${JSON.stringify(gs.json?.nearbyZombies)}`);
    // Back to basecamp_outside and World targeting for the remaining checks below.
    await req("player1", "POST", "/api/travel", { to: "basecamp_outside" });
    await req("player1", "POST", "/api/target/select", { scope: "World" });
  });

  await check("POST /api/action/attack (ranged, out-of-ammo graceful failure)", async () => {
    const r = await req("player1", "POST", "/api/action/attack", { slot: "ranged" });
    if (r.json?.ok) return "ranged attack succeeded (ammo already present)";
    if (r.status !== 409 || !r.json?.message) throw new Error(`expected a well-formed 409, got ${r.status} ${JSON.stringify(r.json)}`);
  });

  await check("POST /api/inventory/use (ammo pack — rangedAmmo effect verb fills the Quiver, clamped at cap)", async () => {
    const grant = await req("admin", "POST", "/api/admin/player/inventory/add", { username: "player1", item: "pack of arrows", qty: 1 });
    if (!grant.json?.ok) throw new Error(`grant: ${grant.json?.message || grant.status}`);
    const before = await req("player1", "GET", "/api/inventory");
    const bowBefore = (before.json?.weapons || []).find((w) => w.name === "Bow");
    const use = await req("player1", "POST", "/api/inventory/use", { item: "pack of arrows" });
    if (!use.json?.ok) throw new Error(`use: ${use.json?.message || use.status}`);
    const after = await req("player1", "GET", "/api/inventory");
    const bowAfter = (after.json?.weapons || []).find((w) => w.name === "Bow");
    if (bowAfter.quiver <= bowBefore.quiver) throw new Error(`quiver did not increase: ${bowBefore.quiver} -> ${bowAfter.quiver}`);
    if (bowAfter.quiver > bowAfter.quiverMax) throw new Error(`quiver exceeded quiverMax: ${bowAfter.quiver}/${bowAfter.quiverMax}`);
  });

  await check("POST /api/action/attack (ranged, now has ammo — fires without crashing)", async () => {
    const r = await req("player1", "POST", "/api/action/attack", { slot: "ranged" });
    if (!r.json?.ok) throw new Error(r.json?.message || `status ${r.status}`);
  });

  console.log(paint(["bold", "cyan"], "\n== Stage 2d: admin Equip Slots, Quests box, zombie location pool tooling =="));

  await check("GET /api/admin/player (weapons + quests fields present)", async () => {
    const r = await req("admin", "GET", "/api/admin/player?username=player1");
    if (r.status !== 200 || !r.json?.ok) throw new Error(`status ${r.status}`);
    if (!Array.isArray(r.json.weapons) || r.json.weapons.length !== 6) throw new Error(`expected 6 weapon slots, got ${JSON.stringify(r.json.weapons?.map((w) => w.slot))}`);
    const meleeSlot = r.json.weapons.find((w) => w.slot === "melee");
    if (!meleeSlot?.items?.some((i) => i.name === "Baseball Bat")) throw new Error("melee slot missing Baseball Bat from the registry");
    if (!r.json.quests || !Array.isArray(r.json.quests.unstarted)) throw new Error(`missing quests.unstarted: ${JSON.stringify(r.json.quests)}`);
  });

  await check("POST /api/admin/player/weapon/equip (force-grant + equip, wrong-slot rejection)", async () => {
    const equip = await req("admin", "POST", "/api/admin/player/weapon/equip", { username: "player2", slot: "throwing", item: "Throwing Knives", force: "true" });
    if (!equip.json?.ok) throw new Error(equip.json?.message || `status ${equip.status}`);
    const check1 = await req("admin", "GET", "/api/admin/player?username=player2");
    const throwingSlot = check1.json.weapons.find((w) => w.slot === "throwing");
    if (throwingSlot.equipped !== "Throwing Knives") throw new Error(`expected Throwing Knives equipped, got ${JSON.stringify(throwingSlot)}`);

    const wrongSlot = await req("admin", "POST", "/api/admin/player/weapon/equip", { username: "player2", slot: "melee", item: "Throwing Knives", force: "true" });
    if (wrongSlot.json?.ok || wrongSlot.status !== 400) throw new Error(`expected a 400 rejecting a Throwing item in the melee slot, got ${wrongSlot.status} ${JSON.stringify(wrongSlot.json)}`);

    const clear = await req("admin", "POST", "/api/admin/player/weapon/equip", { username: "player2", slot: "throwing", item: "" });
    if (!clear.json?.ok) throw new Error(`clear slot: ${clear.json?.message || clear.status}`);
    const check2 = await req("admin", "GET", "/api/admin/player?username=player2");
    if (check2.json.weapons.find((w) => w.slot === "throwing").equipped) throw new Error("throwing slot did not clear");
  });

  await check("GET /api/admin/world + /api/admin/world/locations (locationZombies / zombies fields present)", async () => {
    const world = await req("admin", "GET", "/api/admin/world");
    if (!Array.isArray(world.json?.locationZombies) || world.json.locationZombies.length !== 4)
      throw new Error(`expected 4 zombie-location entries, got ${JSON.stringify(world.json?.locationZombies)}`);

    const locs = await req("admin", "GET", "/api/admin/world/locations");
    const byKey = Object.fromEntries((locs.json?.locations || []).map((l) => [l.key, l]));
    if (typeof byKey.forest?.zombies !== "number") throw new Error(`expected forest.zombies to be numeric, got ${JSON.stringify(byKey.forest)}`);
    if (byKey.bunker?.zombies !== null) throw new Error(`expected bunker.zombies to be null (N/A), got ${JSON.stringify(byKey.bunker)}`);
    if (byKey.mountains?.zombies !== null) throw new Error(`expected mountains.zombies to be null pre-Outbreak, got ${JSON.stringify(byKey.mountains)}`);
  });

  await check("POST /api/admin/world/zombies/splinter (rejects below z_wander, succeeds above it)", async () => {
    await req("admin", "POST", "/api/admin/world/horde", { size: 2 });
    const tooLow = await req("admin", "POST", "/api/admin/world/zombies/splinter", { location: "forest" });
    if (tooLow.json?.ok || tooLow.status !== 409) throw new Error(`expected a 409 below z_wander, got ${tooLow.status} ${JSON.stringify(tooLow.json)}`);

    await req("admin", "POST", "/api/admin/world/horde", { size: 20 });
    const before = await req("admin", "GET", "/api/admin/world/locations");
    const forestBefore = before.json.locations.find((l) => l.key === "forest").zombies;
    const worldBefore = (await req("admin", "GET", "/api/admin/world")).json.hordeSize;

    const ok = await req("admin", "POST", "/api/admin/world/zombies/splinter", { location: "forest" });
    if (!ok.json?.ok) throw new Error(ok.json?.message || `status ${ok.status}`);

    const after = await req("admin", "GET", "/api/admin/world/locations");
    const forestAfter = after.json.locations.find((l) => l.key === "forest").zombies;
    const worldAfter = (await req("admin", "GET", "/api/admin/world")).json.hordeSize;
    if (forestAfter !== forestBefore + 1) throw new Error(`expected forest zombies ${forestBefore} -> ${forestBefore + 1}, got ${forestAfter}`);
    if (worldAfter !== worldBefore - 1) throw new Error(`expected World horde ${worldBefore} -> ${worldBefore - 1}, got ${worldAfter}`);
  });

  await check("POST /api/admin/world/zombies/flowback (rejects an empty location, succeeds otherwise)", async () => {
    const empty = await req("admin", "POST", "/api/admin/world/zombies/flowback", { location: "lake" });
    if (empty.json?.ok || empty.status !== 409) throw new Error(`expected a 409 for an empty location, got ${empty.status} ${JSON.stringify(empty.json)}`);

    const before = await req("admin", "GET", "/api/admin/world/locations");
    const forestBefore = before.json.locations.find((l) => l.key === "forest").zombies;
    const worldBefore = (await req("admin", "GET", "/api/admin/world")).json.hordeSize;

    const ok = await req("admin", "POST", "/api/admin/world/zombies/flowback", { location: "forest" });
    if (!ok.json?.ok) throw new Error(ok.json?.message || `status ${ok.status}`);

    const after = await req("admin", "GET", "/api/admin/world/locations");
    const forestAfter = after.json.locations.find((l) => l.key === "forest").zombies;
    const worldAfter = (await req("admin", "GET", "/api/admin/world")).json.hordeSize;
    if (forestAfter !== forestBefore - 1) throw new Error(`expected forest zombies ${forestBefore} -> ${forestBefore - 1}, got ${forestAfter}`);
    if (worldAfter !== worldBefore + 1) throw new Error(`expected World horde ${worldBefore} -> ${worldBefore + 1}, got ${worldAfter}`);
  });

  await check("POST /api/admin/player/zombies/splinter + flowback (Location <-> that player's Nearby pool)", async () => {
    // player1 sits at basecamp_outside (a ZOMBIE_LOCATIONS location) with
    // zombie_near flushed to 0 by the earlier travel check. Seed the
    // location's own pool first (horde is already >= z_wander from above).
    const seed = await req("admin", "POST", "/api/admin/world/zombies/splinter", { location: "basecamp_outside" });
    if (!seed.json?.ok) throw new Error(`seed basecamp_outside: ${seed.json?.message || seed.status}`);

    const splinter = await req("admin", "POST", "/api/admin/player/zombies/splinter", { username: "player1" });
    if (!splinter.json?.ok) throw new Error(splinter.json?.message || `status ${splinter.status}`);
    const gs1 = await req("player1", "GET", "/api/game-state");
    if (gs1.json?.nearbyZombies !== 1) throw new Error(`expected nearbyZombies 1 after splinter, got ${JSON.stringify(gs1.json?.nearbyZombies)}`);

    const flowback = await req("admin", "POST", "/api/admin/player/zombies/flowback", { username: "player1" });
    if (!flowback.json?.ok) throw new Error(flowback.json?.message || `status ${flowback.status}`);
    const gs2 = await req("player1", "GET", "/api/game-state");
    if (gs2.json?.nearbyZombies !== 0) throw new Error(`expected nearbyZombies 0 after flowback, got ${JSON.stringify(gs2.json?.nearbyZombies)}`);

    const emptyFlowback = await req("admin", "POST", "/api/admin/player/zombies/flowback", { username: "player1" });
    if (emptyFlowback.json?.ok || emptyFlowback.status !== 409) throw new Error(`expected a 409 with no nearby zombies, got ${emptyFlowback.status} ${JSON.stringify(emptyFlowback.json)}`);
  });

  console.log(paint(["bold", "cyan"], "\n== Stage 2e: Outbreak mechanics (total_z_pool invariant + reset) =="));

  await check("total_z_pool invariant holds across a World<->Location splinter/flow-back round trip", async () => {
    // Horde is already >= z_wander from the earlier splinter test in Stage 2d.
    const before = (await req("admin", "GET", "/api/admin/world")).json.totalZPool;
    const afterSplinter = await req("admin", "POST", "/api/admin/world/zombies/splinter", { location: "lake" });
    if (!afterSplinter.json?.ok) throw new Error(afterSplinter.json?.message || `status ${afterSplinter.status}`);
    const mid = (await req("admin", "GET", "/api/admin/world")).json.totalZPool;
    if (mid !== before) throw new Error(`expected total_z_pool unchanged by a single splinter (a balanced transfer), ${before} -> ${mid}`);

    const afterFlowback = await req("admin", "POST", "/api/admin/world/zombies/flowback", { location: "lake" });
    if (!afterFlowback.json?.ok) throw new Error(afterFlowback.json?.message || `status ${afterFlowback.status}`);
    const after = (await req("admin", "GET", "/api/admin/world")).json.totalZPool;
    if (after !== before) throw new Error(`expected total_z_pool unchanged by the round trip, ${before} -> ${after}`);
  });

  await check("Experiment Reset zeroes total_z_pool, every zombies_<loc> column, and the outbreak flag", async () => {
    const seed = await req("admin", "POST", "/api/admin/world/zombies/splinter", { location: "swamp" });
    if (!seed.json?.ok) throw new Error(`seed swamp: ${seed.json?.message || seed.status}`);
    const before = (await req("admin", "GET", "/api/admin/world")).json.totalZPool;
    if (!(before > 0)) throw new Error(`expected a nonzero total_z_pool before reset, got ${before}`);

    const reset = await req("admin", "POST", "/api/base/reset", {});
    if (!reset.json?.ok) throw new Error(`reset: ${reset.json?.message || reset.status}`);

    const world = await req("admin", "GET", "/api/admin/world");
    if (world.json.totalZPool !== 0) throw new Error(`expected total_z_pool 0 after reset, got ${world.json.totalZPool}`);
    if (world.json.outbreak) throw new Error("expected outbreak=false after reset");
    if (world.json.hordeSize !== 0) throw new Error(`expected hordeSize 0 after reset, got ${world.json.hordeSize}`);

    const locs = await req("admin", "GET", "/api/admin/world/locations");
    const nonZero = locs.json.locations.filter((l) => l.zombie && l.zombies !== 0);
    if (nonZero.length) throw new Error(`expected every zombie location at 0 after reset, found: ${JSON.stringify(nonZero)}`);
  });

  console.log(paint(["bold", "cyan"], "\n== Stage 2f: Outbreak UI wiring (non-trigger-dependent regression guards) =="));
  // A real Outbreak trigger needs z_tic to actually fire (15s by default) —
  // impractical inside this single fixed-config scratch server without
  // risking other timing-sensitive checks above. The trigger-dependent
  // behaviors (isZombieActive unlocking Mountains/River/Cave/Town, the
  // hunt-toggle/vote 409 while active, Force End's zero-except-Forest split)
  // are covered instead by a manual --dev -t pass with fast-forwarded
  // zombie_config overrides (same approach used to verify Pass 1). These
  // checks cover what's cheaply verifiable without a live trigger: the new
  // field exists and defaults correctly, and the new guards don't break
  // normal (non-Outbreak) operation.

  await check("GET /api/game-state exposes outbreak (false by default, no active Outbreak)", async () => {
    const r = await req("player1", "GET", "/api/game-state");
    if (typeof r.json?.outbreak !== "boolean") throw new Error(`expected a boolean outbreak field, got ${JSON.stringify(r.json?.outbreak)}`);
    if (r.json.outbreak !== false) throw new Error(`expected outbreak=false (no active Outbreak), got ${r.json.outbreak}`);
  });

  await check("POST /api/hunt/toggle and /api/hunt/vote/start still work normally with no active Outbreak", async () => {
    const toggle = await req("admin", "POST", "/api/hunt/toggle", {});
    if (!toggle.json?.ok) throw new Error(`toggle: ${toggle.json?.message || toggle.status}`);
    // Restore hunt to enabled (the Experiment Reset above left it disabled) and confirm the vote route too.
    if (!toggle.json.huntActive) {
      const reToggle = await req("admin", "POST", "/api/hunt/toggle", {});
      if (!reToggle.json?.ok) throw new Error(`re-toggle: ${reToggle.json?.message || reToggle.status}`);
    }
    const voteStart = await req("player1", "POST", "/api/hunt/vote/start", {});
    if (!voteStart.json?.ok) throw new Error(`vote/start: ${voteStart.json?.message || voteStart.status}`);
  });

  await check("POST /api/admin/world/outbreak/forceend rejects when no Outbreak is active", async () => {
    const r = await req("admin", "POST", "/api/admin/world/outbreak/forceend", {});
    if (r.json?.ok || r.status !== 409) throw new Error(`expected a 409 with no active Outbreak, got ${r.status} ${JSON.stringify(r.json)}`);
  });

  console.log(paint(["bold", "cyan"], "\n== Stage 2g: API log-file split =="));

  await check("API-level request plumbing logs to logFile.api only, not the main log", async () => {
    // A few plain /api/* hits generate a fresh, unambiguous marker line
    // (the /api/game-state API-level log) to look for in both files.
    await req("player1", "GET", "/api/game-state");
    const main = readFileSync(path.join(scratchDir, "logs", "server.log"), "utf8");
    const api = readFileSync(path.join(scratchDir, "logs", "server.log.api"), "utf8");
    const marker = "API request for game state by user player1";
    if (!api.includes(marker)) throw new Error("expected the game-state marker in server.log.api");
    if (main.includes(marker)) throw new Error("game-state marker leaked into the main server.log");
  });

  await check("login/register traffic logs to the main log only, never logFile.api", async () => {
    const main = readFileSync(path.join(scratchDir, "logs", "server.log"), "utf8");
    const api = readFileSync(path.join(scratchDir, "logs", "server.log.api"), "utf8");
    const loginMarker = "Login attempt for username=player1";
    const registerMarker = `Registration attempt for username=${testUser}`;
    for (const [label, marker] of [["login", loginMarker], ["register", registerMarker]]) {
      if (!main.includes(marker)) throw new Error(`expected ${label} marker in the main server.log`);
      if (api.includes(marker)) throw new Error(`${label} marker leaked into server.log.api`);
    }
  });

  exitCode = results.every((r) => r.ok) ? 0 : 1;
} finally {
  console.log(paint(["bold", "cyan"], "\n== Teardown =="));
  child.kill("SIGTERM");
  try {
    rmSync(scratchDir, { recursive: true, force: true });
    record("scratch server killed + scratch dir removed", true);
  } catch (e) {
    record("scratch server killed + scratch dir removed", false, e.message);
  }
}

const passed = results.filter((r) => r.ok).length;
console.log(paint(["bold", "cyan"], `\n== Summary: ${passed}/${results.length} passed ==`));
if (exitCode !== 0) {
  console.log(paint(["bold", "red"], "FAILED:"));
  for (const r of results.filter((r) => !r.ok)) console.log(paint("red", "  - " + r.name));
}
process.exit(exitCode);
