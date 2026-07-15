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
//   tier    (tools) material grade shown in the Backpack — "Stone", "Iron",
//           or "General" for ungraded tools (hammer, fishing rod, …)
//   toolbag (consumables) true = quick-access Toolbag tab in the Inventory
//           modal (combat consumables: gun oil, potions); other consumables
//           (food) live in the Backpack instead

export const ITEM_TYPES = ["gun", "tool", "consumable", "treasure", "trade", "crafting"];

export const ITEMS = {
  // --- Guns (capitalized keys are legacy inventory names — keep them) ---
  "Handgun":        { name: "Handgun",        type: "gun",  gunType: "handgun", desc: "A reliable sidearm. Everyone starts with one." },
  "Rifle":          { name: "Rifle",          type: "gun",  gunType: "rifle",   desc: "Steady and precise — rounds can punch through a thick horde." },
  "Shotgun":        { name: "Shotgun",        type: "gun",  gunType: "shotgun", desc: "Devastating spread. Up to five zombies per blast." },

  // --- Tools (owned, never consumed — gate location actions & recipes) ---
  "axe":            { name: "Axe",            type: "tool", tier: "General", desc: "Chops wood. Occasionally zombies.",             value: 120, shop: { cost: 120, currency: "gold" } },
  "stone pickaxe":  { name: "Stone Pickaxe",  type: "tool", tier: "Stone",   desc: "Crude, but it breaks rock.",                    value: 100, shop: { cost: 100, currency: "gold" } },
  "fishing rod":    { name: "Fishing Rod",    type: "tool", tier: "General", desc: "A rod, a line, and optimism.",                  value: 90,  shop: { cost: 90,  currency: "gold" } },
  "hammer":         { name: "Hammer",         type: "tool", tier: "General", desc: "For smithing at a forge. Or percussive repair.", value: 110, shop: { cost: 110, currency: "gold" } },

  // --- Consumables (have a `use` block; consumed one at a time) ---
  "gun oil":        { name: "Gun Oil",        type: "consumable", toolbag: true, desc: "Restores 25 condition to the equipped gun.", value: 40, use: { gunCondition: 25 } },
  "healing potion": { name: "Healing Potion", type: "consumable", toolbag: true, desc: "Restores 50 health.",                        value: 25, use: { heal: 50 } },
  "shield potion":  { name: "Shield Potion",  type: "consumable", toolbag: true, desc: "Restores 50 shield.",                        value: 60, use: { shield: 50 } },
  "mushroom":       { name: "Mushroom",       type: "consumable", desc: "Probably edible. Restores 5 health.",        value: 4,  use: { heal: 5 } },
  "cooked fish":    { name: "Cooked Fish",    type: "consumable", desc: "A hot meal. Restores 25 health.",            value: 18, use: { heal: 25 } },
  "cooked meat":    { name: "Cooked Meat",    type: "consumable", desc: "Seared over a campfire. Restores 30 health.", value: 25, use: { heal: 30 } },
  "mushroom stew":  { name: "Mushroom Stew",  type: "consumable", desc: "Earthy and filling. Restores 20 health.",     value: 15, use: { heal: 20 } },
  "meat stew":      { name: "Meat Stew",      type: "consumable", desc: "A proper survivor's meal. Restores 60 health.", value: 40, use: { heal: 60 } },

  // --- Crafting materials (action/recipe inputs and outputs) ---
  "firewood":       { name: "Firewood",       type: "crafting", desc: "Dry wood, ready to burn.",                   value: 5 },
  "wood log":       { name: "Wood Log",       type: "crafting", desc: "A solid log. Building material.",            value: 8 },
  "raw fish":       { name: "Raw Fish",       type: "crafting", desc: "Fresh from the lake. Cook before eating.",   value: 10 },
  "raw meat":       { name: "Raw Meat",       type: "crafting", desc: "Fresh game. Cook it over a fire first.",     value: 15 },
  "copper ore":     { name: "Copper Ore",     type: "crafting", desc: "Raw ore, ready for the forge.",              value: 12 },
  "iron ore":       { name: "Iron Ore",       type: "crafting", desc: "Heavy ore. Smelts into strong metal.",       value: 20 },
  "copper bar":     { name: "Copper Bar",     type: "crafting", desc: "Smelted copper, ready for smithing.",        value: 35 },
  "iron bar":       { name: "Iron Bar",       type: "crafting", desc: "Smelted iron, ready for smithing.",          value: 55 },
  "swamp herb":     { name: "Swamp Herb",     type: "crafting", desc: "Pungent. Alchemists swear by it.",           value: 6 },
  "glowcap":        { name: "Glowcap",        type: "crafting", desc: "A faintly luminous mushroom. Hums with magic.", value: 9 },
  "scrap metal":    { name: "Scrap Metal",    type: "crafting", desc: "Rusty but salvageable.",                     value: 8 },

  // --- Trade goods (made to be sold) ---
  "minnow":         { name: "Minnow",         type: "trade", desc: "Tiny fish. Bait, or a very small meal.",        value: 3 },
  "crude blade":    { name: "Crude Blade",    type: "trade", desc: "Rough smithing work, but it holds an edge.",    value: 45 },

  // --- Treasure (rare/valuable finds) ---
  "mana shard":     { name: "Mana Shard",     type: "treasure", desc: "A splinter of raw ley-line energy.",         value: 60 },
  "radio part":     { name: "Radio Part",     type: "treasure", desc: "Delicate electronics. Someone needs this.",  value: 40 },
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
  { key: "amber shard",     name: "Amber Shard",   chance: 5, value: 40, desc: "Fossilized sap with something ancient inside." },
  { key: "lost locket",     name: "Lost Locket",   chance: 4, value: 55, desc: "Someone's memento. Worth more than it should be." },
  { key: "pristine seed",   name: "Pristine Seed", chance: 2, value: 90, desc: "Untouched by the blight. Growers would kill for it." },
];

