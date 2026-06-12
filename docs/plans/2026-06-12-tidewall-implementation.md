# Tidewall Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-only Manifest V3 Chrome extension that blocks porn domains via `declarativeNetRequest` and redirects blocked tabs to a calm, CBT-based intervention page, with a settings page whose protection-removal is gated behind a friction cooldown.

**Architecture:** Chrome's `declarativeNetRequest` does all blocking/redirecting (extension never sees browsing). `chrome.storage.local` is the single source of truth for user domains, settings, and stats; DNR *dynamic* rules are a derived projection rebuilt from storage on install/startup/change. Curated domains are static, shipped as a generated DNR ruleset. Pure logic (domain normalization, friction cooldown) lives in small `lib/` modules that are unit-tested with Node's test runner; the extension surfaces (background worker, block page, settings page) are wired on top and verified with a manual load-unpacked checklist.

**Tech Stack:** Vanilla JS (no framework), Manifest V3, `declarativeNetRequest` + `storage` permissions only, Node.js built-in test runner (`node:test`) for unit tests, ES modules (`.mjs`) for the build script, Geist typeface (self-hosted woff2, no italics).

**Conventions:** DRY, YAGNI, TDD for pure logic, frequent commits. Exact paths below. No `tabs`/host/network permissions — ever.

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.gitignore` (already exists — verify)
- Create: directory structure

**Step 1: Create `package.json`**

```json
{
  "name": "tidewall",
  "version": "0.1.0",
  "description": "Local-only Chrome extension: blocks porn sites and redirects to a calm CBT intervention page.",
  "type": "module",
  "private": true,
  "scripts": {
    "build:rules": "node scripts/build-rules.mjs",
    "test": "node --test"
  }
}
```

**Step 2: Create the directory skeleton**

Run:
```bash
cd ~/code/tidewall
mkdir -p rules data src/lib pages scripts test assets/fonts
```

**Step 3: Verify tooling**

Run: `node --version` (expect v18+ so `node:test` and `--test` exist) and `which google-chrome`.
Expected: a Node 18+ version and a chrome path.

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: scaffold Tidewall project structure"
```

---

## Task 1: Domain normalization (`lib/domains.js`) — pure, TDD

Normalizes arbitrary user input ("https://www.Example.com/path", "EXAMPLE.com") into a
canonical registrable host ("example.com") and validates it. Used both by the settings
"add domain" flow and the rule builder.

**Files:**
- Create: `src/lib/domains.js`
- Test: `test/domains.test.js`

**Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, isValidDomain } from "../src/lib/domains.js";

test("strips scheme, path, www, and lowercases", () => {
  assert.equal(normalizeDomain("https://www.Example.com/foo?x=1"), "example.com");
  assert.equal(normalizeDomain("  EXAMPLE.com  "), "example.com");
  assert.equal(normalizeDomain("sub.example.co.uk"), "sub.example.co.uk");
});

test("rejects empty / malformed input", () => {
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("not a domain"), null);
  assert.equal(normalizeDomain("http://"), null);
});

