// cli/index.js
import readline from "node:readline";
import { runCommand, runTokens } from "./parser.mjs";

// One-shot mode: `node util/index.mjs <group> <action> [args...]` runs a single
// command and exits. This is what the dialog menus in ./menus/*.sh call.
const argvTokens = process.argv.slice(2);
if (argvTokens.length) {
  try {
    const result = await runTokens(argvTokens);
    if (result !== undefined) console.log(result);
    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err.message);
    process.exit(1);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> "
});

console.log("ZBOE Admin CLI");
console.log("Type 'help' for commands");
rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();

  if (input === "exit") process.exit(0);

  try {
    const result = await runCommand(input);
    if (result !== undefined) console.log(result);
  } catch (err) {
    console.error("ERROR:", err.message);
  }

  rl.prompt();
});