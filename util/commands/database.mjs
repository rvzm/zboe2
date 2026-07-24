// Database toolkit: backup / restore / schema check / migrate.
// This module deliberately does NOT import db_backbone.js — db_backbone.js prepares all its
// statements at import and would crash against an outdated live DB, which is
// exactly the situation `check`/`update` exist for. The live DB path is
// resolved the same way db_backbone.js resolves it (DB_PATH env, else config.js), and
// the reference schema comes from a pristine DB that db_backbone.js builds at a temp
// path in a child process — so the toolkit still self-updates as the schema
// evolves without ever opening the live DB through db_backbone.js.
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { file_config } from "../../config.js";

const BASE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
// Live DB path — mirrors db_backbone.js (env override, else config.js name under data/).
const DB_PATH = process.env.DB_PATH || path.join(BASE_DIR, "data", file_config.databaseFile || "zboe.sqlite");
// Backups live under util/ (gitignored) so wiping data/ never touches them.
const BACKUP_DIR = path.join(BASE_DIR, "util", "backups");
const BACKUP_PREFIX = "backup_database_";
const BACKUP_GLOB = /^backup_database_.*\.bak$/;

function timecode() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Existing backup files, newest first (by name — the timecode sorts lexically).
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => BACKUP_GLOB.test(f))
    .sort().reverse()
    .map((f) => path.join(BACKUP_DIR, f));
}

// --- Schema introspection ---
function columnsOf(handle) {
  const tables = handle
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all().map((r) => r.name);
  const schema = {};
  for (const t of tables) schema[t] = handle.prepare(`PRAGMA table_info(${t})`).all();
  return schema;
}

