import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CURATED_DOMAINS } from "../data/curated-domains.js";

// DNR redirect rules for the curated blocklist (static ruleset).
export function buildRules(domains) {
  return domains.map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/pages/blocked.html" } },
    condition: { requestDomains: [domain], resourceTypes: ["main_frame"] },
  }));
}

// Host-permission match patterns for the curated blocklist. DNR `redirect`
// actions only fire for request URLs the extension has host access to, so the
// curated domains must appear in host_permissions. We narrow access to EXACTLY
// the blocklist (apex + subdomains) — never <all_urls>. Domains the user adds
// later are granted at runtime via optional permissions (one prompt each).
export function buildHostPatterns(domains) {
  return domains.flatMap((d) => [`*://${d}/*`, `*://*.${d}/*`]);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));

  const rulesOut = join(here, "..", "rules", "curated.json");
  await writeFile(rulesOut, JSON.stringify(buildRules(CURATED_DOMAINS), null, 2) + "\n");

  // Keep manifest host_permissions in sync with the curated list (single source
  // of truth = data/curated-domains.js). We only touch host_permissions.
  const manifestPath = join(here, "..", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = buildHostPatterns(CURATED_DOMAINS);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  console.log(
    `Wrote ${rulesOut} (${CURATED_DOMAINS.length} rules) and synced ` +
      `manifest host_permissions (${manifest.host_permissions.length} patterns)`
  );
}
