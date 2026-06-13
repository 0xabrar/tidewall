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

// Serialize reconciles within this service worker. Back-to-back triggers (an
// add-domain message landing while onStartup's reconcile is mid-flight, or two
// quick add-domains) would otherwise interleave getDynamicRules/updateDynamicRules
// and collide on rule IDs. This only covers a single worker — it can't serialize
// against a split-incognito sibling worker, but those lifecycle events don't
// realistically overlap.
let reconcileChain = Promise.resolve();
function queueReconcile() {
  // Run after the previous reconcile; a prior failure must not block this one.
  const run = reconcileChain.catch(() => {}).then(reconcile);
  // Keep the internal chain non-rejecting so the next queued run always proceeds
  // and a failure is logged exactly once. `run` keeps that handler attached, so
  // ignoring the return never leaks an unhandled rejection — yet callers that
  // await it still see the rejection (add-domain must not answer {ok:true} when
  // the rule wasn't actually created).
  reconcileChain = run.catch((e) => console.error("Tidewall: reconcile failed", e));
  return run;
}

chrome.runtime.onInstalled.addListener((details) => {
  queueReconcile();
  // First install → show the calm onboarding / privacy welcome page.
  if (details?.reason === "install") {
    chrome.tabs?.create({ url: chrome.runtime.getURL("pages/welcome.html") });
  } else if (details?.reason === "update") {
    // Re-apply the user's Extended choice (Chrome reset it to the manifest default).
    restoreExtended().catch((e) => console.error("Tidewall: extended restore failed", e));
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
  // Persist the choice so it can be restored after an extension update — Chrome
  // resets enabled rulesets to the manifest defaults on update (see restoreExtended).
  // isExtendedEnabled() stays the live source of truth for the current state.
  await store.setSettings({ extendedEnabled: !!enabled });
}

async function isExtendedEnabled() {
  const ids = await chrome.declarativeNetRequest.getEnabledRulesets();
  return ids.includes("extended");
}

// On an extension UPDATE, Chrome resets enabled static rulesets to the manifest
// defaults. Extended now ships enabled:true, so an update would silently flip it
// back ON even for someone who deliberately turned it off. Re-apply the user's
// persisted choice in EITHER direction. If they never changed it (no stored
// flag) we leave the manifest default (on) in place. (Plain browser restarts
// preserve ruleset state, so this only matters on update.)
async function restoreExtended() {
  const stored = (await store.getSettings()).extendedEnabled;
  if (stored === undefined) return; // never toggled — keep the manifest default
  if (stored !== (await isExtendedEnabled())) await setExtended(stored);
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
