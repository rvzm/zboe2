# zboe2

### Zombie Biohazard Occult Experiment 2

[ Version 2.0.22-RC1 ]

zboe2 is a web-based NodeJS game, adapted from my original IRC-based game.

This file will be updated as this project develops.

Currently it's still in early development

## ⚠️ Session Secret

Change `sessionSecret` in `config.js` (or pass `--set game_config.sessionSecret=...`) before any real deployment — it keys the session-cookie signing. While it's left at the default `'changeme'`:

- **Production/stable runs refuse to start** (a FATAL sanity halt).
- **Dev runs (`--dev`) print a warning and continue**, so local development isn't blocked.

## The Game

 Hunt Zombies, sort of. Currently the idea is when "The Experiment is enabled" zombies will randomly spawn based on a configurable spawn rate. Players use (currently only one) weapon to kill zombies and earn gold. When a certain number of zombies (maybe configurable?) are active, "Horde Mode" is enabled, which grants whoever killed EITHER the most zombies OR the last zombie (configurable, eventually) will get additional money and a Horde Token, which can be spent on player upgrades.

 ## The Catch
 This game is in **VERY EARLY DEV** Stages, and as such is prone to drastic changes. release-potential build "finals" will be branched into "dev-rc" versions, and when finally finished will be branched into "full-rc" and updated to the main branch.

 Currently there is no "dev-rc" as the project recently suffered a data loss and our working dev-rc was lost before it could be pushed to GitHub. 

 ## Database Warning
 This game is in development, and updates may cause your currently DB files to be out-of-date. Changes in the changelog marked with [*DB] indicate database-breaking updates. You can store your old/current db file, and eventually we will also include a "db updater" that will fix your file so it matches whatever the current schema requires.