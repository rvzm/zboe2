import { db } from "../../db.js";

function getUserId(username) {
  const row = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  return row?.id ?? null;
}

export async function show(username) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;

  const items = db.prepare(`
    SELECT item_name, quantity, condition, ammo, clips
    FROM player_inventory
    WHERE user_id = ?
    ORDER BY item_name
  `).all(userId);

  return items.length
    ? items.map(i =>
        `${i.item_name} x${i.quantity} [cond:${i.condition}] ammo:${i.ammo} clips:${i.clips}`
      ).join("\n")
    : "(empty)";
}

// Adds quantity, stacking onto an existing row (updating its condition/ammo/clips).
export async function add(username, item, qty = 1, condition = 100, ammo = 0, clips = 0) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  if (!item) return "Usage: inventory add <username> <item> [qty] [condition] [ammo] [clips]";

  const existing = db.prepare(
    "SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_name = ?"
  ).get(userId, item);

  if (existing) {
    const newQty = existing.quantity + Number(qty);
    db.prepare(`
      UPDATE player_inventory
      SET quantity = ?, condition = ?, ammo = ?, clips = ?, updated_at = ?
      WHERE id = ?
    `).run(newQty, Number(condition), Number(ammo), Number(clips), Date.now(), existing.id);
    return `Updated ${item} for ${username} (qty ${existing.quantity} -> ${newQty})`;
  }

  db.prepare(`
    INSERT INTO player_inventory
    (user_id, item_name, quantity, condition, ammo, clips, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, item, Number(qty), Number(condition), Number(ammo), Number(clips), Date.now());

  return `Added ${item} x${qty} to ${username}`;
}

// remove <user> <item> [qty] — drops qty (default: the whole stack).
export async function remove(username, item, qty) {
  const userId = getUserId(username);
  if (userId === null) return `No such user: ${username}`;
  if (!item) return "Usage: inventory remove <username> <item> [qty]";

  const existing = db.prepare(
    "SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_name = ?"
  ).get(userId, item);
  if (!existing) return `${username} does not have ${item}`;

  const n = Number(qty);
  if (qty === undefined || qty === "" || Number.isNaN(n) || n >= existing.quantity) {
    db.prepare("DELETE FROM player_inventory WHERE id = ?").run(existing.id);
    return `Removed all ${item} from ${username}`;
  }

  const newQty = existing.quantity - n;
  db.prepare("UPDATE player_inventory SET quantity = ?, updated_at = ? WHERE id = ?")
    .run(newQty, Date.now(), existing.id);
  return `Removed ${qty} ${item} from ${username} (${newQty} left)`;
}
