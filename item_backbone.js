// item_backbone.js — the item registry (pure data, NO imports, NO logic).
// Single source of truth for every in-game item and crafting recipe. Both
// db.js and server.js import from here; server.js validates all references
// against ITEMS at boot, so a typo'd name dies loudly instead of silently.
//
// Adding an item = adding a row to ITEMS. Adding a recipe = a row in RECIPES.
//
// ITEMS fields:
//   key (the object key)  — MUST match player_inventory.item_name exactly
//   name    display name
//   type    one of ITEM_TYPES
//   desc    flavor/description shown in the UI
//   value   base worth in gold (future selling/trading)
//   use     (consumables) declarative effects applied by server.js's
//           applyItemEffects(): { heal, shield, maxShield, gunCondition,
//           gold, accuracy, goldenShots, tokens } — add a verb to the
//           interpreter once and every item can use it
//   shop    { cost, currency: "gold"|"token" } — listed in the in-game shop
//   gunType (guns) which per-gun stat block it maps to
//   ap      (armor) Armor Points, a 1-500 gauge of effectiveness: the
//           equipped armor blocks ap/500 of each tick's tallied zombie
//           damage (server.js apBlocked). Armor equips from the Backpack
//           (players.equipped_armor); inside players' AP sums into Base AP.
//   tier    (tools) material grade shown in the Backpack — "Stone", "Iron",
//           or "General" for ungraded tools (hammer, fishing rod, …)
//   toolbag (consumables) true = quick-access Toolbag tab in the Inventory
//           modal (combat consumables: gun oil, potions); other consumables
//           (food) live in the Backpack instead

export const ITEM_TYPES = ["gun", "tool", "consumable", "armor", "treasure", "trade", "crafting", "base_item"];
export const SMELT_TYPES = ["copper", "tin", "bronze", "iron", "cobalt", "silver", "gold", "mythril", "adamantite", "syllic"];