// Reference = the current, correct schema, introspected from a fresh DB that
// db_backbone.js builds at a temp path (child process with DB_PATH overridden). Built
// once per run, on first use. We keep each table's columns AND its CREATE
// statement (to recreate whole tables a migrating old DB is missing).
let REF = null;
function reference() {
  if (REF) return REF;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "zboe-schema-"));
  const freshPath = path.join(tmpDir, "fresh.sqlite");
  try {
    const dbUrl = pathToFileURL(path.join(BASE_DIR, "db_backbone.js")).href;
    const res = spawnSync(process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(dbUrl)});`],
      { env: { ...process.env, DB_PATH: freshPath }, encoding: "utf8" });
    if (res.status !== 0) {
      const reason = (res.stderr || "").trim().split("\n").pop() || "db_backbone.js failed";
      throw new Error(`could not build the reference schema: ${reason}`);
    }
    const fresh = new Database(freshPath, { readonly: true, fileMustExist: true });
    REF = {
      columns: columnsOf(fresh),
      createSql: Object.fromEntries(
        fresh.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all().map((r) => [r.name, r.sql])
      ),
    };
    fresh.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return REF;
}

// Compare a db file against the reference. Returns
// { status: "ok"|"outdated"|"invalid"|"missing", missingTables, missingColumns, error }.
function inspectFile(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return { status: "missing", missingTables: [], missingColumns: [] };
  let handle;
  try {
    const ref = reference();
    handle = new Database(dbPath, { readonly: true });
    const got = columnsOf(handle);

    // With NONE of our core tables, it isn't a zboe DB — genuinely invalid.
    const coreTables = ["users", "players", "game_state"];
    if (!coreTables.some((t) => got[t])) {
      handle.close();
      return { status: "invalid", error: "not a zboe database (no core tables)", missingTables: [], missingColumns: [] };
    }

    // Missing tables/columns are a normal older-schema case → migratable.
    const missingTables = [];
    const missingColumns = []; // { table, column }
    for (const [table, cols] of Object.entries(ref.columns)) {
      if (!got[table]) { missingTables.push(table); continue; }
      const have = new Set(got[table].map((c) => c.name));
      for (const c of cols) if (!have.has(c.name)) missingColumns.push({ table, column: c.name });
    }
    handle.close();

    if (missingTables.length || missingColumns.length) return { status: "outdated", missingTables, missingColumns };
    return { status: "ok", missingTables: [], missingColumns: [] };
  } catch (e) {
    if (handle) try { handle.close(); } catch {}
    return { status: "invalid", error: e.message, missingTables: [], missingColumns: [] };
  }
}

// Build an ADD COLUMN statement from a reference column definition.
function addColumnSql(table, refCol) {
  let sql = `ALTER TABLE ${table} ADD COLUMN ${refCol.name} ${refCol.type}`;
  if (refCol.notnull) sql += " NOT NULL";
  if (refCol.dflt_value !== null && refCol.dflt_value !== undefined) sql += ` DEFAULT ${refCol.dflt_value}`;
  return sql;
}

// --- One-line human status for a file (used by the menu prompts) ---
export async function inspect(dbPath) {
  const r = inspectFile(dbPath);
  if (r.status === "missing") return "MISSING: file not found";
  if (r.status === "ok") return "OK: schema matches current";
  if (r.status === "outdated") {
    const parts = [];
    if (r.missingTables.length) parts.push(`tables: ${r.missingTables.join(", ")}`);
    if (r.missingColumns.length) parts.push(`columns: ${r.missingColumns.map((m) => `${m.table}.${m.column}`).join(", ")}`);
    return `OUTDATED: missing ${parts.join("; ")}`;
  }
  return `INVALID: ${r.error}`;
}

// --- Check: does the live DB match what a fresh DB would have? ---
// Multi-line report; the first word (OK/OUTDATED/MISSING/INVALID) is what the
// menu branches on.
export async function check() {
  const r = inspectFile(DB_PATH);
  if (r.status === "missing") return `MISSING: no database at ${DB_PATH}\n(it will be created on first server start)`;
  if (r.status === "invalid") return `INVALID: ${r.error}\nDatabase: ${DB_PATH}`;
  if (r.status === "ok") return `OK: schema matches a fresh database.\nDatabase: ${DB_PATH}`;
  const lines = [
    "OUTDATED: the live database is behind the current schema.",
    `Database: ${DB_PATH}`,
  ];
  if (r.missingTables.length) {
    lines.push("", `Missing tables (${r.missingTables.length}):`);
    for (const t of r.missingTables) lines.push(`  ${t}`);
  }
  if (r.missingColumns.length) {
    lines.push("", `Missing columns (${r.missingColumns.length}):`);
    for (const m of r.missingColumns) lines.push(`  ${m.table}.${m.column}`);
  }
  return lines.join("\n");
}

// --- Update: bring the live DB up to the current schema in place ---
export async function update() {
  return migrate(DB_PATH);
}

export async function backupexists() {
  return listBackups().length ? "yes" : "no";
}

// Full paths of all backups, newest first (one per line) — for the menu picker.
export async function backups() {
  const list = listBackups();
  return list.length ? list.join("\n") : "(no backups)";
}

// --- Backup: hot online copy of the live DB → util/backups/backup_database_<timecode>.bak ---
export async function backup() {
  if (!fs.existsSync(DB_PATH)) return `No database found at ${DB_PATH} — nothing to back up.`;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dest = path.join(BACKUP_DIR, `${BACKUP_PREFIX}${timecode()}.bak`);
  const src = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    await src.backup(dest); // sqlite online backup (safe while the server is running)
  } finally {
    src.close();
  }
  const size = (fs.statSync(dest).size / 1024).toFixed(1);
  return `Backup written: ${dest} (${size} KB)`;
}

// --- Restore: overwrite the live DB with a backup (given path, else newest) ---
// Stale WAL/SHM are removed so the restored file isn't reopened against an old
// journal. Assumes the server is stopped (the menu enforces it).
export async function restore(which) {
  const target = which || listBackups()[0];
  if (!target || !fs.existsSync(target)) return "No backup found — run Backup first.";
  const check = inspectFile(target);
  if (check.status === "invalid") return `Refusing to restore — backup is ${check.error}.`;

  fs.copyFileSync(target, DB_PATH);
  for (const ext of ["-wal", "-shm"]) fs.rmSync(DB_PATH + ext, { force: true });

  let msg = `Restored ${target} -> ${DB_PATH}`;
  if (check.status === "outdated") msg += "\nNote: backup is from an OLDER schema — run 'Check For Schema Updates' (or 'database update') before starting the server.";
  return msg;
}

// --- Migrate: bring an old db file up to the current schema (in place) ---
export async function migrate(oldPath) {
  if (!oldPath) return "Usage: database migrate <path-to-old-db>";
  const check = inspectFile(oldPath);
  if (check.status === "missing") return `No file at: ${oldPath}`;
  if (check.status === "invalid") return `Cannot migrate — ${check.error}. The database is invalid/incompatible.`;
  if (check.status === "ok") return "Already up to date — nothing to migrate.";

  // status === "outdated": create missing tables, then add missing columns.
  const ref = reference();
  const handle = new Database(oldPath);
  const addedTables = [];
  const addedCols = [];
  try {
    const tx = handle.transaction(() => {
      for (const table of check.missingTables) {
        handle.exec(ref.createSql[table]);
        addedTables.push(table);
      }
      for (const { table, column } of check.missingColumns) {
        const refCol = ref.columns[table].find((c) => c.name === column);
        handle.exec(addColumnSql(table, refCol));
        addedCols.push(`${table}.${column}`);
      }
    });
    tx();
  } catch (e) {
    handle.close();
    return `Migration failed: ${e.message}`;
  }
  handle.close();
  const bits = [];
  if (addedTables.length) bits.push(`created ${addedTables.length} table(s): ${addedTables.join(", ")}`);
  if (addedCols.length) bits.push(`added ${addedCols.length} column(s): ${addedCols.join(", ")}`);
  return `Migrated ${oldPath} — ${bits.join("; ")}`;
}
