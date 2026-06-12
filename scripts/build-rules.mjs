import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CURATED_DOMAINS } from "../data/curated-domains.js";

export function buildRules(domains) {
  return domains.map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/pages/blocked.html" } },
    condition: { requestDomains: [domain], resourceTypes: ["main_frame"] },
  }));
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "..", "rules", "curated.json");
  await writeFile(out, JSON.stringify(buildRules(CURATED_DOMAINS), null, 2) + "\n");
  console.log(`Wrote ${out} (${CURATED_DOMAINS.length} rules)`);
}
