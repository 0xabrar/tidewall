import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRules, buildHostPatterns } from "../scripts/build-rules.mjs";
import { blockRuleForDomain } from "../src/lib/rules.js";

test("builds one redirect rule per domain with unique ids in curated range", () => {
  const rules = buildRules(["a.com", "b.com"]);
  assert.equal(rules.length, 2);
  const ids = rules.map(r => r.id);
  assert.equal(new Set(ids).size, 2);
  assert.ok(ids.every(id => id >= 1 && id < 100000));
});
test("rule redirects to the local blocked page via extensionPath", () => {
  const [rule] = buildRules(["a.com"]);
  assert.equal(rule.action.type, "redirect");
  assert.equal(rule.action.redirect.extensionPath, "/pages/blocked.html");
  assert.equal(rule.condition.requestDomains[0], "a.com");
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
});
test("static rules use the same rule shape as dynamic user rules", () => {
  assert.deepEqual(buildRules(["a.com"])[0], blockRuleForDomain("a.com", 1));
});
test("host patterns narrow access to apex + subdomains of each blocked domain (never <all_urls>)", () => {
  const patterns = buildHostPatterns(["a.com", "b.com"]);
  assert.deepEqual(patterns, ["*://a.com/*", "*://*.a.com/*", "*://b.com/*", "*://*.b.com/*"]);
  assert.ok(!patterns.includes("<all_urls>"));
});
