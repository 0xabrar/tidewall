import { test } from "node:test";
import assert from "node:assert/strict";
import { startCooldown, isUnlocked, confirmPhraseMatches, DEFAULT_COOLDOWN_MS } from "../src/lib/friction.js";

test("startCooldown sets unlockAt = now + duration", () => {
  const p = startCooldown({ type: "remove", payload: "example.com" }, 1000, 60_000);
  assert.equal(p.unlockAt, 61_000);
  assert.equal(p.type, "remove");
});
test("isUnlocked only after unlockAt", () => {
  const p = startCooldown({ type: "remove", payload: "x" }, 0, 60_000);
  assert.equal(isUnlocked(p, 59_999), false);
  assert.equal(isUnlocked(p, 60_000), true);
});
test("confirm phrase must match exactly (trimmed)", () => {
  assert.equal(confirmPhraseMatches("  I am choosing to remove this  "), true);
  assert.equal(confirmPhraseMatches("i am choosing to remove this"), false);
});
test("default cooldown is 5 minutes", () => {
  assert.equal(DEFAULT_COOLDOWN_MS, 5 * 60 * 1000);
});
