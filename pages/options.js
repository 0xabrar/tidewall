// ClearHead — settings / options page behavior.
//
// Runs in a normal extension-page realm, so chrome.runtime.sendMessage to the
// background service worker fires onMessage natively (cross-realm). The worker
// owns the canonical writes (add/remove domain, DNR rebuild, pendingUnlock);
// this page reads storage directly for render and drives those writes by
// message. Settings (why/timer/breathing) are written straight to storage via
// the store wrapper since they don't need a DNR rebuild.

import { makeStore } from "../src/lib/storage.js";
import { CONFIRM_PHRASE, isUnlocked, confirmPhraseMatches } from "../src/lib/friction.js";

const store = makeStore();

const els = {
  domainInput: document.getElementById("domain-input"),
  addBtn: document.getElementById("add-btn"),
  addError: document.getElementById("add-error"),
  domainList: document.getElementById("domain-list"),

  whyInput: document.getElementById("why-input"),
  whyDisplay: document.getElementById("why-display"),
  whyEdit: document.getElementById("why-edit"),
  whyText: document.getElementById("why-text"),
  whyEditBtn: document.getElementById("why-edit-btn"),
  whySaveBtn: document.getElementById("why-save-btn"),
  whyCancelBtn: document.getElementById("why-cancel-btn"),
  whySaved: document.getElementById("why-saved"),

  surfRange: document.getElementById("surf-range"),
  surfValue: document.getElementById("surf-value"),
  breathToggle: document.getElementById("breath-toggle"),

  breathHelp: document.getElementById("breath-help"),
  builtinCount: document.getElementById("builtin-count"),
  extendedToggle: document.getElementById("extended-toggle"),
  extendedHelp: document.getElementById("extended-help"),

  breatheNow: document.getElementById("breathe-now"),

  statSurfs: document.getElementById("stat-surfs"),
  statEncounters: document.getElementById("stat-encounters"),
  triggerChart: document.getElementById("trigger-chart"),

  overlay: document.getElementById("friction-overlay"),
  panel: document.getElementById("friction-panel"),
  fTitle: document.getElementById("friction-title"),
  fBody: document.querySelector("#friction-panel .friction-body"),
  fCountdown: document.querySelector("#friction-panel .friction-countdown"),
  fPhraseHint: document.querySelector("#friction-panel .friction-phrase-hint"),
  fDomain: document.getElementById("friction-domain"),
  fTimer: document.getElementById("friction-timer"),
  fPhrase: document.getElementById("friction-phrase"),
  fConfirm: document.getElementById("friction-confirm"),
  fConfirmBtn: document.getElementById("friction-confirm-btn"),
  fCancel: document.getElementById("friction-cancel"),
};

// Best-effort message send; never let messaging rejections crash the page.
function send(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(() => ({ ok: false }));
  } catch {
    return Promise.resolve({ ok: false });
  }
}

const originsFor = (host) => [`*://${host}/*`, `*://*.${host}/*`];

async function hasPermission(host) {
  try {
    return await chrome.permissions.contains({ origins: originsFor(host) });
  } catch {
    return true; // if the API is unavailable, don't nag the user
  }
}

async function requestPermission(host) {
  try {
    return await chrome.permissions.request({ origins: originsFor(host) });
  } catch {
    return false;
  }
}

// ---------- Blocklist ----------

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

