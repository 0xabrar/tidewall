export const BLOCKED_PAGE_PATH = "/pages/blocked.html";

export function blockRuleForDomain(domain, id) {
  return {
    id,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: BLOCKED_PAGE_PATH } },
    condition: { requestDomains: [domain], resourceTypes: ["main_frame"] },
  };
}

export function buildDomainRules(domains, idBase = 0) {
  return domains.map((domain, i) => blockRuleForDomain(domain, idBase + i + 1));
}

// Host-permission match patterns for a blocklist. DNR redirect actions only
// fire for request URLs the extension has host access to.
export function buildHostPatterns(domains) {
  return domains.flatMap((domain) => [`*://${domain}/*`, `*://*.${domain}/*`]);
}
