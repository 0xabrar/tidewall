// Tidewall end-to-end harness.
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
  const userDir = mkdtempSync(join(tmpdir(), "tidewall-e2e-"));
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

// Send a runtime message to the worker from a REAL page context (page -> worker),
// the way production pages do. A service worker messaging itself does not fire
// chrome.runtime.onMessage, so we never drive the worker via sw.evaluate.
async function sendMessageFromPage(context, extId, msg) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/pages/blocked.html`);
  const res = await page.evaluate(
    (m) => new Promise((r) => chrome.runtime.sendMessage(m, r)),
    msg
  );
  await page.close();
  return res;
}

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

  // A curated blocked domain actually resolves to a redirect to the local block
  // page. Uses declarativeNetRequest.testMatchOutcome so we verify the real
  // matching engine (curated rule + host permission must BOTH be present for a
  // redirect to fire) without ever navigating to an adult site or hitting the
  // network. Proves host_permissions is correctly scoped to the blocklist.
  async redirect({ sw, extId }) {
    const domains = await sw.evaluate(async () => {
      const r = await fetch(chrome.runtime.getURL("rules/curated.json"));
      return (await r.json()).map((rule) => rule.condition.requestDomains[0]);
    });
    const target = domains[0];
    const blockedUrls = [
      `https://${target}/`,
      `https://${target}/nested/path/`,
      `https://www.${target}/`,
      `https://www.${target}/nested/path/`,
    ];
    for (const url of blockedUrls) {
      const outcome = await sw.evaluate(
        (u) => chrome.declarativeNetRequest.testMatchOutcome({ url: u, type: "main_frame", method: "get" }),
        url
      );
      const matched = outcome?.matchedRules ?? [];
      if (matched.length === 0)
        throw new Error(`curated domain ${target} did not match ${url} (host perm missing?)`);
    }
    // Confirm a non-permitted domain does NOT match — proves access is narrowed.
    const offList = await sw.evaluate(
      (url) => chrome.declarativeNetRequest.testMatchOutcome({ url, type: "main_frame", method: "get" }),
      "https://example.com/"
    );
    if ((offList?.matchedRules ?? []).length !== 0)
      throw new Error("example.com unexpectedly matched — access is not narrowed");
    return `${target} root/www/deep URLs match; off-list example.com does not`;
  },

  // End-to-end render check: an actual navigation to a curated domain must
  // redirect AND the block page must actually LOAD (not ERR_BLOCKED_BY_CLIENT).
  // This catches the web_accessible_resources requirement for DNR redirects to
  // extension pages — testMatchOutcome can't see that. The DNR redirect fires
  // before the network request, so no adult content is ever fetched.
  async liveredirect({ context, sw, extId }) {
    const domains = await sw.evaluate(async () => {
      const r = await fetch(chrome.runtime.getURL("rules/curated.json"));
      return (await r.json()).map((rule) => rule.condition.requestDomains[0]);
    });
    const target = domains[0];
    const page = await context.newPage();
    await page.goto(`http://${target}/`).catch(() => {});
    await page.waitForURL(/chrome-extension:\/\/.*\/pages\/blocked\.html/, { timeout: 8000 });
    // The page must actually render its content (intro Begin button), proving
    // Chrome allowed loading the web-accessible extension page.
    await page.locator("#beginBtn").waitFor({ state: "visible", timeout: 6000 });
    await page.close();
    return `${target} redirected and blocked.html rendered`;
  },

  // Progressive block page: the breathing animation runs (phase word changes),
  // then the trigger stage records an anonymous tally and advances to the
  // action stage (which shows the "why"), and an action advances to "done".
  // We drive the breathe->trigger transition via the namespaced test handle to
  // avoid waiting out a full real-time breathing session.
  async blockpage({ context, sw, extId }) {
    await seedStorage(sw, {
      settings: { surfSeconds: 8, breathPattern: "box", whyStatement: "test why" },
      stats: { encounters: 0, surfsCompleted: 0, triggers: {} },
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/pages/blocked.html`);

    // Intro stage: the person taps Begin to start the breathing (no auto-start).
    await page.locator("#beginBtn").click();

    // Breathing stage is shown and the phase word advances over time.
    const word = page.locator("#breathWord");
    await word.waitFor({ timeout: 5000 });
    const w1 = await word.textContent();
    await page.waitForTimeout(4600); // box inhale is 4s -> word should change
    const w2 = await word.textContent();
    if (w1 === w2) throw new Error(`breath phase did not advance: ${w1} == ${w2}`);

    // Skip to the trigger stage; record a trigger; expect it to advance + tally.
    await page.evaluate(() => window.__tidewall.go("trigger"));
    await page.locator('[data-stage="trigger"] .chips button').first().click();
    await page.waitForTimeout(400);
    const { stats } = await getStorage(sw, ["stats"]);
    const total = Object.values(stats?.triggers || {}).reduce((a, b) => a + b, 0);
    if (total < 1) throw new Error("trigger chip did not record an anonymous tally");

    // Now on the action stage, which shows the "why".
    const why = await page.locator('[data-stage="action"] #why').textContent();
    if (!why?.includes("test why")) throw new Error(`why not rendered: "${why}"`);

    // Choosing an action advances to the done stage.
    await page.locator('[data-stage="action"] #actions button').first().click();
    await page.waitForTimeout(400);
    const doneVisible = await page.locator('[data-stage="done"]').isVisible();
    if (!doneVisible) throw new Error("action did not advance to the done stage");

    await page.close();
    return `breathing ${w1}->${w2}, trigger tallied, action->done`;
  },

  // The settings page lists domains and can add one through the UI. Requires Task 8.
  async settings({ context, sw, extId }) {
    await seedStorage(sw, { userDomains: [] });
    const target = await sw.evaluate(async () => {
      const r = await fetch(chrome.runtime.getURL("rules/curated.json"));
      return (await r.json())[0].condition.requestDomains[0];
    });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/pages/options.html`);
    await page.locator("#domain-input").fill(target);
    await page.locator("#add-btn").click();
    await page.waitForTimeout(400);
    const listed = await page.locator("#domain-list").textContent();
    if (!listed?.includes(target))
      throw new Error(`domain not listed after add: "${listed}"`);
    await page.close();
    return "added domain shows in list";
  },

  // Long custom lists paginate in both Settings and the read-only blocklist
  // review page instead of rendering one unbounded column.
  async pagination({ context, sw, extId }) {
    const domains = Array.from({ length: 17 }, (_, i) => `custom-${String(i + 1).padStart(2, "0")}.com`);
    await seedStorage(sw, { userDomains: domains, theme: "dark" });

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${extId}/pages/options.html`);
    const settingsPager = settings.locator("#domain-pager");
    await settingsPager.waitFor({ state: "visible", timeout: 4000 });
    await settings.waitForFunction(() => document.querySelector("#domain-page-info")?.textContent === "1-8 of 17");
    let info = await settings.locator("#domain-page-info").textContent();
    if (info !== "1-8 of 17") throw new Error(`settings pager first page wrong: ${info}`);
    const buttonBg = await settings.locator("#domain-next").evaluate((el) => getComputedStyle(el).backgroundColor);
    if (buttonBg === "rgb(255, 255, 255)" || buttonBg === "rgba(0, 0, 0, 0)")
      throw new Error(`settings pager button ignores dark mode: ${buttonBg}`);
    await settings.evaluate(() => {
      const list = document.querySelector("#domain-list");
      window.__tidewallEmptyListSeen = false;
      window.__tidewallListObserver = new MutationObserver(() => {
        if (list && list.children.length === 0) window.__tidewallEmptyListSeen = true;
      });
      window.__tidewallListObserver.observe(list, { childList: true });
    });
    await settings.locator("#domain-next").click();
    await settings.waitForFunction(() => document.querySelector("#domain-page-info")?.textContent === "9-16 of 17");
    const emptyListSeen = await settings.evaluate(() => window.__tidewallEmptyListSeen);
    if (emptyListSeen) throw new Error("settings list became empty during pagination");
    info = await settings.locator("#domain-page-info").textContent();
    if (info !== "9-16 of 17") throw new Error(`settings pager second page wrong: ${info}`);
    await settings.close();

    const review = await context.newPage();
    await review.goto(`chrome-extension://${extId}/pages/blocklist.html`);
    const reviewPager = review.locator("#custom-pager");
    await reviewPager.waitFor({ state: "visible", timeout: 4000 });
    await review.waitForFunction(() => document.querySelector("#custom-page-info")?.textContent === "1-16 of 17");
    info = await review.locator("#custom-page-info").textContent();
    if (info !== "1-16 of 17") throw new Error(`review pager first page wrong: ${info}`);
    await review.locator("#custom-next").click();
    await review.waitForFunction(() => document.querySelector("#custom-page-info")?.textContent === "17-17 of 17");
    info = await review.locator("#custom-page-info").textContent();
    if (info !== "17-17 of 17") throw new Error(`review pager second page wrong: ${info}`);
    await review.close();

    return "settings and review custom lists paginate";
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

  // The "extended" static ruleset ships ON by default. It can be turned off and
  // back on via the worker, and each choice is persisted to storage — that
  // persisted flag is what restoreExtended re-applies after an extension update
  // (the update event itself can't be simulated in this harness).
  async extended({ context, sw, extId }) {
    const before = await sw.evaluate(() =>
      chrome.declarativeNetRequest.getEnabledRulesets()
    );
    if (!before.includes("extended"))
      throw new Error("extended ruleset should be ON by default");

    // A domain that's ONLY on the extended list actually redirects by default —
    // proves the default-on ruleset has the manifest host access it needs to fire
    // (default-on is pointless if the redirect can't actually happen).
    const extDomain = await sw.evaluate(async () => {
      const r = await fetch(chrome.runtime.getURL("rules/extended.json"));
      return (await r.json())[0].condition.requestDomains[0];
    });
    const extOutcome = await sw.evaluate(
      (url) => chrome.declarativeNetRequest.testMatchOutcome({ url, type: "main_frame", method: "get" }),
      `https://${extDomain}/`
    );
    if ((extOutcome?.matchedRules ?? []).length === 0)
      throw new Error(`extended domain ${extDomain} did not redirect by default (host perm missing?)`);

    // Turn it OFF — ruleset disables and the choice persists as false.
    const off = await sendMessageFromPage(context, extId, { type: "set-extended", enabled: false });
    if (off?.enabled) throw new Error(`disable failed: ${JSON.stringify(off)}`);
    const mid = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
    if (mid.includes("extended")) throw new Error("extended ruleset still enabled after off");
    const s1 = await getStorage(sw, ["settings"]);
    if (s1.settings?.extendedEnabled !== false)
      throw new Error(`off choice not persisted: ${JSON.stringify(s1.settings)}`);

    // Turn it back ON — ruleset enables and the choice persists as true.
    const on = await sendMessageFromPage(context, extId, { type: "set-extended", enabled: true });
    if (!on?.enabled) throw new Error(`enable failed: ${JSON.stringify(on)}`);
    const after = await sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
    if (!after.includes("extended")) throw new Error("extended ruleset not enabled after on");
    const s2 = await getStorage(sw, ["settings"]);
    if (s2.settings?.extendedEnabled !== true)
      throw new Error(`on choice not persisted: ${JSON.stringify(s2.settings)}`);

    return "extended on(default) -> off(persisted) -> on(persisted)";
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
