// location_backbone.js — the world/location registry (pure data, NO imports, NO logic).
// Single source of truth for the map layout and per-location actions. Both db_backbone.js and
// server.js import from here; server.js validates LOCATION_ACTIONS references (skills,
// items, recipes) at boot, same "typos die at boot" convention as item_backbone.js.
//
// Split out of db_backbone.js during the server.js reorganization — SKILLS/SKILL_NAMES/
// skillLevelCost stayed behind in db_backbone.js (general-purpose, used well beyond locations).

// Display names for the world map — the object keys are ALSO the canonical
// list of valid location keys. basecamp_inside is entered via the base
// toggle, never the map (and hides the map entirely while there).
export const LOCATION_NAMES = {
  basecamp_outside: "Basecamp",
  basecamp_inside: "Inside the Base",
  bunker: "Bunker",
  forest: "Forest",
  lake: "Lake",
  mountains: "Mountains",
  river: "River",
  swamp: "Swamp",
  cave: "Cave",
  town: "Town",
};

export const OUTBREAK_LOCATIONS = new Set([
  // safe areas that become unsafe
  "mountains",
  "river",
  "cave",
  "town",
  // zombie areas should get outbreak included
  "basecamp_outside",
  "forest",
  "lake",
  "swamp",
]);

// Locations where the zombie pool is active — tick attacks and hunting only
// happen here. Everywhere else is "safe" (the game page swaps Hunt Info for
// Actions there). basecamp_inside counts: zombies besiege the base itself,
// with player hits absorbed as base HP.
export const ZOMBIE_LOCATIONS = new Set([
  "basecamp_outside",
  "forest",
  "lake",
  "swamp",
]);

// Travel graph: which locations connect. The Bunker hangs off Basecamp only;
// the Forest is the hub that reaches every other named location.
export const LOCATION_LINKS = {
  basecamp_outside: ["bunker", "forest"],
  basecamp_inside: [],
  bunker: ["basecamp_outside"],
  forest: ["basecamp_outside", "lake", "mountains", "river", "swamp", "cave", "town"],
  lake: ["forest", "swamp"],
  mountains: ["forest", "river", "cave", "town"],
  river: ["forest", "cave", "town", "mountains"],
  swamp: ["forest", "lake"],
  cave: ["forest", "river", "mountains", "town"],
  town: ["forest", "river", "cave", "mountains"],
};

