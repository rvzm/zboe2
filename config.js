// zboe2 configuration file
// This file contains configuration settings for the zboe2 server, including logging and database options.


export const file_config = {
  logFile: "server.log", // Default log file name
  databaseFile: "zboe.sqlite", // Default database file name
  censorFile: "censor.txt"
}

export const game_config = {
  verbose: false, // Set to true for detailed logging
  dev: false, // Set to true for development mode, false for development mode
  debugLevel: 'NONE', // Set to 'FULL', 'WARN', 'ERROR', or 'FATAL' for logging levels
  sessionSecret: 'changeme', // Change this to a secure random string in production
  timeout: 60, // Session timeout in seconds
  heartbeatSeconds: 30 // How often the --verbose heartbeat prints
};

export const zombie_config = {
  z_tic: 15, // Time interval for zombie actions in seconds
  z_chance: 5, // Chance of zombie action occurring (percentage)
  z_hit: 10, // Chance of zombie hitting the player (percentage)
  z_damage: 10, // Damage dealt per zombie hit (absorbed by shield first, then health)
  z_horde: 5, // Number of zombies in a horde
  z_raid: 15 // Number of zombies in a raid
};