// magic.js — the spell registry (pure data + magic-only helpers, NO imports —
// same leaf-module convention as item_backbone.js).
//
// MAGIC_SPELLS fields:
//   name    display name
//   type    a SPELL_TYPES entry (must also exist in MAGIC_SPELL_CATEGORIES,
//           which drives the Magic Table's category tabs)
//   level   minimum Magic skill level to cast (and to learn)
//   desc    flavor/description shown in the UI
//   cost    mana spent per cast
//   xp      Magic skill XP granted per cast (win or miss)
//   effect  type-shaped: attack { accuracy, targets } / armor { ap } /
//           heal { hp } / aid { hp_target } / travel { loc — a
//           LOCATION_NAMES key }
//   starter true = known from account creation (re-granted on death) — see
//           STARTER_SPELLS below. Mutually exclusive with `learn`.
//   learn   { item: qty } — ingredients consumed learning it at the Magic
//           Table in Town (POST /api/spell/learn). Every non-starter spell
//           must have one (boot-checked).
export const MAGIC_SPELLS = {
    "magic missle":      { name: "Magic Missle",     type: "attack",     level: 1,     desc: "A missle of magic",                                cost: 5,   xp: 3,  effect: { accuracy: 75, targets: 1 }, starter: true },
    "fireball":          { name: "Fireball",         type: "attack",     level: 2,     desc: "A blast of Fire",                                  cost: 10,  xp: 5,  effect: { accuracy: 90, targets: 5 }, learn: { "mana shard": 1, "arcane dust": 2 } },
    "oak skin":          { name: "Oak Skin",         type: "armor",      level: 5,     desc: "Harden your skin, like oak",                       cost: 20,  xp: 8,  effect: { ap: 75 },                   learn: { "glowcap": 3, "arcane dust": 1 } },
    "heal":              { name: "Heal",             type: "heal",       level: 2,     desc: "Restore some health",                              cost: 15,  xp: 5,  effect: { hp: 50 },                   learn: { "spirit bloom": 1, "glowcap": 2 } },
    "cure":              { name: "Cure",             type: "heal",       level: 3,     desc: "Restore a lot of health",                          cost: 25,  xp: 8,  effect: { hp: 100 },                  learn: { "spirit bloom": 2, "mana shard": 1 } },
    "healing touch":     { name: "Healing Touch",    type: "aid",        level: 5,     desc: "Restore a lot of health to you or another player", cost: 30,  xp: 10, effect: { hp_target: 150 },           learn: { "spirit bloom": 3, "ley crystal": 1 } },
    "teleport":          { name: "Base Teleport",    type: "travel",     level: 1,     desc: "Teleport back to base (inside)",                   cost: 10,  xp: 3,  effect: { loc: "basecamp_inside" },   learn: { "ley crystal": 1, "mana shard": 2 } },
};

// Category tabs for the Magic Table's learn menu — keys match spell `type`.
export const MAGIC_SPELL_CATEGORIES = {
    "attack": { name: "Attack Spells",  desc: "Spells that deal damage to enemies." },
    "armor":  { name: "Armor Spells",   desc: "Spells that provide temporary armor." },
    "heal":   { name: "Healing Spells", desc: "Spells that restore health." },
    "aid":    { name: "Aid Spells",     desc: "Spells that provide temporary buffs or assistance." },
    "travel": { name: "Travel Spells",  desc: "Spells that allow teleportation to specific locations." },
};

// Spells flagged `starter: true` — granted by db.js on account creation and
// after every death reset (and backfilled at boot for pre-existing players).
export const STARTER_SPELLS = Object.entries(MAGIC_SPELLS)
  .filter(([, s]) => s.starter)
  .map(([key]) => key);

// ===== Magic Backbone =====
// Magic-system helpers that only server.js's spell-casting code needs — kept
// out of db.js since none of it touches SQL (see addMana and the player_magic
// accessors in db.js for the SQL side, which stays there for that reason).

