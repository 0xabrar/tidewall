// ClearHead end-to-end harness.
//
// Loads the REAL unpacked extension into headless Chromium (new headless mode,
// required for MV3 extensions), resolves the extension ID from the live service
// worker, and runs named integration checks against actual browser behavior.
//
// Usage:
//   node test/e2e/harness.mjs [check ...]
// With no args, runs ALL checks. Otherwise runs only the named checks, e.g.:
//   node test/e2e/harness.mjs load
//   node test/e2e/harness.mjs load redirect blockpage settings friction
//
// Exit code 0 iff every requested check passed.
//
// Note: the redirect check targets example.com (an IANA reserved test domain) —
// we NEVER navigate to real adult sites. DNR redirects the request to the local
// extension page before any network call, so this works offline too.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const EXT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function log(ok, name, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

async function launch() {
  const userDir = mkdtempSync(join(tmpdir(), "clearhead-e2e-"));
  const context = await chromium.launchPersistentContext(userDir, {
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      "--no-sandbox",
    ],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  return { context, sw, extId };
}

// Send a runtime message to the background worker and await its response.
const sendMessage = (sw, msg) =>
  sw.evaluate(
    (m) => new Promise((res) => chrome.runtime.sendMessage(m, res)),
    msg
  );

const seedStorage = (sw, obj) =>
  sw.evaluate((o) => chrome.storage.local.set(o), obj);

const getStorage = (sw, keys) =>
  sw.evaluate((k) => chrome.storage.local.get(k), keys);

const checks = {
  // The extension loads, the service worker is alive, the ID resolves, the
  // curated static ruleset is enabled, and the local block page is reachable.
  async load({ context, sw, extId }) {
    if (!extId || extId.length < 10) throw new Error(`bad ext id: ${extId}`);
    const rulesets = await sw.evaluate(() =>
      chrome.declarativeNetRequest.getEnabledRulesets()
    );
    if (!rulesets.includes("curated"))
      throw new Error(`curated ruleset not enabled: ${JSON.stringify(rulesets)}`);
    const page = await context.newPage();
    const resp = await page.goto(`chrome-extension://${extId}/pages/blocked.html`);
    if (!resp || !resp.ok()) throw new Error("blocked.html not reachable");
    await page.close();
    return `extId=${extId}, rulesets=[${rulesets}]`;
  },

  // Adding a domain (via the background worker) causes a real navigation to it
  // to be redirected to the local block page. Requires Task 6 (message handler).
  async redirect({ context, sw, extId }) {
    const res = await sendMessage(sw, { type: "add-domain", domain: "example.com" });
    if (!res || !res.ok) throw new Error(`add-domain failed: ${JSON.stringify(res)}`);
    const page = await context.newPage();
    await page.goto("http://example.com/").catch(() => {});
    await page.waitForURL(/chrome-extension:\/\/.*\/pages\/blocked\.html/, { timeout: 8000 });
    const url = page.url();
    await page.close();
    if (!url.includes(`${extId}/pages/blocked.html`))
      throw new Error(`not redirected, url=${url}`);
    return `example.com -> ${url}`;
  },

  // The block page renders its hero ring + countdown, the timer actually ticks
  // down, and clicking a trigger chip records it. Requires Task 7.
  async blockpage({ context, sw, extId }) {
    await seedStorage(sw, {
      settings: { surfSeconds: 5, breathPattern: "box", whyStatement: "test why" },
      stats: { encounters: 0, surfsCompleted: 0, triggers: {} },
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/pages/blocked.html`);
    const timeEl = page.locator("#time");
    await timeEl.waitFor({ timeout: 5000 });
    const t1 = await timeEl.textContent();
    await page.waitForTimeout(2200);
    const t2 = await timeEl.textContent();
    if (t1 === t2) throw new Error(`timer did not tick: ${t1} == ${t2}`);
    // why statement shown
    const why = await page.locator("#why").textContent();
    if (!why?.includes("test why")) throw new Error(`why not rendered: "${why}"`);
    // click a chip, expect a trigger recorded
    await page.locator("#chips button").first().click();
    await page.waitForTimeout(300);
    const { stats } = await getStorage(sw, ["stats"]);
    const total = Object.values(stats?.triggers || {}).reduce((a, b) => a + b, 0);
    if (total < 1) throw new Error("chip click did not record a trigger");
    await page.close();
    return `timer ${t1}->${t2}, trigger recorded`;
  },

  // The settings page lists domains and can add one through the UI. Requires Task 8.
  async settings({ context, sw, extId }) {
    await seedStorage(sw, { userDomains: [] });
    await sendMessage(sw, { type: "noop" }).catch(() => {});
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/pages/options.html`);
    await page.locator("#domain-input").fill("addedviaui.com");
    await page.locator("#add-btn").click();
    await page.waitForTimeout(400);
    const listed = await page.locator("#domain-list").textContent();
    if (!listed?.includes("addedviaui.com"))
      throw new Error(`domain not listed after add: "${listed}"`);
    await page.close();
    return "added domain shows in list";
  },

  // Removing a domain is gated: a cooldown panel appears and confirm is disabled
  // until the cooldown elapses. Requires Task 8. We assert the gate appears and
  // confirm starts disabled (we don't wait 5 real minutes).
  async friction({ context, sw, extId }) {
    await seedStorage(sw, { userDomains: ["gated.com"], pendingUnlock: null });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/pages/options.html`);
    await page.waitForTimeout(300);
    await page.locator('[data-remove="gated.com"]').click();
    const panel = page.locator("#friction-panel");
    await panel.waitFor({ timeout: 4000 });
    const confirmDisabled = await page.locator("#friction-confirm").isDisabled();
    if (!confirmDisabled) throw new Error("confirm should be disabled during cooldown");
    await page.close();
    return "cooldown gate shown, confirm disabled";
  },
};

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(checks);

const { context, sw, extId } = await launch();
let failures = 0;
for (const name of names) {
  const fn = checks[name];
  if (!fn) { log(false, name, "unknown check"); failures++; continue; }
  try {
    const detail = await fn({ context, sw, extId });
    log(true, name, detail);
  } catch (e) {
    log(false, name, e.message);
    failures++;
  }
}
await context.close();
console.log(`\n${names.length - failures}/${names.length} checks passed`);
process.exit(failures ? 1 : 0);