export const ITEMS = {
  // --- Guns (capitalized keys are legacy inventory names — keep them) ---
  "Handgun":        { name: "Handgun",        type: "gun",  gunType: "handgun", desc: "A reliable sidearm. Everyone starts with one." },
  "Rifle":          { name: "Rifle",          type: "gun",  gunType: "rifle",   desc: "Steady and precise — rounds can punch through a thick horde." },
  "Shotgun":        { name: "Shotgun",        type: "gun",  gunType: "shotgun", desc: "Devastating spread. Up to five zombies per blast." },
  "Burst Rifle":    { name: "Burst Rifle",    type: "gun",  gunType: "burstrifle", desc: "Fires three rounds in quick succession. Good for groups." },

  // --- Tools (owned, never consumed — gate location actions & recipes) ---
  "axe":                { name: "Axe",                type: "tool", tier: "General",    desc: "Chops wood. Occasionally zombies.",              value: 120,  shop: { cost: 120, currency: "gold" } },
  "stone pickaxe":      { name: "Stone Pickaxe",      type: "tool", tier: "Stone",      desc: "Crude, but it breaks rock.",                     value: 100,  shop: { cost: 100, currency: "gold" } },
  "bronze pickaxe":     { name: "Bronze Pickaxe",     type: "tool", tier: "Bronze",     desc: "Improved but crude pickaxe.",                    value: 125,  shop: { cost: 125, currency: "gold" } },
  "iron pickaxe":       { name: "Iron Pickaxe",       type: "tool", tier: "Iron",       desc: "A proper pickaxe. Smashes stone and ore.",       value: 200,  shop: { cost: 200, currency: "gold" } },
  "cobalt pickax":      { name: "Cobalt Pickaxe",     type: "tool", tier: "Cobalt",     desk: "A Cobalt pickaxe. Smashes stone and ore.",       value: 250,  shop: { cost: 250, currency: "gold" } },
  "silver pickaxe":     { name: "Silver Pickaxe",     type: "tool", tier: "Silver",     desc: "A silver pickaxe. Smashes stone and ore.",       value: 300,  shop: { cost: 300, currency: "gold" } },
  "gold pickaxe":       { name: "Gold Pickaxe",       type: "tool", tier: "Gold",       desc: "A gold pickaxe. Smashes stone and ore.",         value: 400,  shop: { cost: 400, currency: "gold" } },
  "mythril pickaxe":    { name: "Mythril Pickaxe",    type: "tool", tier: "Mythril",    desc: "A mythril pickaxe. Smashes stone and ore.",      value: 600,  shop: { cost: 600, currency: "gold" } },
  "adamantite pickaxe": { name: "Adamantite Pickaxe", type: "tool", tier: "Adamantite", desc: "An adamantite pickaxe. Smashes stone and ore.",  value: 1000, shop: { cost: 1000, currency: "gold" } },
  "syllic pickaxe":     { name: "Syllic Pickaxe",     type: "tool", tier: "Syllic",     desc: "A syllic pickaxe. Smashes stone and ore.",       value: 1500, shop: { cost: 1500, currency: "gold" } },
  "fishing rod":        { name: "Fishing Rod",        type: "tool", tier: "General",    desc: "A rod, a line, and optimism.",                   value: 90,   shop: { cost: 90,  currency: "gold" } },
  "hammer":             { name: "Hammer",             type: "tool", tier: "General",    desc: "For smithing at a forge. Or percussive repair.", value: 110,  shop: { cost: 110, currency: "gold" } },

  // --- Consumables (have a `use` block; consumed one at a time) ---
  "gun oil":        { name: "Gun Oil",        type: "consumable", toolbag: true, desc: "Restores 25 condition to the equipped gun.", value: 40, use: { gunCondition: 25 } },
  "healing potion": { name: "Healing Potion", type: "consumable", toolbag: true, desc: "Restores 50 health.",                        value: 25, use: { heal: 50 } },
  "shield potion":  { name: "Shield Potion",  type: "consumable", toolbag: true, desc: "Restores 50 shield.",                        value: 60, use: { shield: 50 } },
  "mushroom":       { name: "Mushroom",       type: "consumable", desc: "Probably edible. Restores 5 health.",        value: 4,  use: { heal: 5 } },
  "cooked fish":    { name: "Cooked Fish",    type: "consumable", desc: "A hot meal. Restores 25 health.",            value: 18, use: { heal: 25 } },
  "cooked tuna":    { name: "Cooked Tuna",    type: "consumable", desc: "A hot meal. Restores 30 health.",            value: 20, use: { heal: 30 } },
  "cooked small meat": { name: "Cooked Small Meat", type: "consumable", desc: "Seared over a campfire. Restores 20 health.", value: 15, use: { heal: 20 } },
  "cooked meat":    { name: "Cooked Meat",    type: "consumable", desc: "Seared over a campfire. Restores 30 health.", value: 25, use: { heal: 30 } },
  "cooked mushroom": { name: "Cooked Mushroom", type: "consumable", desc: "A simple dish. Restores 10 health.",          value: 8,  use: { heal: 10 } },
  "mushroom stew":  { name: "Mushroom Stew",  type: "consumable", desc: "Earthy and filling. Restores 20 health.",     value: 15, use: { heal: 20 } },
  "mushroom sautee": { name: "Mushroom Sautee", type: "consumable", desc: "A simple dish. Restores 30 health.",          value: 20, use: { heal: 30 } },
  "meat stew":      { name: "Meat Stew",      type: "consumable", desc: "A proper survivor's meal. Restores 60 health.", value: 40, use: { heal: 60 } },
  "fish stew":      { name: "Fish Stew",      type: "consumable", desc: "A hearty meal. Restores 50 health.",          value: 35, use: { heal: 50 } },
  "mana potion":    { name: "Mana Potion",    type: "consumable", toolbag: true, desc: "Restores 25 mana.",                           value: 50, use: { maxShield: 25 } },
  

  // --- Crafting materials (action/recipe inputs and outputs) ---
  // - Wood
  "firewood":       { name: "Firewood",       type: "crafting", desc: "Dry wood, ready to burn.",                   value: 5 },
  "wood log":       { name: "Wood Log",       type: "crafting", desc: "A solid log. Building material.",            value: 8 },
  // - Food
  "raw fish":       { name: "Raw Fish",       type: "crafting", desc: "Fresh from the lake. Cook before eating.",   value: 10 },
  "raw tuna":       { name: "Raw Tuna",       type: "crafting", desc: "A large fish. Cook before eating.",           value: 12 },
  "raw small meat": { name: "Raw Small Meat", type: "crafting", desc: "A small piece of meat. Cook it over a fire first.", value: 8 },
  "raw meat":       { name: "Raw Meat",       type: "crafting", desc: "Fresh game. Cook it over a fire first.",     value: 15 },
  "raw mushroom":   { name: "Raw Mushroom",   type: "crafting", desc: "A wild mushroom. Cook before eating.",        value: 5 },
  // - Ore & bars
  "copper ore":     { name: "Copper Ore",     type: "crafting", desc: "Raw ore, ready for the forge.",              value: 12 },
  "copper bar":     { name: "Copper Bar",     type: "crafting", desc: "Smelted copper, ready for smithing.",        value: 35 },
  "tin ore":        { name: "Tin Ore",        type: "crafting", desc: "Raw ore, ready for the forge",               value: 5 },
  "tin bar":        { name: "Tin Bar",        type: "crafting", desc: "Smelted tin, ready for smithing.",           value: 15 },
  "iron ore":       { name: "Iron Ore",       type: "crafting", desc: "Heavy ore. Smelts into strong metal.",       value: 20 },
  "iron bar":       { name: "Iron Bar",       type: "crafting", desc: "Smelted iron, ready for smithing.",          value: 55 },
  "bronze bar":     { name: "Bronze Bar",     type: "crafting", desc: "Smelted bronze, ready for smithing",         value: 38 },
  "cobalt ore":     { name: "Cobalt Ore",     type: "crafting", desc: "Raw ore, ready for the forge",               value: 58 },
  "cobalt bar":     { name: "Cobalt Bar",     type: "crafting", desc: "Smelted cobalt, ready for smithig.",         value: 65 },
  "silver ore":     { name: "Silver Ore",     type: "crafting", desc: "Shiny ore. Smelts into silver.",             value: 30 },
  "silver bar":     { name: "Silver Bar",     type: "crafting", desc: "Smelted silver, ready for smithing.",        value: 50 },
  "gold ore":       { name: "Gold Ore",       type: "crafting", desc: "Rare and valuable. Smelts into gold.",       value: 50 },
  "gold bar":       { name: "Gold Bar",       type: "crafting", desc: "Smelted gold, ready for smithing.",          value: 80 },
  "mythril ore":    { name: "Mythril Ore",    type: "crafting", desc: "A legendary ore. Smelts into mythril.",      value: 100 },
  "mythril bar":    { name: "Mythril Bar",    type: "crafting", desc: "Smelted mythril, ready for smithing.",       value: 150 },
  "adamantite ore": { name: "Adamantite Ore", type: "crafting", desc: "A mythical ore. Smelts into adamantite.",    value: 200 },
  "adamantite bar": { name: "Adamantite Bar", type: "crafting", desc: "Smelted adamantite, ready for smithing.",    value: 300 },
  "syllic ore":     { name: "Syllic Ore",     type: "crafting", desc: "A rare ore. Combines with Mythril to create something more than 2 times stronger than adamantite.", value: 800 },
  "syllic bar":     { name: "Syllic Bar",     type: "crafting", desc: "Smelted syllic, ready for smithing.",        value: 1200 },
  // - Misc Smithing ingredients
  "copper wire":    { name: "Copper Wire",    type: "crafting", desc: "Thin copper strands. Conducts electricity.", value: 20 },
  "tin wire":       { name: "Tin Wire",       type: "crafting", desc: "Thin tin strands, can be used for binding.", value: 15 },
  "tin plate":      { name: "Tin Plate",      type: "crafting", desc: "Thin plate of tin. Can be shaped with a hammer", value: 20 },
  "tin foil":       { name: "Tin Foil",       type: "crafting", desc: "Thin tin foil, can be used for apparel or crafting", value: 100 },
  "gold wire":      { name: "Gold Wire",      type: "crafting", desc: "Thin gold strands. Conducts electricity.",     value: 40 },
  "silver wire":    { name: "Silver Wire",    type: "crafting", desc: "Thin silver strands. Conducts electricity.",   value: 30 },
  "syllic wire":    { name: "Syllic Wire",    type: "crafting", desc: "Thin syllic strands. Conducts electricity.",    value: 100 },
  "syllic plate":   { name: "Syllic Plate",   type: "crafting", desc: "A thin sheet of syllic. Used in advanced smithing.", value: 200 },
  "cobalt shard":   { name: "Cobalt Shard",   type: "crafting", desc: "A shard of cobalt",                          value: 35 },
  "cobalt funnel":  { name: "Cobalt Funnel",  type: "crafting", desc: "A funnel for filling molds",                 value: 25 },
  // - Cobalt Molds, for crafting jewelry
  "cobalt mold star":    { name: "Mold (star)",          type: "crafting", desc: "A mold in the shape of a star",    value: 100 },
  "cobalt mold circ":    { name: "Mold (circle)",        type: "crafting", desc: "A mold in the shape of a circle",  value: 100 },
  "cobalt mold line":    { name: "Mold (line)",          type: "crafting", desc: "A mold in the shape of a line",    value: 100 },
  "cobalt mold trgt":    { name: "Mold (target)",        type: "crafting", desc: "A mold in the shape of a target",  value: 100 },
  "cobalt mold arow":    { name: "Mold (arrow)",         type: "crafting", desc: "A mold in the shape of a arrow",   value: 100 },
  "cobalt mold l squar": { name: "Large Mold (square)",  type: "crafting", desc: "A large square mold",              value: 200 },
  "cobalt mold l sign":  { name: "Large Mold (sign)",    type: "crafting", desc: "A large mold for making signs",    value: 250 },
  "cobalt mold l insg":  { name: "Large Mold (Insigia)", type: "crafting", desc: "A large mold with a customizable insignia space", value: 250 },
  // - Armors
  "iron armor":       { name: "Iron Armor",       type: "armor",    desc: "A suit of iron armor. Heavy but protective.",  value: 150, ap: 50 },
  "bronze armor":     { name: "Bronze Armor",     type: "armor",    desc: "A suit of Bronze armor. Lighter but restrictive", value: 200, ap: 60 },
  "silver armor":     { name: "Silver Armor",     type: "armor",    desc: "A suit of silver armor. Shines and protects.", value: 250, ap: 75 },
  "gold armor":       { name: "Gold Armor",       type: "armor",    desc: "A suit of gold armor. Heavy, shiny, and protective.", value: 400, ap: 100 },
  "gold and silver armor": { name: "Gold and Silver Armor", type: "armor",    desc: "A suit of gold and silver armor. Heavy, shiny, and protective.", value: 600, ap: 115 },
  "mythril armor":    { name: "Mythril Armor",    type: "armor",    desc: "A suit of mythril armor. Light and protective.", value: 800, ap: 150 },
  "adamantite armor": { name: "Adamantite Armor", type: "armor",    desc: "A suit of adamantite armor. Extremely protective.", value: 1200, ap: 200 },
  "syllic armor":     { name: "Syllic Armor",     type: "armor",    desc: "A suit of syllic armor. Extremely protective.", value: 2000, ap: 350 },
  // - Misc
  "swamp herb":     { name: "Swamp Herb",     type: "crafting", desc: "Pungent. Alchemists swear by it.",           value: 6 },
  "river herb":     { name: "River Herb",     type: "crafting", desc: "A fragrant herb. Used in potions.",           value: 7 },
  "lake herb":      { name: "Lake Herb",      type: "crafting", desc: "A rare herb. Used in potions.",                value: 8 },
  "glowcap":        { name: "Glowcap",        type: "crafting", desc: "A faintly luminous mushroom. Hums with magic.", value: 9 },
  "scrap metal":    { name: "Scrap Metal",    type: "crafting", desc: "Rusty but salvageable.",                     value: 8 },
  "coal":           { name: "Coal",           type: "crafting", desc: "Black rock. Burns hot.",                      value: 10 },

  // --- Trade goods (made to be sold) ---
  "minnow":         { name: "Minnow",         type: "trade", desc: "Tiny fish. Bait, or a very small meal.",        value: 3 },
  "crude blade":    { name: "Crude Blade",    type: "trade", desc: "Rough smithing work, but it holds an edge.",    value: 45 },
  "weak blade":     { name: "Weak Blade",     type: "trade", desc: "A simple sword. Not very strong.",               value: 60 },
  "magic amulet":   { name: "Magic Amulet",   type: "trade", desc: "A trinket of raw ley-line energy. Highly sought.", value: 500 },

  // --- Treasure (rare/valuable finds) ---
  "mana shard":     { name: "Mana Shard",     type: "treasure", desc: "A splinter of raw ley-line energy.",         value: 60 },
  "radio part":     { name: "Radio Part",     type: "treasure", desc: "Delicate electronics. Someone needs this.",  value: 40 },
  "golden bangle":   { name: "Golden Bangle",   type: "treasure", desc: "A gold bracelet. Worth a lot to the right buyer.", value: 150 },
  "syllic shard":    { name: "Syllic Shard",    type: "treasure", desc: "A fragment of syllic. Rare and valuable.",     value: 300 },
  "syllic tablet":   { name: "Syllic Tablet",    type: "treasure", desc: "A tablet of syllic, engraved with an unknown language. Rare and extremely valuable.", value: 5000 },
  "strange egg":      { name: "Strange Egg",      type: "treasure", desc: "A mysterious egg. It hums with latent energy.", value: 200 },

  // --- Bunker Items (quest progression, supply beacons, and other radio/base items) ---
  "functional radio": { name: "Functional Radio", type: "base_item", desc: "A working radio. Can call for help.", value: 100 },
  "supply beacon":    { name: "Supply Beacon",    type: "base_item", desc: "A beacon that calls in supply drops.", value: 200 },
  "base repair kit":   { name: "Base Repair Kit",   type: "base_item", desc: "Use at the Bunker to stock a repair kit for the base (+500 base HP per use, from inside).", value: 150, use: { stockRepairKits: 1 } },
  "external antenna":     { name: "External Antenna",     type: "base_item", desc: "Passive while owned: +10% supply beacon activation chance.", value: 120 },
  "signal amplifier":     { name: "Signal Amplifier",     type: "base_item", desc: "Passive while owned: +15% supply beacon activation chance.", value: 130 },
  "sentry turret":     { name: "Sentry Turret",     type: "base_item", desc: "Use at the Bunker: shields the base from all zombie damage for 4 hours and returns fire during raids.", value: 250, use: { sentryHours: 4 } },
  "storage locker":     { name: "Storage Locker",     type: "base_item", desc: "A secure locker for storing items.", value: 100 },

};

