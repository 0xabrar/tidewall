// src/background.js
import { makeStore } from "./lib/storage.js";
import { startCooldown, isUnlocked, confirmPhraseMatches } from "./lib/friction.js";

const store = makeStore();
const DYNAMIC_BASE_ID = 100000; // user rules never collide with curated (1..99999)

function ruleForDomain(domain, id) {
  return {
    id,
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/pages/blocked.html" } },
    condition: { requestDomains: [domain], resourceTypes: ["main_frame"] },
  };
}

// Rebuild ALL dynamic rules to match storage. Idempotent.
async function reconcile() {
  const domains = await store.getDomains();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);
  const addRules = domains.map((d, i) => ruleForDomain(d, DYNAMIC_BASE_ID + i));
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

// Serialize reconciles for this service-worker lifetime. Two near-simultaneous
// triggers (onStartup racing a split-incognito sibling, or back-to-back
// add-domain messages) would otherwise interleave getDynamicRules/updateDynamicRules
// and collide on rule IDs. Chaining also gives one place to swallow + log a
// failure instead of leaking an unhandled rejection.
let reconcileChain = Promise.resolve();
function queueReconcile() {
  reconcileChain = reconcileChain
    .catch(() => {})
    .then(reconcile)
    .catch((e) => console.error("Tidewall: reconcile failed", e));
  return reconcileChain;
}

chrome.runtime.onInstalled.addListener((details) => {
  queueReconcile();
  // First install → show the calm onboarding / privacy welcome page.
  if (details?.reason === "install") {
    chrome.tabs?.create({ url: chrome.runtime.getURL("pages/welcome.html") });
  }
});
chrome.runtime.onStartup.addListener(queueReconcile);

// Toolbar icon opens the settings page.
chrome.action?.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Enable/disable the opt-in "extended" static ruleset. Host permission for the
// extended domains is requested from the options page (a user gesture) BEFORE
// this is called; here we just flip the ruleset.
async function setExtended(enabled) {
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled ? { enableRulesetIds: ["extended"] } : { disableRulesetIds: ["extended"] }
  );
  // No need to persist the choice: DNR remembers enabled rulesets across restarts,
  // and isExtendedEnabled() reads that back as the single source of truth.
}

async function isExtendedEnabled() {
  const ids = await chrome.declarativeNetRequest.getEnabledRulesets();
  return ids.includes("extended");
}

// Handles a runtime message from an extension page (block page / options) and
// returns the response object. Pages run in their own realm, so their
// chrome.runtime.sendMessage reaches this onMessage listener natively.
async function handleMessage(msg, sender) {
  // blocked.html is web-accessible (the DNR redirect target), so any page can
  // iframe it and fire stat messages. Real stat senders are top-level extension
  // pages (frameId 0); ignore stat writes coming from a sub-frame.
  const subFrame = !!sender && sender.frameId > 0;
  switch (msg?.type) {
    case "encounter":
      if (!subFrame) await store.recordEncounter();
      return { ok: true };
    case "surf-complete":
      if (!subFrame) await store.recordSurf();
      return { ok: true };
    case "trigger": {
      const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 64) : "";
      if (!subFrame && name) await store.recordTrigger(name);
      return { ok: true };
    }
    case "add-domain": {
      const res = await store.addDomain(msg.domain);
      if (res.ok) await queueReconcile();
      return res;
    }
    case "request-remove": {
      const pending = startCooldown({ type: "remove", payload: msg.domain }, Date.now());
      await store.setPendingUnlock(pending);
      return { ok: true, unlockAt: pending.unlockAt };
    }
    case "confirm-remove": {
      const pending = await store.getPendingUnlock();
      if (pending?.type !== "remove" || !isUnlocked(pending, Date.now()) || !confirmPhraseMatches(msg.phrase)) {
        return { ok: false };
      }
      await store.removeDomain(pending.payload);
      await store.setPendingUnlock(null);
      await queueReconcile();
      return { ok: true };
    }
    // Disabling the extended tier is gated behind the same friction as removing
    // a domain (cooldown + type-to-confirm) — turning protection OFF should be
    // deliberate, never a quick toggle.
    case "request-disable-extended": {
      const pending = startCooldown({ type: "disable-extended" }, Date.now());
      await store.setPendingUnlock(pending);
      return { ok: true, unlockAt: pending.unlockAt };
    }
    case "confirm-disable-extended": {
      const pending = await store.getPendingUnlock();
      if (pending?.type !== "disable-extended" || !isUnlocked(pending, Date.now()) || !confirmPhraseMatches(msg.phrase)) {
        return { ok: false };
      }
      await setExtended(false);
      await store.setPendingUnlock(null);
      return { ok: true };
    }
    case "set-extended": {
      await setExtended(msg.enabled);
      return { ok: true, enabled: await isExtendedEnabled() };
    }
    case "get-extended":
      return { ok: true, enabled: await isExtendedEnabled() };
    default:
      return { ok: false, error: "unknown" };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse, (e) => {
    console.error("Tidewall: message handler failed", msg?.type, e);
    sendResponse({ ok: false, error: "exception" });
  });
  return true; // keep the message channel open for async sendResponse
});