// Register the drops as treasure items — they live in ITEMS like everything
// else (descriptions, values, boot validation, backpack display).
for (const d of RANDOM_DROPS) {
  ITEMS[d.key] = { name: d.name, type: "treasure", desc: d.desc, value: d.value };
}

// RECIPES fields:
//   key       unique id
//   label     display name
//   skill     which skill it trains / gates it
//   level     minimum skill level
//   station   where it can be crafted: "campfire" (the player must have one
//             burning — see /api/campfire) or "forge" (must be in Town).
//             Omit for craftable-anywhere.
//   requires  tool that must be OWNED (not consumed) — omit for none
//   inputs    { item: qty, ... } — CONSUMED on craft
//   output    item granted (1 per craft)
//   xp        skill XP awarded
//   timer     seconds the craft takes
export const RECIPES = [
  // Campfire cooking (the fire replaces any firewood input — building it costs the wood)
  { key: "cook_fish",     label: "Cook Fish",     skill: "crafting", level: 1, station: "campfire", inputs: { "raw fish": 1 },                    output: "cooked fish",   xp: 8,  timer: 10 },
  { key: "cook_meat",     label: "Cook Meat",     skill: "crafting", level: 1, station: "campfire", inputs: { "raw meat": 1 },                    output: "cooked meat",   xp: 8,  timer: 10 },
  { key: "mushroom_stew", label: "Mushroom Stew", skill: "crafting", level: 2, station: "campfire", inputs: { "mushroom": 3 },                    output: "mushroom stew", xp: 12, timer: 15 },
  { key: "meat_stew",     label: "Meat Stew",     skill: "crafting", level: 3, station: "campfire", inputs: { "cooked meat": 1, "mushroom": 1 },  output: "meat stew",     xp: 15, timer: 15 },
  // Forge work (the Old Forge in Town)
  { key: "smelt_copper",  label: "Smelt Copper",  skill: "smithing", level: 1, station: "forge", requires: "hammer", inputs: { "copper ore": 2, "firewood": 1 }, output: "copper bar", xp: 15, timer: 20 },
  { key: "smelt_iron",    label: "Smelt Iron",    skill: "smithing", level: 5, station: "forge", requires: "hammer", inputs: { "iron ore": 2, "firewood": 2 },   output: "iron bar",   xp: 25, timer: 30 },
];