async function renderDomains() {
  const domains = await store.getDomains();
  els.domainList.replaceChildren();

  if (domains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-note";
    empty.textContent = "No custom domains yet. The built-in list is always on.";
    els.domainList.append(empty);
    return;
  }

  for (const domain of domains) {
    const row = document.createElement("li");
    row.className = "domain-row";

    const name = document.createElement("span");
    name.className = "domain-name";
    name.textContent = domain;
    row.append(name);

    // Per-row permission affordance: only shown when access is NOT granted.
    // Curated/static domains always have permission, so this only appears on
    // user-added rows lacking the optional grant.
    if (!(await hasPermission(domain))) {
      const grant = document.createElement("button");
      grant.type = "button";
      grant.className = "grant-badge";
      grant.textContent = "Grant access to block this";
      grant.addEventListener("click", async () => {
        await requestPermission(domain);
        renderDomains();
      });
      row.append(grant);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-btn";
    remove.textContent = "Remove";
    remove.setAttribute("data-remove", domain);
    remove.addEventListener("click", () =>
      openCooldownModal({
        title: `Remove ${domain}?`,
        requestType: "request-remove",
        requestPayload: { domain },
        confirmType: "confirm-remove",
        confirmLabel: "Remove",
        onDone: renderDomains,
      })
    );
    row.append(remove);

    els.domainList.append(row);
  }
}

async function onAdd() {
  const raw = els.domainInput.value;
  els.addError.hidden = true;

  // 1. Ask the worker to store + rebuild DNR. It normalizes the input.
  const res = await send({ type: "add-domain", domain: raw });
  if (!res || !res.ok) {
    els.addError.hidden = false;
    return;
  }

  // 2. Re-render immediately — the list must update independently of the
  //    permission grant below (which may be denied or unavailable in headless).
  els.domainInput.value = "";
  await renderDomains();

  // 3. THEN request the optional host permission from this user gesture.
  await requestPermission(res.host);

  // 4. Reflect any change to permission state on the row.
  await renderDomains();
}

// ---------- Friction modal ----------
// One overlay, used to turn protection OFF (remove a domain, or disable the
// extended tier): a 5-minute cooldown + type-to-confirm. Deliberately hard.

const FRICTION_BODY =
  "Removing protection has a 5 minute cooldown. This pause is on purpose. It gives your future self a chance to weigh in.";

let modal = { pending: null, timer: null, confirmType: null, onDone: null };

function updateConfirmEnabled() {
  const unlocked = isUnlocked(modal.pending, Date.now());
  const phraseOk = confirmPhraseMatches(els.fConfirm.value);
  els.fConfirm.disabled = !unlocked;
  els.fConfirmBtn.disabled = !(unlocked && phraseOk);
}

function tickModal() {
  if (!modal.pending) return;
  const remainingMs = modal.pending.unlockAt - Date.now();
  els.fTimer.textContent = formatTime(Math.ceil(Math.max(0, remainingMs) / 1000));
  updateConfirmEnabled();
}

async function openCooldownModal({ title, requestType, requestPayload = {}, confirmType, confirmLabel = "Remove", onDone }) {
  const res = await send({ type: requestType, ...requestPayload });
  const unlockAt = res && res.ok ? res.unlockAt : Date.now() + 5 * 60 * 1000;
  modal = { pending: { unlockAt }, timer: null, confirmType, onDone };

  els.fTitle.textContent = title;
  els.fBody.textContent = FRICTION_BODY;
  els.fConfirmBtn.textContent = confirmLabel;
  els.fPhrase.textContent = CONFIRM_PHRASE;
  els.fConfirm.placeholder = CONFIRM_PHRASE;
  els.fConfirm.value = "";
  els.fConfirm.disabled = true;
  els.fConfirmBtn.disabled = true;
  els.overlay.hidden = false;
  tickModal();
  modal.timer = setInterval(tickModal, 1000);
}

function closeModal() {
  if (modal.timer) clearInterval(modal.timer);
  modal = { pending: null, timer: null, confirmType: null, onDone: null };
  els.overlay.hidden = true;
}

async function onConfirm() {
  const res = await send({ type: modal.confirmType, phrase: els.fConfirm.value });
  if (!(res && res.ok)) {
    updateConfirmEnabled(); // cooldown not elapsed or phrase mismatch — keep the gate up
    return;
  }
  const done = modal.onDone;
  closeModal();
  if (done) await done();
}

// ---------- Your Why ----------

const WHY_PLACEHOLDER = "Add a personal reason you'll see mid-intervention.";
let whyValue = ""; // canonical saved value, drives display mode
let whySavedTimer = null;

function renderWhyDisplay() {
  if (whyValue) {
    els.whyText.textContent = whyValue;
    els.whyText.classList.remove("why-text-empty");
  } else {
    els.whyText.textContent = WHY_PLACEHOLDER;
    els.whyText.classList.add("why-text-empty");
  }
  els.whyDisplay.hidden = false;
  els.whyEdit.hidden = true;
}

function enterWhyEdit() {
  els.whyInput.value = whyValue;
  els.whySaved.hidden = true;
  els.whyDisplay.hidden = true;
  els.whyEdit.hidden = false;
  els.whyInput.focus();
}

async function saveWhy() {
  const value = els.whyInput.value.trim();
  await store.setSettings({ whyStatement: value });
  whyValue = value;
  renderWhyDisplay();
  els.whySaved.hidden = false;
  if (whySavedTimer) clearTimeout(whySavedTimer);
  whySavedTimer = setTimeout(() => { els.whySaved.hidden = true; }, 1500);
}

function cancelWhy() {
  renderWhyDisplay();
}

// ---------- Intervention ----------

function reflectSurf(seconds) {
  els.surfValue.textContent = `${seconds}s`;
}

const BREATH_HELP = {
  box: "Equal 4-4-4-4. Steady and grounding.",
  478: "In 4, hold 7, out 8. The long exhale calms fastest.",
};

function reflectBreath(pattern) {
  for (const btn of els.breathToggle.querySelectorAll(".seg")) {
    btn.classList.toggle("active", btn.dataset.pattern === pattern);
  }
  els.breathHelp.textContent = BREATH_HELP[pattern] || "";
}

// ---------- Built-in blocklist summary ----------

async function renderBuiltinCount() {
  try {
    const res = await fetch(chrome.runtime.getURL("rules/curated.json"));
    const rules = await res.json();
    els.builtinCount.textContent = String(rules.length);
  } catch {
    els.builtinCount.textContent = "—";
  }
}

// ---------- Extended blocklist tier ----------

let extendedDomains = null; // cached list for the permission request

async function loadExtendedDomains() {
  if (extendedDomains) return extendedDomains;
  try {
    const res = await fetch(chrome.runtime.getURL("rules/extended.json"));
    const rules = await res.json();
    extendedDomains = rules.map((r) => r.condition.requestDomains[0]);
  } catch {
    extendedDomains = [];
  }
  return extendedDomains;
}

function paintExtended(enabled) {
  els.extendedToggle.classList.toggle("on", enabled);
  els.extendedToggle.setAttribute("aria-checked", enabled ? "true" : "false");
}

async function renderExtended() {
  const res = await send({ type: "get-extended" });
  paintExtended(!!res?.enabled);
}

async function onToggleExtended() {
  const res = await send({ type: "get-extended" });
  const currentlyOn = !!res?.enabled;

  if (currentlyOn) {
    // Turning OFF is gated behind the cooldown friction — protection shouldn't
    // come off with a casual flick of the switch.
    openCooldownModal({
      title: "Turn off the extended blocklist?",
      requestType: "request-disable-extended",
      confirmType: "confirm-disable-extended",
      confirmLabel: "Turn it off",
      onDone: renderExtended,
    });
  } else {
    // Turning ON goes straight to Chrome's permission prompt for the extended
    // domains — that prompt (access to 300+ sites) IS the deliberate gate, and
    // it's the same flow as adding a custom domain. No extra modal in between.
    await enableExtended();
  }
}

async function enableExtended() {
  // Runs inside the toggle-click gesture, so chrome.permissions.request is allowed.
  const domains = extendedDomains || (await loadExtendedDomains());
  const origins = domains.flatMap(originsFor);
  let granted = true;
  try {
    granted = await chrome.permissions.request({ origins });
  } catch {
    granted = false;
  }
  if (!granted) {
    els.extendedHelp.textContent = "Permission is needed to block these sites. Not enabled.";
    paintExtended(false);
    return;
  }
  const out = await send({ type: "set-extended", enabled: true });
  paintExtended(!!out?.enabled);
}

// ---------- Stats ----------

function renderStats(stats) {
  els.statSurfs.textContent = String(stats.surfsCompleted ?? 0);
  els.statEncounters.textContent = String(stats.encounters ?? 0);

  els.triggerChart.replaceChildren();
  const entries = Object.entries(stats.triggers || {});
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "No triggers logged yet.";
    els.triggerChart.append(empty);
    return;
  }

  const max = Math.max(...entries.map(([, n]) => n), 1);
  for (const [name, count] of entries) {
    const col = document.createElement("div");
    col.className = "chart-col";

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${Math.round((count / max) * 64) + 3}px`;
    bar.title = `${name}: ${count}`;

    const label = document.createElement("div");
    label.className = "chart-name";
    label.textContent = name;

    col.append(bar, label);
    els.triggerChart.append(col);
  }
}

// ---------- Take a breath (on demand) ----------

// Open the intervention page in a new tab so the user can run the breathing
// exercise any time. chrome.tabs.create needs no extra permission; fall back to
// window.open when chrome.tabs is unavailable (e.g. a plain page realm).
function openBreathing() {
  const url = chrome.runtime.getURL("pages/blocked.html?mode=self");
  try {
    if (chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
      return;
    }
  } catch {
    // fall through to window.open
  }
  window.open(url, "_blank");
}

// ---------- Init ----------

async function init() {
  // Settings
  const settings = await store.getSettings();
  whyValue = settings.whyStatement || "";
  renderWhyDisplay();

  const surf = Number(settings.surfSeconds) || 90;
  els.surfRange.value = String(surf);
  reflectSurf(surf);
  reflectBreath(settings.breathPattern || "478");

  // Stats
  renderStats(await store.getStats());

  // Domains
  await renderDomains();
  renderBuiltinCount();
  renderExtended();

  // ----- Wiring -----
  els.breatheNow.addEventListener("click", openBreathing);

  els.addBtn.addEventListener("click", onAdd);
  els.domainInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onAdd(); }
  });
  els.domainInput.addEventListener("input", () => { els.addError.hidden = true; });

  els.whyEditBtn.addEventListener("click", enterWhyEdit);
  els.whyText.addEventListener("click", () => {
    if (!whyValue) enterWhyEdit(); // clicking the placeholder starts editing
  });
  els.whySaveBtn.addEventListener("click", saveWhy);
  els.whyCancelBtn.addEventListener("click", cancelWhy);

  let surfSavedTimer = null;
  els.surfRange.addEventListener("input", () => {
    reflectSurf(Number(els.surfRange.value));
    els.surfValue.classList.add("dragging");      // live value lights up while dragging
    els.surfValue.classList.remove("saved");
  });
  els.surfRange.addEventListener("change", async () => {
    await store.setSettings({ surfSeconds: Number(els.surfRange.value) });
    els.surfValue.classList.remove("dragging");
    els.surfValue.classList.add("saved");          // confirm it persisted on release
    if (surfSavedTimer) clearTimeout(surfSavedTimer);
    surfSavedTimer = setTimeout(() => els.surfValue.classList.remove("saved"), 1400);
  });

  els.breathToggle.addEventListener("click", async (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    const pattern = btn.dataset.pattern;
    reflectBreath(pattern);
    await store.setSettings({ breathPattern: pattern });
  });

  els.extendedToggle.addEventListener("click", onToggleExtended);

  els.fConfirm.addEventListener("input", updateConfirmEnabled);
  els.fConfirmBtn.addEventListener("click", onConfirm);
  els.fCancel.addEventListener("click", closeModal);
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) closeModal();
  });

  loadExtendedDomains(); // preload so the enable gesture isn't broken by a fetch
}

init();
