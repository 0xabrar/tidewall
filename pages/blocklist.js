// Tidewall — blocklist review page.
//
// Read-only view of everything the extension blocks: the curated built-in
// ruleset (loaded from the packaged rules/curated.json) plus any user-added
// custom domains. Deliberately offers NO way to edit the built-in list —
// custom domains are managed (with friction) in Settings.

import { makeStore } from "../src/lib/storage.js";

const store = makeStore();

const els = {
  subtitle: document.getElementById("counts-subtitle"),
  customCard: document.getElementById("custom-card"),
  customList: document.getElementById("custom-list"),
  customPager: document.getElementById("custom-pager"),
  customPrev: document.getElementById("custom-prev"),
  customNext: document.getElementById("custom-next"),
  customPageInfo: document.getElementById("custom-page-info"),
  builtinList: document.getElementById("builtin-list"),
  extendedList: document.getElementById("extended-list"),
  extendedState: document.getElementById("extended-state"),
};

const CUSTOM_PAGE_SIZE = 16;
let customPage = 0;
let customDomains = [];

async function loadRuleset(path) {
  try {
    const res = await fetch(chrome.runtime.getURL(path));
    const rules = await res.json();
    return rules
      .map((rule) => rule?.condition?.requestDomains?.[0])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function extendedEnabled() {
  try {
    const ids = await chrome.declarativeNetRequest.getEnabledRulesets();
    return ids.includes("extended");
  } catch {
    return false;
  }
}

function renderList(ul, domains) {
  ul.replaceChildren();
  for (const domain of domains) {
    const li = document.createElement("li");
    li.textContent = domain;
    ul.append(li);
  }
}

function renderCustomList() {
  els.customList.replaceChildren();
  if (customDomains.length === 0) {
    els.customPager.hidden = true;
    return;
  }

  const totalPages = Math.ceil(customDomains.length / CUSTOM_PAGE_SIZE);
  customPage = Math.min(Math.max(customPage, 0), totalPages - 1);
  const start = customPage * CUSTOM_PAGE_SIZE;
  const visibleDomains = customDomains.slice(start, start + CUSTOM_PAGE_SIZE);

  renderList(els.customList, visibleDomains);

  els.customPager.hidden = totalPages <= 1;
  els.customPrev.disabled = customPage === 0;
  els.customNext.disabled = customPage >= totalPages - 1;
  els.customPageInfo.textContent = `${start + 1}-${start + visibleDomains.length} of ${customDomains.length}`;
}

function subtitleText({ builtin, extended, custom }) {
  const parts = [`${builtin} built-in`];
  if (extended) parts.push(`${extended} extended`);
  if (custom) parts.push(`${custom} of your own`);
  return parts.join(" + ") + ". Each one redirects to a calm pause.";
}

async function init() {
  // Match the theme chosen in Settings (shares options.css; light is default).
  document.documentElement.dataset.theme = (await store.getTheme()) === "dark" ? "dark" : "light";

  const [curated, extended, custom, extOn] = await Promise.all([
    loadRuleset("rules/curated.json"),
    loadRuleset("rules/extended.json"),
    store.getDomains(),
    extendedEnabled(),
  ]);

  els.subtitle.textContent = subtitleText({
    builtin: curated.length,
    extended: extOn ? extended.length : 0,
    custom: custom.length,
  });

  if (custom.length > 0) {
    customDomains = [...custom].sort((a, b) => a.localeCompare(b));
    renderCustomList();
    els.customCard.hidden = false;
  }

  renderList(els.builtinList, curated);
  renderList(els.extendedList, extended);

  els.extendedState.textContent = extOn ? "on" : "off";
  els.extendedState.classList.toggle("on", extOn);
  // When on, these are live — show them at full strength, not dimmed.
  document.getElementById("extended-card").classList.toggle("inactive", !extOn);

  els.customPrev.addEventListener("click", () => {
    customPage -= 1;
    renderCustomList();
  });
  els.customNext.addEventListener("click", () => {
    customPage += 1;
    renderCustomList();
  });
}

init();
