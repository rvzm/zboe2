// zboe2 configuration file
// This file contains configuration settings for the zboe2 server, including logging and database options.


export const file_config = {
  logFile: "server.log", // Default log file name
  databaseFile: "zboe.sqlite", // Default database file name
}

export const game_config = {
  verbose: false, // Set to true for detailed logging
  dev: false, // Set to true for development mode, false for development mode
  debugLevel: 'NONE', // Set to 'FULL', 'WARN', 'ERROR', or 'FATAL' for logging levels
  sessionSecret: 'changeme' // Change this to a secure random string in production
};