 // item_backbone.js — the item registry (pure data, NO imports, NO logic).
 // Single source of truth for every in-game item and crafting recipe. Both
 // db_backbone.js and server.js import from here; server.js validates all references
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
 //   attack_mod (guns) optional { dmg?, floor?, acc? } additive offset from
 //           the base WEAPON_FIREARM_EXPORT[gunType] stats — dmg/floor shift
 //           the underlying inputs, acc is a flat post-formula hit-chance
 //           handicap/bonus (server.js computeHitChance, clamped [0,100]).
 //           Broad-scope (World/Location) kills are instant and never read
 //           dmg, so attack_mod.dmg only matters in Nearby-scope combat.
 //   ap      (armor) Armor Points, a 1-500 gauge of effectiveness: the
 //           equipped armor blocks ap/500 of each tick's tallied zombie
 //           damage (server.js apBlocked). Armor equips from the Backpack
 //           (players.equipped_armor); inside players' AP sums into Base AP.
 //   tier    (tools) material grade shown in the Backpack — "Stone", "Iron",
 //           or "General" for ungraded tools (hammer, fishing rod, …)
 //   toolbag (consumables) true = quick-access Toolbag tab in the Inventory
 //           modal (combat consumables: gun oil, potions); other consumables
 //           (food) live in the Backpack instead
 
 export const ITEM_TYPES = ["gun", "weapon", "tool", "consumable", "armor", "treasure", "trade", "crafting", "base_item"];
 export const SMELT_TYPES = ["copper", "tin", "bronze", "iron", "cobalt", "silver", "gold", "mythril", "adamantite", "syllic", "zombie"];
 export const ARMOR_PIECES = ["head", "torso", "legs", "boots", "hands", "shield"];
 export const WEAPON_TYPES = ["Melee", "Ranged", "Throwing", "Fist", "Zombie", "Firearm"];
 export const WEAPON_RANGED_OPTIONS = ["crossbow", "bow", "slingshot"];
 export const WEAPON_THROWING_OPTIONS = ["throwing knives", "spear", "javelin"];
 export const WEAPON_FIREARM_TYPES = ["handgun", "rifle", "shotgun", "burstrifle", "railgun", "bfg2000"];
 export const WEAPON_ATTACK_EXPORT = {
    "Melee":    { floor: 45 },
    "Ranged":   { floor: 40 },
    "Throwing": { floor: 30 },
    "Fist":     { floor: 30 },
    "Zombie":   { floor: 45 },
    "Firearm":  { floor: 40 },
 };
 // The single gun accuracy/damage/target model, shared by both World/Location
 // (Broad, instant-kill) and Nearby (real HP) combat — formerly two separate
 // tables (WEAPON_FIREARM_EXPORT + GUN_BEHAVIOR); folded into one.
 // accuracyModel: "player"    → player accuracy stat (+ gun condition), floored.
 //                "condition" → floor scaled by condition only.
 // floor: optional — computeHitChance()/nearbyGunHitChance() default a missing
 //        floor to 5 (a player-model gun's floor is just a sanity-check lower
 //        bound, not a defining value).
 // maxTargets: zombies a single successful Broad-scope shot can drop (unused
 //             in Nearby scope, which resolves one queued zombie at a time).
 export const WEAPON_FIREARM_EXPORT = {
    "handgun":   { accuracyModel: "player", dmg: 6, ammo: 6, clips: 3, maxTargets: 1 },
    "rifle":     { accuracyModel: "condition", dmg: 8, floor: 60, ammo: 12, clips: 3, maxTargets: 1 },
    "burstrifle":  { accuracyModel: "condition", dmg: 7, floor: 55, ammo: 15, clips: 3, maxTargets: 3 },
    "shotgun":    { accuracyModel: "condition", dmg: 15, floor: 50, ammo: 8, clips: 3, maxTargets: 5 },
    "railgun":    { accuracyModel: "condition", dmg: 25, floor: 70, ammo: 5, clips: 2, maxTargets: 3 },
    "bfg2000":   { accuracyModel: "condition", dmg: 200, floor: 80, ammo: 1, clips: 10, maxTargets: 100 },
 };


 export const ITEMS = {
   // --- Guns (capitalized keys are legacy inventory names — keep them) ---
   "Handgun":        { name: "Handgun",        type: "gun", section: "Firearms", gunType: "handgun", desc: "A reliable sidearm. Everyone starts with one." },
   "Rifle":          { name: "Rifle",          type: "gun", section: "Firearms", gunType: "rifle",   desc: "Steady and precise — rounds can punch through a thick horde." },
   "Shotgun":        { name: "Shotgun",        type: "gun", section: "Firearms", gunType: "shotgun", desc: "Devastating spread. Up to five zombies per blast." },
   "Burst Rifle":    { name: "Burst Rifle",    type: "gun", section: "Firearms", gunType: "burstrifle", desc: "Fires three rounds in quick succession. Good for groups." },
   "Railgun":        { name: "Railgun",        type: "gun", section: "Firearms", gunType: "railgun", desc: "Fires a single, high-velocity round. Pierces multiple zombies." },
   "BFG 2000":       { name: "BFG 2000",       type: "gun", section: "Firearms", gunType: "bfg2000", desc: "Fires a single, devastating round. Obliterates zombies in its path." },
   // --- Weapons (melee, bows, and other non-guns) ---
   "Baseball Bat":  { name: "Baseball Bat",  type: "weapon", section: "Melee", desc: "A solid bat. Smacks zombies hard.", attack: { dmg: 5, acc_model: "player" } },
   "Spiked Bat":    { name: "Spiked Bat",    type: "weapon", section: "Melee", desc: "A bat with spikes. Smacks zombies harder.", attack: { dmg: 8, acc_model: "player" } },
   "Billy Club":      { name: "Billy Club",      type: "weapon", section: "Melee", desc: "A short, heavy club. Smacks zombies hard.", attack: { dmg: 6, acc_model: "player" } },
   "Crowbar":        { name: "Crowbar",        type: "weapon", section: "Melee", desc: "A crowbar. Smacks zombies hard.", attack: { dmg: 7, acc_model: "player" } },
   "Machete":        { name: "Machete",        type: "weapon", section: "Melee", desc: "A sharp machete. Smacks zombies hard.", attack: { dmg: 9, targets_max: 2, acc_model: "player" } },
   "Katana":         { name: "Katana",         type: "weapon", section: "Melee", desc: "A sharp katana. Smacks zombies hard.", attack: { dmg: 10, targets_max: 3, acc_model: "condition" } },
   "Spear":          { name: "Spear",          type: "weapon", section: "Melee", desc: "A long spear. Smacks zombies hard.", attack: { dmg: 8, acc_model: "player" } },
   "Crossbow":      { name: "Crossbow",      type: "weapon", section: "Ranged", rangedType: "crossbow", desc: "A quiet ranged weapon. Fires bolts with deadly accuracy.", attack: { dmg: 12, acc_model: "condition" } },
   "Syllic Crossbow": { name: "Syllic Crossbow", type: "weapon", section: "Ranged", rangedType: "crossbow", desc: "A syllic crossbow. Fires bolts with deadly accuracy.", attack: { dmg: 14, targets_max: 2, acc_model: "condition" } },
   "Bow":            { name: "Bow",            type: "weapon", section: "Ranged", rangedType: "bow", desc: "A classic ranged weapon. Fires arrows with deadly accuracy.", attack: { dmg: 10, targets_max: 2, acc_model: "condition" } },
   "Syllic Bow":      { name: "Syllic Bow",      type: "weapon", section: "Ranged", rangedType: "bow", desc: "A syllic bow. Fires arrows with deadly accuracy.", attack: { dmg: 12, targets_max: 2, acc_model: "condition" } },
   "Throwing Knives":{ name: "Throwing Knives",type: "weapon", section: "Throwing", desc: "A set of throwing knives. Good for silent takedowns.", attack: { dmg: 8, targets_max: 4, acc_model: "player" } },
   "Slingshot":      { name: "Slingshot",      type: "weapon", section: "Ranged", rangedType: "slingshot", desc: "A simple ranged weapon. Fires small projectiles.", attack: { dmg: 6, targets_max: 2, acc_model: "condition" } },
   "Spiked Knuckles": { name: "Spiked Knuckles", type: "weapon", section: "Fist", desc: "Knuckle dusters with spikes. Punches zombies hard.", attack: { dmg: 7, acc_model: "player" } },
   // --- Weapons - Zombie-themed (crafted at the Arcane Table) ---
   "zombie flail":           { name: "Zombie Flail",           type: "weapon", class: "Melee", section: "Zombie", desc: "A zombie head attached to a stick with a rope.", attack: { dmg: 14, targets_max: 3, acc_model: "player" } },
   "zombie sword":           { name: "Zombie Sword",           type: "weapon", class: "Melee", section: "Zombie", desc: "A sword made from zombie bones and flesh.", attack: { dmg: 16, targets_max: 3, acc_model: "player" } },
   "zombie club":            { name: "Zombie Club",            type: "weapon", class: "Melee", section: "Zombie", desc: "A knotted club studded with zombie bone.", attack: { dmg: 15, targets_max: 2, acc_model: "player" } },
   "zombie dagger":          { name: "Zombie Dagger",          type: "weapon", class: "Melee", section: "Zombie", desc: "A dagger honed from sharpened zombie bone.", attack: { dmg: 13, acc_model: "player" } },
   "zombie crossbow":        { name: "Zombie Crossbow",        type: "weapon", class: "Ranged", section: "Zombie", rangedType: "crossbow", desc: "A crossbow made from zombie bones and sinew.", attack: { dmg: 18, targets_max: 3, acc_model: "condition" } },
   "zombie bow":             { name: "Zombie Bow",             type: "weapon", class: "Ranged", section: "Zombie", rangedType: "bow", desc: "A bow made from zombie bones and sinew.", attack: { dmg: 16, targets_max: 3, acc_model: "condition" } },
   "zombie throwing knives": { name: "Zombie Throwing Knives", type: "weapon", class: "Throwing", section: "Zombie", desc: "Throwing knives made from zombie bones and sinew.", attack: { dmg: 14, targets_max: 4, acc_model: "player" } },
   "zombie slingshot":       { name: "Zombie Slingshot",       type: "weapon", class: "Ranged", section: "Zombie", rangedType: "slingshot", desc: "A slingshot made from zombie bones and sinew.", attack: { dmg: 12, targets_max: 2, acc_model: "condition" } },
   "zombie fist arm":        { name: "Zombie Arm",             type: "weapon", class: "Fist", section: "Zombie", desc: "A zombie arm. Punches zombies for you.", attack: { dmg: 10, acc_model: "player" } },
   "zombie knuckles":        { name: "Zombie Knuckles",        type: "weapon", class: "Fist", section: "Zombie", desc: "Knuckle dusters made from zombie teeth.", attack: { dmg: 8, acc_model: "player" } },
   "zombie spine whip":      { name: "Zombie Spine",           type: "weapon", class: "Melee", section: "Zombie", desc: "A series of zombie spines attached together. Smacks zombies hard. Looks like a whip.", attack: { dmg: 15, targets_max: 3, acc_model: "player" } },
 
   // --- Tools (owned, never consumed — gate location actions & recipes) ---
   "fishing rod":        { name: "Fishing Rod",        type: "tool", tier: "General", section: "Tools",    desc: "A rod, a line, and optimism.",                   value: 90,   shop: { cost: 90,  currency: "gold" } },
   "hammer":             { name: "Hammer",             type: "tool", tier: "General", section: "Tools",    desc: "For smithing at a forge. Or percussive repair.", value: 110,  shop: { cost: 110, currency: "gold" } },
   "axe":                { name: "Axe",                type: "tool", tier: "General", section: "Tools",    desc: "Chops wood. Occasionally zombies.",              value: 120,  shop: { cost: 120, currency: "gold" } },
  
   "stone pickaxe":      { name: "Stone Pickaxe",      type: "tool", tier: "Stone", section: "Tools",      desc: "Crude, but it breaks rock.",                     value: 100,  shop: { cost: 100, currency: "gold" } },
   // --- Crafted Tools (Not Purchasable in the shop, must be crafted) ---
   "iron axe":           { name: "Iron Axe",           type: "tool", tier: "Iron", section: "Tools",       desc: "A proper axe. Chops wood and occasionally zombies.",      value: 200 },
   "silver axe":         { name: "Silver Axe",         type: "tool", tier: "Silver", section: "Tools",     desc: "A silver axe. Chops wood and occasionally zombies.",      value: 300 },
   "gold axe":           { name: "Gold Axe",           type: "tool", tier: "Gold", section: "Tools",       desc: "A gold axe. Chops wood and occasionally zombies.",        value: 400 },
   "mythril axe":        { name: "Mythril Axe",        type: "tool", tier: "Mythril", section: "Tools",    desc: "A mythril axe. Chops wood and occasionally zombies.",     value: 600 },
   "adamantite axe":     { name: "Adamantite Axe",     type: "tool", tier: "Adamantite", section: "Tools", desc: "An adamantite axe. Chops wood and occasionally zombies.", value: 1000 },
   "syllic axe":         { name: "Syllic Axe",         type: "tool", tier: "Syllic", section: "Tools",     desc: "A syllic axe. Chops wood and occasionally zombies.",      value: 1500 },
  
   "bronze pickaxe":     { name: "Bronze Pickaxe",     type: "tool", tier: "Bronze", section: "Tools",     desc: "Improved but crude pickaxe.",                    value: 125, },
   "iron pickaxe":       { name: "Iron Pickaxe",       type: "tool", tier: "Iron", section: "Tools",       desc: "A proper pickaxe. Smashes stone and ore.",       value: 200, },
   "cobalt pickaxe":     { name: "Cobalt Pickaxe",     type: "tool", tier: "Cobalt",     section: "Tools", desc: "A Cobalt pickaxe. Smashes stone and ore.",                value: 250, },
   "silver pickaxe":     { name: "Silver Pickaxe",     type: "tool", tier: "Silver",     section: "Tools", desc: "A silver pickaxe. Smashes stone and ore.",                value: 300, },
   "gold pickaxe":       { name: "Gold Pickaxe",       type: "tool", tier: "Gold",       section: "Tools", desc: "A gold pickaxe. Smashes stone and ore.",                  value: 400, },
   "mythril pickaxe":    { name: "Mythril Pickaxe",    type: "tool", tier: "Mythril",    section: "Tools", desc: "A mythril pickaxe. Smashes stone and ore.",               value: 600, },
   "adamantite pickaxe": { name: "Adamantite Pickaxe", type: "tool", tier: "Adamantite", section: "Tools", desc: "An adamantite pickaxe. Smashes stone and ore.",           value: 1000, },
   "syllic pickaxe":     { name: "Syllic Pickaxe",     type: "tool", tier: "Syllic",     section: "Tools", desc: "A syllic pickaxe. Smashes stone and ore.",                value: 1500, },

   "iron fishing rod":   { name: "Iron Fishing Rod",   type: "tool", tier: "Iron", section: "Tools", desc: "A proper fishing rod. Catches fish and occasionally zombies.", value: 200, },
   "silver fishing rod": { name: "Silver Fishing Rod", type: "tool", tier: "Silver", section: "Tools", desc: "A silver fishing rod. Catches fish and occasionally zombies.", value: 300, },
   "gold fishing rod":   { name: "Gold Fishing Rod",   type: "tool", tier: "Gold", section: "Tools", desc: "A gold fishing rod. Catches fish and occasionally zombies.", value: 400, },
   "mythril fishing rod":{ name: "Mythril Fishing Rod",type: "tool", tier: "Mythril", section: "Tools", desc: "A mythril fishing rod. Catches fish and occasionally zombies.", value: 600, },
   "adamantite fishing rod":{ name: "Adamantite Fishing Rod",type: "tool", tier: "Adamantite", section: "Tools", desc: "An adamantite fishing rod. Catches fish and occasionally zombies.", value: 1000, },
   "syllic fishing rod": { name: "Syllic Fishing Rod", type: "tool", tier: "Syllic", section: "Tools", desc: "A syllic fishing rod. Catches fish and occasionally zombies.", value: 1500, },
 
   // --- Consumables (have a `use` block; consumed one at a time) ---
   "gun oil":        { name: "Gun Oil",        type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 25 condition to the equipped gun.", value: 40, use: { gunCondition: 25 } },
   "gun repair kit": { name: "Gun Repair Kit", type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 50 condition to the equipped gun.", value: 80, use: { gunCondition: 50 } },

   "weapon table": { name: "Weapon Table", type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 25 condition to the equipped weapon.", value: 40, use: { weaponCondition: 25 } },
   "weapon repair kit": { name: "Weapon Repair Kit", type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 50 condition to the equipped weapon.", value: 80, use: { weaponCondition: 50 } },

   "pack of bolts":  { name: "Pack of Bolts",  type: "consumable", section: "Toolbag", toolbag: true, desc: "Refills your Quiver by 15.", value: 35, shop: { cost: 35, currency: "gold" }, use: { rangedAmmo: 15 } },
   "pack of arrows": { name: "Pack of Arrows", type: "consumable", section: "Toolbag", toolbag: true, desc: "Refills your Quiver by 10.", value: 25, shop: { cost: 25, currency: "gold" }, use: { rangedAmmo: 10 } },
   "pouch of stones": { name: "Pouch of Stones", type: "consumable", section: "Toolbag", toolbag: true, desc: "Refills your Quiver by 20.", value: 45, shop: { cost: 45, currency: "gold" }, use: { rangedAmmo: 20 } },
   "bundle of throwing knives": { name: "Bundle of Throwing Knives", type: "consumable", section: "Toolbag", toolbag: true, desc: "Refills your Pouch by 10.", value: 30, shop: { cost: 30, currency: "gold" }, use: { throwingAmmo: 10 } },
   "plasma pack": { name: "Plasma Pack", type: "consumable", section: "Toolbag", toolbag: true, desc: "Refills your Railgun by 5.", value: 100, shop: { cost: 100, currency: "gold" }, use: { railgunAmmo: 5 } },
   "bfg engery can": { name: "BFG Energy Can", type: "consumable", section: "Toolbag", toolbag: true, desc: "Refills your BFG by 1.", value: 200, shop: { cost: 200, currency: "gold" }, use: { bfgAmmo: 1 } },

   "healing potion": { name: "Healing Potion", type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 50 health.",   value: 25, use: { heal: 50 } },
   "hi-potion":       { name: "Hi-Potion",       type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 100 health.",  value: 50, use: { heal: 100 } },
   "small shield potion": { name: "Small Shield Potion", type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 25 shield.",   value: 30, use: { shield: 25 } },
   "shield potion":  { name: "Shield Potion",  type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 50 shield.",   value: 60, use: { shield: 50 } },
   "large shield potion": { name: "Large Shield Potion", type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 100 shield.",  value: 100, use: { shield: 100 } },
  
   "mushroom":       { name: "Mushroom",       type: "consumable", section: "Food", desc: "Probably edible. Restores 5 health.",               value: 4,  use: { heal: 5 } },
  
   "cooked fish":       { name: "Cooked Fish",       type: "consumable", section: "Food", desc: "A hot meal. Restores 25 health.",             value: 18, use: { heal: 25 } },
   "cooked tuna":       { name: "Cooked Tuna",       type: "consumable", section: "Food", desc: "A hot meal. Restores 30 health.",             value: 20, use: { heal: 30 } },
   "cooked gator":      { name: "Cooked Gator",      type: "consumable", section: "Food", desc: "A hot mean. restores 50 health.",             value: 30, use: { heal: 50 } },
   "cooked small meat": { name: "Cooked Small Meat", type: "consumable", section: "Food", desc: "Seared over a campfire. Restores 20 health.", value: 15, use: { heal: 20 } },
   "cooked meat":       { name: "Cooked Meat",       type: "consumable", section: "Food", desc: "Seared over a campfire. Restores 30 health.", value: 25, use: { heal: 30 } },
   "cooked mushroom":   { name: "Cooked Mushroom",   type: "consumable", section: "Food", desc: "A simple dish. Restores 10 health.",          value: 8,  use: { heal: 10 } },
  
   "mushroom stew":   { name: "Mushroom Stew",   type: "consumable", section: "Food", desc: "Earthy and filling. Restores 20 health.",       value: 15, use: { heal: 20 } },
   "mushroom sautee": { name: "Mushroom Sautee", type: "consumable", section: "Food", desc: "A simple dish. Restores 30 health.",            value: 20, use: { heal: 30 } },
   "meat stew":       { name: "Meat Stew",       type: "consumable", section: "Food", desc: "A proper survivor's meal. Restores 60 health.", value: 40, use: { heal: 60 } },
   "fish stew":       { name: "Fish Stew",       type: "consumable", section: "Food", desc: "A hearty meal. Restores 50 health.",            value: 35, use: { heal: 50 } },
   "mana potion":     { name: "Mana Potion",     type: "consumable", section: "Toolbag", toolbag: true, desc: "Restores 25 mana.",              value: 50, use: { mana: 25 } },
   "hi-potion":       { name: "Hi-Potion",       type: "consumable", section: "Toolbag", toolbag: true, desc: "A stronger healing draught. Restores 100 health.", value: 50, use: { heal: 100 } },
   
 
   // --- Crafting materials (action/recipe inputs and outputs) ---
   // - Wood
   "firewood":       { name: "Firewood",       type: "crafting", section: "Wood" ,desc: "Dry wood, ready to burn.",                   value: 5 },
   "wood log":       { name: "Wood Log",       type: "crafting", section: "Wood", desc: "A solid log. Building material.",            value: 8 },
   // - Food
   "raw fish":       { name: "Raw Fish",       type: "crafting", section: "Food", desc: "Fresh from the lake. Cook before eating.",   value: 10 },
   "raw tuna":       { name: "Raw Tuna",       type: "crafting", section: "Food", desc: "A large fish. Cook before eating.",          value: 12 },
   "raw gator meat": { name: "Raw Aligator",   type: "crafting", section: "Food", desc: "A collection of raw aligator meat",          value: 25 },
   "raw small meat": { name: "Raw Small Meat", type: "crafting", section: "Food", desc: "A small piece of meat. Cook it over a fire first.", value: 8 },
   "raw meat":       { name: "Raw Meat",       type: "crafting", section: "Food", desc: "Fresh game. Cook it over a fire first.",     value: 15 },
   "raw mushroom":   { name: "Raw Mushroom",   type: "crafting", section: "Food", desc: "A wild mushroom. Cook before eating.",       value: 5 },
   // - Ore & bars
   "copper ore":     { name: "Copper Ore",     type: "crafting", section: "Ore", desc: "Raw ore, ready for the forge.",              value: 12 },
   "copper bar":     { name: "Copper Bar",     type: "crafting", section: "Bars", desc: "Smelted copper, ready for smithing.",        value: 35 },
   "tin ore":        { name: "Tin Ore",        type: "crafting", section: "Ore", desc: "Raw ore, ready for the forge",               value: 5 },
   "tin bar":        { name: "Tin Bar",        type: "crafting", section: "Bars", desc: "Smelted tin, ready for smithing.",           value: 15 },
   "iron ore":       { name: "Iron Ore",       type: "crafting", section: "Ore", desc: "Heavy ore. Smelts into strong metal.",       value: 20 },
   "iron bar":       { name: "Iron Bar",       type: "crafting", section: "Bars", desc: "Smelted iron, ready for smithing.",          value: 55 },
   "bronze bar":     { name: "Bronze Bar",     type: "crafting", section: "Bars", desc: "Smelted bronze, ready for smithing",         value: 38 },
   "cobalt ore":     { name: "Cobalt Ore",     type: "crafting", section: "Ore", desc: "Raw ore, ready for the forge",               value: 58 },
   "cobalt bar":     { name: "Cobalt Bar",     type: "crafting", section: "Bars", desc: "Smelted cobalt, ready for smithig.",         value: 65 },
   "silver ore":     { name: "Silver Ore",     type: "crafting", section: "Ore", desc: "Shiny ore. Smelts into silver.",             value: 30 },
   "silver bar":     { name: "Silver Bar",     type: "crafting", section: "Bars", desc: "Smelted silver, ready for smithing.",        value: 50 },
   "gold ore":       { name: "Gold Ore",       type: "crafting", section: "Ore", desc: "Rare and valuable. Smelts into gold.",       value: 50 },
   "gold bar":       { name: "Gold Bar",       type: "crafting", section: "Bars", desc: "Smelted gold, ready for smithing.",          value: 80 },
   "mythril ore":    { name: "Mythril Ore",    type: "crafting", section: "Ore", desc: "A legendary ore. Smelts into mythril.",      value: 100 },
   "mythril bar":    { name: "Mythril Bar",    type: "crafting", section: "Bars", desc: "Smelted mythril, ready for smithing.",       value: 150 },
   "adamantite ore": { name: "Adamantite Ore", type: "crafting", section: "Ore", desc: "A mythical ore. Smelts into adamantite.",    value: 200 },
   "adamantite bar": { name: "Adamantite Bar", type: "crafting", section: "Bars", desc: "Smelted adamantite, ready for smithing.",    value: 300 },
   "syllic ore":     { name: "Syllic Ore",     type: "crafting", section: "Ore", desc: "A rare ore. Combines with Mythril to create something more than 2 times stronger than adamantite.", value: 800 },
   "syllic bar":     { name: "Syllic Bar",     type: "crafting", section: "Bars", desc: "Smelted syllic, ready for smithing.",        value: 1200 },
   // Zombie Bits - Dropped by zombies, used in crafting
   "zombie arm":        { name: "Zombie Arm",        type: "crafting", section: "Zombie Bits", desc: "A severed zombie arm. Still twitching.", value: 5 },
   "zombie leg":        { name: "Zombie Leg",        type: "crafting", section: "Zombie Bits", desc: "A severed zombie leg. Still twitching.", value: 5 },
   "zombie torso":      { name: "Zombie Torso",      type: "crafting", section: "Zombie Bits", desc: "A severed zombie torso. Still twitching.", value: 10 },
   "zombie head":       { name: "Zombie Head",       type: "crafting", section: "Zombie Bits", desc: "A severed zombie head. Still twitching.", value: 15 },
   "zombie heart":      { name: "Zombie Heart",      type: "crafting", section: "Zombie Bits", desc: "A severed zombie heart. Still twitching.", value: 20 },
   "zombie brain":      { name: "Zombie Brain",      type: "crafting", section: "Zombie Bits", desc: "A severed zombie brain. Still twitching.", value: 25 },
   "zombie eye":        { name: "Zombie Eye",        type: "crafting", section: "Zombie Bits", desc: "A severed zombie eye. Still twitching.", value: 5 },
   "zombie tongue":     { name: "Zombie Tongue",     type: "crafting", section: "Zombie Bits", desc: "A severed zombie tongue. Still twitching.", value: 5 },
   "zombie intestine":  { name: "Zombie Intestine",  type: "crafting", section: "Zombie Bits", desc: "A severed zombie intestine. Still twitching.", value: 10 },
   "zombie stomach":    { name: "Zombie Stomach",    type: "crafting", section: "Zombie Bits", desc: "A severed zombie stomach. Still twitching.", value: 10 },
   "zombie skin":       { name: "Zombie Skin",       type: "crafting", section: "Zombie Bits", desc: "A severed zombie skin. Still twitching.", value: 15 },
   "zombie bone":       { name: "Zombie Bone",       type: "crafting", section: "Zombie Bits", desc: "A severed zombie bone. Still twitching.", value: 5 },
   // - Misc Smithing ingredients
   "copper wire":    { name: "Copper Wire",    type: "crafting", section: "Smithing Components", desc: "Thin copper strands. Conducts electricity.", value: 20 },
   "tin wire":       { name: "Tin Wire",       type: "crafting", section: "Smithing Components", desc: "Thin tin strands, can be used for binding.", value: 15 },
   "tin plate":      { name: "Tin Plate",      type: "crafting", section: "Smithing Components", desc: "Thin plate of tin. Can be shaped with a hammer", value: 20 },
   "tin foil":       { name: "Tin Foil",       type: "crafting", section: "Smithing Components", desc: "Thin tin foil, can be used for apparel or crafting", value: 100 },
   "gold wire":      { name: "Gold Wire",      type: "crafting", section: "Smithing Components", desc: "Thin gold strands. Conducts electricity.",     value: 40 },
   "silver wire":    { name: "Silver Wire",    type: "crafting", section: "Smithing Components", desc: "Thin silver strands. Conducts electricity.",   value: 30 },
   "syllic wire":    { name: "Syllic Wire",    type: "crafting", section: "Smithing Components", desc: "Thin syllic strands. Conducts electricity.",    value: 100 },
   "syllic plate":   { name: "Syllic Plate",   type: "crafting", section: "Smithing Components", desc: "A thin sheet of syllic. Used in advanced smithing.", value: 200 },
   "cobalt shard":   { name: "Cobalt Shard",   type: "crafting", section: "Smithing Components", desc: "A shard of cobalt",                          value: 35 },
   "cobalt funnel":  { name: "Cobalt Funnel",  type: "crafting", section: "Smithing Components", desc: "A funnel for filling molds",                 value: 25 },
   // - Cobalt Molds, for crafting jewelry
   "cobalt mold star":    { name: "Mold (star)",          type: "crafting", section: "Smithing Components", desc: "A mold in the shape of a star",    value: 100 },
   "cobalt mold circ":    { name: "Mold (circle)",        type: "crafting", section: "Smithing Components", desc: "A mold in the shape of a circle",  value: 100 },
   "cobalt mold line":    { name: "Mold (line)",          type: "crafting", section: "Smithing Components", desc: "A mold in the shape of a line",    value: 100 },
   "cobalt mold trgt":    { name: "Mold (target)",        type: "crafting", section: "Smithing Components", desc: "A mold in the shape of a target",  value: 100 },
   "cobalt mold arow":    { name: "Mold (arrow)",         type: "crafting", section: "Smithing Components", desc: "A mold in the shape of a arrow",   value: 100 },
   "cobalt mold l squar": { name: "Large Mold (square)",  type: "crafting", section: "Smithing Components", desc: "A large square mold",              value: 200 },
   "cobalt mold l sign":  { name: "Large Mold (sign)",    type: "crafting", section: "Smithing Components", desc: "A large mold for making signs",    value: 250 },
   "cobalt mold l insg":  { name: "Large Mold (Insignia)", type: "crafting", section: "Smithing Components", desc: "A large mold with a customizable insignia space", value: 250 },
   // - Armors
   //   (armors also carry `piece` — one of ARMOR_PIECES, the paperdoll slot —
   //    and `defense`, the minimum Defense skill level to WEAR them, enforced
   //    by /api/armor/equip and boot-validated in server.js)
   // Armor Sets — matched-set trophies (sellable treasure, value = sum of that
   // tier's 6 piece values), not an equip-all-at-once bundle — there's no
   // "unpack into pieces" mechanic; each piece is smithed/crafted individually.
   "bronze armor set":     { name: "Bronze Armor Set",     type: "treasure", section: "Artifacts", desc: "A matched set of bronze armor.",     value: 1200 },
   "iron armor set":       { name: "Iron Armor Set",       type: "treasure", section: "Artifacts", desc: "A matched set of iron armor.",       value: 900 },
   "silver armor set":     { name: "Silver Armor Set",     type: "treasure", section: "Artifacts", desc: "A matched set of silver armor.",     value: 1500 },
   "gold armor set":       { name: "Gold Armor Set",       type: "treasure", section: "Artifacts", desc: "A matched set of gold armor.",       value: 2400 },
   "gold and silver armor set": { name: "Gold and Silver Armor Set", type: "treasure", section: "Artifacts", desc: "A matched set of gold and silver armor.", value: 3600 },
   "mythril armor set":    { name: "Mythril Armor Set",    type: "treasure", section: "Artifacts", desc: "A matched set of mythril armor.",    value: 4800 },
   "adamantite armor set": { name: "Adamantite Armor Set", type: "treasure", section: "Artifacts", desc: "A matched set of adamantite armor.", value: 7200 },
   "syllic armor set":     { name: "Syllic Armor Set",     type: "treasure", section: "Artifacts", desc: "A matched set of syllic armor.",     value: 12000 },
   "zombie armor set":     { name: "Zombie Armor Set",     type: "treasure", section: "Artifacts", desc: "A matched set of zombie-forged armor.", value: 12000 },
 
   // Bronze Armor
   "bronze helm":     { name: "Bronze Helm", piece: "head", type: "armor", section: "bronze",          desc: "A bronze helmet. Lighter but restrictive",                value: 200, ap: 60,  defense: 1 },
   "bronze chainmail": { name: "Bronze Chainmail", piece: "torso", type: "armor", section: "bronze", desc: "Bronze chainmail. Lighter, less restrictive",                value: 200, ap: 60,  defense: 1 },
   "bronze chestplate": { name: "Bronze Chestplate", piece: "torso", type: "armor", section: "bronze", desc: "A bronze Chestplate. Lighter but restrictive",                value: 200, ap: 60,  defense: 1 },
   "bronze chainlegs": { name: "Bronze Chainlegs", piece: "legs", type: "armor", section: "bronze", desc: "A set of Bronze Chainlegs. Lighter, less restrictive",                value: 200, ap: 60,  defense: 1 },
   "bronze platelegs": { name: "Bronze Platelegs", piece: "legs", type: "armor", section: "bronze", desc: "A set of Bronze Platelegs. Lighter but restrictive",                value: 200, ap: 60,  defense: 1 },
   "bronze boots":    { name: "Bronze Boots", piece: "boots", type: "armor", section: "bronze", desc: "A pair of Bronze boots. Lighter but restrictive",                value: 200, ap: 60,  defense: 1 },
   "bronze gauntlets": { name: "Bronze Gauntlets", piece: "hands", type: "armor", section: "bronze", desc: "A pair of Bronze gauntlets. Lighter but restrictive",                value: 200, ap: 60,  defense: 1 },
 
   // Iron Armor
   "iron helm":       { name: "Iron Helm", piece: "head",       type: "armor", section: "iron",            desc: "A suit of iron armor. Heavy but protective.",                    value: 150, ap: 50,  defense: 5 },
   "iron chainmail":    { name: "Iron Chainmail", piece: "torso", type: "armor", section: "iron",            desc: "A suit of iron chainmail. Heavy but protective.",                value: 150, ap: 50,  defense: 5 },
   "iron chestplate":   { name: "Iron Chestplate", piece: "torso", type: "armor", section: "iron",            desc: "A suit of iron chestplate. Heavy but protective.",                value: 150, ap: 50,  defense: 5 },
   "iron chainlegs":    { name: "Iron Chainlegs", piece: "legs", type: "armor", section: "iron",            desc: "A suit of iron chainlegs. Heavy but protective.",                value: 150, ap: 50,  defense: 5 },
   "iron platelegs":    { name: "Iron Platelegs", piece: "legs", type: "armor", section: "iron",            desc: "A suit of iron platelegs. Heavy but protective.",                value: 150, ap: 50,  defense: 5 },
   "iron boots":        { name: "Iron Boots", piece: "boots", type: "armor", section: "iron",            desc: "A pair of iron boots. Heavy but protective.",                    value: 150, ap: 50,  defense: 5 },
   "iron gauntlets":    { name: "Iron Gauntlets", piece: "hands", type: "armor", section: "iron",            desc: "A pair of iron gauntlets. Heavy but protective.",                value: 150, ap: 50,  defense: 5 },
 
   // Silver Armor
   "silver helm":       { name: "Silver Helm", piece: "head", type: "armor", section: "silver",          desc: "A silver helm. Shines and protects.",                            value: 250, ap: 75,  defense: 10 },
   "silver armor":     { name: "Silver Armor", piece: "torso", type: "armor", section: "silver",          desc: "A suit of silver armor. Shines and protects.",                   value: 250, ap: 75,  defense: 10 },
   "silver chainmail":  { name: "Silver Chainmail", piece: "torso", type: "armor", section: "silver",          desc: "A suit of silver chainmail. Shines and protects.",                value: 250, ap: 75,  defense: 10 },
   "silver chestplate": { name: "Silver Chestplate", piece: "torso", type: "armor", section: "silver",          desc: "A suit of silver chestplate. Shines and protects.",                value: 250, ap: 75,  defense: 10 },
   "silver chainlegs":  { name: "Silver Chainlegs", piece: "legs", type: "armor", section: "silver",          desc: "A suit of silver chainlegs. Shines and protects.",                value: 250, ap: 75,  defense: 10 },
   "silver platelegs":  { name: "Silver Platelegs", piece: "legs", type: "armor", section: "silver",          desc: "A suit of silver platelegs. Shines and protects.",                value: 250, ap: 75,  defense: 10 },
   "silver boots":      { name: "Silver Boots", piece: "boots", type: "armor", section: "silver",          desc: "A pair of silver boots. Shines and protects.",                    value: 250, ap: 75,  defense: 10 },
   "silver gauntlets":  { name: "Silver Gauntlets", piece: "hands", type: "armor", section: "silver",          desc: "A pair of silver gauntlets. Shines and protects.",                value: 250, ap: 75,  defense: 10 },
 
   // Gold Armor
   "gold helm":       { name: "Gold Helm", piece: "head", type: "armor", section: "gold",            desc: "A suit of gold armor. Heavy, shiny, and protective.",            value: 400, ap: 100, defense: 15 },
   "gold chainmail":    { name: "Gold Chainmail", piece: "torso", type: "armor", section: "gold",            desc: "A suit of gold chainmail. Heavy, shiny, and protective.",        value: 400, ap: 100, defense: 15 },
   "gold chestplate":   { name: "Gold Chestplate", piece: "torso", type: "armor", section: "gold",            desc: "A suit of gold chestplate. Heavy, shiny, and protective.",        value: 400, ap: 100, defense: 15 },
   "gold chainlegs":    { name: "Gold Chainlegs", piece: "legs", type: "armor", section: "gold",            desc: "A suit of gold chainlegs. Heavy, shiny, and protective.",        value: 400, ap: 100, defense: 15 },
   "gold platelegs":    { name: "Gold Platelegs", piece: "legs", type: "armor", section: "gold",            desc: "A suit of gold platelegs. Heavy, shiny, and protective.",        value: 400, ap: 100, defense: 15 },
   "gold boots":      { name: "Gold Boots", piece: "boots", type: "armor", section: "gold",            desc: "A pair of gold boots. Heavy, shiny, and protective.",            value: 400, ap: 100, defense: 15 },
   "gold gauntlets":    { name: "Gold Gauntlets", piece: "hands", type: "armor", section: "gold",            desc: "A pair of gold gauntlets. Heavy, shiny, and protective.",        value: 400, ap: 100, defense: 15 },
 
   // Gold and Silver Armor
   "gold and silver helm": { name: "Gold and Silver Helm", piece: "head", type: "armor", section: "gold and silver", desc: "A suit of gold and silver armor. Heavy, shiny, and protective.", value: 600, ap: 115, defense: 20 },
   "gold and silver chainmail": { name: "Gold and Silver Chainmail", piece: "torso", type: "armor", section: "gold and silver", desc: "A suit of gold and silver chainmail. Heavy, shiny, and protective.", value: 600, ap: 115, defense: 20 },
   "gold and silver chestplate": { name: "Gold and Silver Chestplate", piece: "torso", type: "armor", section: "gold and silver", desc: "A suit of gold and silver chestplate. Heavy, shiny, and protective.", value: 600, ap: 115, defense: 20 },
   "gold and silver chainlegs": { name: "Gold and Silver Chainlegs", piece: "legs", type: "armor", section: "gold and silver", desc: "A suit of gold and silver chainlegs. Heavy, shiny, and protective.", value: 600, ap: 115, defense: 20 },
   "gold and silver platelegs": { name: "Gold and Silver Platelegs", piece: "legs", type: "armor", section: "gold and silver", desc: "A suit of gold and silver platelegs. Heavy, shiny, and protective.", value: 600, ap: 115, defense: 20 },
   "gold and silver boots": { name: "Gold and Silver Boots", piece: "boots", type: "armor", section: "gold and silver", desc: "A pair of gold and silver boots. Heavy, shiny, and protective.", value: 600, ap: 115, defense: 20 },
   "gold and silver gauntlets": { name: "Gold and Silver Gauntlets", piece: "hands", type: "armor", section: "gold and silver", desc: "A pair of gold and silver gauntlets. Heavy, shiny, and protective.", value: 600, ap: 115, defense: 20 },
 
   // Mythril Armor
   "mythril helm":    { name: "Mythril Helm",              piece: "head", type: "armor", section: "mythril",         desc: "A suit of mythril armor. Light and protective.",                 value: 800, ap: 150, defense: 25 },
   "mythril chainmail": { name: "Mythril Chainmail",          piece: "torso", type: "armor", section: "mythril", desc: "A suit of mythril chainmail. Light and protective.",                 value: 800, ap: 150, defense: 25 },
   "mythril chestplate": { name: "Mythril Chestplate",          piece: "torso", type: "armor", section: "mythril", desc: "A suit of mythril chestplate. Light and protective.",                 value: 800, ap: 150, defense: 25 },
   "mythril chainlegs": { name: "Mythril Chainlegs",          piece: "legs", type: "armor", section: "mythril", desc: "A suit of mythril chainlegs. Light and protective.",                 value: 800, ap: 150, defense: 25 },
   "mythril platelegs": { name: "Mythril Platelegs",          piece: "legs", type: "armor", section: "mythril", desc: "A suit of mythril platelegs. Light and protective.",                 value: 800, ap: 150, defense: 25 },
   "mythril boots":   { name: "Mythril Boots",             piece: "boots", type: "armor", section: "mythril",         desc: "A pair of mythril boots. Light and protective.",                 value: 800, ap: 150, defense: 25 },
   "mythril gauntlets": { name: "Mythril Gauntlets",          piece: "hands", type: "armor", section: "mythril", desc: "A pair of mythril gauntlets. Light and protective.",                 value: 800, ap: 150, defense: 25 },
 
   // Adamantite Armor
   "adamantite helm": { name: "Adamantite Helm",           piece: "head", type: "armor", section: "adamantite",      desc: "A suit of adamantite armor. Extremely protective.",              value: 1200, ap: 200, defense: 30 },
   "adamantite chainmail": { name: "Adamantite Chainmail",       piece: "torso", type: "armor", section: "adamantite", desc: "A suit of adamantite chainmail. Extremely protective.",              value: 1200, ap: 200, defense: 30 },
   "adamantite chestplate": { name: "Adamantite Chestplate",       piece: "torso", type: "armor", section: "adamantite", desc: "A suit of adamantite chestplate. Extremely protective.",              value: 1200, ap: 200, defense: 30 },
   "adamantite chainlegs": { name: "Adamantite Chainlegs",       piece: "legs", type: "armor", section: "adamantite", desc: "A suit of adamantite chainlegs. Extremely protective.",              value: 1200, ap: 200, defense: 30 },
   "adamantite platelegs": { name: "Adamantite Platelegs",       piece: "legs", type: "armor", section: "adamantite", desc: "A suit of adamantite platelegs. Extremely protective.",              value: 1200, ap: 200, defense: 30 },
   "adamantite boots": { name: "Adamantite Boots",          piece: "boots", type: "armor", section: "adamantite",      desc: "A pair of adamantite boots. Extremely protective.",              value: 1200, ap: 200, defense: 30 },
   "adamantite gauntlets": { name: "Adamantite Gauntlets",       piece: "hands", type: "armor", section: "adamantite", desc: "A pair of adamantite gauntlets. Extremely protective.",              value: 1200, ap: 200, defense: 30 },
 
   // Syllic Armor
   "syllic helm":     { name: "Syllic Helm",               piece: "head", type: "armor", section: "syllic",          desc: "A suit of syllic armor. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "syllic chainmail":  { name: "Syllic Chainmail",           piece: "torso", type: "armor", section: "syllic", desc: "A suit of syllic chainmail. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "syllic chestplate": { name: "Syllic Chestplate",           piece: "torso", type: "armor", section: "syllic", desc: "A suit of syllic chestplate. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "syllic chainlegs":  { name: "Syllic Chainlegs",           piece: "legs", type: "armor", section: "syllic", desc: "A suit of syllic chainlegs. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "syllic platelegs":  { name: "Syllic Platelegs",           piece: "legs", type: "armor", section: "syllic", desc: "A suit of syllic platelegs. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "syllic boots":      { name: "Syllic Boots",              piece: "boots", type: "armor", section: "syllic",          desc: "A pair of syllic boots. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "syllic gauntlets":  { name: "Syllic Gauntlets",           piece: "hands", type: "armor", section: "syllic", desc: "A pair of syllic gauntlets. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
 
   // Zombie Armor (Rare craft, requires zombie parts)
   "zombie helm":     { name: "Zombie Helm",               piece: "head", type: "armor", section: "zombie",          desc: "A suit of zombie armor. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "zombie chainmail":  { name: "Zombie Chainmail",           piece: "torso", type: "armor", section: "zombie", desc: "A suit of zombie chainmail. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "zombie chestplate": { name: "Zombie Chestplate",           piece: "torso", type: "armor", section: "zombie", desc: "A suit of zombie chestplate. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "zombie chainlegs":  { name: "Zombie Chainlegs",           piece: "legs", type: "armor", section: "zombie", desc: "A suit of zombie chainlegs. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "zombie platelegs":  { name: "Zombie Platelegs",           piece: "legs", type: "armor", section: "zombie", desc: "A suit of zombie platelegs. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "zombie boots":      { name: "Zombie Boots",              piece: "boots", type: "armor", section: "zombie",          desc: "A pair of zombie boots. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
   "zombie gauntlets":  { name: "Zombie Gauntlets",           piece: "hands", type: "armor", section: "zombie", desc: "A pair of zombie gauntlets. Extremely protective.",                  value: 2000, ap: 350, defense: 35 },
 
   // Shields — one per tier, completing the 6-piece paperdoll (head/torso/legs/boots/hands/shield).
   "bronze shield":     { name: "Bronze Shield",     piece: "shield", type: "armor", section: "bronze",     desc: "A bronze shield. Blocks blows.",                   value: 200,   ap: 60,  defense: 1 },
   "iron shield":       { name: "Iron Shield",       piece: "shield", type: "armor", section: "iron",       desc: "An iron shield. Heavy but protective.",            value: 150,   ap: 50,  defense: 5 },
   "silver shield":     { name: "Silver Shield",     piece: "shield", type: "armor", section: "silver",     desc: "A silver shield. Shines and protects.",            value: 250,   ap: 75,  defense: 10 },
   "gold shield":       { name: "Gold Shield",       piece: "shield", type: "armor", section: "gold",       desc: "A gold shield. Heavy, shiny, and protective.",     value: 400,   ap: 100, defense: 15 },
   "gold and silver shield": { name: "Gold and Silver Shield", piece: "shield", type: "armor", section: "gold and silver", desc: "A gold and silver shield. Heavy, shiny, and protective.", value: 600, ap: 115, defense: 20 },
   "mythril shield":    { name: "Mythril Shield",    piece: "shield", type: "armor", section: "mythril",    desc: "A mythril shield. Light and protective.",          value: 800,   ap: 150, defense: 25 },
   "adamantite shield": { name: "Adamantite Shield", piece: "shield", type: "armor", section: "adamantite", desc: "An adamantite shield. Extremely protective.",      value: 1200,  ap: 200, defense: 30 },
   "syllic shield":     { name: "Syllic Shield",     piece: "shield", type: "armor", section: "syllic",     desc: "A syllic shield. Extremely protective.",           value: 2000,  ap: 350, defense: 35 },
   "zombie shield":     { name: "Zombie Shield",     piece: "shield", type: "armor", section: "zombie",     desc: "A shield forged from zombie remains. Extremely protective.", value: 2000, ap: 350, defense: 35 },
 
   // - Magic ingredients (gathered via magic-skill location actions; consumed
   //   learning spells at the Magic Table in Town — see magic_backbone.js `learn` maps)
   "glowcap":        { name: "Glowcap",        type: "crafting", section: "Magic", desc: "A faintly luminous mushroom. Hums with magic.", value: 9 },
   "arcane dust":    { name: "Arcane Dust",    type: "crafting", section: "Magic", desc: "Glittering residue sifted from a ley line.",  value: 15 },
   "spirit bloom":   { name: "Spirit Bloom",   type: "crafting", section: "Magic", desc: "A pale flower that sways without wind.",      value: 12 },
   "ley crystal":    { name: "Ley Crystal",    type: "crafting", section: "Magic", desc: "A crystal humming with ley-line energy.",     value: 45 },
   "mana shard":     { name: "Mana Shard",     type: "crafting", section: "Magic", desc: "A splinter of raw ley-line energy.",         value: 60 },
   // - Potions
   "swamp herb":     { name: "Swamp Herb",     type: "crafting", section: "Alchemy", desc: "Pungent. Alchemists swear by it.",           value: 6 },
   "river herb":     { name: "River Herb",     type: "crafting", section: "Alchemy", desc: "A fragrant herb. Used in potions.",           value: 7 },
   "lake herb":      { name: "Lake Herb",      type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions.",                value: 8 },
   "scrap metal":    { name: "Scrap Metal",    type: "crafting", section: "Alchemy", desc: "Rusty but salvageable.",                     value: 8 },
   "coal":           { name: "Coal",           type: "crafting", section: "Alchemy", desc: "Black rock. Burns hot.",                      value: 10 },
 
   // --- Trade goods (made to be sold) ---
   "minnow":         { name: "Minnow",         type: "trade", section: "Trade", desc: "Tiny fish. Bait, or a very small meal.",        value: 3 },
   "crude blade":    { name: "Crude Blade",    type: "trade", section: "Trade", desc: "Rough smithing work, but it holds an edge.",    value: 45 },
   "weak blade":     { name: "Weak Blade",     type: "trade", section: "Trade", desc: "A simple sword. Not very strong.",               value: 60 },
   "magic amulet":   { name: "Magic Amulet",   type: "trade", section: "Trade", desc: "A trinket of raw ley-line energy. Highly sought.", value: 500 },
 
   // --- Treasure (rare/valuable finds) ---
   "radio part":     { name: "Radio Part",     type: "treasure", section: "Artifacts", desc: "Delicate electronics. Someone needs this.",  value: 40 },
   "golden bangle":  { name: "Golden Bangle",  type: "treasure", section: "Artifacts", desc: "A gold bracelet. Worth a lot to the right buyer.", value: 150 },
   "syllic shard":   { name: "Syllic Shard",   type: "treasure", section: "Artifacts", desc: "A fragment of syllic. Rare and valuable.",     value: 300 },
   "syllic tablet":  { name: "Syllic Tablet",  type: "treasure", section: "Artifacts", desc: "A tablet of syllic, engraved with an unknown language. Rare and extremely valuable.", value: 5000 },
   "strange egg":    { name: "Strange Egg",    type: "treasure", section: "Artifacts", desc: "A mysterious egg. It hums with latent energy.", value: 200 },
 
   // --- Bunker Items (quest progression, supply beacons, and other radio/base items) ---
   "functional radio": { name: "Functional Radio", type: "base_item", section: "Quest Items", desc: "A working radio. Can call for help.", value: 100 },
   "supply beacon":    { name: "Supply Beacon",    type: "base_item", section: "Quest Items", desc: "A beacon that calls in supply drops.", value: 200 },
   "base repair kit":  { name: "Base Repair Kit",  type: "base_item", section: "Quest Items", desc: "Use at the Bunker to stock a repair kit for the base (+500 base HP per use, from inside).", value: 150, use: { stockRepairKits: 1 } },
   "external antenna": { name: "External Antenna", type: "base_item", section: "Quest Items", desc: "Passive while owned: +10% supply beacon activation chance.", value: 120 },
   "signal amplifier": { name: "Signal Amplifier", type: "base_item", section: "Quest Items", desc: "Passive while owned: +15% supply beacon activation chance.", value: 130 },
   "sentry turret":    { name: "Sentry Turret",    type: "base_item", section: "Quest Items", desc: "Use at the Bunker: shields the base from all zombie damage for 4 hours and returns fire during raids.", value: 250, title: "defense_up", use: { sentryHours: 4 } },
   "storage locker":   { name: "Storage Locker",   type: "base_item", section: "Quest Items", desc: "A secure locker for storing items.", title: "space_invader" },
 
 };
 
 // ----- Bonus Drops -----
 // Random bonus drops that can fall from actions that drop crafting components (foraging, woodcutting, etc.).
 //  Each entry is rolled top to bottom on a successful action; the first entry to pass its `chance` (%) is granted.
 export const BONUS_DROPS = [
   // - Herbs (for potions)
   { key: "blue herb", name: "Blue Herb", chance: 10, value: 15, type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions." },
   { key: "red herb", name: "Red Herb", chance: 8, value: 20, type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions." },
   { key: "yellow herb", name: "Yellow Herb", chance: 6, value: 25, type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions." },
   { key: "purple herb", name: "Purple Herb", chance: 4, value: 30, type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions." },
   { key: "green herb", name: "Green Herb", chance: 2, value: 35, type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions." },
   { key: "black herb", name: "Black Herb", chance: 1, value: 40, type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions." },
   { key: "white herb", name: "White Herb", chance: 1, value: 45, type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions." },
   { key: "golden herb", name: "Golden Herb", chance: 1, value: 50, type: "crafting", section: "Alchemy", desc: "A rare herb. Used in potions." },
   // - Relics (For crafting and potions)
   { key: "ancient relic", name: "Ancient Relic", chance: 5, value: 100, type: "crafting", section: "Smithing Components", desc: "A fragment of an ancient civilization. Used in crafting and potions." },
   { key: "mystic relic", name: "Mystic Relic", chance: 3, value: 150, type: "crafting", section: "Smithing Components", desc: "A fragment of a mystical civilization. Used in crafting and potions." },
   { key: "arcane relic", name: "Arcane Relic", chance: 2, value: 200, type: "crafting", section: "Smithing Components", desc: "A fragment of an arcane civilization. Used in crafting and potions." },
   { key: "legendary relic", name: "Legendary Relic", chance: 1, value: 300, type: "crafting", section: "Smithing Components", desc: "A fragment of a legendary civilization. Used in crafting and potions." },
   { key: "mythical relic", name: "Mythical Relic", chance: 1, value: 500, type: "crafting", section: "Smithing Components", desc: "A fragment of a mythical civilization. Used in crafting and potions." },
   { key: "Dragonflower Root", name: "Dragonflower Root", chance: 1, value: 1000, type: "crafting", section: "Alchemy", desc: "A rare root from the legendary Dragonflower. Used in crafting and potions." },
   { key: "Phoenix Feather", name: "Phoenix Feather", chance: 1, value: 1500, type: "crafting", section: "Alchemy", desc: "A feather from the mythical Phoenix. Used in crafting and potions." },
   { key: "Unicorn Horn", name: "Unicorn Horn", chance: 1, value: 2000, type: "crafting", section: "Alchemy", desc: "A horn from the legendary Unicorn. Used in crafting and potions." },
   { key: "Mermaid Scale", name: "Mermaid Scale", chance: 1, value: 2500, type: "crafting", section: "Alchemy", desc: "A scale from the mythical Mermaid. Used in crafting and potions." },
   { key: "Griffin Claw", name: "Griffin Claw", chance: 1, value: 3000, type: "crafting", section: "Alchemy", desc: "A claw from the legendary Griffin. Used in crafting and potions." },
   { key: "Kraken Ink", name: "Kraken Ink", chance: 1, value: 3500, type: "crafting", section: "Alchemy", desc: "Ink from the mythical Kraken. Used in crafting and potions." },
   { key: "Basilisk Fang", name: "Basilisk Fang", chance: 1, value: 4000, type: "crafting", section: "Alchemy", desc: "A fang from the legendary Basilisk. Used in crafting and potions." },
   { key: "Chimera Scale", name: "Chimera Scale", chance: 1, value: 4500, type: "crafting", section: "Alchemy", desc: "A scale from the mythical Chimera. Used in crafting and potions." },
   { key: "Hydra Tooth", name: "Hydra Tooth", chance: 1, value: 5000, type: "crafting", section: "Alchemy", desc: "A tooth from the legendary Hydra. Used in crafting and potions." },
   { key: "Sphinx Claw", name: "Sphinx Claw", chance: 1, value: 5500, type: "crafting", section: "Alchemy", desc: "A claw from the mythical Sphinx. Used in crafting and potions." },
   { key: "Minotaur Horn", name: "Minotaur Horn", chance: 1, value: 6000, type: "crafting", section: "Alchemy", desc: "A horn from the legendary Minotaur. Used in crafting and potions." },
   // - Very Rare chance to drop Armor pieces, Smithing Components, or full armor sets.
 ];
 
 // Register the Bonus Drops as items — rows already carry type/section inline
 // (unlike RANDOM_DROPS below, which self-registers as treasure separately).
 for (const d of BONUS_DROPS) {
   ITEMS[d.key] = { name: d.name, type: d.type, section: d.section, desc: d.desc, value: d.value };
 }
 
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
   ITEMS[d.key].section = "Artifacts"; // all random drops are Artifacts
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
   { key: "iron armor set", chance: 0.5 },
   { key: "silver armor set", chance: 0.5 },
   { key: "gold armor set", chance: 0.5 },
   { key: "gold and silver armor set", chance: 0.5 },
   { key: "mythril armor set", chance: 0.5 },
   { key: "adamantite armor set", chance: 0.5 },
   { key: "syllic armor set", chance: 0.25 },
   { key: "zombie armor set", chance: 0.05 },
 ];
 
 
 // 
export const COOKING = [
  // COOKIING fields
  // key: unique identifier for the recipe
  // label: display name for the recipe
  // skill: the skill used for cooking (e.g., "crafting")
  // level: required skill level to cook the recipe
  // station: the cooking station required (e.g., "campfire")
  // inputs: an object representing the required ingredients and their quantities
  // output: the resulting item from cooking
  // xp: experience points gained from cooking the recipe
  // timer: time in seconds it takes to cook the recipe
  // category: category of the recipe (e.g., "food")

   // Campfire cooking (the fire replaces any firewood input — building it costs the wood)
   { key: "cook_fish",     label: "Cook Fish",     skill: "crafting", level: 1, station: "campfire", inputs: { "raw fish": 1 },                    output: "cooked fish",   xp: 8,  timer: 10, category: "food" },
   { key: "cook_tuna",     label: "Cook Tuna",     skill: "crafting", level: 1, station: "campfire", inputs: { "raw tuna": 1 },                    output: "cooked tuna",   xp: 10,  timer: 10, category: "food" },
   { key: "cook_small_meat", label: "Cook Small Meat", skill: "crafting", level: 1, station: "campfire", inputs: { "raw small meat": 1 },            output: "cooked small meat", xp: 8,  timer: 10, category: "food" },
   { key: "cook_meat",     label: "Cook Meat",     skill: "crafting", level: 1, station: "campfire", inputs: { "raw meat": 1 },                    output: "cooked meat",   xp: 8,  timer: 10, category: "food" },
   { key: "cook_mushroom", label: "Cook Mushroom", skill: "crafting", level: 1, station: "campfire", inputs: { "raw mushroom": 1 },                output: "cooked mushroom", xp: 8,  timer: 10, category: "food" },
   { key: "mushroom_stew", label: "Mushroom Stew", skill: "crafting", level: 2, station: "campfire", inputs: { "mushroom": 3 },                    output: "mushroom stew", xp: 12, timer: 15, category: "food" },
   { key: "fish_stew",     label: "Fish Stew",     skill: "crafting", level: 2, station: "campfire", inputs: { "cooked fish": 1, "mushroom": 1 },  output: "fish stew",     xp: 12, timer: 15, category: "food" },
   { key: "meat_stew",     label: "Meat Stew",     skill: "crafting", level: 3, station: "campfire", inputs: { "cooked meat": 1, "mushroom": 1 },  output: "meat stew",     xp: 15, timer: 15, category: "food" },
   { key: "mushroom_sautee", label: "Mushroom Sautee", skill: "crafting", level: 3, station: "campfire", inputs: { "cooked mushroom": 2 },         output: "mushroom sautee", xp: 15, timer: 15, category: "food" },
   
   // Campire cooking - Advanced recipes, requires more ingredients and higher skill levels
   { key: "fish_casserole", label: "Fish Casserole", skill: "crafting", level: 4, station: "campfire", inputs: { "cooked fish": 1, "cooked mushroom": 1, "cooked small meat": 1 }, output: "fish casserole", xp: 20, timer: 20, category: "food" },
   { key: "meat_casserole", label: "Meat Casserole", skill: "crafting", level: 4, station: "campfire", inputs: { "cooked meat": 1, "cooked mushroom": 1, "cooked small meat": 1 }, output: "meat casserole", xp: 20, timer: 20, category: "food" },
   { key: "mushroom_casserole", label: "Mushroom Casserole", skill: "crafting", level: 4, station: "campfire", inputs: { "cooked mushroom": 2, "cooked small meat": 1 }, output: "mushroom casserole", xp: 20, timer: 20, category: "food" },
   { key: "mixed_casserole", label: "Mixed Casserole", skill: "crafting", level: 5, station: "campfire", inputs: { "cooked fish": 1, "cooked meat": 1, "cooked mushroom": 1 }, output: "mixed casserole", xp: 45, timer: 25, category: "food" },
   { key: "mushroom_risotto", label: "Mushroom Risotto", skill: "crafting", level: 5, station: "campfire", inputs: { "cooked mushroom": 2, "cooked small meat": 1, "cooked fish": 1 }, output: "mushroom risotto", xp: 45, timer: 25, category: "food" },
   { key: "fish_risotto", label: "Fish Risotto", skill: "crafting", level: 5, station: "campfire", inputs: { "cooked fish": 2, "cooked small meat": 1, "cooked mushroom": 1 }, output: "fish risotto", xp: 45, timer: 25, category: "food" },
   { key: "meat_risotto", label: "Meat Risotto", skill: "crafting", level: 5, station: "campfire", inputs: { "cooked meat": 2, "cooked small meat": 1, "cooked mushroom": 1 }, output: "meat risotto", xp: 45, timer: 25, category: "food" },
   { key: "mixed_risotto", label: "Mixed Risotto", skill: "crafting", level: 6, station: "campfire", inputs: { "cooked fish": 1, "cooked meat": 1, "cooked mushroom": 1, "cooked small meat": 1 }, output: "mixed risotto", xp: 60, timer: 30, category: "food" },
   { key: "fish_and_meat_risotto", label: "Fish and Meat Risotto", skill: "crafting", level: 6, station: "campfire", inputs: { "cooked fish": 1, "cooked meat": 1, "cooked small meat": 1 }, output: "fish and meat risotto", xp: 60, timer: 30, category: "food" },
   { key: "mushroom_and_meat_risotto", label: "Mushroom and Meat Risotto", skill: "crafting", level: 6, station: "campfire", inputs: { "cooked mushroom": 1, "cooked meat": 1, "cooked small meat": 1 }, output: "mushroom and meat risotto", xp: 60, timer: 30, category: "food" },
   { key: "mushroom_and_fish_risotto", label: "Mushroom and Fish Risotto", skill: "crafting", level: 6, station: "campfire", inputs: { "cooked mushroom": 1, "cooked fish": 1, "cooked small meat": 1 }, output: "mushroom and fish risotto", xp: 60, timer: 30, category: "food" },
   { key: "mixed_fish_and_meat_risotto", label: "Mixed Fish and Meat Risotto", skill: "crafting", level: 6, station: "campfire", inputs: { "cooked fish": 1, "cooked meat": 1, "cooked mushroom": 1, "cooked small meat": 1 }, output: "mixed fish and meat risotto", xp: 60, timer: 30, category: "food" },

   
   // Campfire Hotpot recipes -- Requires any 2 of the listed hotpot items. 
   // Mixed Hotpots require one of the other hotpots to be present, and will consume one of hotpot items in the mix, and the normal "hotpot:" ingredients.
   // Hotpot Specific keys
   // hotpot: { "ingredient": quantity, ... } -- the ingredients that are options to be in the hotpot
   // hotpot_req: { "hotpot_item": quantity, ... } -- the hotpot items that are optioned for the required base to be in the new mixed hotpot
   // hotpot_mix: { h1: { "ingredient": quantity, ... }, h2: { "ingredient": quantity, ... } ... } -- the ingredients that are options to be in the hotpot mix, up to 4 main ingredients
   //                                                                                                 and 2 optional ingredients. The hotpot mix will consume one of the hotpot items in the mix
   //                                                                                                 instead of the normal "hotpot:" ingredients. This option allows for more complex recipes.
   { key: "mushroom_hotpot", label: "Mushroom Hotpot", skill: "crafting", level: 4, station: "campfire", hotpot: { "blue mushroom": 1, "red mushroom": 1, "green mushroom": 1 }, output: "mushroom hotpot", xp: 20, timer: 20, category: "food" },
   { key: "fish_hotpot", label: "Fish Hotpot", skill: "crafting", level: 4, station: "campfire", hotpot: { "cooked fish": 1, "cooked tuna": 1, "cooked small meat": 1 }, output: "fish hotpot", xp: 20, timer: 20, category: "food" },
   { key: "meat_hotpot", label: "Meat Hotpot", skill: "crafting", level: 4, station: "campfire", hotpot: { "cooked meat": 1, "cooked small meat": 1, "cooked tuna": 1 }, output: "meat hotpot", xp: 20, timer: 20, category: "food" },
   { key: "mixed_hotpot", label: "Mixed Hotpot", skill: "crafting", level: 5, station: "campfire", hotpot_req: { "mushroom hotpot": 1, "fish hotpot": 1, "meat hotpot": 1 }, hotpot: { "blue mushroom": 1, "red mushroom": 1, "green mushroom": 1, "cooked fish": 1, "cooked tuna": 1, "cooked small meat": 1 }, output: "mixed hotpot", xp: 45, timer: 25, category: "food" },
   { key: "mushroom_and_fish_hotpot", label: "Mushroom and Fish Hotpot", skill: "crafting", level: 5, station: "campfire", hotpot_req: { "mushroom hotpot": 1, "fish hotpot": 1 }, hotpot: { "blue mushroom": 1, "red mushroom": 1, "green mushroom": 1, "cooked fish": 1, "cooked tuna": 1 }, output: "mushroom and fish hotpot", xp: 45, timer: 25, category: "food" },
   { key: "mushroom_and_meat_hotpot", label: "Mushroom and Meat Hotpot", skill: "crafting", level: 5, station: "campfire", hotpot_req: { "mushroom hotpot": 1, "meat hotpot": 1 }, hotpot: { "blue mushroom": 1, "red mushroom": 1, "green mushroom": 1, "cooked meat": 1, "cooked small meat": 1 }, output: "mushroom and meat hotpot", xp: 45, timer: 25, category: "food" },
   { key: "fish_and_meat_hotpot", label: "Fish and Meat Hotpot", skill: "crafting", level: 5, station: "campfire", hotpot_req: { "fish hotpot": 1, "meat hotpot": 1 }, hotpot: { "cooked fish": 1, "cooked tuna": 1, "cooked small meat": 1, "cooked meat": 1 }, output: "fish and meat hotpot", xp: 45, timer: 25, category: "food" },
   { key: "mixed_fish_and_meat_hotpot", label: "Mixed Fish and Meat Hotpot", skill: "crafting", level: 6, station: "campfire", hotpot_req: { "fish hotpot": 1, "meat hotpot": 1 }, hotpot_mix: { h1: { "cooked fish": 1, "cooked tuna": 1 }, h2: { "cooked meat": 1, "cooked small meat": 1 } }, output: "mixed fish and meat hotpot", xp: 60, timer: 30, category: "food" },
   { key: "mixed_mushroom_and_fish_hotpot", label: "Mixed Mushroom and Fish Hotpot", skill: "crafting", level: 6, station: "campfire", hotpot_req: { "mushroom hotpot": 1, "fish hotpot": 1 }, hotpot_mix: { h1: { "blue mushroom": 1, "red mushroom": 1, "green mushroom": 1 }, h2: { "cooked fish": 1, "cooked tuna": 1 } }, output: "mixed mushroom and fish hotpot", xp: 60, timer: 30, category: "food" },
   { key: "mixed_mushroom_and_meat_hotpot", label: "Mixed Mushroom and Meat Hotpot", skill: "crafting", level: 6, station: "campfire", hotpot_req: { "mushroom hotpot": 1, "meat hotpot": 1 }, hotpot_mix: { h1: { "blue mushroom": 1, "red mushroom": 1, "green mushroom": 1 }, h2: { "cooked meat": 1, "cooked small meat": 1 } }, output: "mixed mushroom and meat hotpot", xp: 60, timer: 30, category: "food" },
   { key: "mixed_mushroom_fish_and_meat_hotpot", label: "Mixed Mushroom, Fish and Meat Hotpot", skill: "crafting", level: 7, station: "campfire", hotpot_req: { "mushroom hotpot": 1, "fish hotpot": 1, "meat hotpot": 1 }, hotpot_mix: { h1: { "blue mushroom": 1, "red mushroom": 1, "green mushroom": 1 }, h2: { "cooked fish": 1, "cooked tuna": 1 }, h3: { "cooked meat": 1, "cooked small meat": 1 } }, output: "mixed mushroom, fish and meat hotpot", xp: 75, timer: 35, category: "food" },

];

 // RECIPES fields:
 //   key       unique id
 //   label     display name
 //   skill     which skill it trains / gates it
 //   level     minimum skill level
 //   station   where it can be crafted: "campfire" (the player must have one
 //             burning — see /api/campfire), "forge" (your Mountains forge
 //             must be fired — see fire_forge), "beacon" (a live supply
 //             beacon at the Bunker — see activate_supply_beacon), or
 //             "arcane_table" (the Town Arcane Table, active within its 5min
 //             window — see activate_arcane_table). Omit for craftable-anywhere.
 //   requires  tool that must be OWNED (not consumed) — omit for none
 //   inputs    { item: qty, ... } — CONSUMED on craft
 //   output    item granted (1 per craft), or { item: qty, ... } for a bundle
 //   roll      "supply" — the craft ALSO rolls the SUPPLY_DROP_ROLL table once
 //             (first entry to pass its chance wins, one bonus max) — the
 //             declarative random-roll picker; server.js does the rolling
 //   xp        skill XP awarded
 //   timer     seconds the craft takes
 //   section   (forge recipes) which section of the Use Forge modal the row
 //             renders under: "Ingredients" | "Tools" | "Bronze" | "Iron" |
 //             "Silver" | "Gold" | "Mythril" | "Adamantite" | "Syllic". The
 //             modal's main tab is derived from the key: smelt_* -> Smelting,
 //             everything else -> Smithing. Required on station:"forge" rows
 //             (boot-checked). Gold-and-silver pieces use section "Gold".
 // `category` (admin-panel Recipes tabs, added alongside `section`): one of
 // "food" | "potion" | "base" | "magic" | "metal" | "misc". Only "metal" rows
 // also carry `metal` (a SMELT_TYPES entry) and `metalType`
 // ("armor" | "crafting" | "tools") — the metal drives which top-level tab a
 // recipe lands in, metalType which of that tab's Armor/Crafting/Tools
 // side-tabs. Boot-validated below (server.js) same as every other field here.
 export const RECIPES = [
   // Town Crafting
   // -- General crafting (anywhere)
   { key: "craft_mana_potion",    label: "Craft Mana Potion",    skill: "alchemy", level: 1, inputs: { "swamp herb": 1, "river herb": 1 }, output: "mana potion", xp: 10, timer: 15, category: "potion" },
   { key: "craft_healing_potion", label: "Craft Healing Potion", skill: "alchemy", level: 1, inputs: { "swamp herb": 1, "lake herb": 1 }, output: "healing potion", xp: 10, timer: 15, category: "potion" },
   { key: "craft_hi_potion",      label: "Craft Hi-Potion",      skill: "alchemy", level: 2, inputs: { "swamp herb": 2, "river herb": 2, "lake herb": 1 }, output: "hi-potion", xp: 15, timer: 20, category: "potion" },
   { key: "craft_shield_potion",  label: "Craft Shield Potion",  skill: "alchemy", level: 2, inputs: { "swamp herb": 2, "lake herb": 1, "coal": 2 }, output: "shield potion", xp: 12, timer: 20, category: "potion" },
   // -- Town crafting (Only accessible in Town, requires campfire)
   // -- - Base items, requires a hammer
   { key: "craft_weak_blade", label: "Craft Weak Blade", skill: "smithing", level: 1, station: "campfire", requires: "hammer", inputs: { "copper bar": 1, "scrap metal": 1 }, output: "weak blade", xp: 15, timer: 20, category: "misc" },
   { key: "craft_radio_part", label: "Craft Radio Part", skill: "smithing", level: 2, station: "campfire", requires: "hammer", inputs: { "copper wire": 1, "scrap metal": 1 }, output: "radio part", xp: 20, timer: 25, category: "misc" },
   // -- - zombie armor — the Arcane Table's endgame recipes, built from the
   //    Zombie Bits kill-drop pool (see resolveKill in server.js) plus syllic.
   { key: "craft_zombie_head",   label: "Craft Zombie Helm",       skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie head": 1, "zombie brain": 1, "zombie eye": 1, "syllic bar": 1 }, output: "zombie helm",       xp: 60, timer: 45, category: "armor" },
   { key: "craft_zombie_torso",  label: "Craft Zombie Chestplate", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie torso": 1, "zombie heart": 1, "zombie skin": 2, "syllic bar": 1, "syllic plate": 1 }, output: "zombie chestplate", xp: 90, timer: 60, category: "armor" },
   { key: "craft_zombie_legs",   label: "Craft Zombie Platelegs",  skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie leg": 2, "zombie skin": 1, "syllic bar": 1, "syllic plate": 1 }, output: "zombie platelegs", xp: 90, timer: 60, category: "armor" },
   { key: "craft_zombie_boots",  label: "Craft Zombie Boots",      skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie leg": 1, "zombie skin": 1, "syllic bar": 1 }, output: "zombie boots",     xp: 60, timer: 45, category: "armor" },
   { key: "craft_zombie_hands",  label: "Craft Zombie Gauntlets",  skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie arm": 1, "zombie skin": 1, "syllic bar": 1 }, output: "zombie gauntlets", xp: 60, timer: 45, category: "armor" },
   { key: "craft_zombie_shield", label: "Craft Zombie Shield",     skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie torso": 1, "zombie stomach": 1, "zombie intestine": 1, "syllic bar": 1, "syllic plate": 1 }, output: "zombie shield", xp: 90, timer: 60, category: "armor" },
   // -- - Weapon crafting — Town's Arcane Table recipes, requires a hammer, the Campfire to be active, and the Arcane Table to be active (5min window).
   // -- -                   Some recipes are built from the Zombie Bits and other materials, while other recipes require normal crafting materials.
    { key: "craft_zombie_sword", label: "Craft Zombie Sword", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie head": 1, "zombie arm": 1, "zombie leg": 1, "syllic bar": 1 }, output: "zombie sword", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_baseball_bat", label: "Craft Baseball Bat", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 2, "wood log": 1 }, output: "Baseball Bat", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_billyclub", label: "Craft Billy Club", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 1, "wood log": 1 }, output: "Billy Club", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_crowbar", label: "Craft Crowbar", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 1, "wood log": 1 }, output: "Crowbar", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_machete", label: "Craft Machete", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 2, "wood log": 1 }, output: "Machete", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_katana", label: "Craft Katana", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 3, "wood log": 1 }, output: "Katana", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_spear", label: "Craft Spear", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 1, "wood log": 2 }, output: "Spear", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_crossbow", label: "Craft Crossbow", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 2, "wood log": 2 }, output: "Crossbow", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_syllic_crossbow", label: "Craft Syllic Crossbow", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "syllic bar": 2, "wood log": 2 }, output: "Syllic Crossbow", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_syllic_bow", label: "Craft Syllic Bow", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "syllic bar": 1, "wood log": 2 }, output: "Syllic Bow", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_bow", label: "Craft Bow", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 1, "wood log": 2 }, output: "Bow", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_throwing_knives", label: "Craft Throwing Knives", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 1, "wood log": 1 }, output: "Throwing Knives", xp: 50, timer: 30, category: "weapon" },
    { key: "craft_spiked_knuckles", label: "Craft Spiked Knuckles", skill: "smithing", level: 5, station: "arcane_table", requires: "hammer", inputs: { "scrap metal": 2, "wood log": 1 }, output: "Spiked Knuckles", xp: 50, timer: 30, category: "weapon" },
    // -- - Zombie Bits weapons — the Arcane Table's endgame recipes, built from the
    { key: "craft_zombie_club", label: "Craft Zombie Club", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie arm": 1, "zombie leg": 1, "syllic bar": 1 }, output: "zombie club", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_dagger", label: "Craft Zombie Dagger", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie head": 1, "zombie arm": 1, "syllic bar": 1 }, output: "zombie dagger", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_flail", label: "Craft Zombie Flail", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie head": 1, "zombie leg": 1, "syllic bar": 1 }, output: "zombie flail", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_crossbow", label: "Craft Zombie Crossbow", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie torso": 1, "zombie arm": 1, "syllic bar": 1 }, output: "zombie crossbow", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_bow", label: "Craft Zombie Bow", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie torso": 1, "zombie leg": 1, "syllic bar": 1 }, output: "zombie bow", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_throwing_knives", label: "Craft Zombie Throwing Knives", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie arm": 1, "zombie leg": 1, "syllic bar": 1 }, output: "zombie throwing knives", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_spiked_knuckles", label: "Craft Zombie Spiked Knuckles", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie arm": 1, "zombie head": 1, "syllic bar": 1 }, output: "zombie knuckles", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_arm", label: "Craft Zombie Arm", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie arm": 1, "syllic bar": 1 }, output: "zombie fist arm", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_knuckles", label: "Craft Zombie Knuckles", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie tongue": 5, "syllic bar": 1 }, output: "zombie knuckles", xp: 90, timer: 60, category: "weapon" },
    { key: "craft_zombie_spine_whip", label: "Craft Zombie Spine Whip", skill: "smithing", level: 10, station: "arcane_table", requires: "hammer", inputs: { "zombie bone": 5, "syllic bar": 1 }, output: "zombie spine whip", xp: 90, timer: 60, category: "weapon" },
 
   // Bunker Systems. Only enable_supply_beacon needs a LIVE beacon (it's the
   // redemption of the call-in) and rolls the supply table (it IS the drop).
   // The rest just need a functional radio kept on hand — no beacon required.
   { key: "enable_supply_beacon", label: "Enable Supply Beacon", skill: "crafting", level: 5, station: "beacon", requires: "functional radio", inputs: { "supply beacon": 1, "functional radio": 1 }, output: { "cooked meat": 3, "cooked fish": 3, "cooked mushroom": 3, "meat stew": 1, "firewood": 5, "functional radio": 1 }, roll: "supply", xp: 50, timer: 30, category: "base" },
   { key: "craft_base_repair_kit", label: "Craft Base Repair Kit", skill: "crafting", level: 4, requires: "functional radio", inputs: { "scrap metal": 3, "copper wire": 1 }, output: "base repair kit", xp: 40, timer: 25, category: "base" },
   { key: "craft_external_antenna", label: "Craft External Antenna", skill: "crafting", level: 4, requires: "functional radio", inputs: { "copper wire": 2, "scrap metal": 2 }, output: "external antenna", xp: 40, timer: 25, category: "base" },
   { key: "craft_signal_amplifier", label: "Craft Signal Amplifier", skill: "crafting", level: 5, requires: "functional radio", inputs: { "copper wire": 3, "silver wire": 1 }, output: "signal amplifier", xp: 50, timer: 30, category: "base" },
   { key: "craft_sentry_turret", label: "Craft Sentry Turret", skill: "crafting", level: 6, requires: "functional radio", inputs: { "scrap metal": 5, "copper wire": 2, "silver wire": 1 }, output: "sentry turret", xp: 60, timer: 35, category: "base" },
   { key: "craft_storage_locker", label: "Craft Storage Locker", skill: "crafting", level: 5, requires: "functional radio", inputs: { "scrap metal": 4, "copper wire": 2 }, output: "storage locker", xp: 50, timer: 30, category: "base" },
   { key: "craft_supply_beacon", label: "Craft Supply Beacon", skill: "crafting", level: 7, requires: "functional radio", inputs: { "scrap metal": 6, "copper wire": 3, "silver wire": 2 }, output: "supply beacon", xp: 70, timer: 40, category: "base" },
   // Forge work — the player's own forge at the Mountains (fire_forge), not Town
   // -- Crafting (raw -> usable)
   { key: "craft_firewood", label: "Craft Firewood", skill: "crafting", level: 1, station: "forge", section: "Ingredients", inputs: { "wood log": 1 }, output: "firewood", xp: 5, timer: 10, category: "misc" },
   { key: "craft_copper_wire", label: "Craft Copper Wire", skill: "crafting", level: 2, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "copper bar": 1 }, output: {"copper wire": 5 }, xp: 10, timer: 15, category: "metal", metal: "copper", metalType: "crafting" },
   { key: "craft_tin_wire", label: "Craft Tin Wire", skill: "crafting", level: 2, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "tin bar": 1 }, output: { "tin wire": 5 }, xp: 10, timer: 15, category: "metal", metal: "tin", metalType: "crafting" },
   { key: "craft_tin_plate", label: "Craft Tin Plate", skill: "crafting", level: 3, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "tin bar": 1 }, output: "tin plate", xp: 15, timer: 20, category: "metal", metal: "tin", metalType: "crafting" },
   { key: "craft_tin_foil", label: "Craft Tin Foil", skill: "crafting", level: 4, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "tin plate": 1 }, output: { "tin foil": 5 }, xp: 20, timer: 25, category: "metal", metal: "tin", metalType: "crafting" },
   { key: "craft_silver_wire", label: "Craft Silver Wire", skill: "crafting", level: 3, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "silver bar": 1 }, output: { "silver wire": 5 }, xp: 15, timer: 20, category: "metal", metal: "silver", metalType: "crafting" },
   { key: "craft_gold_wire", label: "Craft Gold Wire", skill: "crafting", level: 4, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "gold bar": 1 }, output: { "gold wire": 5 }, xp: 20, timer: 25, category: "metal", metal: "gold", metalType: "crafting" },
   { key: "craft_syllic_wire", label: "Craft Syllic Wire", skill: "crafting", level: 5, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "syllic bar": 1 }, output: "syllic wire", xp: 25, timer: 30, category: "metal", metal: "syllic", metalType: "crafting" },
   { key: "craft_cobalt_shard", label: "Craft Cobalt Shard", skill: "crafting", level: 5, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "cobalt ore": 1, "copper bar": 1 }, output: { "cobalt shard": 10 }, xp: 30, timer: 35, category: "metal", metal: "cobalt", metalType: "crafting" },
   { key: "craft_cobalt_funnel", label: "Craft Cobalt Funnel", skill: "crafting", level: 6, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "cobalt shard": 6, "cobalt bar": 1, "copper bar": 1 }, output: "cobalt funnel", xp: 35, timer: 40, category: "metal", metal: "cobalt", metalType: "crafting" },
   // -- Smelting (ore -> bar)
   { key: "smelt_copper",  label: "Smelt Copper",  skill: "smithing", level: 1, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "copper ore": 2, "firewood": 1 }, output: "copper bar", xp: 15, timer: 20, category: "metal", metal: "copper", metalType: "crafting" },
   { key: "smelt_bronze",  label: "Smelt Bronze",  skill: "smithing", level: 1, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "copper bar": 1, "tin bar": 1 },   output: "bronze bar", xp: 18, timer: 22, category: "metal", metal: "bronze", metalType: "crafting" },
   { key: "smelt_iron",    label: "Smelt Iron",    skill: "smithing", level: 5, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron ore": 2, "firewood": 2 },   output: "iron bar",   xp: 25, timer: 30, category: "metal", metal: "iron", metalType: "crafting" },
   { key: "smelt_tin",     label: "Smelt Tin",     skill: "smithing", level: 2, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "tin ore": 2, "firewood": 1 },    output: "tin bar",    xp: 15, timer: 20, category: "metal", metal: "tin", metalType: "crafting" },
   { key: "smelt_silver",  label: "Smelt Silver",  skill: "smithing", level: 4, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver ore": 2, "firewood": 2 }, output: "silver bar", xp: 20, timer: 25, category: "metal", metal: "silver", metalType: "crafting" },
   { key: "smelt_gold",    label: "Smelt Gold",    skill: "smithing", level: 5, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold ore": 2, "firewood": 3 },   output: "gold bar",   xp: 30, timer: 35, category: "metal", metal: "gold", metalType: "crafting" },
   { key: "smelt_mythril",  label: "Smelt Mythril",  skill: "smithing", level: 6, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril ore": 2, "firewood": 4 }, output: "mythril bar", xp: 40, timer: 45, category: "metal", metal: "mythril", metalType: "crafting" },
   { key: "smelt_adamantite", label: "Smelt Adamantite", skill: "smithing", level: 7, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite ore": 2, "firewood": 5 }, output: "adamantite bar", xp: 50, timer: 50, category: "metal", metal: "adamantite", metalType: "crafting" },
   { key: "smelt_syllic",    label: "Smelt Syllic",    skill: "smithing", level: 8, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic ore": 2, "firewood": 6 }, output: "syllic bar", xp: 60, timer: 55, category: "metal", metal: "syllic", metalType: "crafting" },
   { key: "smelt_syllic_plate", label: "Smelt Syllic Plate", skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 2, "mythril bar": 1, "firewood": 6 }, output: "syllic plate", xp: 70, timer: 60, category: "metal", metal: "syllic", metalType: "crafting" },
   // -- Smithging (bars -> tools, consumables, trade goods)
   // -- - Tools (bars -> tools)
   // -- - - Axes
   { key: "smith_axe",       label: "Smith Axe",      skill: "smithing", level: 3, station: "forge", section: "Tools", requires: "hammer", inputs: { "iron bar": 1, "firewood": 1 }, output: "axe",          xp: 20, timer: 25, category: "misc" },
   { key: "smith_iron_axe",   label: "Smith Iron Axe", skill: "smithing", level: 4, station: "forge", section: "Tools", requires: "hammer", inputs: { "iron bar": 1, "firewood": 1 }, output: "iron axe",     xp: 25, timer: 30, category: "metal", metal: "iron", metalType: "tools" },
   { key: "smith_silver_axe", label: "Smith Silver Axe", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "silver bar": 1, "firewood": 1 }, output: "silver axe",   xp: 30, timer: 35, category: "metal", metal: "silver", metalType: "tools" },
   { key: "smith_gold_axe",   label: "Smith Gold Axe", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "gold bar": 1, "firewood": 1 }, output: "gold axe",     xp: 35, timer: 40, category: "metal", metal: "gold", metalType: "tools" },
   { key: "smith_mythril_axe", label: "Smith Mythril Axe", skill: "smithing", level: 6, station: "forge", section: "Tools", requires: "hammer", inputs: { "mythril bar": 1, "firewood": 1 }, output: "mythril axe", xp: 40, timer: 45, category: "metal", metal: "mythril", metalType: "tools" },
   { key: "smith_adamantite_axe", label: "Smith Adamantite Axe", skill: "smithing", level: 7, station: "forge", section: "Tools", requires: "hammer", inputs: { "adamantite bar": 1, "firewood": 1 }, output: "adamantite axe", xp: 50, timer: 50, category: "metal", metal: "adamantite", metalType: "tools" },
   { key: "smith_syllic_axe", label: "Smith Syllic Axe", skill: "smithing", level: 8, station: "forge", section: "Tools", requires: "hammer", inputs: { "syllic bar": 1, "firewood": 1 }, output: "syllic axe", xp: 60, timer: 55, category: "metal", metal: "syllic", metalType: "tools" },
   // -- - - Pickaxes
   { key: "smith_iron_pickaxe",   label: "Smith Iron Pickaxe",  skill: "smithing", level: 4, station: "forge", section: "Tools", requires: "hammer", inputs: { "iron bar": 1, "firewood": 1 }, output: "iron pickaxe", xp: 25, timer: 30, category: "metal", metal: "iron", metalType: "tools" },
   { key: "smith_silver_pickaxe", label: "Smith Silver Pickaxe", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "silver bar": 1, "firewood": 1 }, output: "silver pickaxe", xp: 30, timer: 35, category: "metal", metal: "silver", metalType: "tools" },
   { key: "smith_gold_pickaxe",   label: "Smith Gold Pickaxe",   skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "gold bar": 1, "firewood": 1 }, output: "gold pickaxe", xp: 35, timer: 40, category: "metal", metal: "gold", metalType: "tools" },
   { key: "smith_mythril_pickaxe", label: "Smith Mythril Pickaxe", skill: "smithing", level: 6, station: "forge", section: "Tools", requires: "hammer", inputs: { "mythril bar": 1, "firewood": 1 }, output: "mythril pickaxe", xp: 40, timer: 45, category: "metal", metal: "mythril", metalType: "tools" },
   { key: "smith_adamantite_pickaxe", label: "Smith Adamantite Pickaxe", skill: "smithing", level: 7, station: "forge", section: "Tools", requires: "hammer", inputs: { "adamantite bar": 1, "firewood": 1 }, output: "adamantite pickaxe", xp: 50, timer: 50, category: "metal", metal: "adamantite", metalType: "tools" },
   { key: "smith_syllic_pickaxe", label: "Smith Syllic Pickaxe", skill: "smithing", level: 8, station: "forge", section: "Tools", requires: "hammer", inputs: { "syllic bar": 1, "firewood": 1 }, output: "syllic pickaxe", xp: 60, timer: 55, category: "metal", metal: "syllic", metalType: "tools" },
   // -- - - Guns
   { key: "smith_rifle", label: "Smith Rifle", skill: "smithing", level: 5, station: "forge", section: "Guns", requires: "hammer", inputs: { "iron bar": 15, "cobalt bar": 5, "tin wire": 5, "firewood": 4 }, output: "Rifle", xp: 35, timer: 40, category: "misc" },
   { key: "smith_shotgun", label: "Smith Shotgun", skill: "smithing", level: 6, station: "forge", section: "Guns", requires: "hammer", inputs: { "iron bar": 20, "cobalt bar": 10, "tin wire": 10, "firewood": 5 }, output: "Shotgun", xp: 45, timer: 50, category: "misc" },
   { key: "smith_burstrifle", label: "Smith Burst Rifle", skill: "smithing", level: 7, station: "forge", section: "Guns", requires: "hammer", inputs: { "iron bar": 15, "cobalt bar": 5, "mythril bar": 10, "tin wire": 15, "firewood": 6 }, output: "Burst Rifle", xp: 55, timer: 60, category: "misc" },
   // -- - - Molds (bars -> molds)
   { key: "smith_star_mold", label: "Smith Star Mold", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "cobalt bar": 2, "firewood": 3 }, output: "cobalt mold star", xp: 30, timer: 35, category: "metal", metal: "cobalt", metalType: "tools" },
   { key: "smith_circle_mold", label: "Smith Circle Mold", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "cobalt bar": 2, "firewood": 3 }, output: "cobalt mold circ", xp: 30, timer: 35, category: "metal", metal: "cobalt", metalType: "tools" },
   { key: "smith_line_mold", label: "Smith Line Mold", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "cobalt bar": 2, "firewood": 3 }, output: "cobalt mold line", xp: 30, timer: 35, category: "metal", metal: "cobalt", metalType: "tools" },
   { key: "smith_target_mold", label: "Smith Target Mold", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "cobalt bar": 2, "firewood": 3 }, output: "cobalt mold trgt", xp: 30, timer: 35, category: "metal", metal: "cobalt", metalType: "tools" },
   { key: "smith_large_square_mold", label: "Smith Large Square Mold", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "cobalt bar": 5, "firewood": 10 }, output: "cobalt mold l squar", xp: 30, timer: 35, category: "metal", metal: "cobalt", metalType: "tools" },
   { key: "smith_large_sign_mold", label: "Smith Large Sign Mold", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "cobalt bar": 5, "firewood": 10 }, output: "cobalt mold l sign", xp: 30, timer: 35, category: "metal", metal: "cobalt", metalType: "tools" },
   { key: "smith_large_insignia_mold", label: "Smith Large Insignia Mold", skill: "smithing", level: 5, station: "forge", section: "Tools", requires: "hammer", inputs: { "cobalt bar": 5, "firewood": 10 }, output: "cobalt mold l insg", xp: 30, timer: 35, category: "metal", metal: "cobalt", metalType: "tools" },
   // -- Armor (bars -> armor) — one recipe per paperdoll piece per tier.
   // Material cost scales by piece "weight": head/boots/hands (weight 1) cost
   // one bar; torso/legs/shield (weight 2, more material) cost two — or for
   // the split tiers (gold-and-silver, syllic) one of the base bar plus one of
   // the secondary/heavy component, mirroring the old whole-suit recipes' 2:1
   // material ratios. xp/timer scale with weight too. Numbers are a starting
   // baseline, easy to retune later.
   // Bronze
   { key: "smith_bronze_head",   label: "Smith Bronze Helm",       skill: "smithing", level: 2, station: "forge", section: "Bronze", requires: "hammer", inputs: { "bronze bar": 1 }, output: "bronze helm",       xp: 10, timer: 15, category: "metal", metal: "bronze", metalType: "armor" },
   { key: "smith_bronze_torso",  label: "Smith Bronze Chestplate", skill: "smithing", level: 2, station: "forge", section: "Bronze", requires: "hammer", inputs: { "bronze bar": 2 }, output: "bronze chestplate", xp: 18, timer: 22, category: "metal", metal: "bronze", metalType: "armor" },
   { key: "smith_bronze_legs",   label: "Smith Bronze Platelegs",  skill: "smithing", level: 2, station: "forge", section: "Bronze", requires: "hammer", inputs: { "bronze bar": 2 }, output: "bronze platelegs", xp: 18, timer: 22, category: "metal", metal: "bronze", metalType: "armor" },
   { key: "smith_bronze_boots",  label: "Smith Bronze Boots",      skill: "smithing", level: 2, station: "forge", section: "Bronze", requires: "hammer", inputs: { "bronze bar": 1 }, output: "bronze boots",     xp: 10, timer: 15, category: "metal", metal: "bronze", metalType: "armor" },
   { key: "smith_bronze_hands",  label: "Smith Bronze Gauntlets",  skill: "smithing", level: 2, station: "forge", section: "Bronze", requires: "hammer", inputs: { "bronze bar": 1 }, output: "bronze gauntlets", xp: 10, timer: 15, category: "metal", metal: "bronze", metalType: "armor" },
   { key: "smith_bronze_shield", label: "Smith Bronze Shield",     skill: "smithing", level: 2, station: "forge", section: "Bronze", requires: "hammer", inputs: { "bronze bar": 2 }, output: "bronze shield",    xp: 18, timer: 22, category: "metal", metal: "bronze", metalType: "armor" },
   // Iron
   { key: "smith_iron_head",   label: "Smith Iron Helm",       skill: "smithing", level: 4, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron bar": 1 }, output: "iron helm",       xp: 15, timer: 20, category: "metal", metal: "iron", metalType: "armor" },
   { key: "smith_iron_torso",  label: "Smith Iron Chestplate", skill: "smithing", level: 4, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron bar": 2 }, output: "iron chestplate", xp: 25, timer: 28, category: "metal", metal: "iron", metalType: "armor" },
   { key: "smith_iron_legs",   label: "Smith Iron Platelegs",  skill: "smithing", level: 4, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron bar": 2 }, output: "iron platelegs", xp: 25, timer: 28, category: "metal", metal: "iron", metalType: "armor" },
   { key: "smith_iron_boots",  label: "Smith Iron Boots",      skill: "smithing", level: 4, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron bar": 1 }, output: "iron boots",     xp: 15, timer: 20, category: "metal", metal: "iron", metalType: "armor" },
   { key: "smith_iron_hands",  label: "Smith Iron Gauntlets",  skill: "smithing", level: 4, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron bar": 1 }, output: "iron gauntlets", xp: 15, timer: 20, category: "metal", metal: "iron", metalType: "armor" },
   { key: "smith_iron_shield", label: "Smith Iron Shield",     skill: "smithing", level: 4, station: "forge", section: "Iron", requires: "hammer", inputs: { "iron bar": 2 }, output: "iron shield",    xp: 25, timer: 28, category: "metal", metal: "iron", metalType: "armor" },
   // Silver
   { key: "smith_silver_head",   label: "Smith Silver Helm",       skill: "smithing", level: 5, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver bar": 1 }, output: "silver helm",       xp: 20, timer: 25, category: "metal", metal: "silver", metalType: "armor" },
   { key: "smith_silver_torso",  label: "Smith Silver Chestplate", skill: "smithing", level: 5, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver bar": 2 }, output: "silver chestplate", xp: 30, timer: 32, category: "metal", metal: "silver", metalType: "armor" },
   { key: "smith_silver_legs",   label: "Smith Silver Platelegs",  skill: "smithing", level: 5, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver bar": 2 }, output: "silver platelegs", xp: 30, timer: 32, category: "metal", metal: "silver", metalType: "armor" },
   { key: "smith_silver_boots",  label: "Smith Silver Boots",      skill: "smithing", level: 5, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver bar": 1 }, output: "silver boots",     xp: 20, timer: 25, category: "metal", metal: "silver", metalType: "armor" },
   { key: "smith_silver_hands",  label: "Smith Silver Gauntlets",  skill: "smithing", level: 5, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver bar": 1 }, output: "silver gauntlets", xp: 20, timer: 25, category: "metal", metal: "silver", metalType: "armor" },
   { key: "smith_silver_shield", label: "Smith Silver Shield",     skill: "smithing", level: 5, station: "forge", section: "Silver", requires: "hammer", inputs: { "silver bar": 2 }, output: "silver shield",    xp: 30, timer: 32, category: "metal", metal: "silver", metalType: "armor" },
   // Gold
   { key: "smith_gold_head",   label: "Smith Gold Helm",       skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1 }, output: "gold helm",       xp: 25, timer: 28, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_torso",  label: "Smith Gold Chestplate", skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 2 }, output: "gold chestplate", xp: 38, timer: 35, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_legs",   label: "Smith Gold Platelegs",  skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 2 }, output: "gold platelegs", xp: 38, timer: 35, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_boots",  label: "Smith Gold Boots",      skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1 }, output: "gold boots",     xp: 25, timer: 28, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_hands",  label: "Smith Gold Gauntlets",  skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1 }, output: "gold gauntlets", xp: 25, timer: 28, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_shield", label: "Smith Gold Shield",     skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 2 }, output: "gold shield",    xp: 38, timer: 35, category: "metal", metal: "gold", metalType: "armor" },
   // Gold and Silver (weight-2 pieces split 1 gold + 1 silver, mirroring the old whole-suit's 2:1 ratio)
   { key: "smith_gold_and_silver_head",   label: "Smith Gold and Silver Helm",       skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1 }, output: "gold and silver helm",       xp: 28, timer: 30, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_and_silver_torso",  label: "Smith Gold and Silver Chestplate", skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1, "silver bar": 1 }, output: "gold and silver chestplate", xp: 42, timer: 38, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_and_silver_legs",   label: "Smith Gold and Silver Platelegs",  skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1, "silver bar": 1 }, output: "gold and silver platelegs", xp: 42, timer: 38, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_and_silver_boots",  label: "Smith Gold and Silver Boots",      skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1 }, output: "gold and silver boots",       xp: 28, timer: 30, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_and_silver_hands",  label: "Smith Gold and Silver Gauntlets",  skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1 }, output: "gold and silver gauntlets",   xp: 28, timer: 30, category: "metal", metal: "gold", metalType: "armor" },
   { key: "smith_gold_and_silver_shield", label: "Smith Gold and Silver Shield",     skill: "smithing", level: 6, station: "forge", section: "Gold", requires: "hammer", inputs: { "gold bar": 1, "silver bar": 1 }, output: "gold and silver shield",   xp: 42, timer: 38, category: "metal", metal: "gold", metalType: "armor" },
   // Mythril
   { key: "smith_mythril_head",   label: "Smith Mythril Helm",       skill: "smithing", level: 7, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril bar": 1 }, output: "mythril helm",       xp: 32, timer: 33, category: "metal", metal: "mythril", metalType: "armor" },
   { key: "smith_mythril_torso",  label: "Smith Mythril Chestplate", skill: "smithing", level: 7, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril bar": 2 }, output: "mythril chestplate", xp: 48, timer: 40, category: "metal", metal: "mythril", metalType: "armor" },
   { key: "smith_mythril_legs",   label: "Smith Mythril Platelegs",  skill: "smithing", level: 7, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril bar": 2 }, output: "mythril platelegs", xp: 48, timer: 40, category: "metal", metal: "mythril", metalType: "armor" },
   { key: "smith_mythril_boots",  label: "Smith Mythril Boots",      skill: "smithing", level: 7, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril bar": 1 }, output: "mythril boots",     xp: 32, timer: 33, category: "metal", metal: "mythril", metalType: "armor" },
   { key: "smith_mythril_hands",  label: "Smith Mythril Gauntlets",  skill: "smithing", level: 7, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril bar": 1 }, output: "mythril gauntlets", xp: 32, timer: 33, category: "metal", metal: "mythril", metalType: "armor" },
   { key: "smith_mythril_shield", label: "Smith Mythril Shield",     skill: "smithing", level: 7, station: "forge", section: "Mythril", requires: "hammer", inputs: { "mythril bar": 2 }, output: "mythril shield",    xp: 48, timer: 40, category: "metal", metal: "mythril", metalType: "armor" },
   // Adamantite
   { key: "smith_adamantite_head",   label: "Smith Adamantite Helm",       skill: "smithing", level: 8, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite bar": 1 }, output: "adamantite helm",       xp: 38, timer: 38, category: "metal", metal: "adamantite", metalType: "armor" },
   { key: "smith_adamantite_torso",  label: "Smith Adamantite Chestplate", skill: "smithing", level: 8, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite bar": 2 }, output: "adamantite chestplate", xp: 55, timer: 45, category: "metal", metal: "adamantite", metalType: "armor" },
   { key: "smith_adamantite_legs",   label: "Smith Adamantite Platelegs",  skill: "smithing", level: 8, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite bar": 2 }, output: "adamantite platelegs", xp: 55, timer: 45, category: "metal", metal: "adamantite", metalType: "armor" },
   { key: "smith_adamantite_boots",  label: "Smith Adamantite Boots",      skill: "smithing", level: 8, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite bar": 1 }, output: "adamantite boots",     xp: 38, timer: 38, category: "metal", metal: "adamantite", metalType: "armor" },
   { key: "smith_adamantite_hands",  label: "Smith Adamantite Gauntlets",  skill: "smithing", level: 8, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite bar": 1 }, output: "adamantite gauntlets", xp: 38, timer: 38, category: "metal", metal: "adamantite", metalType: "armor" },
   { key: "smith_adamantite_shield", label: "Smith Adamantite Shield",     skill: "smithing", level: 8, station: "forge", section: "Adamantite", requires: "hammer", inputs: { "adamantite bar": 2 }, output: "adamantite shield",    xp: 55, timer: 45, category: "metal", metal: "adamantite", metalType: "armor" },
   // Syllic (weight-2 pieces additionally need 1 syllic plate, mirroring the old whole-suit recipe's flavor)
   { key: "smith_syllic_head",   label: "Smith Syllic Helm",       skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 1 }, output: "syllic helm",       xp: 45, timer: 42, category: "metal", metal: "syllic", metalType: "armor" },
   { key: "smith_syllic_torso",  label: "Smith Syllic Chestplate", skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 1, "syllic plate": 1 }, output: "syllic chestplate", xp: 65, timer: 50, category: "metal", metal: "syllic", metalType: "armor" },
   { key: "smith_syllic_legs",   label: "Smith Syllic Platelegs",  skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 1, "syllic plate": 1 }, output: "syllic platelegs", xp: 65, timer: 50, category: "metal", metal: "syllic", metalType: "armor" },
   { key: "smith_syllic_boots",  label: "Smith Syllic Boots",      skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 1 }, output: "syllic boots",     xp: 45, timer: 42, category: "metal", metal: "syllic", metalType: "armor" },
   { key: "smith_syllic_hands",  label: "Smith Syllic Gauntlets",  skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 1 }, output: "syllic gauntlets", xp: 45, timer: 42, category: "metal", metal: "syllic", metalType: "armor" },
   { key: "smith_syllic_shield", label: "Smith Syllic Shield",     skill: "smithing", level: 9, station: "forge", section: "Syllic", requires: "hammer", inputs: { "syllic bar": 1, "syllic plate": 1 }, output: "syllic shield",    xp: 65, timer: 50, category: "metal", metal: "syllic", metalType: "armor" },
   // -- Alchemy (bars + herbs -> potions)
   { key: "brew_healing_potion", label: "Brew Healing Potion", skill: "alchemy", level: 2, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "swamp herb": 1, "copper bar": 1 }, output: "healing potion", xp: 15, timer: 20, category: "potion" },
   { key: "brew_shield_potion",  label: "Brew Shield Potion",  skill: "alchemy", level: 3, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "swamp herb": 1, "silver bar": 1 }, output: "shield potion", xp: 20, timer: 25, category: "potion" },
   // -- Crafting (bars + herbs + other inputs -> consumables, trade goods)
   { key: "gun_oil",       label: "Make Gun Oil",  skill: "crafting", level: 3, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "scrap metal": 1, "swamp herb": 1 }, output: "gun oil", xp: 10, timer: 15, category: "misc" },
   { key: "crude_blade",   label: "Make Crude Blade", skill: "smithing", level: 3, station: "forge", section: "Tools", requires: "hammer", inputs: { "scrap metal": 2, "firewood": 1 }, output: "crude blade", xp: 20, timer: 25, category: "misc" },
   { key: "fishing_rod",   label: "Make Fishing Rod", skill: "crafting", level: 2, station: "forge", section: "Tools", requires: "hammer", inputs: { "wood log": 1, "swamp herb": 1 }, output: "fishing rod", xp: 12, timer: 20, category: "misc" },
   { key: "magic_amulet",    label: "Make Magic Amulet", skill: "crafting", level: 5, station: "forge", section: "Ingredients", requires: "hammer", inputs: { "mana shard": 1, "silver bar": 1, "coal": 3, "gold ore": 2 }, output: "magic amulet", xp: 30, timer: 40, category: "magic" },
 
 ];
 