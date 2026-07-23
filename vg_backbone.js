// vg_backbone.js
// Backbone for the Velvet Grove expansion: new locations, new encounters, new magic spells, etc.

export const ENCOUNTER_LOCATIONS = new Set([
  "velvet_grove",
  "rose_garden",
  "crystal_clearing",
  "ancient_ruins",
]);

export const ENCOUNTER_NAMES = {
    // Velvet Grove encounters
    // These are the various possible encounters that can trigger in the Velvet Grove expansion locations. 
    // Each encounter has a unique name, and some properties that define its behavior, such as the chance of
    // it occurring, the level of difficulty, and the rewards for completing it.
    "velvet_grove": {
        "mystic_fairy": { chance: 20, level: 1, reward: { gold: 50, xp: 10 }, combat: { hp: 30, attack: 5, acc: 75 } },
        "enchanted_stag": { chance: 15, level: 2, reward: { gold: 100, xp: 20 }, combat: { hp: 50, attack: 10, acc: 80 } },
        "forest_spirit": { chance: 10, level: 3, reward: { gold: 150, xp: 30 }, combat: { hp: 70, attack: 15, acc: 85 } },
    },
    "rose_garden": {
        "thorny_briar": { chance: 25, level: 1, reward: { gold: 30, xp: 5 }, combat: { hp: 20, attack: 3, acc: 70 } },
        "rose_guardian": { chance: 15, level: 2, reward: { gold: 80, xp: 15 }, combat: { hp: 40, attack: 8, acc: 75 } },
    },
    "crystal_clearing": {
        "crystal_golem": { chance: 20, level: 2, reward: { gold: 120, xp: 25 }, combat: { hp: 60, attack: 12, acc: 80 } },
        "shimmering_sprite": { chance: 10, level: 3, reward: { gold: 200, xp: 40 }, combat: { hp: 80, attack: 18, acc: 85 } },
    },
    "ancient_ruins": {
        "ruin_wraith": { chance: 15, level: 3, reward: { gold: 180, xp: 35 }, combat: { hp: 70, attack: 15, acc: 80 } },
        "ancient_guardian": { chance: 10, level: 4, reward: { gold: 250, xp: 50 }, combat: { hp: 100, attack: 20, acc: 85 } },
    }
};

export const ENCOUNTER_BOSSES = {
    // Boss encounters for the Velvet Grove expansion locations.
    // These are special encounters that occur less frequently than regular encounters, but offer greater rewards.
    "rose_garden": {
        "queen_of_roses": { chance: 5, level: 4, reward: { gold: 250, xp: 50 }, combat: { hp: 120, attack: 20, acc: 85 }, cooldown: 60 },
    },
    "crystal_clearing": {
        "crystal_dragon": { chance: 5, level: 5, reward: { gold: 400, xp: 80 }, combat: { hp: 200, attack: 30, acc: 90 }, cooldown: 60 },
    },
    "ancient_ruins": {
        "ruin_colossus": { chance: 5, level: 5, reward: { gold: 350, xp: 70 }, combat: { hp: 180, attack: 28, acc: 88 }, cooldown: 60 },
    }
};

