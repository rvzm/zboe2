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
// This file is deliberately standalone (no imports from server.js/db.js
// beyond the pure-data item_backbone.js) and is meant to be kept current:
// add a check here whenever a new route/feature is built, or a past bug
// (like the RECIPES typos below) deserves a permanent regression guard.

import { spawn } from "node:child_process";
import { styleText } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RECIPES, ITEMS, ARMOR_PIECES } from "./item_backbone.js";

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
  const RECIPE_CATEGORIES = ["food", "potion", "base", "magic", "metal", "misc"];
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