// ----- Random drops -----
// Bonus treasure that can fall from actions flagged `drops: true` in
// LOCATION_ACTIONS (the foraging/woodcutting ones). On each SUCCESSFUL
// action, the table is rolled top to bottom and the first entry to pass its
// `chance` (%) is granted — one bonus drop max per action. Every entry is
// auto-registered into ITEMS as a "treasure" (sellable from the Backpack),
// so adding a drop = adding a row here.
export const RANDOM_DROPS = [
  //  key             name             chance  value  desc
  { key: "mysterious rock", name: "Mysterious Rock", chance: 10, value: 15, desc: "A rock with strange markings. Worth a few coins." },
  { key: "old coin",        name: "Old Coin",      chance: 8, value: 30, desc: "Pre-outbreak currency. Collectors still pay well." },
  { key: "bird nest",       name: "Bird Nest",     chance: 6, value: 20, desc: "Neatly woven. Sometimes something glints inside." },
  { key: "ancient shard",   name: "Ancient Shard",  chance: 5, value: 50, desc: "A fragment of something old and powerful." },
  { key: "mystic feather",  name: "Mystic Feather", chance: 5, value: 70, desc: "A feather that hums with latent magic." },
  { key: "crystal vial",    name: "Crystal Vial",   chance: 5, value: 80, desc: "A small vial of unknown liquid. Alchemists would pay." },
  { key: "amber shard",     name: "Amber Shard",   chance: 5, value: 40, desc: "Fossilized sap with something ancient inside." },
  { key: "lost locket",     name: "Lost Locket",   chance: 4, value: 55, desc: "Someone's memento. Worth more than it should be." },
  { key: "pristine seed",   name: "Pristine Seed", chance: 2, value: 90, desc: "Untouched by the blight. Growers would kill for it." },
  { key: "ancient coin",   name: "Ancient Coin",   chance: 1, value: 120, desc: "A coin from a long-lost civilization. Worth a fortune." },
  { key: "mystic orb",     name: "Mystic Orb",     chance: 1, value: 150, desc: "A small orb that pulses with magical energy." },
  { key: "ancient relic",   name: "Ancient Relic",   chance: 1, value: 200, desc: "A relic from a bygone era. Collectors would pay handsomely." },
  { key: "ancient tome",   name: "Ancient Tome",   chance: 1, value: 250, desc: "A book of forgotten knowledge. Scholars would pay dearly." },
  { key: "ancient artifact", name: "Ancient Artifact", chance: 1, value: 300, desc: "An artifact of immense historical value. Museums would pay a fortune." },
];