export const LOCATION_ACTIONS = {
    // Actions that can be performed in the new locations of the Velvet Grove expansion.
    // Each action has a name, a description, and may have requirements or effects.
    "velvet_grove": {
        "dowse_ley_crystal": { desc: "Dowse for Ley Crystals.", reward: { items: { "ley_crystal": 1 } }, cooldown: 25, skill: "magic", skillLevel: 3, successRate: 60, xp: 15 },
        "harvest_velvet_antler": { desc: "Harvest Velvet Antler from the mystical stags.", reward: { items: { "velvet_antler": 1 } }, cooldown: 30, skill: "hunting", skillLevel: 2, successRate: 70, xp: 20 },
        "gather_glowcap": { desc: "Gather Glowcap mushrooms.", reward: { items: { "glowcap": 2 } }, cooldown: 20, skill: "foraging", skillLevel: 1, successRate: 80, xp: 10 },
    },
    "rose_garden": {
        "pick_rose_petals": { desc: "Pick Rose Petals from the enchanted roses.", reward: { items: { "rose_petals": 3 } }, cooldown: 15, skill: "foraging", skillLevel: 1, successRate: 85, xp: 10 },
        "tend_rose_bushes": { desc: "Tend to the magical rose bushes.", reward: { items: { "rose_petals": 15 } }, cooldown: 20, skill: "gardening", skillLevel: 2, successRate: 75, xp: 15 },
        "harvest_rose_essence": { desc: "Harvest Rose Essence from the roses.", reward: { items: { "rose_essence": 1 } }, cooldown: 25, skill: "alchemy", skillLevel: 3, successRate: 65, xp: 20 },
    },
    "crystal_clearing": {
        "chop_crystal_wood": { desc: "Chop Engorged Wood from the ancient trees.", reward: { items: { "engorged_wood": 1 } }, cooldown: 30, skill: "woodcutting", skillLevel: 2, successRate: 70, xp: 20 },
        "mine_glowing_crystal": { desc: "Mine Glowing Crystals from the crystal formations.", reward: { items: { "glowing_crystal": 1 } }, cooldown: 25, skill: "mining", skillLevel: 3, successRate: 65, xp: 25 },
        "study_crystal_formations": { desc: "Study the magical properties of the crystal formations.", reward: { items: { "ley_crystal": 1 } }, cooldown: 20, skill: "magic", skillLevel: 4, successRate: 60, xp: 30 },
        "collect_ley_crystals": { desc: "Collect Ley Crystals from the crystal formations.", reward: { items: { "ley_crystal": 1 } }, cooldown: 20, skill: "magic", skillLevel: 3, successRate: 75, xp: 15 }
    },
    "ancient_ruins": {
        "explore_ruins": { desc: "Explore the ancient ruins for hidden treasures.", reward: { items: { "ancient_artifact": 1 } }, cooldown: 40, skill: "exploration", skillLevel: 4, successRate: 60, xp: 30 },
        "study_ruins": { desc: "Study the ancient ruins for knowledge.", reward: { items: { "ancient_scroll": 1 } }, cooldown: 30, skill: "history", skillLevel: 3, successRate: 70, xp: 20 },
        "gather_ruin_stones": { desc: "Gather Ruin Stones from the ruins.", reward: { items: { "ruin_stone": 2 } }, cooldown: 25, skill: "foraging", skillLevel: 2, successRate: 75, xp: 15 },
    }
};