test("isValidDomain mirrors normalize", () => {
  assert.equal(isValidDomain("example.com"), true);
  assert.equal(isValidDomain("nope nope"), false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/domains.test.js`
Expected: FAIL (module/exports not found).

**Step 3: Write minimal implementation**

```js
// src/lib/domains.js
// Pure helpers — no chrome APIs. Normalizes user input to a registrable host.

export function normalizeDomain(input) {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  // Add a scheme so URL() can parse bare hosts.
  if (!/^[a-z]+:\/\//.test(s)) s = "https://" + s;
  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  if (host.startsWith("www.")) host = host.slice(4);
  // Must look like a domain: at least one dot, valid label chars.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return host;
}

export function isValidDomain(input) {
  return normalizeDomain(input) !== null;
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/domains.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/domains.js test/domains.test.js
git commit -m "feat: add domain normalization/validation"
```

---

## Task 2: Friction cooldown logic (`lib/friction.js`) — pure, TDD

Encapsulates the "removing protection has a cooldown" rule. Pure functions over an
injected `now` timestamp (so tests are deterministic and we never call `Date.now()` inside
the logic).

**Files:**
- Create: `src/lib/friction.js`
- Test: `test/friction.test.js`

**Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { startCooldown, isUnlocked, confirmPhraseMatches, DEFAULT_COOLDOWN_MS } from "../src/lib/friction.js";

test("startCooldown sets unlockAt = now + duration", () => {
  const p = startCooldown({ type: "remove", payload: "example.com" }, 1000, 60_000);
  assert.equal(p.unlockAt, 61_000);
  assert.equal(p.type, "remove");
});

test("isUnlocked only after unlockAt", () => {
  const p = startCooldown({ type: "remove", payload: "x" }, 0, 60_000);
  assert.equal(isUnlocked(p, 59_999), false);
  assert.equal(isUnlocked(p, 60_000), true);
});

test("confirm phrase must match exactly (trimmed)", () => {
  assert.equal(confirmPhraseMatches("  I am choosing to remove this  "), true);
  assert.equal(confirmPhraseMatches("i am choosing to remove this"), false);
});

test("default cooldown is 5 minutes", () => {
  assert.equal(DEFAULT_COOLDOWN_MS, 5 * 60 * 1000);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/friction.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

```js
// src/lib/friction.js
// Pure friction/cooldown logic. `now` is always injected.

export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;
export const CONFIRM_PHRASE = "I am choosing to remove this";

export function startCooldown(change, now, durationMs = DEFAULT_COOLDOWN_MS) {
  return { ...change, unlockAt: now + durationMs };
}

export function isUnlocked(pending, now) {
  return !!pending && now >= pending.unlockAt;
}

export function confirmPhraseMatches(input) {
  return typeof input === "string" && input.trim() === CONFIRM_PHRASE;
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/friction.test.js`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/lib/friction.js test/friction.test.js
git commit -m "feat: add friction cooldown logic"
```

---

## Task 3: Curated domains + rule builder (`build-rules.mjs`) — TDD

Generates `rules/curated.json` (static DNR redirect ruleset) from an editable source list.
Each rule redirects a matched domain to the local `blocked.html`.

**Files:**
- Create: `data/curated-domains.js`
- Create: `scripts/build-rules.mjs`
- Create: `rules/curated.json` (generated output, committed)
- Test: `test/build-rules.test.js`

**Step 1: Create the source list**

```js
// data/curated-domains.js
// Editable curated list of adult domains. Keep one host per line, no scheme.
export const CURATED_DOMAINS = [
  "pornhub.com",
  "xvideos.com",
  "xnxx.com",
  "redtube.com",
  "youporn.com",
  "xhamster.com",
  "onlyfans.com",
  "chaturbate.com",
  "spankbang.com",
  "brazzers.com",
  // ...extend as needed
];
```

**Step 2: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRules } from "../scripts/build-rules.mjs";

test("builds one redirect rule per domain with unique ids in curated range", () => {
  const rules = buildRules(["a.com", "b.com"]);
  assert.equal(rules.length, 2);
  const ids = rules.map(r => r.id);
  assert.equal(new Set(ids).size, 2);            // unique
  assert.ok(ids.every(id => id >= 1 && id < 100000)); // curated range (< dynamic 100000)
});

test("rule redirects to the local blocked page via extensionPath", () => {
  const [rule] = buildRules(["a.com"]);
  assert.equal(rule.action.type, "redirect");
  assert.equal(rule.action.redirect.extensionPath, "/pages/blocked.html");
  assert.equal(rule.condition.requestDomains[0], "a.com");
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
});
```

**Step 3: Run test to verify it fails**

Run: `node --test test/build-rules.test.js`
Expected: FAIL.

**Step 4: Write minimal implementation**

```js
// scripts/build-rules.mjs
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CURATED_DOMAINS } from "../data/curated-domains.js";

export function buildRules(domains) {
  return domains.map((domain, i) => ({
    id: i + 1, // curated IDs occupy 1..99999; dynamic user rules start at 100000
    priority: 1,
    action: { type: "redirect", redirect: { extensionPath: "/pages/blocked.html" } },
    condition: { requestDomains: [domain], resourceTypes: ["main_frame"] },
  }));
}

// When run directly, write rules/curated.json
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, "..", "rules", "curated.json");
  await writeFile(out, JSON.stringify(buildRules(CURATED_DOMAINS), null, 2) + "\n");
  console.log(`Wrote ${out} (${CURATED_DOMAINS.length} rules)`);
}
```

**Step 5: Run tests, then generate the ruleset**

Run: `node --test test/build-rules.test.js` → Expected: PASS (2 tests).
Run: `npm run build:rules` → Expected: prints "Wrote .../rules/curated.json (N rules)".

**Step 6: Commit**

```bash
git add data/curated-domains.js scripts/build-rules.mjs rules/curated.json test/build-rules.test.js
git commit -m "feat: curated domain list and static DNR rule builder"
```

---

## Task 4: Storage wrapper (`lib/storage.js`) — TDD with a fake

Single source of truth accessor over `chrome.storage.local`. Tests inject a fake storage
object so they run under Node without Chrome.

**Files:**
- Create: `src/lib/storage.js`
- Test: `test/storage.test.js`

**Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStore, DEFAULT_SETTINGS } from "../src/lib/storage.js";

function fakeChromeStorage(initial = {}) {
  let data = { ...initial };
  return {
    local: {
      async get(keys) {
        if (Array.isArray(keys)) return Object.fromEntries(keys.map(k => [k, data[k]]));
        return { [keys]: data[keys] };
      },
      async set(obj) { data = { ...data, ...obj }; },
    },
  };
}

test("getDomains defaults to empty, addDomain normalizes + dedupes", async () => {
  const store = makeStore(fakeChromeStorage());
  assert.deepEqual(await store.getDomains(), []);
  await store.addDomain("https://www.Example.com/x");
  await store.addDomain("example.com"); // dup after normalize
  assert.deepEqual(await store.getDomains(), ["example.com"]);
});

test("settings fall back to defaults", async () => {
  const store = makeStore(fakeChromeStorage());
  assert.deepEqual(await store.getSettings(), DEFAULT_SETTINGS);
});

test("recordEncounter increments stats", async () => {
  const store = makeStore(fakeChromeStorage());
  await store.recordEncounter();
  const stats = await store.getStats();
  assert.equal(stats.encounters, 1);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test test/storage.test.js`
Expected: FAIL.

**Step 3: Write minimal implementation**

```js
// src/lib/storage.js
import { normalizeDomain } from "./domains.js";

export const DEFAULT_SETTINGS = { surfSeconds: 90, breathPattern: "box", whyStatement: "" };
const DEFAULT_STATS = { encounters: 0, surfsCompleted: 0, triggers: {} };

// `chromeStorage` defaults to the real chrome.storage when running in the extension.
export function makeStore(chromeStorage = globalThis.chrome?.storage) {
  const local = chromeStorage.local;

  async function get(key, fallback) {
    const res = await local.get([key]);
    return res[key] ?? fallback;
  }

  return {
    async getDomains() { return await get("userDomains", []); },
    async addDomain(input) {
      const host = normalizeDomain(input);
      if (!host) return { ok: false, error: "invalid" };
      const domains = await this.getDomains();
      if (!domains.includes(host)) await local.set({ userDomains: [...domains, host] });
      return { ok: true, host };
    },
    async removeDomain(host) {
      const domains = await this.getDomains();
      await local.set({ userDomains: domains.filter(d => d !== host) });
    },
    async getSettings() { return { ...DEFAULT_SETTINGS, ...(await get("settings", {})) }; },
    async setSettings(patch) {
      await local.set({ settings: { ...(await this.getSettings()), ...patch } });
    },
    async getStats() { return { ...DEFAULT_STATS, ...(await get("stats", {})) }; },
    async recordEncounter() {
      const s = await this.getStats();
      await local.set({ stats: { ...s, encounters: s.encounters + 1 } });
    },
    async recordSurf() {
      const s = await this.getStats();
      await local.set({ stats: { ...s, surfsCompleted: s.surfsCompleted + 1 } });
    },
    async recordTrigger(name) {
      const s = await this.getStats();
      await local.set({ stats: { ...s, triggers: { ...s.triggers, [name]: (s.triggers[name] || 0) + 1 } } });
    },
    async getPendingUnlock() { return await get("pendingUnlock", null); },
    async setPendingUnlock(p) { await local.set({ pendingUnlock: p }); },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `node --test test/storage.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/storage.js test/storage.test.js
git commit -m "feat: chrome.storage.local wrapper as single source of truth"
```

---

## Task 5: Manifest + static ruleset wiring

**Files:**
- Create: `manifest.json`

**Step 1: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Tidewall",
  "version": "0.1.0",
  "description": "Blocks porn sites and redirects to a calm intervention page. Local-only.",
  "permissions": ["declarativeNetRequest", "storage"],
  "background": { "service_worker": "src/background.js", "type": "module" },
  "options_page": "pages/options.html",
  "declarative_net_request": {
    "rule_resources": [
      { "id": "curated", "enabled": true, "path": "rules/curated.json" }
    ]
  }
}
```

**Step 2: Verify it loads**

Run: `chrome://extensions` → Developer mode ON → Load unpacked → select `~/code/tidewall`.
Expected: Tidewall loads with no manifest errors. (No host/tabs permission prompt — confirm the permissions list shows only "declarativeNetRequest" essentially silently.)

**Step 3: Smoke-test blocking**

Navigate to one curated domain (e.g. `pornhub.com`).
Expected: redirected to `chrome-extension://…/pages/blocked.html` (will 404 until Task 7 — that's fine; confirm the *redirect* happens).

**Step 4: Commit**

```bash
git add manifest.json
git commit -m "feat: MV3 manifest with curated static ruleset, minimal permissions"
```

---

## Task 6: Background service worker (`src/background.js`)

Reconciles dynamic DNR rules from storage (single source of truth → derived projection),
and handles runtime messages from the pages (stats, add/remove with friction).

**Files:**
- Create: `src/background.js`

**Step 1: Write the worker**

```js
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
  const removeRuleIds = existing.map(r => r.id);
  const addRules = domains.map((d, i) => ruleForDomain(d, DYNAMIC_BASE_ID + i));
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

chrome.runtime.onInstalled.addListener(reconcile);
chrome.runtime.onStartup.addListener(reconcile);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "encounter": await store.recordEncounter(); return sendResponse({ ok: true });
      case "surf-complete": await store.recordSurf(); return sendResponse({ ok: true });
      case "trigger": await store.recordTrigger(msg.name); return sendResponse({ ok: true });
      case "add-domain": {
        const res = await store.addDomain(msg.domain);
        if (res.ok) await reconcile();
        return sendResponse(res);
      }
      case "request-remove": {
        const pending = startCooldown({ type: "remove", payload: msg.domain }, Date.now());
        await store.setPendingUnlock(pending);
        return sendResponse({ ok: true, unlockAt: pending.unlockAt });
      }
      case "confirm-remove": {
        const pending = await store.getPendingUnlock();
        if (!pending || !isUnlocked(pending, Date.now()) || !confirmPhraseMatches(msg.phrase)) {
          return sendResponse({ ok: false });
        }
        await store.removeDomain(pending.payload);
        await store.setPendingUnlock(null);
        await reconcile();
        return sendResponse({ ok: true });
      }
      default: return sendResponse({ ok: false, error: "unknown" });
    }
  })();
  return true; // keep the message channel open for async sendResponse
});
```

**Step 2: Reload and verify reconciliation**

Reload the unpacked extension. Open the service worker console (chrome://extensions → Tidewall → "service worker"). Run there:
```js
chrome.runtime.sendMessage({ type: "add-domain", domain: "example.com" }, console.log);
```
Then navigate to `example.com`.
Expected: response `{ok:true, host:"example.com"}`, and `example.com` now redirects to the block page.

**Step 3: Commit**

```bash
git add src/background.js
git commit -m "feat: background worker — reconcile dynamic rules + message handlers"
```

---

## Task 7: Block / intervention page (`pages/blocked.*`)

The calm, single-focal-point page from the approved mockup
(`docs/assets/block-page.png`). Geist, no italics, dark indigo→teal gradient, one glowing
breath+timer ring; everything else low-contrast. No bypass button.

**Files:**
- Create: `pages/blocked.html`
- Create: `pages/blocked.css`
- Create: `pages/blocked.js`
- Add: `assets/fonts/Geist[woff2]` (self-hosted; download the Geist variable woff2)

**Step 1: HTML structure**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="blocked.css" />
</head>
<body>
  <main class="wrap">
    <div class="ring" id="ring">
      <span class="breath" id="breath">Breathe</span>
      <span class="time" id="time">1:30</span>
    </div>
    <p class="reframe">The urge is a wave. Let it pass.</p>
    <section class="reflect">
      <p class="label">what's going on?</p>
      <div class="chips" id="chips">
        <button>anxious</button><button>bored</button><button>stressed</button>
        <button>lonely</button><button>tired</button>
      </div>
      <p class="why" id="why"></p>
      <input class="next" id="next" placeholder="What were you about to do instead?" />
    </section>
    <p class="foot" id="foot"></p>
  </main>
  <script type="module" src="blocked.js"></script>
</body>
</html>
```

**Step 2: CSS — implement the mockup**

Implement per `docs/assets/block-page.png` and the design doc §6:
- `@font-face` Geist from `../assets/fonts/`; `font-style: normal` everywhere (no italics).
- Full-viewport gradient `radial-gradient` indigo→teal; centered `.wrap` max-width 440px.
- `.ring`: large circle (~220px), conic/SVG progress ring, soft glow — the only bright element.
- `.reframe/.label/.chips/.why/.next/.foot`: low-contrast (e.g. `color: rgba(255,255,255,.45)`), small.
- Bump `.reframe` contrast slightly for WCAG (design doc §12 note).

**Step 3: JS — timer, breathing, stats, persistence**

```js
// pages/blocked.js
import { makeStore } from "../src/lib/storage.js";
const store = makeStore();

chrome.runtime.sendMessage({ type: "encounter" });

const settings = await store.getSettings();
document.getElementById("why").textContent = settings.whyStatement || "";

const stats = await store.getStats();
document.getElementById("foot").textContent = `${stats.surfsCompleted} urges surfed`;

// Urge-surf countdown
let remaining = settings.surfSeconds;
const timeEl = document.getElementById("time");
const render = () => {
  const m = Math.floor(remaining / 60), s = String(remaining % 60).padStart(2, "0");
  timeEl.textContent = `${m}:${s}`;
};
render();
const iv = setInterval(() => {
  remaining -= 1; render();
  if (remaining <= 0) { clearInterval(iv); chrome.runtime.sendMessage({ type: "surf-complete" }); }
}, 1000);

// Trigger logging (affect labeling)
document.getElementById("chips").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  e.target.classList.add("selected");
  chrome.runtime.sendMessage({ type: "trigger", name: e.target.textContent });
});
```

> Note: `blocked.js` imports `../src/lib/storage.js`; ensure paths resolve as packaged.
> The page also messages the worker (`encounter`, `surf-complete`, `trigger`).

**Step 4: Manual verification**

Reload extension → navigate to a blocked domain.
Expected: calm page renders with Geist; ring counts down from the configured time; clicking
a chip highlights it; "urges surfed" reflects stored stat; no bypass/exit button exists.

**Step 5: Commit**

```bash
git add pages/blocked.html pages/blocked.css pages/blocked.js assets/fonts
git commit -m "feat: calm intervention/block page (no bypass)"
```

---

## Task 8: Settings / options page (`pages/options.*`)

The quieted settings surface from `docs/assets/settings-page.png`: Blocklist (add +
friction-gated remove), Your Why, Intervention controls, Stats.

**Files:**
- Create: `pages/options.html`
- Create: `pages/options.css`
- Create: `pages/options.js`

**Step 1: HTML — four sections**

Sidebar (Blocklist / Your Why / Intervention / Stats) + main column with cards matching the
mockup. Include: add-domain input + button; domain list container; a hidden friction panel
(cooldown countdown + confirm input); a Why `<textarea>`; a surf-timer `<input type=range>`
+ breathing segmented toggle; a stats area with numbers + a simple bar chart container.

**Step 2: CSS — implement the mockup**

Per `docs/assets/settings-page.png` and design doc §6: light theme, near-white bg, white
cards, hairline borders, single teal accent for primary actions only, de-emphasized
uppercase gray section labels, Geist, no italics, generous spacing, ~620px column.

**Step 3: JS — wire to storage + friction**

```js
// pages/options.js
import { makeStore } from "../src/lib/storage.js";
import { isUnlocked } from "../src/lib/friction.js";
const store = makeStore();

async function renderDomains() {
  const domains = await store.getDomains();
  // render list with a "Remove" link per domain → calls startRemove(domain)
}

async function addDomain(value) {
  const res = await new Promise(r => chrome.runtime.sendMessage({ type: "add-domain", domain: value }, r));
  if (!res.ok) { /* show "invalid domain" */ } else { await renderDomains(); }
}

async function startRemove(domain) {
  const res = await new Promise(r => chrome.runtime.sendMessage({ type: "request-remove", domain }, r));
  // show friction panel; tick a countdown to res.unlockAt; enable confirm only when isUnlocked + phrase matches
}

async function confirmRemove(phrase) {
  const res = await new Promise(r => chrome.runtime.sendMessage({ type: "confirm-remove", phrase }, r));
  if (res.ok) await renderDomains();
}

// Why textarea → store.setSettings({ whyStatement })
// Surf-timer range → store.setSettings({ surfSeconds })
// Breathing toggle → store.setSettings({ breathPattern })
// Stats: render store.getStats() numbers + a minimal bar chart over triggers
```

**Step 4: Manual verification**

Open the options page (chrome://extensions → Tidewall → Details → Extension options).
Expected:
- Add a domain → appears in list → that domain now redirects.
- Click Remove → friction panel shows a 5-min countdown; confirm is disabled until the
  countdown ends AND the exact phrase is typed; only then is the domain removed.
- Why/timer/breathing changes persist (reflected on the block page).
- Stats numbers + trigger chart render.

**Step 5: Commit**

```bash
git add pages/options.html pages/options.css pages/options.js
git commit -m "feat: settings page with friction-gated removal, intervention controls, stats"
```

---

## Task 9: README polish + full manual acceptance pass

**Files:**
- Modify: `README.md` (add build/test/run instructions, link the design doc)

**Step 1: Update README**

Add: `npm test`, `npm run build:rules`, load-unpacked steps, and the minimal-permissions
rationale (already drafted in the design doc §11).

**Step 2: Full acceptance checklist (load unpacked, fresh profile if possible)**

- [ ] Extension loads with only `declarativeNetRequest` + `storage` — no host/tabs prompt.
- [ ] A curated domain redirects to the block page.
- [ ] Adding a custom domain redirects.
- [ ] Block page: ring counts down; cannot be skipped; chips log; "urges surfed" updates;
      no bypass button anywhere.
- [ ] Removing a domain enforces cooldown + exact-phrase confirm.
- [ ] Settings changes (why / timer / breathing) persist and affect the block page.
- [ ] `npm test` passes (domains, friction, build-rules, storage).
- [ ] Quit and relaunch Chrome → blocking still active (reconcile-on-startup works).

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: build/test/run instructions and acceptance checklist"
```

---

## Notes for the implementer

- **Never add `tabs`, host, or network permissions.** If a feature seems to need them,
  stop and reconsider — it's almost certainly a non-goal (see design doc §2).
- **`Date.now()` only in the worker**, never inside `lib/` pure logic (keep it injectable
  and testable).
- **Regenerate `rules/curated.json`** with `npm run build:rules` whenever
  `data/curated-domains.js` changes; commit the generated file.
- **Reference:** design doc at `docs/plans/2026-06-12-tidewall-porn-blocker-design.md`;
  mockups in `docs/assets/`.
