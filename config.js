// zboe2 configuration file
// This file contains configuration settings for the zboe2 server, including logging and database options.

// Single source of truth for the app version. Code reads it from here — only
// changelog.md and README.md state versions of their own.
export const app_version = "2.0.27-dev-rc";

export const file_config = {
  logFile: "server.log", // Default log file name
  logMaxMB: 3, // Log file size cap (MB) — when reached, the log rotates to <name>.old.log
  databaseFile: "zboe.sqlite", // Default database file name
  censorFile: "censor.txt"
}

export const game_config = {
  verbose: false, // Set to true for detailed logging
  dev: false, // Set to true for development mode, false for development mode
  debugLevel: 'NONE', // Set to 'FULL', 'INFO', 'WARN', 'ERROR', or 'FATAL' for logging levels
  sessionSecret: 'changeme', // Change this to a secure random string in production
  timeout: 10, // Session timeout in seconds
  heartbeatSeconds: 10, // How often the --verbose heartbeat prints
  baseMaxHealth: 10000, // Base (inside) health pool
  experimentResetHours: 24, // Hours a destroyed base persists before auto-resetting the experiment
  tokenExchangeGold: 500 // Gold granted per horde token exchanged in the shop

};

export const ui_config = {
  censor: true, // set true for chat censoring
  mobile_events: 10, // how many events should mobile limit to showing.
  mobile_chat: true, // enable/disable world chat sending from mobile.
  gfx_mode: 3, // Graphics Mode: 0 - Pixel-Art / 1 - Low / 2 - Mid / 3 - High || This is for the background at each location. playercard, admin, and index all use High.
};

export const account_config = {
  ban_timeout: 86400, // Default temp-ban length (seconds) when none is given — 24h
  failed_login_max: 5, // Failed password attempts before a lockout
  failed_login_lockout_seconds: 300 // Auto-lockout length after too many failed attempts — 5m
};

export const ssl_config = {
  enabled: false, // true = serve HTTPS with the cert/key below (also flips all cookies to Secure)
  certFile: "certs/server.crt", // PEM certificate (or a Let's Encrypt fullchain.pem); relative paths resolve from the project root
  keyFile: "certs/server.key"   // PEM private key (privkey.pem)
};

export const zombie_config = {
  z_tic: 15, // Time interval for zombie actions in seconds
  z_chance: 5, // Chance of zombie action occurring (percentage)
  z_hit: 10, // Chance of zombie hitting the player (percentage)
  z_damage: 3, // Damage dealt per zombie hit (absorbed by shield first, then health)
  z_horde: 5, // Number of zombies in a horde
  z_raid: 15, // Number of zombies in a raid
  z_break: 100, // Number of zombies needed to create a Zombie Break event.
  z_break_chance: 10, // Chance of a Zombie Break event occurring (percentage)
  z_break_duration: 60, // Duration of a Zombie Break event in seconds
  z_break_reward: { gold: 500, xp: 250 }, // Reward for surviving a Zombie Break event
  z_break_fall: 50 // Number of Zombies that must be killed to end a Zombie Break event early (percentage)

};