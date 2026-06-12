import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRules } from "../scripts/build-rules.mjs";

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