// Register the drops as treasure items — they live in ITEMS like everything
// else (descriptions, values, boot validation, backpack display).
for (const d of RANDOM_DROPS) {
  ITEMS[d.key] = { name: d.name, type: "treasure", desc: d.desc, value: d.value };
}

// Supply Drop Roll — the random bonus in a supply drop (recipes with
// `roll: "supply"`). Rolled top to bottom; the first entry to pass its
// `chance` (%) is granted — one bonus max per drop. Unlike RANDOM_DROPS,
// entries here reference EXISTING ITEMS keys (boot-validated), so anything
// already in the registry can ride in on a supply drop.
export const SUPPLY_DROP_ROLL = [
  { key: "healing potion",     chance: 15 },
  { key: "shield potion",      chance: 15 },
  { key: "gun oil",            chance: 15 },
  { key: "mushroom",           chance: 12 },
  { key: "cooked fish",        chance: 10 },
  { key: "cooked meat",        chance: 10 },
  { key: "cooked mushroom",    chance: 10 },
  { key: "mysterious rock", chance: 10 },
  { key: "old coin",        chance: 8 },
  { key: "bird nest",       chance: 6 },
  { key: "ancient shard",   chance: 5 },
  { key: "mystic feather",  chance: 5 },
  { key: "crystal vial",    chance: 5 },
  { key: "amber shard",     chance: 5 },
  { key: "lost locket",     chance: 4 },
  { key: "pristine seed",   chance: 2 },
  { key: "ancient coin",    chance: 1 },
  { key: "mystic orb",      chance: 1 },
  { key: "ancient relic",   chance: 1 },
  { key: "ancient tome",    chance: 1 },
  { key: "ancient artifact", chance: 1 },
  { key: "supply beacon", chance: 0.5 },
  { key: "functional radio", chance: 0.5 },
  { key: "base repair kit", chance: 0.5 },
  { key: "external antenna", chance: 0.5 },
  { key: "signal amplifier", chance: 0.5 },
  { key: "sentry turret", chance: 0.5 },
  { key: "storage locker", chance: 0.5 },
  { key: "iron armor", chance: 0.5 },
  { key: "silver armor", chance: 0.5 },
  { key: "gold armor", chance: 0.5 },
  { key: "gold and silver armor", chance: 0.5 },
  { key: "mythril armor", chance: 0.5 },
  { key: "adamantite armor", chance: 0.5 },
  { key: "syllic armor", chance: 0.25 },
];

