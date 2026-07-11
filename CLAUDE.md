# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

zboe2 (Zombie Biohazard Occult Experiment 2) is a web-based multiplayer zombie-hunting game — a NodeJS/Express rewrite of an older IRC-based game. Early development (this is the first playable dev-rc after a prior build was lost to a drive failure). Pure ESM (`"type": "module"`), no build step, no test suite, no linter configured.

## Commands

```bash
npm run dev       # node server.js --dev --debug=FULL
npm run stable    # node server.js
npm run verbose   # node server.js --verbose
node util/index.mjs [group action args...]   # Admin CLI: REPL with no args, one-shot with args
```

Server listens on `PORT` (default 3000). Docker: `docker compose up` (mounts `./data` for DB persistence). The server manages its own foreground/background lifecycle (see `--verbose` / `--stop` below) — there is no systemd unit. `./zboe.sh` is a `dialog` TUI: the Server menu starts/stops/restarts via `node server.js` / `node server.js --stop` (reading `logs/zboe.pid`), plus User/Player/Database/Log/**Shop** admin menus and the Admin CLI.

**Runtime flags** (parsed by a declarative `CLI_OPTIONS` table in `server.js`):
- `--dev` / `--production` (mutually exclusive).
- `-v` / `--verbose` — **foreground/background switch.** With it, the process stays attached as a live, colorized console. Without it, the process re-spawns itself detached, prints a couple of lines + the child PID, writes `logs/zboe.pid`, and releases the terminal.
- `--stop` — SIGTERMs the backgrounded server via `logs/zboe.pid` (handles missing/stale PID files).
- `--debug-level=<FULL|INFO|WARN|ERROR|FATAL>` and its alias `--debug=<LEVEL>` (the alias is real now — the old `--debug=` vs `--debug-level=` discrepancy is fixed).
- `--set group.key=value` (repeatable), `--group.key=value`, or bare `--key=value` — override any value in `file_config`/`game_config`/`zombie_config` for a single run, type-coerced to the existing value's type. Overrides are in-memory only; they don't write back to `config.js`.
- `-h` / `--help`.

## Architecture

Three layers, with `db.js` as the hard boundary between the web layer and SQLite.

**`db.js` — the only place SQL lives.** On import it opens/creates `data/zboe.sqlite` (WAL, foreign keys on), runs `CREATE TABLE IF NOT EXISTS` for the full schema, seeds the single `game_state` row (`key = 'main'`), and does a couple of legacy `ALTER TABLE` column-adds. It defines prepared statements once and exports thin named accessors. **Nothing outside `db.js` writes raw SQL** — the one exception is `util/commands/*.mjs`, which imports the raw `db` handle for admin ops. Add game state as a column/table + a matching exported accessor here, not as a query in `server.js`. Also exports `GUN_TYPES` (`handgun`/`rifle`/`shotgun`), `GUN_NAMES` (`Handgun`/`Rifle`/`Shotgun`), and `valid_locations`.

Core tables:
- `users` — auth (`is_admin`, `pass_salt`/`pass_hash`, `last_login`).
- `players` — 1:1 stats. `xp` (spendable) + `lifetime_xp` (leaderboard rank) + `level`; `health`/`max_health`/`shield`; `accuracy`, `kills`, `gold`, `horde_tokens`, `jammed`, `equipped_gun`, `location`, `hidden`, `last_seen`. **Ammo/clips/condition are per gun type**: `handgun_*`, `rifle_*`, `shotgun_*` (`_ammo`, `_max_ammo`, `_clips`, `_max_clips`, `_condition`). Page stats read from whichever gun is equipped.
- `player_inventory` — items (guns are inventory items; a consumed consumable stays at qty 0, visible-but-unusable).
- `events` — global feed. `type` (spawn/kill/shoot/attack/death/chat/system/level/item/shop/reload), `visibility` (public/private/background — `background` is hidden from the feed), and `target` (`'global'` or a stringified `user_id`; the feed query returns global + your own).
- `game_state` — one `key='main'` row: `hunt_enabled`, `horde_size`, `horde_status`, `raid_enabled`, `online_players`, `base_health`, `base_destroyed_at`.
- `shop_items` — admin-managed catalogue. `nuke_votes` — ballots while the base is destroyed.

**`server.js` — Express app, auth, game-state API, and the game tick.** Session auth is a hand-rolled signed cookie (`zboe_session`): base64url JSON + HMAC-SHA256 keyed on `game_config.sessionSecret`; passwords are PBKDF2-SHA256. `requireAuth` populates `req.user`/`req.userId`; `requireAdmin` (checks `users.is_admin`) gates admin-only routes (hunt toggle, base reset). The frontend is one static page (`public/game.html`) that polls `GET /api/game-state` every 3s and composes one JSON response (player stats, world/base status, leaderboard, filtered events, online list).

- **Game tick** (`startZombieTicker`, every `zombie_config.z_tic` s): spawns (`z_chance%`) then runs an attack tier — **wandering** (<`z_horde`: one zombie @ `z_hit%`), **hunting** (≥`z_horde`: up to 75% of zombies hit every active player), **raiding** (≥`z_raid`: each zombie @ `z_hit/2%` hits up to 10 players for double damage; persists until the horde is cleared). Damage is shield-first then health (`damagePlayer`). Inside players are absorbed by the base (2 base HP each, up to 500); base death resets everyone inside; an outside player at 0 HP dies. Death = full reset to level 1 (`resetPlayer`). A destroyed base freezes the world until an admin reset, a passed nuke vote, or `experimentResetHours` elapse — then `experimentReset` wipes global state.
- **Leveling** (`/api/level/up`, `/api/level/max`): spend `xp` on levels (1→20 by 1, then by 5; cost compounds). Each level grants +5 accuracy and +5 max health and heals to the new max. `lifetime_xp` is untouched by spending.
- **Presence:** `last_seen` is touched **only** by the game-state poll (the page's active refresh) and at login — actions no longer touch it. `online` = `getActivePlayers` within `game_config.timeout` seconds; drop by lowering `timeout`.
- **Shop:** DB `shop_items` (`/api/shop`, `/api/shop/buy` with gold) plus a hardcoded `STATIC_UPGRADES` list (`/api/shop/upgrades`) of stat boosts (hit the equipped gun's type), consumables (gun oil), and one-time gun unlocks (Rifle/Shotgun). Inventory tab equips guns and uses consumables.
- **Chat:** `/api/chat` posts a `chat` event; text is censored against a whole-word, case-insensitive list loaded from `file_config.censorFile` at startup (each hit → `****`).

**`util/` — Admin CLI.** `index.mjs` runs a single command and exits when given argv (what the `menus/*.sh` dialogs call), else a readline REPL. `parser.mjs` routes `<group> <action> <args...>` to `commands/{users,players,inventory,shop}.mjs`. Notable: `players stats|statsraw|getstat|setstat|guns|setgun` (the interactive stats editor and gun-equip menu in `menus/players.sh` are built on the `*raw`/`guns` outputs; `setgun … force` grants an unowned gun), `users add|setpassword|setadmin|names`. `menus/lib.sh` provides the shared `pick_user` "Enter name/list" picker.

**Logging.** `log(level, message, config)` in `server.js`. Levels ascending: `FULL`(0, plumbing) < `INFO`(1, actions + tick results) < `WARN` < `ERROR` < `FATAL`. Console output requires `--verbose` and is colorized per level via `util.styleText` (auto-no-ops when the stream can't color; the log file stays plain). File writes happen in dev mode or for ERROR/FATAL. `FATAL` exits. **In dev mode, the console filter defaults to INFO** unless a level was explicitly set (`NONE` is the config default sentinel). A startup summary (mode/debug/tick/timeout) is always printed and logged, ungated; `timeout > 10` prints an "excessive" warning.

## Conventions & gotchas

- **Config is three objects in `config.js`:** `file_config` (log/db/censor filenames), `game_config` (verbose, dev, debugLevel, `sessionSecret`, timeout, heartbeatSeconds, baseMaxHealth, experimentResetHours), `zombie_config` (z_tic, z_chance, z_hit, z_damage, z_horde, z_raid). `sessionSecret` defaults to `'changeme'` and **must** be overridden for real deployments. Env overrides: `DB_PATH`, `PORT` (the old `HUNT_TICK_MINUTES` is gone).
- **Dev DB = delete & rebuild, no migrations.** This is a strictly dev build; when the schema changes, delete `data/zboe.sqlite*` and let `db.js` recreate it. Don't add `ALTER TABLE` migrations — real "old DB" migration is deferred to a future zboe2→zboe3 push. The two existing `ALTER`s (location/hidden) are legacy leftovers.
- `.gitignore` excludes `data/`, `logs/`, `util/`, `zboe.sh`, the install scripts, `package-lock.json`, `.env*`, and `*.sqlite`/`*.log` — so the Admin CLI (`util/`) is untracked, but `menus/` and `CLAUDE.md` are **tracked**. Don't assume the working tree matches the repo.
- `scratchbook.js` / `scratchbook.note` are ignored scratch space, not part of the app.
- **`horde_size` (in `game_state`) is the single source of truth for the zombie count**; `horde_status` (`hiding`/`wandering`/`hunting`/`raiding`) is derived in `hordeStatusOf()` from the hunt flag + `z_horde`/`z_raid`. `spawn`/`kill` events are narrative feed flavor, not counters.
- **Player location lives on `players.location`** — no `locations` table; occupancy via `getLocationCount()`. `"inside"` is the base; the toggle is `/api/base/toggle`.
- **Backgrounding:** without `--verbose` the server daemonizes (self-respawn detached, writes `logs/zboe.pid`); `--stop` kills it. Only one backgrounded instance is tracked (single PID file), and a live PID file blocks a second background start. `menus/server.sh` drives this.
- **`sessionSecret` sanity halt:** while it's the default `'changeme'`, non-dev runs FATAL-exit at startup and dev runs only warn — set it before any real run.
- Several dead/duplicate `log(...)` calls sit after `return` in some route handlers (they never execute); don't treat them as reachable behavior.