export const SPELL_TYPES = ["attack", "armor", "heal", "aid", "travel"];

// Boot-time sanity check for MAGIC_SPELLS — a typo here dies at boot, not
// mid-cast. Takes LOCATION_NAMES/ITEMS as params (rather than importing
// db.js/item_backbone.js) so this file stays a leaf; server.js calls this
// and owns the FATAL logging/exit, same as the item registry validation.
export function validateMagicSpells(LOCATION_NAMES, ITEMS) {
  const bad = [];
  for (const [key, spell] of Object.entries(MAGIC_SPELLS)) {
    if (!SPELL_TYPES.includes(spell.type)) bad.push(`MAGIC_SPELLS["${key}"] has invalid type "${spell.type}"`);
    if (!MAGIC_SPELL_CATEGORIES[spell.type]) bad.push(`MAGIC_SPELLS["${key}"] type "${spell.type}" has no MAGIC_SPELL_CATEGORIES entry`);
    if (!Number.isFinite(spell.level) || spell.level < 1) bad.push(`MAGIC_SPELLS["${key}"] has invalid level "${spell.level}"`);
    if (!Number.isFinite(spell.cost) || spell.cost < 0) bad.push(`MAGIC_SPELLS["${key}"] has invalid mana cost "${spell.cost}"`);
    if (!Number.isFinite(spell.xp) || spell.xp < 0) bad.push(`MAGIC_SPELLS["${key}"] has invalid xp "${spell.xp}"`);
    const e = spell.effect || {};
    if (spell.type === "attack" && !(Number.isFinite(e.accuracy) && Number.isFinite(e.targets)))
      bad.push(`MAGIC_SPELLS["${key}"] is an attack spell missing effect.accuracy/effect.targets`);
    if (spell.type === "armor" && !Number.isFinite(e.ap))
      bad.push(`MAGIC_SPELLS["${key}"] is an armor spell missing effect.ap`);
    if (spell.type === "heal" && !Number.isFinite(e.hp))
      bad.push(`MAGIC_SPELLS["${key}"] is a heal spell missing effect.hp`);
    if (spell.type === "aid" && !Number.isFinite(e.hp_target))
      bad.push(`MAGIC_SPELLS["${key}"] is an aid spell missing effect.hp_target`);
    if (spell.type === "travel" && !LOCATION_NAMES[e.loc])
      bad.push(`MAGIC_SPELLS["${key}"] is a travel spell with unknown effect.loc "${e.loc}"`);
    // Every spell is either a starter or learnable at the Magic Table.
    if (spell.starter && spell.learn) bad.push(`MAGIC_SPELLS["${key}"] is a starter spell with a learn cost — pick one`);
    if (!spell.starter && !spell.learn) bad.push(`MAGIC_SPELLS["${key}"] is neither a starter nor learnable (no learn map)`);
    for (const [item, qty] of Object.entries(spell.learn || {})) {
      if (!ITEMS[item]) bad.push(`MAGIC_SPELLS["${key}"].learn references unknown item "${item}"`);
      if (!Number.isInteger(qty) || qty < 1) bad.push(`MAGIC_SPELLS["${key}"].learn has invalid qty for "${item}"`);
    }
  }
  return bad;
}

// Temporary AP from "armor"-type spells: userId -> { ap, until }. Adds on top
// of equipped-gear AP (not a replacement) — in-memory only, same convention
// as ACTION_BUSY/CAMPFIRES in server.js, so a restart just lets any active
// buff lapse. server.js's armorApOf() folds spellApOf() into its AP total.
export const SPELL_ARMOR_BUFFS = new Map();
export const SPELL_ARMOR_BUFF_SECONDS = 300;
export function spellApOf(userId) {
  const b = SPELL_ARMOR_BUFFS.get(userId);
  return (b && b.until > Date.now()) ? b.ap : 0;
}

// Meditation: a safe-zone timed action granting magic XP (no item, no roll).
export const MEDITATE_SECONDS = 20;
export const MEDITATE_XP = 15;
