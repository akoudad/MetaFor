import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, cp, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await mkdir("desktop-dist/native", { recursive: true });
await Promise.all([
  build({ entryPoints: ["desktop/main.ts"], outfile: "desktop-dist/main.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], target: "node22" }),
  build({ entryPoints: ["desktop/preload.ts"], outfile: "desktop-dist/preload.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], target: "node22" }),
  viteBuild({ configFile: "desktop/vite.config.ts" }),
]);
execFileSync("swiftc", ["-O", "desktop/native/SourceInfo.swift", "-o", "desktop-dist/native/source-info"], { stdio: "inherit" });
execFileSync("swiftc", ["-O", "desktop/native/GuidanceObserver.swift", "-o", "desktop-dist/native/guidance-observer"], { stdio: "inherit" });
await cp("desktop/assets", "desktop-dist/assets", { recursive: true });
await writeFile("desktop-dist/package.json", JSON.stringify({ name: "metafor", version: "0.4.10", description: "Spatial conversations and assistance beside your work", author: "Karim Akoudad", main: "main.cjs" }, null, 2));
console.log("Metafor desktop bundle ready.");
