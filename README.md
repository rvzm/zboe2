# zboe2

### Zombie Biohazard Outbreak Experiment 2

[ Version 2.0.25-dev-rc ]

zboe2 is a web-based NodeJS game, adapted from my original IRC-based game.

This file will be updated as this project develops.

Currently it's still in early development

## ⚠️ Session Secret

Change `sessionSecret` in `config.js` (or pass `--set game_config.sessionSecret=...`) before any real deployment — it keys the session-cookie signing. While it's left at the default `'changeme'`:

- **Production/stable runs refuse to start** (a FATAL sanity halt).
- **Dev runs (`--dev`) print a warning and continue**, so local development isn't blocked.

## Running

zboe can be ran by using ``npm run stable`` for a stable run. You can run with either ``dev`` or ``verbose`` to run in either "dev" or "verbose dev" where ``verbose`` stops the server from forking into the background, so you can track the console in dev mode.

You can also run via ``node server.js`` with several flags, including ``--set [type]_config.[setting]=[your_value]`` to run with specific config variables set via the command line.

## The Game

 Hunt zombies — and survive the world around them. While "The Experiment" (the hunt) is enabled, zombies spawn on a configurable rate and escalate through tiers: **wandering → hunting → raiding** (a raid latches on and doesn't stop until the horde is cleared to zero). Zombies besiege the base too — hide inside and the base soaks the damage until it falls.

 What's in the game right now:

 - **Three guns** (Handgun / Rifle / Shotgun) with per-gun ammo, clips, condition, and **jamming** — worn guns misfeed, and clearing a jam costs a fresh clip or a single bullet, depending on if you still have ammo in your clip. The Rifle can pierce through a thick horde; the Shotgun drops up to five per blast. The **Golden Gun** power-up grants 25 perfect shots.
 - **Gold + Horde Tokens**: kills pay gold; breaking a horde or ending a raid pays tokens, spendable on Shield Boosters, the Golden Gun, or exchanged back into gold.
 - **Leveling** (spend XP on levels; stat bonuses every level through 15, then every 5th) and a **lifetime-XP leaderboard**, visible on the public landing page.
 - **A world to travel**: Basecamp, the Bunker, and the Forest hub leading to the Lake, Mountains, River, Swamp, Cave, and Town. Zombies only roam some areas — the rest are safe zones with **location actions** (chop wood, fish, mine, gather, smith) that train six skills: Magic, Woodcutting, Fishing, Mining, Smithing, Crafting.
 - **An item registry** (`item_backbone.js`): every item and crafting recipe is a readable row of code — descriptions, tool requirements, shop prices, consumable effects — validated at boot so a typo'd item name can't ship.
 - **Admin tooling three ways**: a web admin panel (`/admin`), a dialog TUI (`./zboe.sh`), and a scriptable CLI (`node util/index.mjs`, with `help`).

 See `INSTALL.md` for setup, reverse-proxy (Apache/nginx), and HTTPS notes.

 ## The Catch
 This game is in **VERY EARLY DEV** Stages, and as such is prone to drastic changes. release-potential build "finals" will be branched into "dev-rc" versions, and when finally finished will be branched into "full-rc" and updated to the main branch.
 We have started doing 2.0.* Dev RC versions.

 ## Database Warning
 This game is in development, and updates may cause your current DB file to be out-of-date. Changes in the changelog marked with [*DB] indicate database-breaking updates. In dev, the fix is: stop the server, delete `data/zboe.sqlite*`, and let it rebuild on the next boot. There is also a schema-aware backup/restore/migrate toolkit under `./zboe.sh` → Database Management — backups live in `util/backups/` (safe from `data/` wipes), and `migrate` can bring an older DB file up to the current schema in place.