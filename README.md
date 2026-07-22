# zboe2

### Zombie Biohazard Outbreak Experiment 2

[ Version 2.0.27-dev-rc ]

zboe2 is a web-based NodeJS game, adapted from my original IRC-based game.

This file will be updated as this project develops.

Currently it's still in early development.

## ⚠️ Session Secret

Change `sessionSecret` in `config.js` (or pass `--set game_config.sessionSecret=...`) before any real deployment — it keys the session-cookie signing. While it's left at the default `'changeme'`:

- **Production/stable runs refuse to start** (a FATAL sanity halt).
- **Dev runs (`--dev`) print a warning and continue**, so local development isn't blocked.

## Running

```bash
npm run stable    # node server.js
npm run dev       # node server.js --dev --debug=FULL
npm run verbose   # node server.js --verbose
```

`stable` and `dev` fork the server into the background (prints the child PID, writes `logs/zboe.pid`, releases the terminal) — use `node server.js --stop` to stop it. `--verbose` (or `npm run verbose`) keeps it attached in the foreground as a live, colorized console instead.

You can also run `node server.js` directly with any combination of flags — `--dev`/`--production`, `-v`/`--verbose`, `--debug-level=LEVEL` (`FULL`/`INFO`/`WARN`/`ERROR`/`FATAL`), `--mock-db` (seeds a starter dev DB with random passwords, printed once to the console), `--rotate-keys`, `--stop`, and `--set group.key=value` (repeatable) to override any `config.js` value for a single run. Run `node server.js -h` for the full list, and `node server.js --dev -h` to also see the dev-only flags below.

### Dev-only flags

These require `--dev` — passing any of them without it is a startup FATAL:

| Flag | Effect |
|---|---|
| `-t` | every action/craft/meditation timer runs at 3s instead of its real length |
| `-s` | admins log in **stealthed**: hidden, and invisible to the zombie tick (no damage, no targeting) |
| `-d` | shorthand for `--verbose --debug-level=INFO` |
| `-a` | every new registration is created as an admin |
| `-H` | keeps the horde topped up to `z_horde` whenever it drops below (so a hunt tier never lapses) |
| `-r` | same, but tops up to `z_raid` (keeps a raid rolling) |
| `-z N` | hard zombie cap — spawns, call-zombie, and the `-H`/`-r` refills never push the horde past N |

## The Game

Hunt zombies — or don't. The world has both a fight (guns, the horde, the base siege) and a slower loop of travel, gathering, crafting, and skill training, tied together by a shared level/XP system.

### Zombies: wandering → hunting → raiding

While "The Experiment" (the hunt) is enabled, the zombie tick runs every `zombie_config.z_tic` seconds (15s by default): first a spawn roll (`z_chance`%, doubled during a raid), then an attack pass whose behavior depends on the current horde size:

- **Wandering** (horde below `z_horde`, 5 by default): a single zombie takes one shot at everyone active, `z_hit`% (10% default) to connect for `z_damage` (3) each.
- **Hunting** (horde at or above `z_horde`): a random number of zombies (up to ~75% of the horde) land a hit on **every** active player at once — this is where things start to hurt.
- **Raiding** (horde at or above `z_raid`, 15 by default): each zombie gets its own `z_hit/2`% roll against up to 10 random players, for **double** damage. Once triggered, raiding **latches** — it doesn't drop back to hunting/wandering just because the horde dips below `z_raid` again; it only ends when the horde is cleared to **zero**.

Damage hits shield first, then health. Before that, your total armor (equipped gear + any spell buff + your innate Base AP stat) blocks a percentage of it — see **Defense**, below. Die (health to 0) and you're reset to level 1, losing your gear and progress.

**The base can be besieged too.** Players hiding inside soak zombie damage collectively (2 base HP per hit, up to 500), and their combined armor pools into "Base AP" to deflect base damage the same way armor deflects player damage — capped so the base can never be made fully invincible. If the base falls, everyone inside is reset and the world freezes until an admin resets it, a nuke vote passes, or enough time passes automatically.

**Tokens and gold**: killing zombies pays gold + XP. Landing the shot that breaks a hunting horde (drops it below `z_horde`) earns a Horde Token; landing the kill that clears the last zombie of a raid earns three. Tokens buy Shield Boosters, the Golden Gun, or exchange back into gold.

### Guns

