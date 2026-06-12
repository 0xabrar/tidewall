// ClearHead — blocklist review page.
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
  builtinList: document.getElementById("builtin-list"),
};

async function loadCurated() {
  try {
    const res = await fetch(chrome.runtime.getURL("rules/curated.json"));
    const rules = await res.json();
    return rules
      .map((rule) => rule?.condition?.requestDomains?.[0])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
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

function subtitleText(builtinCount, customCount) {
  const builtin = `${builtinCount} built-in site${builtinCount === 1 ? "" : "s"}`;
  if (customCount === 0) return builtin;
  return `${builtin} + ${customCount} of your own`;
}

async function init() {
  const [curated, custom] = await Promise.all([loadCurated(), store.getDomains()]);

  els.subtitle.textContent = subtitleText(curated.length, custom.length);

  if (custom.length > 0) {
    renderList(els.customList, [...custom].sort((a, b) => a.localeCompare(b)));
    els.customCard.hidden = false;
  }

  renderList(els.builtinList, curated);
}

init();
