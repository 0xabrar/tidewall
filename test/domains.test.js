import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, isValidDomain } from "../src/lib/domains.js";

test("strips scheme, path, www, and lowercases", () => {
  assert.equal(normalizeDomain("https://www.Example.com/foo?x=1"), "example.com");
  assert.equal(normalizeDomain("  EXAMPLE.com  "), "example.com");
  assert.equal(normalizeDomain("sub.example.co.uk"), "sub.example.co.uk");
});
test("rejects empty / malformed input", () => {
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("not a domain"), null);
  assert.equal(normalizeDomain("http://"), null);
});
test("isValidDomain mirrors normalize", () => {
  assert.equal(isValidDomain("example.com"), true);
  assert.equal(isValidDomain("nope nope"), false);
});