| Gun | Behavior | Notes |
|---|---|---|
| **Handgun** | accuracy = your accuracy stat (scaled by condition) | starting weapon, everyone has one |
| **Rifle** | accuracy = a high fixed floor scaled by condition only | ignores your accuracy stat; can **pierce** a second zombie when the horde is thick (>5), 15–65% chance scaling with your accuracy |
| **Shotgun** | accuracy = your accuracy stat | drops up to **5 zombies per blast** |
| **Burst Rifle** | accuracy = your accuracy stat, higher floor | drops up to 3 per shot; one-time unlock, pricier |

Each gun tracks its own **ammo, clips, and condition** independently — swapping guns doesn't share state, and a jammed Rifle doesn't stop your Handgun. Firing has a chance to wear the gun's condition down; the worse the condition, the higher the chance a shot **jams** it (pristine guns essentially never jam). A jam wastes the round and blocks shooting/reloading until you clear it — which costs a clip. **Gun Oil** restores condition and is worth carrying.

The **Golden Gun** is a temporary power-up, not a real gun: while active it grants perfect, unlimited, jam-free shots (one zombie each) until its charges run out, then you're back to your equipped weapon.

### Skills

Ten skills, each with its own level and spendable XP pool (`s_<skill>_xp`), trained by location actions and (for a few) other means. Skill XP also feeds your main player level and the leaderboard — training a skill is never wasted. Skills auto-level as their XP pool crosses thresholds, or you can spend **main** player XP to insta-buy the next level in the Player Info modal.

- **Magic** — cast spells (see below), and via the **Meditate on Magical Theory** action in any safe zone.
- **Defense** — trained by *taking* zombie damage (scaled off how much actually got through your armor — a fully-blocked hit teaches nothing) and by the **Train Defense** action (Town & Forest). Gates which armor tiers you're strong enough to *wear* (bronze needs the least, syllic the most), and lets you buy the **AP Base** upgrade — mana + materials, permanently raising your innate "Base AP" stat, which adds to your total armor rating alongside whatever you have equipped.
- **Woodcutting** — chopping wood, gathering firewood.
- **Fishing** — the Lake, River, and Swamp all have fishing spots; better rods/bait unlock deeper water.
- **Mining** — ore, gated by pickaxe tier (stone → iron → ... → syllic), mostly in the Cave.
- **Smithing** — smelting ore into bars and smithing bars into armor/tools/weapons at the Mountains forge.
- **Crafting** — cooking, radio/base-system parts, general assembly recipes.
- **Foraging** — mushrooms, herbs, glowcaps — food and alchemy ingredients.
- **Trapping** — small game in the Forest, feeding the cooking chain.
- **Alchemy** — potions (healing, shield, mana) from herbs and bars.

### Locations & travel

The world is a small graph, not a full map: **Basecamp** connects to the **Bunker** and to **Forest**, and Forest is the hub that everything else (Lake, Mountains, River, Swamp, Cave, Town) branches off of. Travel only works between connected locations — `POST /api/travel` validates adjacency, though a few spells (and admin teleport) can skip straight to a location, graph be damned.

Zombies only threaten Basecamp (inside and out), Forest, Lake, and Swamp — those are the only spots the hunt tick and manual shooting matter. Everywhere else is a **safe zone**: no combat, but that's where the game's other half lives — each safe location has its own set of **actions** (gather, mine, fish, craft, smith) gated by skill level and sometimes a tool or station (a campfire you build, the Mountains forge you fire up, a Bunker supply beacon). Town additionally hosts the **Magic Table**, where spells are learned.

The **map** (in-game) lists only locations reachable from where you currently are, color-coded by safe/zombie, with the base's HP shown when you're away from Basecamp.

### Magic

Magic runs on **mana** (its own bar alongside health/shield), spent per cast, and the **Magic** skill (level-gated per spell). You start knowing one spell; everything else has to be **learned** at the Magic Table in Town by spending gathered ingredients — no gold, just materials plus enough Magic level. Learning is permanent and instant, shop-style, from a categorized menu (attack / armor / heal / aid / travel).

Spell types:
- **Attack** — rolls its own accuracy against the horde, same kill/reward logic as a gun shot.
- **Armor** — a temporary AP buff stacking on top of your equipped armor and Base AP, lasting several minutes.
- **Heal** / **Aid** — restores health, to yourself or (Aid) another player.
- **Travel** — warps straight to a fixed location, bypassing the travel graph.

Every cast (hit or miss) costs its mana and grants Magic XP, so training the skill is a side effect of just using it.

### The item registry