// RECIPES fields:
//   key       unique id
//   label     display name
//   skill     which skill it trains / gates it
//   level     minimum skill level
//   station   where it can be crafted: "campfire" (the player must have one
//             burning — see /api/campfire), "forge" (your Mountains forge
//             must be fired — see fire_forge), or "beacon" (a live supply
//             beacon at the Bunker — see activate_supply_beacon). Omit for
//             craftable-anywhere.
//   requires  tool that must be OWNED (not consumed) — omit for none
//   inputs    { item: qty, ... } — CONSUMED on craft
//   output    item granted (1 per craft), or { item: qty, ... } for a bundle
//   roll      "supply" — the craft ALSO rolls the SUPPLY_DROP_ROLL table once
//             (first entry to pass its chance wins, one bonus max) — the
//             declarative random-roll picker; server.js does the rolling
//   xp        skill XP awarded
//   timer     seconds the craft takes
//   section   (forge recipes) which section of the Use Forge modal the row
//             renders under: "Ingredients" | "Tools" | "Iron" | "Silver" |
//             "Gold" | "Mythril" | "Adamantite" | "Syllic". The modal's main
//             tab is derived from the key: smelt_* -> Smelting, everything
//             else -> Smithing. Required on station:"forge" rows (boot-checked).
export const RECIPES = [
  // Town Crafting 
  // -- General crafting (anywhere)
  { key: "craft_mana_potion", label: "Craft Mana Potion", skill: "alchemy", level: 1, inputs: { "swamp herb": 1, "river herb": 1 }, output: "mana potion", xp: 10, timer: 15 },
  { key: "craft_healing_potion", label: "Craft Healing Potion", skill: "alchemy", level: 1, inputs: { "swamp herb": 1, "lake herb": 1 }, output: "healing potion", xp: 10, timer: 15 },
  { key: "craft_shield_potion", label: "Craft Shield Potion", skill: "alchemy", level: 2, inputs: { "river herb": 1, "lake herb": 1 }, output: "shield potion", xp: 12, timer: 20 },
  // -- Town crafting (Only accessible in Town, requires campfire)
  { key: "craft_weak_blade", label: "Craft Weak Blade", skill: "smithing", level: 1, station: "campfire", requires: "hammer", inputs: { "copper bar": 1, "scrap metal": 1 }, output: "weak blade", xp: 15, timer: 20 },
  { key: "craft_radio_part", label: "Craft Radio Part", skill: "smithing", level: 2, station: "campfire", requires: "hammer", inputs: { "copper wire": 1, "scrap metal": 1 }, output: "radio part", xp: 20, timer: 25 },
  // Campfire cooking (the fire replaces any firewood input — building it costs the wood)
  { key: "cook_fish",     label: "Cook Fish",     skill: "crafting", level: 1, station: "campfire", inputs: { "raw fish": 1 },                    output: "cooked fish",   xp: 8,  timer: 10 },
  { key: "cook_tuna",     label: "Cook Tuna",     skill: "crafting", level: 1, station: "campfire", inputs: { "raw tuna": 1 },                    output: "cooked tuna",   xp: 10,  timer: 10 },
  { key: "cook_small_meat", label: "Cook Small Meat", skill: "crafting", level: 1, station: "campfire", inputs: { "raw small meat": 1 },            output: "cooked small meat", xp: 8,  timer: 10 },
  { key: "cook_meat",     label: "Cook Meat",     skill: "crafting", level: 1, station: "campfire", inputs: { "raw meat": 1 },                    output: "cooked meat",   xp: 8,  timer: 10 },
  { key: "cook_mushroom", label: "Cook Mushroom", skill: "crafting", level: 1, station: "campfire", inputs: { "raw mushroom": 1 },                output: "cooked mushroom", xp: 8,  timer: 10 },
  { key: "mushroom_stew", label: "Mushroom Stew", skill: "crafting", level: 2, station: "campfire", inputs: { "mushroom": 3 },                    output: "mushroom stew", xp: 12, timer: 15 },
  { key: "fish_stew",     label: "Fish Stew",     skill: "crafting", level: 2, station: "campfire", inputs: { "cooked fish": 1, "mushroom": 1 },  output: "fish stew",     xp: 12, timer: 15 },
  { key: "meat_stew",     label: "Meat Stew",     skill: "crafting", level: 3, station: "campfire", inputs: { "cooked meat": 1, "mushroom": 1 },  output: "meat stew",     xp: 15, timer: 15 },
  { key: "mushroom_sautee", label: "Mushroom Sautee", skill: "crafting", level: 3, station: "campfire", inputs: { "cooked mushroom": 2 },         output: "mushroom sautee", xp: 15, timer: 15 },
  // Bunker Systems. Only enable_supply_beacon needs a LIVE beacon (it's the
  // redemption of the call-in) and rolls the supply table (it IS the drop).
  // The rest just need a functional radio kept on hand — no beacon required.
  { key: "enable_supply_beacon", label: "Enable Supply Beacon", skill: "crafting", level: 5, station: "beacon", requires: "functional radio", inputs: { "supply beacon": 1, "functional radio": 1 }, output: { "cooked meat": 3, "cooked fish": 3, "cooked mushroom": 3, "meat stew": 1, "firewood": 5, "functional radio": 1 }, roll: "supply", xp: 50, timer: 30 },
  { key: "craft_base_repair_kit", label: "Craft Base Repair Kit", skill: "crafting", level: 4, requires: "functional radio", inputs: { "scrap metal": 3, "copper wire": 1 }, output: "base repair kit", xp: 40, timer: 25 },
  { key: "craft_external_antenna", label: "Craft External Antenna", skill: "crafting", level: 4, requires: "functional radio", inputs: { "copper wire": 2, "scrap metal": 2 }, output: "external antenna", xp: 40, timer: 25 },
  { key: "craft_signal_amplifier", label: "Craft Signal Amplifier", skill: "crafting", level: 5, requires: "functional radio", inputs: { "copper wire": 3, "silver wire": 1 }, output: "signal amplifier", xp: 50, timer: 30 },
  { key: "craft_sentry_turret", label: "Craft Sentry Turret", skill: "crafting", level: 6, requires: "functional radio", inputs: { "scrap metal": 5, "copper wire": 2, "silver wire": 1 }, output: "sentry turret", xp: 60, timer: 35 },
  { key: "craft_storage_locker", label: "Craft Storage Locker", skill: "crafting", level: 5, requires: "functional radio", inputs: { "scrap metal": 4, "copper wire": 2 }, output: "storage locker", xp: 50, timer: 30 },
  { key: "craft_supply_beacon", label: "Craft Supply Beacon", skill: "crafting", level: 7, requires: "functional radio", inputs: { "scrap metal": 6, "copper wire": 3, "silver wire": 2 }, output: "supply beacon", xp: 70, timer: 40 },
  // Forge work — the player's own forge at the Mountains (fire_forge), not Town
  // -- Crafting (raw -> usable)
  { key: "craft_firewood", label: "Craft Firewood", skill: "crafting", level: 1, station: "forge", section: "Ingredients", inputs: { "wood log": 1 }, output: "firewood", xp: 5, timer: 10 },
  { key: "craft_copper_wire", label: "Craft Copper Wire", skill: "crafting", level: 2, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "copper bar": 1 }, output: "copper wire", xp: 10, timer: 15 },
  { key: "craft_silver_wire", label: "Craft Silver Wire", skill: "crafting", level: 3, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "silver bar": 1 }, output: "silver wire", xp: 15, timer: 20 },
  { key: "craft_gold_wire", label: "Craft Gold Wire", skill: "crafting", level: 4, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "gold bar": 1 }, output: "gold wire", xp: 20, timer: 25 },
  { key: "craft_syllic_wire", label: "Craft Syllic Wire", skill: "crafting", level: 5, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "syllic bar": 1 }, output: "syllic wire", xp: 25, timer: 30 },
  // -- Smelting (ore -> bar)
  { key: "smelt_copper",  label: "Smelt Copper",  skill: "smithing", level: 1, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "copper ore": 2, "firewood": 1 }, output: "copper bar", xp: 15, timer: 20 },
  { key: "smelt_iron",    label: "Smelt Iron",    skill: "smithing", level: 5, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron ore": 2, "firewood": 2 },   output: "iron bar",   xp: 25, timer: 30 },
  { key: "smelt_tin",     label: "Smelt Tin",     skill: "smithing", level: 2, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "tin ore": 2, "firewood": 1 },    output: "tin bar",    xp: 15, timer: 20 },
  { key: "smelt_silver",  label: "Smelt Silver",  skill: "smithing", level: 4, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver ore": 2, "firewood": 2 }, output: "silver bar", xp: 20, timer: 25 },
  { key: "smelt_gold",    label: "Smelt Gold",    skill: "smithing", level: 5, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold ore": 2, "firewood": 3 },   output: "gold bar",   xp: 30, timer: 35 },
  { key: "smelt_mythril",  label: "Smelt Mythril",  skill: "smithing", level: 6, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril ore": 2, "firewood": 4 }, output: "mythril bar", xp: 40, timer: 45 },
  { key: "smelt_adamantite", label: "Smelt Adamantite", skill: "smithing", level: 7, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite ore": 2, "firewood": 5 }, output: "adamantite bar", xp: 50, timer: 50 },
  { key: "smelt_syllic",    label: "Smelt Syllic",    skill: "smithing", level: 8, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic ore": 2, "firewood": 6 }, output: "syllic bar", xp: 60, timer: 55 },
  { key: "smelt_syllic_plate", label: "Smelt Syllic Plate", skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 2, "mythril bar": 1, "firewood": 6 }, output: "syllic plate", xp: 70, timer: 60 },
  // -- Smithging (bars -> tools, consumables, trade goods)
  { key: "smith_axe",       label: "Smith Axe",      skill: "smithing", level: 3, station: "forge", section: "Tools", requires: "hammer", inputs: { "iron bar": 1, "firewood": 1 }, output: "axe",          xp: 20, timer: 25 },
  { key: "smith_iron_pickaxe",   label: "Smith Iron Pickaxe",  skill: "smithing", level: 4, station: "forge", section: "Tools", requires: "hammer", inputs: { "iron bar": 1, "firewood": 1 }, output: "iron pickaxe", xp: 25, timer: 30 },
  { key: "smith_silver_pickaxe", label: "Smith Silver Pickaxe", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "silver bar": 1, "firewood": 1 }, output: "silver pickaxe", xp: 30, timer: 35 },
  { key: "smith_gold_pickaxe",   label: "Smith Gold Pickaxe",   skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "gold bar": 1, "firewood": 1 }, output: "gold pickaxe", xp: 35, timer: 40 },
  { key: "smith_mythril_pickaxe", label: "Smith Mythril Pickaxe", skill: "smithing", level: 6, station: "forge", section: "Tools", requires: "hammer", inputs: { "mythril bar": 1, "firewood": 1 }, output: "mythril pickaxe", xp: 40, timer: 45 },
  { key: "smith_adamantite_pickaxe", label: "Smith Adamantite Pickaxe", skill: "smithing", level: 7, station: "forge", section: "Tools", requires: "hammer", inputs: { "adamantite bar": 1, "firewood": 1 }, output: "adamantite pickaxe", xp: 50, timer: 50 },
  { key: "smith_syllic_pickaxe", label: "Smith Syllic Pickaxe", skill: "smithing", level: 8, station: "forge", section: "Tools", requires: "hammer", inputs: { "syllic bar": 1, "firewood": 1 }, output: "syllic pickaxe", xp: 60, timer: 55 },
  // -- Armor (bars -> armor)
  { key: "smith_iron_armor",       label: "Smith Iron Armor",       skill: "smithing", level: 4, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron bar": 3 }, output: "iron armor", xp: 30, timer: 35 },
  { key: "smith_silver_armor",     label: "Smith Silver Armor",     skill: "smithing", level: 5, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver bar": 3 }, output: "silver armor", xp: 40, timer: 40 },
  { key: "smith_gold_armor",       label: "Smith Gold Armor",       skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 3 }, output: "gold armor", xp: 50, timer: 45 },
  { key: "smith_gold_and_silver_armor", label: "Smith Gold and Silver Armor", skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 2, "silver bar": 1 }, output: "gold and silver armor", xp: 55, timer: 50 },
  { key: "smith_mythril_armor",    label: "Smith Mythril Armor",    skill: "smithing", level: 7, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril bar": 3 }, output: "mythril armor", xp: 60, timer: 50 },
  { key: "smith_adamantite_armor", label: "Smith Adamantite Armor", skill: "smithing", level: 8, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite bar": 3 }, output: "adamantite armor", xp: 70, timer: 55 },
  { key: "smith_syllic_armor",     label: "Smith Syllic Armor",     skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 3, "syllic plate": 1 }, output: "syllic armor", xp: 80, timer: 60 },
  // -- Alchemy (bars + herbs -> potions)
  { key: "brew_healing_potion", label: "Brew Healing Potion", skill: "alchemy", level: 2, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "swamp herb": 1, "copper bar": 1 }, output: "healing potion", xp: 15, timer: 20 },
  { key: "brew_shield_potion",  label: "Brew Shield Potion",  skill: "alchemy", level: 3, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "swamp herb": 1, "silver bar": 1 }, output: "shield potion", xp: 20, timer: 25 },
  // -- Crafting (bars + herbs + other inputs -> consumables, trade goods)
  { key: "gun_oil",       label: "Make Gun Oil",  skill: "crafting", level: 3, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "scrap metal": 1, "swamp herb": 1 }, output: "gun oil", xp: 10, timer: 15 },
  { key: "crude_blade",   label: "Make Crude Blade", skill: "smithing", level: 3, station: "forge", section: "Tools", requires: "hammer", inputs: { "scrap metal": 2, "firewood": 1 }, output: "crude blade", xp: 20, timer: 25 },
  { key: "fishing_rod",   label: "Make Fishing Rod", skill: "crafting", level: 2, station: "forge", section: "Tools", requires: "hammer", inputs: { "wood log": 1, "swamp herb": 1 }, output: "fishing rod", xp: 12, timer: 20 },
  { key: "magic_amulet",    label: "Make Magic Amulet", skill: "crafting", level: 5, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "mana shard": 1, "silver bar": 1, "coal": 3, "gold ore": 2 }, output: "magic amulet", xp: 30, timer: 40 },
];
