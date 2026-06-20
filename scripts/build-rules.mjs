import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CURATED_DOMAINS } from "../data/curated-domains.js";
import { EXTENDED_DOMAINS } from "../data/curated-domains-extended.js";
import { buildDomainRules, buildHostPatterns } from "../src/lib/rules.js";

// Domains pruned from the extended list: they host substantial NON-adult
// content, so wildcard-blocking them would over-block legitimate sites.
const EXTENDED_EXCLUDE = new Set(["fc2.com", "dmm.co.jp"]);

// Dynamic (user) rule IDs start at 100000; keep static rulesets below that.
// Built-in occupies 1..99999, extended occupies 200000.. (its own ruleset, so
// IDs only need to be unique within the extended ruleset — offset for clarity).
const EXTENDED_ID_BASE = 200000;

// DNR redirect rules for a blocklist (static ruleset).
export function buildRules(domains, idBase = 0) {
  return buildDomainRules(domains, idBase);
}
export { buildHostPatterns };

export function extendedDomains() {
  return EXTENDED_DOMAINS.filter((d) => !EXTENDED_EXCLUDE.has(d));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const ext = extendedDomains();

  const curatedOut = join(here, "..", "rules", "curated.json");
  await writeFile(curatedOut, JSON.stringify(buildRules(CURATED_DOMAINS), null, 2) + "\n");

  const extendedOut = join(here, "..", "rules", "extended.json");
  await writeFile(
    extendedOut,
    JSON.stringify(buildRules(ext, EXTENDED_ID_BASE), null, 2) + "\n"
  );

  // Keep manifest host_permissions in sync with BOTH lists (single source of
  // truth = data/curated-domains.js + data/curated-domains-extended.js). The
  // Extended tier is enabled by default, so its host access must be present at
  // install time for the redirects to fire. (optional_host_permissions stays
  // "*://*/*", requested per-domain only for sites the user adds themselves.)
  const manifestPath = join(here, "..", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = buildHostPatterns([...CURATED_DOMAINS, ...ext]);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(
    `Wrote ${curatedOut} (${CURATED_DOMAINS.length} built-in rules), ` +
      `${extendedOut} (${ext.length} extended rules), and synced manifest ` +
      `host_permissions (${manifest.host_permissions.length} patterns for ` +
      `${CURATED_DOMAINS.length + ext.length} domains).`
  );
}
