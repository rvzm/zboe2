// quest-backbone.js
// Quest Bacbone for zboe2

export const QUEST_NAMES = ["basic_training", "space_invader", "resupply", "first_horde", "first_raid", "can_you_hear_me", "drop_it", "defense_up", "getting_started" ];

// Quest definitions: each quest has a name, description, and a set of objectives.
export const QUESTS = {
  "getting_started": {
    name: "Getting Started",
    desc: "Learn the basics of surviving in the world.",
    long_desc: "Learn the basics of surviving in the world. This quest guides you through learning a spell, acquiring essential items, and preparing for future challenges.",
    quest_level: 1,
    reward: { gold: 100, xp: 50, grant_instant_level: true },
    starter: { starter: true },
    objectives: [
      { type: "learn_spell", spell: "teleport", qty: 1 },
      { type: "acquire_item", item: "firewood", qty: 5 },
    ],
  },
  "basic_training": {
    name: "Basic Training",
    desc: "Learn the basics of surviving in the world.",
    long_desc: "Learn the basics of surviving in the world. This quest guided you through learning a spell, acquiring essential items, and preparing for future challenges.",
    quest_level: 1,
    reward: { gold: 100, xp: 50 },
    starter: { enter_location: "basecamp_inside" },
    objectives: [
      { type: "learn_spell", spell: "teleport", qty: 1 },
      { type: "acquire_item", item: "firewood", qty: 5 },
      { type: "acquire_item", item: "glowcap", qty: 3 },
      { type: "acquire_item", item: "mana shard", qty: 2 },
    ],
  },
  "space_invader": {
    name: "Space Invader",
    desc: "Acquire a Storage Locker to store your items safely.",
    long_desc: "Acquire a Storage Locker to store your items safely. This quest guides you through the process of obtaining a Storage Locker, which is essential for managing your inventory and keeping your items secure.",
    quest_level: 2,
    reward: { gold: 200, xp: 100 },
    starter: { enter_location: "bunker" },
    objectives: [
      { type: "acquire_item", item: "storage locker", qty: 1 },
    ],
  },
  "first_horde": {
    name: "First Horde",
    desc: "Break your first zombie horde.",
    starter: { starter: true },
    reward: { gold: 300, xp: 150 },
    objectives: [
        { type: "break_horde", qty: 1 },
    ],
  }, 
  "first_raid": {
    name: "First Raid",
    desc: "Clear your first zombie raid.",
    reward: { gold: 400, xp: 200 },
    starter: { starter: true },
    objectives: [
      { type: "clear_raid", qty: 1 },
    ],
  },
  // Can You Hear Me? This chain of quests is designed to guide the player through the process of using a Functional Radio Call
  // to request a supply drop, and then using a Supply Beacon to call in supplies. The player will also learn how to use a 
  // Sentry Turret to defend their base, and finally use the Radio to call for help during a critical situation.
  "resupply": {
    // Basic
    name: "Resupply",
    desc: "Use a Supply Beacon to call in supplies.",
    long_desc: "Use a Supply Beacon to call in supplies. This quest guides you through the process of using a Supply Beacon, which allows you to call in essential supplies to aid in your survival.",
    quest_level: 4,
    starter: { type: "action", action: "repair_radio" },
    reward: { gold: 150, xp: 75 },
    objectives: [
      { type: "action", action: "activate_supply_beacon", qty: 1 },
    ],
  },  
  "can_you_hear_me": {
    name: "Can You Hear Me?",
    desc: "Use a Functional Radio Call for a supply drop.",
    reward: { gold: 250, xp: 125 },
    starter: { quest: "resupply" },
    objectives: [
      { type: "action", action: "attempt_supply_beacon", qty: 1 },
    ],
  },
  "drop_it": {
    name: "Drop It",
    desc: "Use a Supply Beacon to call in supplies.",
    reward: { gold: 150, xp: 75, items: { "supply drop": 1 }, grant_instant_level: true },
    starter: { quest: "can_you_hear_me" },
    objectives: [
        { type: "recipe", recipe: "enable_supply_beacon", qty: 1 },
    ],
},

  "defense_up": {
    name: "Defense Up",
    desc: "Use a Sentry Turret to defend your base.",
    reward: { gold: 350, xp: 175 },
    starter: { enter_location: "forest" },
    objectives: [
        { type: "use_item", item: "sentry turret", qty: 1 },
    ],
  },
  
};


export const QUEST_OBJECTIVE_TYPES = ["action", "recipe", "use_item", "learn_spell", "break_horde", "clear_raid", "acquire_item"];
export const QUEST_REWARDS = {
    "gold": { give: "gold" },
    "tokens": { give: "tokens" },
    "xp": { give: "xp" },
    "items": { give: "items" },
    "level_up": { grant_instant_level: true },
}

export const QUEST_REWARD_EXPORTER = {
  "gold": (player, qty) => { player.gold += qty; },
  "tokens": (player, qty) => { player.tokens += qty; },
  "xp": (player, qty) => { player.xp += qty; },
  "items": (player, items) => {
    for (const [item, qty] of Object.entries(items)) {
      if (!player.items[item]) player.items[item] = 0;
      player.items[item] += qty;
    }
  },
  "grant_instant_level": (player) => { player.level += 1; },
};
export const QUEST_PROGRESS_HOOK = {
    // Hook for quest progress tracking. Each objective type has a corresponding function that checks if the player has completed the objective.
    "action": (player, objective) => {
        // Check if the player has performed the required action.
        return player.actionsPerformed && player.actionsPerformed.includes(objective.action);
    },
    "recipe": (player, objective) => {
        // Check if the player has crafted the required recipe.
        return player.recipesCrafted && player.recipesCrafted.includes(objective.recipe);
    },
    "use_item": (player, objective) => {
        // Check if the player has used the required item.
        return player.itemsUsed && player.itemsUsed.includes(objective.item);
    },
    "learn_spell": (player, objective) => {
        // Check if the player has learned the required spell.
        return player.spellsLearned && player.spellsLearned.includes(objective.spell);
    },
    "break_horde": (player, objective) => {
        // Check if the player has broken the required number of hordes.
        return player.hordesBroken && player.hordesBroken >= objective.qty;
    },
    "clear_raid": (player, objective) => {
        // Check if the player has cleared the required number of raids.
        return player.raidsCleared && player.raidsCleared >= objective.qty;
    },
    "acquire_item": (player, objective) => {
        // Check if the player has acquired the required quantity of the item.
        return player.items && player.items[objective.item] >= objective.qty;
    },

}
export const QUEST_STARTER_HOOK = {
    // Hook for quest starter conditions. Each starter type has a corresponding function that checks if the player meets the conditions to start the quest.
    "starter": (player, quest) => {
        // Check if the player is a new player or has completed the previous quest in the chain.
        return player.isNewPlayer || (quest.prevQuest && player.completedQuests && player.completedQuests.includes(quest.prevQuest));
    },
    "enter_location": (player, quest) => {
        // Check if the player has entered the required location to start the quest.
        return player.currentLocation === quest.starter.enter_location;
    },
    "action": (player, quest) => {
        // Check if the player has performed the required action to start the quest.
        return player.actionsPerformed && player.actionsPerformed.includes(quest.starter.action);
    },
    "quest": (player, quest) => {
        // Check if the player has completed the required previous quest to start the quest.
        return player.completedQuests && player.completedQuests.includes(quest.starter.quest);
    },
}