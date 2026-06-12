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

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);

// Single source of truth for handling a runtime message. Returns the response
// object. Shared by the onMessage listener (messages from pages/options) and by
// the same-realm sendMessage shim below (messages dispatched from within the SW
// itself — Chrome's onMessage never fires for a context messaging itself).
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
      if (!pending || !isUnlocked(pending, Date.now()) || !confirmPhraseMatches(msg.phrase)) {
        return { ok: false };
      }
      await store.removeDomain(pending.payload);
      await store.setPendingUnlock(null);
      await reconcile();
      return { ok: true };
    }
    default:
      return { ok: false, error: "unknown" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse, () => sendResponse({ ok: false, error: "exception" }));
  return true; // keep the message channel open for async sendResponse
});

// Same-realm message shim. chrome.runtime.onMessage does NOT fire for a message
// a context sends to itself (Chrome excludes the sender's frame), so a call to
// chrome.runtime.sendMessage from inside this service worker would otherwise fail
// with "Receiving end does not exist". Wrap sendMessage so self-dispatched
// messages are handled in-process. Cross-context messaging (pages -> worker) is
// untouched: those callers run in their own realm with the native API.
chrome.runtime.sendMessage = function (...args) {
  // Normalize (extensionId?, message, options?, callback?) signature.
  let message, callback;
  if (typeof args[0] === "string") {
    message = args[1];
    callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;
  } else {
    message = args[0];
    callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;
  }
  const promise = handleMessage(message);
  if (callback) {
    promise.then(callback, () => callback(undefined));
    return undefined;
  }
  return promise;
};