export const VG_SPELLS = {
    "velvet_detect": { name: "Velvet Detect", type: "aid", level: 3, desc: "Detect hidden objects and creatures in the Velvet Grove", cost: 20, xp: 10, effect: { hp_target: 0, buff: "velvet_detect" }, learn: { "glowcap": 2, "ley crystal": 1 } },
    "doublestrike": { name: "Double Strike", type: "aid", level: 4, desc: "Double the damage of your next attack", cost: 25, xp: 10, effect: { hp_target: 0, buff: "doublestrike" }, learn: { "glowcap": 2, "arcane dust": 1 } },
    "dissolve": { name: "Dissolve", type: "attack", level: 4, desc: "Dissolve your enemies with a corrosive spell", cost: 30, xp: 12, effect: { accuracy: 80, targets: 1, damage: 50 }, learn: { "glowcap": 3, "arcane dust": 2 } },
    "entangle": { name: "Entangle", type: "aid", level: 3, desc: "Entangle your enemies, reducing their movement", cost: 20, xp: 8, effect: { hp_target: 0, debuff: "entangled" }, learn: { "spirit bloom": 2, "mana shard": 1 } },
    "nature's wrath": { name: "Nature's Wrath", type: "attack", level: 5, desc: "Unleash the wrath of nature upon your foes", cost: 40, xp: 15, effect: { accuracy: 85, targets: 3, damage: 60 }, learn: { "ley crystal": 2, "mana shard": 3 } },
    "call_of_the_wild": { name: "Call of the Wild", type: "aid", level: 4, desc: "Summon a wild creature to aid you in battle", cost: 35, xp: 14, effect: { hp_target: 100, buff: "summoned_ally" }, learn: { "spirit bloom": 3, "ley crystal": 2 } },
    "firestorm": { name: "Firestorm", type: "attack", level: 5, desc: "Summon a storm of fire to burn your enemies", cost: 50, xp: 20, effect: { accuracy: 90, targets: 5, damage: 70, aoe: "firestorm" }, learn: { "glowcap": 4, "arcane dust": 3 } },
    "circle_of_protection": { name: "Circle of Protection", type: "aid", level: 4, desc: "Create a protective circle that reduces damage taken by allies", cost: 30, xp: 12, effect: { hp_target: 0, buff: "circle_of_protection" }, learn: { "ley crystal": 3, "mana shard": 2 } },
    "ice_shard": { name: "Ice Shard", type: "attack", level: 3, desc: "Launch a shard of ice that damages and slows enemies", cost: 25, xp: 10, effect: { accuracy: 85, targets: 3, damage: 40, aoe: "ice_shard" }, learn: { "spirit bloom": 2, "arcane dust": 1 } },
};

export const VG_SPELL_EFFECTS = {
    "buff": { 
        "summoned_ally": { duration: 30, effect: "Summoned ally fights for you" },
        "doublestrike": { duration: 15, effect: "Doubles the damage of target players next attack" },
     },
    "debuff": { 
        "entangled": { duration: 20, effect: "Entangled enemies have reduced movement" },
        "poisoned": { duration: 15, effect: "Poisoned enemies take damage over time" },
     },
     "aoe": {
        "firestorm": { radius: 5, damage: 40, effect: "Deals fire damage to all enemies in the area" },
        "ice_shard": { radius: 3, damage: 30, effect: "Deals ice damage and slows enemies in the area" },
        "circle_of_protection": { duration: 20, effect: "Reduces damage taken by allies in the area" },
     }
};

export const VG_ITEMS = {
    "velvet_antler": { name: "Velvet Antler", type: "material", level: 2, desc: "A rare antler from the Velvet Grove", cost: 50, xp: 10 },
    "rose_petals": { name: "Rose Petals", type: "material", level: 1, desc: "Petals from the Rose Garden", cost: 25, xp: 5 },
    "rose_essence": { name: "Rose Essence", type: "material", level: 3, desc: "Essence extracted from enchanted roses", cost: 75, xp: 15 },
    "glowing_crystal": { name: "Glowing Crystal", type: "material", level: 3, desc: "A crystal that glows with magical energy", cost: 75, xp: 15 },
    "engorged_wood": { name: "Engorged Wood", type: "material", level: 4, desc: "Wood from the ancient trees of the Velvet Grove", cost: 100, xp: 20 },
    "ancient_scroll": { name: "Ancient Scroll", type: "material", level: 4, desc: "A scroll containing ancient knowledge", cost: 100, xp: 20 },
    "ancient_artifact": { name: "Ancient Artifact", type: "material", level: 5, desc: "A mysterious artifact from the ancient ruins", cost: 150, xp: 30 },
    "ruin_stone": { name: "Ruin Stone", type: "material", level: 2, desc: "A stone from the ancient ruins", cost: 50, xp: 10 }, 

    
};


export const EXPANSION_VELVET_GROVE_EXPORTS = {
    ENCOUNTER_LOCATIONS,
    ENCOUNTER_NAMES,
    VG_SPELLS,
    VG_ITEMS,
    key: { version: "1.0.0", name: "Velvet Grove Expansion", description: "Adds new locations, encounters, and magic spells to the game." },
    "base_req": { zboe_version: "2.0.28-dev-rc" },
};