import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const secrets = [process.env.MODEL_API_KEY, process.env.DEMO_ACCESS_CODE].filter((value) => value && value.length >= 8);
if (!secrets.length) {
  console.log("No configured secrets to compare against client assets.");
  process.exit(0);
}

let checked = 0;
const exposed = [];
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) inspect(path);
    else if (/\.(js|json|map)$/.test(entry.name)) {
      checked += 1;
      const source = readFileSync(path, "utf8");
      if (secrets.some((secret) => source.includes(secret))) exposed.push(path);
    }
  }
}

try {
  inspect(".next/static");
  if (exposed.length) {
    console.error("A configured secret was found in client build files. Do not publish this build.");
    process.exitCode = 1;
  } else console.log(`Checked ${checked} client build files: no configured secrets found.`);
} catch {
  console.error("Build the app before checking client assets.");
  process.exitCode = 1;
}
