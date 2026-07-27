// cli/parser.js
// Command groups are lazy-loaded on first use: users/players/inventory import
// db_backbone.js, which prepares all its statements at import and crashes against an
// outdated live DB — the database group (schema check/update) must still work
// in exactly that state, so nothing may load db_backbone.js until its group is invoked.
const routes = {
  users: () => import("./commands/users.mjs"),
  inventory: () => import("./commands/inventory.mjs"),
  players: () => import("./commands/players.mjs"),
  database: () => import("./commands/database.mjs")
};

// Usage/description for every command, keyed group → action. `help` prints the
// group summaries; `help <group>` prints that group's commands.
const HELP = {
  users: {
    summary: "User accounts (auth, admin flag, moderation)",
    commands: {
      "list": "list all users with id/admin/last-login",
      "names": "bare usernames, one per line (feeds the menu pickers)",
      "add <user> <password>": "create a user (+player row)",
      "setpassword <user> <password>": "reset a user's password",
      "setadmin <user> <0|1>": "revoke/grant admin",
      "admfun <user> <0|1>": "revoke/grant Fun-button access (sub-permission within admin)",
      "chatflag <user> <mute|deaf|strict> <0|1>": "set a chat gate (see CLAUDE.md for what each does)",
      "ban <user> [duration] [reason...]": "temp-ban (duration e.g. 30m/24h/3d, default account_config.ban_timeout; auto-lifts on expiry)",
      "unban <user>": "lift a temp ban early",
      "exile <user> [reason...]": "permaban — replaces any active temp ban",
      "unexile <user>": "lift a permaban",
      "remove <user>": "delete a user and all their data (cascade)",
    },
  },
  players: {
    summary: "Player stats, leveling, guns, armor, weapon wheel, location",
    commands: {
      "stats <user>": "formatted stat sheet (core/vitals/stations/guns/armor/weapon wheel/skills)",
      "statsraw <user>": "editable stats as field=value lines (feeds the stat menu)",
      "getstat <user> <field>": "one stat's current value",
      "setstat <user> <field> <value>": "set a whitelisted stat (clamped)",
      "forcelevel <user> <steps>": "full-stack level change, ± steps, no XP cost",
      "guns <user>": "gun ownership/equip overview",
      "setgun <user> <gun> [force]": "equip a gun ('force' grants it first)",
      "armor <user>": "per-slot (head/torso/legs/boots/hands/shield) equip overview",
      "armoritems <user> <slot>": "owned/equippable armor items for that slot",
      "setarmor <user> <slot> <item> [force]": "equip armor into a paperdoll slot (\"\"/none clears; 'force' grants first)",
      "weapons <user>": "per-slot (melee/fist/ranged/throwing/zombie) equip overview",
      "weaponitems <user> <slot>": "owned/equippable weapons for that wheel slot",
      "setweapon <user> <slot> <item> [force]": "equip a weapon-wheel slot and make it active (\"\"/none clears; 'force' grants first)",
      "locations": "valid location keys/names (feeds the teleport menu)",
      "teleport <user> <location>": "move a player to any location, bypassing the travel graph",
      "setxp|setkills|setgold <user> <n>": "shorthand for setstat",
    },
  },
  inventory: {
    summary: "Player inventory items",
    commands: {
      "show <user>": "list a player's items",
      "add <user> <item> [qty] [condition] [ammo] [clips]": "grant an item",
      "remove <user> <item> [qty]": "take an item away",
    },
  },
  database: {
    summary: "Backups, restore, schema check/migration",
    commands: {
      "backup": "hot backup -> util/backups/backup_database_<timecode>.bak",
      "backups": "list backups, newest first",
      "backupexists": "yes/no — any backups present",
      "inspect <path>": "schema-verify a db file (OK/OUTDATED/INVALID/MISSING)",
      "check": "compare the live DB against a fresh schema, listing anything missing",
      "update": "add the live DB's missing tables/columns in place",
      "restore [path]": "overwrite the live DB from a backup (default: newest)",
      "migrate <path>": "bring an old db up to the current schema in place",
    },
  },
};

function helpText(group) {
  if (!group) {
    const lines = ["Commands: <group> <action> [args...]  —  'help <group>' for details\n"];
    for (const [name, h] of Object.entries(HELP)) lines.push(`  ${name.padEnd(10)} ${h.summary}`);
    return lines.join("\n");
  }
  const h = HELP[group];
  if (!h) return `Unknown group: ${group}\nGroups: ${Object.keys(HELP).join(", ")}`;
  const lines = [`${group} — ${h.summary}\n`];
  for (const [usage, desc] of Object.entries(h.commands)) lines.push(`  ${group} ${usage}\n      ${desc}`);
  return lines.join("\n");
}

function split(input) {
  return input.match(/"[^"]+"|\S+/g)?.map(s => s.replace(/"/g, "")) || [];
}

// Run from an already-tokenized argv array (the shell has handled quoting).
export async function runTokens(parts) {
  const [group, action, ...args] = parts;

  if (group === "help") return helpText(action);

  const mod = routes[group] ? await routes[group]() : null;
  const handler = mod?.[action];

  if (!handler) {
    return `Unknown command: ${group ?? ""} ${action ?? ""}`.trim() + " — try 'help'";
  }

  return await handler(...args);
}

// Run from a raw input line (interactive REPL) — tokenize, respecting quotes.
export async function runCommand(input) {
  return runTokens(split(input));
}

