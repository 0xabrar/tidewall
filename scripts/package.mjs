// Build a clean Chrome Web Store ZIP.
//
// Allowlist, NOT blocklist: we zip ONLY the files Chrome actually loads, so dev
// junk (node_modules, tests, data/, scripts/, .agents, .claude, CHROMEWEBSTORE.md,
// the design source art, etc.) can never accidentally ship. Output → dist/.
//
// Usage: npm run package
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

// Exactly what manifest.json + the pages/CSS reference at runtime. Note we list
// assets/fonts (the woff2s) — NOT all of assets/, so assets/design (the 1MB icon
// source) stays out of the package.
const INCLUDE = ["manifest.json", "icons", "src", "pages", "rules", "assets/fonts"];

for (const p of INCLUDE) {
  if (!existsSync(join(root, p))) throw new Error(`package: missing required path "${p}"`);
}

const outDir = join(root, "dist");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `tidewall-v${version}.zip`);
rmSync(out, { force: true });

// -r recurse, -X strip extra file attributes (cleaner, reproducible-ish archive).
execFileSync("zip", ["-rX", out, ...INCLUDE, "-x", "*.DS_Store", "-x", "**/.*"], {
  cwd: root,
  stdio: "inherit",
});

console.log("\nArchive contents:");
execFileSync("zip", ["-sf", out], { stdio: "inherit" });
console.log(`\nBuilt ${out}`);
