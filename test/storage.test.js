import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStore, DEFAULT_SETTINGS } from "../src/lib/storage.js";

function fakeChromeStorage(initial = {}) {
  let data = { ...initial };
  return { local: {
    async get(keys) {
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, data[k]]));
      return { [keys]: data[keys] };
    },
    async set(obj) { data = { ...data, ...obj }; },
  }};
}

test("getDomains defaults to empty, addDomain normalizes + dedupes", async () => {
  const store = makeStore(fakeChromeStorage());
  assert.deepEqual(await store.getDomains(), []);
  await store.addDomain("https://www.Example.com/x");
  await store.addDomain("example.com");
  assert.deepEqual(await store.getDomains(), ["example.com"]);
});
test("settings fall back to defaults", async () => {
  const store = makeStore(fakeChromeStorage());
  assert.deepEqual(await store.getSettings(), DEFAULT_SETTINGS);
});
test("recordEncounter increments stats", async () => {
  const store = makeStore(fakeChromeStorage());
  await store.recordEncounter();
  const stats = await store.getStats();
  assert.equal(stats.encounters, 1);
});
