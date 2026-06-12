// Tidewall — incognito end-to-end check.
//
// Verifies the calm page actually RENDERS in Incognito after a DNR redirect
// (not ERR_BLOCKED_BY_CLIENT). This requires "incognito":"split" in the
// manifest — under the default "spanning" mode Chrome blocks loading the
// extension's redirect-target page in an incognito tab.
//
// Because Chrome only allows an extension in Incognito after a manual user
// toggle, we forge that flag in the test profile's Preferences (the unprotected
// `extensions.settings.<id>.incognito`, used for command-line-loaded
// extensions), then relaunch the whole session with --incognito.
//
// Usage: node test/e2e/incognito.mjs   (exit 0 iff the page renders in incognito)

import { chromium } from "playwright";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EXT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const userDir = mkdtempSync(join(tmpdir(), "tidewall-incognito-"));
const baseArgs = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"];

function fail(msg) {
  console.log(`FAIL  incognito  — ${msg}`);
  process.exit(1);
}

// 1) Normal launch: register the extension, learn its id + a curated target, then close.
let ctx = await chromium.launchPersistentContext(userDir, { headless: false, args: ["--headless=new", ...baseArgs] });
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10000 });
const id = new URL(sw.url()).host;
const target = await sw.evaluate(async () => {
  const r = await fetch(chrome.runtime.getURL("rules/curated.json"));
  return (await r.json())[0].condition.requestDomains[0];
});
await ctx.close();

// 2) Forge "allow in incognito".
const prefsPath = join(userDir, "Default", "Preferences");
const prefs = JSON.parse(readFileSync(prefsPath, "utf8"));
if (!prefs.extensions?.settings?.[id]) fail("extension not registered in profile prefs");
prefs.extensions.settings[id].incognito = true;
writeFileSync(prefsPath, JSON.stringify(prefs));

// 3) Relaunch the session in Incognito with the extension incognito-enabled.
ctx = await chromium.launchPersistentContext(userDir, { headless: false, args: ["--headless=new", "--incognito", ...baseArgs] });
await new Promise((r) => setTimeout(r, 1500));

// 4) Navigate (incognito) to a blocked curated domain. The DNR redirect fires
//    before the network request, so no adult content is ever fetched.
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(`http://${target}/`).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));
const url = page.url();
const redirected = url.includes(`${id}/pages/blocked.html`);
let rendered = false;
try { rendered = await page.locator("#beginBtn").isVisible({ timeout: 4000 }); } catch {}
await ctx.close();

if (!redirected) fail(`did not redirect in incognito (url=${url})`);
if (!rendered) fail("redirected but the page did not render (ERR_BLOCKED_BY_CLIENT — is incognito:split set?)");
console.log(`PASS  incognito  — ${target} redirected and blocked.html rendered in incognito`);
process.exit(0);
