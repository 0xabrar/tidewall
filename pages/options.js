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
    empty.textContent = "No custom domains yet — the built-in list is always on.";
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
    remove.addEventListener("click", () => openFriction(domain));
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

// ---------- Friction removal ----------

let friction = { domain: null, pending: null, timer: null };

function updateConfirmEnabled() {
  const unlocked = isUnlocked(friction.pending, Date.now());
  const phraseOk = confirmPhraseMatches(els.fConfirm.value);
  // The text input stays disabled until the cooldown elapses; the confirm
  // button additionally requires the exact phrase.
  els.fConfirm.disabled = !unlocked;
  els.fConfirmBtn.disabled = !(unlocked && phraseOk);
}

function tickFriction() {
  if (!friction.pending) return;
  const remainingMs = friction.pending.unlockAt - Date.now();
  els.fTimer.textContent = formatTime(Math.ceil(Math.max(0, remainingMs) / 1000));
  updateConfirmEnabled();
}

async function openFriction(domain) {
  // Start (or restart) the cooldown via the worker; it returns unlockAt.
  const res = await send({ type: "request-remove", domain });
  const unlockAt = res && res.ok ? res.unlockAt : Date.now() + 5 * 60 * 1000;

  friction.domain = domain;
  friction.pending = { type: "remove", payload: domain, unlockAt };

  els.fDomain.textContent = domain;
  els.fPhrase.textContent = CONFIRM_PHRASE;
  els.fConfirm.placeholder = CONFIRM_PHRASE;
  els.fConfirm.value = "";
  els.fConfirm.disabled = true;
  els.fConfirmBtn.disabled = true;

  els.overlay.hidden = false;
  tickFriction();

  if (friction.timer) clearInterval(friction.timer);
  friction.timer = setInterval(tickFriction, 1000);
}

function closeFriction() {
  if (friction.timer) clearInterval(friction.timer);
  friction = { domain: null, pending: null, timer: null };
  els.overlay.hidden = true;
}

async function onConfirmRemove() {
  const res = await send({ type: "confirm-remove", phrase: els.fConfirm.value });
  if (res && res.ok) {
    closeFriction();
    await renderDomains();
  } else {
    // Cooldown not elapsed or phrase mismatch — keep the gate up.
    updateConfirmEnabled();
  }
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
  478: "In 4, hold 7, out 8 — the long exhale calms fastest.",
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
    await send({ type: "set-extended", enabled: false });
    paintExtended(false);
    return;
  }

  // Turning ON: needs host access to the extended domains (one prompt).
  const domains = await loadExtendedDomains();
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
  reflectBreath(settings.breathPattern || "box");

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

  els.surfRange.addEventListener("input", () => {
    reflectSurf(Number(els.surfRange.value));
  });
  els.surfRange.addEventListener("change", async () => {
    await store.setSettings({ surfSeconds: Number(els.surfRange.value) });
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
  els.fConfirmBtn.addEventListener("click", onConfirmRemove);
  els.fCancel.addEventListener("click", closeFriction);
  els.overlay.addEventListener("click", (e) => {
    if (e.target === els.overlay) closeFriction();
  });
}

init();