// ----- Location actions -----
// The per-location action catalogue. Fields:
//   key         unique id (posted back by the Do button)
//   label       display name
//   timer       seconds the action takes (player is busy until it resolves)
//   skill       which skill it trains / gates it (see SKILLS)
//   skillLevel  minimum skill level required
//   successRate % chance the action succeeds when it resolves
//   grants      inventory item given on success
//   xp          skill XP awarded on success
//   requires    inventory item (tool) that must be OWNED to attempt — not
//               consumed. Omit for no requirement (mushrooms need nothing;
//               mining copper needs a stone pickaxe).
//   uses        inventory item CONSUMED (×1, up front) to attempt — fuel or
//               feedstock; a failed roll still burns it (like craft inputs).
//   station     "campfire" | "forge" | "beacon" — the action additionally
//               needs that station usable, same check as RECIPES (campfire
//               burning / Mountains forge fired / live beacon at the Bunker).
//   activates   "forge" (success sets players.forge_fired) or "beacon"
//               (success sets players.beacon_fired — cleared again when a
//               beacon-station craft redeems the drop) instead of granting
//               an item.
//               Mutually exclusive with grants.
//   drops       true = successful runs also roll the RANDOM_DROPS treasure
//               table (item_backbone.js) for a bonus find.
//
// A row can instead be { recipe: "<RECIPES key>" } — a pointer that surfaces
// an item_backbone.js recipe in this location's Actions card. Everything
// (label/timer/skill/level/inputs/tool/station/xp) comes from the recipe, and
// /api/action/do delegates to the craft flow (no success roll — crafts always
// land). Use it instead of duplicating a recipe as a hand-rolled action.
//
// A row can also be { key, button: true, label } — a pure UI button in the
// Actions card (no Do button, no timer, no gating): the page opens the
// matching modal (magic_table -> the Magic Table). /api/action/do refuses
// them; they exist so location-bound surfaces stay in this catalogue.
//
// Two more optional fields on plain action rows:
//   trainOnly   true = the action grants NO item — success awards only the
//               skill XP (Train Defense). Exempts the row from the
//               "grants or activates" boot check; still requires xp.
//   text        custom start-event line ("You begin climbing and jumping
//               from trees") instead of the default "You started: <label>".
export const LOCATION_ACTIONS = {
  basecamp_outside: [
    { key: "gather_firewood", label: "Gather Firewood", timer: 3, skill: "woodcutting", skillLevel: 1, successRate: 90, grants: "firewood", xp: 5, drops: true },
    { key: "gather_mushrooms", label: "Gather Mushrooms", timer: 8, skill: "foraging", skillLevel: 1, successRate: 90, grants: "mushroom", xp: 5, drops: true },
    { key: "harvest_glowcaps", label: "Harvest Glowcaps", timer: 12, skill: "foraging", skillLevel: 1, successRate: 80, grants: "glowcap", xp: 8, drops: true },
    { key: "channel_leyline", label: "Channel the Ley Line", timer: 20, skill: "magic", skillLevel: 5, successRate: 70, grants: "mana shard", xp: 15 },
  ],
  bunker: [
    { key: "tinker_radio", label: "Tinker with the Radio", timer: 15, skill: "crafting", skillLevel: 1, successRate: 60, grants: "radio part", xp: 10 },
    { key: "repair_radio", label: "Repair the Radio", timer: 20, skill: "crafting", skillLevel: 3, successRate: 20, requires: "radio part", grants: "functional radio", xp: 15 },
    { key: "attempt_supply_beacon", label: "Attempt Supply Beacon", timer: 30, skill: "crafting", skillLevel: 5, successRate: 25, requires: "functional radio", grants: "supply beacon", xp: 20 },
    { key: "activate_supply_beacon", label: "Activate Supply Beacon", timer: 10, skill: "crafting", skillLevel: 5, successRate: 65, requires: "supply beacon", activates: "beacon", xp: 10 },
    { recipe: "enable_supply_beacon" },
    { recipe: "craft_base_repair_kit" },
    { recipe: "craft_external_antenna" },
    { recipe: "craft_signal_amplifier" },
    { recipe: "craft_sentry_turret" },
    { recipe: "craft_storage_locker" },
    { recipe: "craft_supply_beacon" }
  ],
  forest: [
    { key: "gather_mushrooms", label: "Gather Mushrooms", timer: 8, skill: "foraging", skillLevel: 1, successRate: 90, grants: "mushroom", xp: 5, drops: true },
    { key: "chop_wood", label: "Chop Wood", timer: 15, skill: "woodcutting", skillLevel: 1, successRate: 80, grants: "wood log", requires: "axe", xp: 10, drops: true },
    { key: "trap_rabbit", label: "Trap Rabbit", timer: 4, skill: "trapping", skillLevel: 1, successRate: 75, grants: "raw small meat", xp: 8 },
    { key: "trap_game", label: "Trap Game", timer: 9, skill: "trapping", skillLevel: 2, successRate: 70, grants: "raw meat", xp: 8 },
    { key: "train_defense", label: "Train Defense", timer: 10, skill: "defense", skillLevel: 1, successRate: 100, xp: 15, trainOnly: true, text: "You begin climbing and jumping from trees" },
  ],
  lake: [
    { key: "fish_shallows", label: "Fish the Shallows", timer: 10, skill: "fishing", skillLevel: 1, successRate: 75, grants: "raw fish", requires: "fishing rod", xp: 10 },
    { key: "fish_deep", label: "Fish the Deep", timer: 18, skill: "fishing", skillLevel: 3, successRate: 60, grants: "raw tuna", requires: "fishing rod", uses: "minnow", xp: 15 },
    { key: "gather mushrooms", label: "Gather Mushrooms", timer: 5, skill: "foraging", skillLevel: 1, successRate: 85, grants: "mushroom", xp: 6, drops: true },
    { key: "gather herbs", label: "Gather Herbs", timer: 5, skill: "foraging", skillLevel: 2, successRate: 80, grants: "lake herb", xp: 8, drops: true },
    { key: "dowse_ley_crystal", label: "Dowse for Ley Crystals", timer: 25, skill: "magic", skillLevel: 1, successRate: 60, grants: "ley crystal", xp: 15 },
  ],
  river: [
    { key: "net_minnows", label: "Net Minnows", timer: 8, skill: "fishing", skillLevel: 1, successRate: 85, grants: "minnow", xp: 6 },
    { key: "fish_river", label: "Fish the River", timer: 15, skill: "fishing", skillLevel: 1, successRate: 70, grants: "raw fish", requires: "fishing rod", xp: 12 },
    { key: "gather herbs", label: "Gather Herbs", timer: 5, skill: "foraging", skillLevel: 2, successRate: 80, grants: "river herb", xp: 8, drops: true },
    { key: "gather mushrooms", label: "Gather Mushrooms", timer: 5, skill: "foraging", skillLevel: 1, successRate: 85, grants: "raw mushroom", xp: 6, drops: true },
    { key: "dowse_ley_crystal", label: "Dowse for Ley Crystals", timer: 25, skill: "magic", skillLevel: 3, successRate: 60, grants: "ley crystal", xp: 15 },
  ],
  mountains: [
    { key: "fire_forge", label: "Get the Forge Going", timer: 10, skill: "smithing", skillLevel: 1, successRate: 70, activates: "forge", uses: "firewood", xp: 12 },
    { key: "mine_iron", label: "Mine Iron", timer: 30, skill: "mining", skillLevel: 3, successRate: 60, grants: "iron ore", requires: "stone pickaxe", xp: 20 },
    // Forge work — pointers into item_backbone.js RECIPES (see comment above).
    { recipe: "smelt_copper" },
    { recipe: "smelt_bronze" },
    { recipe: "smelt_tin" },
    { recipe: "smelt_iron" },
    { recipe: "smelt_silver" },
    { recipe: "smelt_gold" },
    { recipe: "smelt_cobalt" },
    { recipe: "smelt_mythril" },
    { recipe: "smelt_adamantite" },
    { recipe: "smelt_syllic" },
    { recipe: "smith_bronze_head" }, { recipe: "smith_bronze_torso" }, { recipe: "smith_bronze_legs" },
    { recipe: "smith_bronze_boots" }, { recipe: "smith_bronze_hands" }, { recipe: "smith_bronze_shield" },
    { recipe: "smith_iron_head" }, { recipe: "smith_iron_torso" }, { recipe: "smith_iron_legs" },
    { recipe: "smith_iron_boots" }, { recipe: "smith_iron_hands" }, { recipe: "smith_iron_shield" },
    { recipe: "smith_silver_head" }, { recipe: "smith_silver_torso" }, { recipe: "smith_silver_legs" },
    { recipe: "smith_silver_boots" }, { recipe: "smith_silver_hands" }, { recipe: "smith_silver_shield" },
    { recipe: "smith_gold_head" }, { recipe: "smith_gold_torso" }, { recipe: "smith_gold_legs" },
    { recipe: "smith_gold_boots" }, { recipe: "smith_gold_hands" }, { recipe: "smith_gold_shield" },
    { recipe: "smith_cobalt_head" }, { recipe: "smith_cobalt_torso" }, { recipe: "smith_cobalt_legs" },
    { recipe: "smith_cobalt_boots" }, { recipe: "smith_cobalt_hands" }, { recipe: "smith_cobalt_shield" },
    { recipe: "smith_mythril_head" }, { recipe: "smith_mythril_torso" }, { recipe: "smith_mythril_legs" },
    { recipe: "smith_mythril_boots" }, { recipe: "smith_mythril_hands" }, { recipe: "smith_mythril_shield" },
    { recipe: "smith_adamantite_head" }, { recipe: "smith_adamantite_torso" }, { recipe: "smith_adamantite_legs" },
    { recipe: "smith_adamantite_boots" }, { recipe: "smith_adamantite_hands" }, { recipe: "smith_adamantite_shield" },
    { recipe: "smith_syllic_head" }, { recipe: "smith_syllic_torso" }, { recipe: "smith_syllic_legs" },
    { recipe: "smith_syllic_boots" }, { recipe: "smith_syllic_hands" }, { recipe: "smith_syllic_shield" },
    { recipe: "crude_blade" },
    { recipe: "magic_amulet" },
    { recipe: "fishing_rod" },
    { recipe: "gun_oil" },
  ],
  swamp: [
    { key: "gather_herbs", label: "Gather Herbs", timer: 5, skill: "crafting", skillLevel: 1, successRate: 85, grants: "swamp herb", xp: 6, drops: true },
    { key: "gather_mushrooms", lavel: "Gather Mushrooms", timer: 5, skill: "foraging", skillLevel: 1, successRate: 80, grants: "raw mushroom", xp: 6, drops: true },
    { key: "net_minnows", label: "Net Minnows", timer: 8, skill: "fishing", skillLevel: 1, successRate: 85, grants: "minnow", xp: 6 },
    { key: "fish_gator", label: "Fish for Aligators", timer: 20, skill: "fishing", skillLevel: 4, successRate: 75, grants: "raw gator meat", xp: 6, drops: true },
    { key: "harvest_glowcaps", label: "Harvest Glowcaps", timer: 12, skill: "magic", skillLevel: 1, successRate: 80, grants: "glowcap", xp: 8, drops: true },
    { key: "pick_spirit_blooms", label: "Pick Spirit Blooms", timer: 12, skill: "magic", skillLevel: 1, successRate: 75, grants: "spirit bloom", xp: 8 },
  ],
  cave: [
    { key: "harvest_glowcaps", label: "Harvest Glowcaps", timer: 12, skill: "foraging", skillLevel: 1, successRate: 80, grants: "glowcap", xp: 8 },
    { key: "channel_leyline", label: "Channel the Ley Line", timer: 20, skill: "magic", skillLevel: 1, successRate: 70, grants: "mana shard", xp: 15 },
    { key: "sift_arcane_dust", label: "Sift Arcane Dust", timer: 15, skill: "magic", skillLevel: 2, successRate: 70, grants: "arcane dust", xp: 10 },
    { key: "mine_copper", label: "Mine Copper", timer: 20, skill: "mining", skillLevel: 1, successRate: 75, grants: "copper ore", requires: "stone pickaxe", xp: 10 },
    { key: "mine_tin", label: "Mine Tin", timer: 22, skill: "mining", skillLevel: 2, successRate: 70, grants: "tin ore", requires: "stone pickaxe", xp: 12 },
    { key: "mine_silver", label: "Mine Silver", timer: 28, skill: "mining", skillLevel: 4, successRate: 65, grants: "silver ore", requires: "stone pickaxe", xp: 18 },
    { key: "mine_gold", label: "Mine Gold", timer: 35, skill: "mining", skillLevel: 5, successRate: 60, grants: "gold ore", requires: "stone pickaxe", xp: 25 },
    { key: "mine_cobalt", label: "Mine Cobalt", timer: 37, skill: "mining", skillLevel: 5, successRate: 58, grants: "cobalt ore", requires: "stone pickaxe", xp: 27 },
    { key: "mine_coal", label: "Mine Coal", timer: 25, skill: "mining", skillLevel: 3, successRate: 70, grants: "coal", requires: "stone pickaxe", xp: 12 },
    { key: "mine_mythril", label: "Mine Mythril", timer: 40, skill: "mining", skillLevel: 6, successRate: 55, grants: "mythril ore", requires: "iron pickaxe", xp: 30 },
    { key: "mine_adamantite", label: "Mine Adamantite", timer: 50, skill: "mining", skillLevel: 7, successRate: 50, grants: "adamantite ore", requires: "mythril pickaxe", xp: 40 },
    { key: "mine_syllic", label: "Mine Syllic", timer: 60, skill: "mining", skillLevel: 8, successRate: 45, grants: "syllic ore", requires: "adamantite pickaxe", xp: 50 },
  ],
  town: [
    { key: "magic_table", button: true, label: "Learn at the Magic Table" },
    { key: "craft_arcane_table", button: true, label: "Craft at the Arcane Table" },
    { key: "activate_arcane_table", label: "Activate the Arcane Table", timer: 15, skill: "magic", skillLevel: 5, successRate: 70, uses: { "firewood": 2, "mana shard": 2 }, activates: "arcane_table", xp: 15 },
    { key: "scavenge_scrap", label: "Scavenge Scrap", timer: 12, skill: "crafting", skillLevel: 1, successRate: 80, grants: "scrap metal", xp: 8 },
    { key: "train_defense", label: "Train Defense", timer: 10, skill: "defense", skillLevel: 1, successRate: 100, xp: 15, trainOnly: true, text: "You begin climbing and jumping from trees" },
    { recipe: "craft_weak_blade" },
    { recipe: "craft_radio_part" },
    { recipe: "craft_mana_potion" },
    { recipe: "craft_healing_potion" },
    { recipe: "craft_shield_potion" },
  ],
};