`item_backbone.js` is the single source of truth for every item and crafting recipe in the game — guns, tools, armor, consumables, treasure, crafting materials — as plain, readable rows: display name, type, description, value, shop price, and (for consumables) the exact effect it applies. `magic.js` does the same for spells. Both are validated at boot: an unknown item reference, a bad effect verb, an armor with no valid AP, a spell with a missing effect field — any of it is a loud startup FATAL, not a silent runtime bug. Adding content to the game is meant to be "add a row," not "hunt through the code."

### Progression

Leveling is universal: XP from combat, skill training, and actions all feed the same spendable pool (plus a separate **lifetime XP** total that only ever grows, driving the public leaderboard). Leveling up grants stat bonuses (accuracy, max health) — every level through 15, then only every 5th level after that — and costs compound as you go. Skills level the same way, on their own XP pools.

### Admin tooling, three ways

- **Web admin panel** (`/admin`) — live world/horde/base state, user & player management, moderation (mutes, bans, exile), and a read-only view of the item/recipe/spell registries.
- **`./zboe.sh`** — a terminal menu for server lifecycle, user/player/database/log management (see **Server Management** below).
- **Admin CLI** (`node util/index.mjs`) — the same operations, scriptable: one-shot commands or an interactive REPL.

See `INSTALL.md` for setup, reverse-proxy (Apache/nginx), and HTTPS notes.

## Server Management

### `./zboe.sh`

The server-admin TUI. By default it's a `dialog`-based menu; pass **`--cli`** to run it as a plain interactive console instead (prints the options, reads a choice, loops) — use this on a box where `dialog` doesn't render properly:

```bash
./zboe.sh          # dialog TUI
./zboe.sh --cli    # plain console menu
```

Top-level options: **Server Management** (start/stop/restart/status, plus a manual-launch flag picker), **User Management**, **Player Management**, **Database Management**, **Log Management** (view/tail/delete logs), and **Open Admin CLI** (drops straight into the `util/index.mjs` REPL).

In `--cli` mode, Server Management and Log Management get their own console submenus (the flag passes down automatically); User/Player/Database Management instead drop you into the Admin CLI REPL — it's already a console-native interface to exactly those command groups (`help users`, `help players`, `help database` once inside).

Database Management (dialog mode) includes a schema-aware backup/restore/migrate toolkit: `backup` snapshots the live DB to `util/backups/` (gitignored, survives wiping `data/`), `check`/`update` compare the live DB against a fresh schema and add whatever's missing in place, and `migrate` brings an arbitrary old DB file up to the current schema.

There's also **`./live.sh`** (also `dialog`-free, always a plain console) for a *deployed* instance specifically — backing up/verifying/restoring the live `config.js` and database against snapshots kept one directory above the checkout, so a fresh code deploy never clobbers your real secret or running data.

### `node util/index.mjs` — the Admin CLI

Run it with no arguments for an interactive REPL, or give it a full command line for a one-shot invocation (what `zboe.sh`'s menus call under the hood):

```bash
node util/index.mjs                          # REPL
node util/index.mjs users list                # one-shot
node util/index.mjs players setstat <user> gold 500
```

Commands are grouped: `users` (list/add/setpassword/setadmin/remove/ban/exile/chatflag/admfun...), `players` (stats/setstat/forcelevel/guns/setgun...), `inventory`, and `database` (backup/backups/restore/check/update/migrate/inspect). Type `help` for the full group list, or `help <group>` for that group's commands and usage.

### `npm run` options

```bash
npm run dev       # node server.js --dev --debug=FULL
npm run stable    # node server.js
npm run verbose   # node server.js --verbose
```

There's no build step and no test suite — it's plain ESM Node, so these are just the three common launch presets. Anything else (mock DB seeding, config overrides, dev-only cheats) goes through `node server.js` flags directly — see **Running**, above.

## The Catch
This game is in **VERY EARLY DEV** Stages, and as such is prone to drastic changes. release-potential build "finals" will be branched into "dev-rc" versions, and when finally finished will be branched into "full-rc" and updated to the main branch.
We have started doing 2.0.* Dev RC versions.

## Database Warning
This game is in development, and updates may cause your current DB file to be out-of-date. Changes in the changelog marked with [*DB] indicate database-breaking updates. In dev, the fix is: stop the server, delete `data/zboe.sqlite*`, and let it rebuild on the next boot. There is also a schema-aware backup/restore/migrate toolkit under `./zboe.sh` → Database Management — backups live in `util/backups/` (safe from `data/` wipes), and `migrate` can bring an older DB file up to the current schema in place.
