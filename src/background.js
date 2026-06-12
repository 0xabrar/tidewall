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

chrome.runtime.onInstalled.addListener((details) => {
  reconcile();
  // First install → show the calm onboarding / privacy welcome page.
  if (details?.reason === "install") {
    chrome.tabs?.create({ url: chrome.runtime.getURL("pages/welcome.html") });
  }
});
chrome.runtime.onStartup.addListener(reconcile);

// Toolbar icon opens the settings page.
chrome.action?.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Enable/disable the opt-in "extended" static ruleset. Host permission for the
// extended domains is requested from the options page (a user gesture) BEFORE
// this is called; here we just flip the ruleset and remember the choice.
async function setExtended(enabled) {
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled ? { enableRulesetIds: ["extended"] } : { disableRulesetIds: ["extended"] }
  );
  await store.setSettings({ extendedEnabled: !!enabled });
}

async function isExtendedEnabled() {
  const ids = await chrome.declarativeNetRequest.getEnabledRulesets();
  return ids.includes("extended");
}

// Handles a runtime message from an extension page (block page / options) and
// returns the response object. Pages run in their own realm, so their
// chrome.runtime.sendMessage reaches this onMessage listener natively.
async function handleMessage(msg) {
  switch (msg?.type) {
    case "encounter":
      await store.recordEncounter();
      return { ok: true };
    case "surf-complete":
      await store.recordSurf();
      return { ok: true };
    case "trigger":
      await store.recordTrigger(msg.name);
      return { ok: true };
    case "add-domain": {
      const res = await store.addDomain(msg.domain);
      if (res.ok) await reconcile();
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
      await reconcile();
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse, () => sendResponse({ ok: false, error: "exception" }));
  return true; // keep the message channel open for async sendResponse
});
