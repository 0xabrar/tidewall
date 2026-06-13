# Tidewall

A **local-only** Chrome extension that blocks pornography sites and redirects to a calm,
CBT-based intervention page (breathing + urge-surfing) instead of a generic error.

## Why local / unpacked?

Tidewall is loaded as an **unpacked extension** — never published to the Chrome Web
Store. Extension supply-chain attacks (ownership changes, malicious auto-updates,
over-broad permissions) are a real risk. A self-authored extension with **no auto-update**,
**no remote code**, **no network calls**, and **no telemetry** sidesteps all of it. The
whole thing is ~a few hundred lines you can audit.

## Permissions (honest version)

```
permissions:               ["declarativeNetRequest", "storage"]
host_permissions:          <generated from the blocklist only>   e.g. *://*.pornhub.com/*
optional_host_permissions: ["*://*/*"]   (requested per-domain, only when YOU add one)
```

Chrome requires host access to *redirect* a request — that's how the calm intervention
page replaces the blocked site (a plain block can't show a custom page). Tidewall narrows
that access to **exactly the sites on your blocklist** and nothing else:

- **Curated blocklist** → host access is baked in (generated from `data/curated-domains.js`),
  so the built-in list works out of the box.
- **Extended blocklist** → ~327 more sites (`data/curated-domains-extended.js`), also baked in
  and **on by default**, so the wider net works immediately. You can turn it off in Settings —
  gated by the same cooldown + type-to-confirm friction as removing a domain.
- **Domains you add** → Chrome shows a one-time permission prompt *for that specific domain*
  when you add it (via `optional_host_permissions`). Allow once, it's permanent.

So Tidewall can only ever touch the sites it blocks — **not your general browsing** — and
since there is no network code, nothing leaves your machine regardless.

There is **no bypass button**. The only way to reach a blocked site is to remove its domain
in Settings, which is gated behind a 5-minute cooldown + type-to-confirm — a deliberate,
calm-moment decision, never an impulsive one.

## Architecture

- **Blocking:** Chrome's `declarativeNetRequest` matches and redirects — the extension's own
  code is never invoked on a blocked navigation.
- **Source of truth:** `chrome.storage.local` holds your domains/settings/stats; DNR dynamic
  rules are a derived projection, rebuilt on install/startup/change. Curated domains are
  static, shipped as `rules/curated.json`.

## Develop

```bash
npm test              # unit tests (domains, friction, rule builder, storage)
npm run build:rules   # regenerate rules/curated.json + manifest host_permissions
                      #   from data/curated-domains.js (run after editing the list)
npm run e2e           # full integration suite: loads the real extension in headless
                      #   Chromium and asserts redirect + block page + settings + friction
npm run e2e load redirect   # run a subset of e2e checks
```

The e2e harness (`test/e2e/harness.mjs`) loads the unpacked extension, resolves the
extension ID from the live service worker, and verifies real browser behavior. The redirect
check uses `declarativeNetRequest.testMatchOutcome`, so it **never navigates to an actual
adult site** — it confirms a curated domain redirects while an off-list domain does not.

Requires Node 18+ (uses the built-in `node:test` runner) and Playwright's Chromium
(`npx playwright install chromium`).

## Install

1. `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder
4. For the built-in list, Chrome grants host access **silently** on an unpacked load (you can
   see exactly what it can touch under the extension's **Details**). A Web Store install would
   show that as a prompt instead.

### Incognito (important)

People often use Incognito for this, but **Chrome keeps every extension off in Incognito until
you explicitly allow it** — there is no manifest setting that can turn this on automatically
(it's a deliberate Chrome security rule). To stay protected in Incognito:

- `chrome://extensions` → **Details** on Tidewall → enable **Allow in Incognito**.

If a blocked site shows `ERR_BLOCKED_BY_CLIENT` instead of the calm page, another content
blocker (e.g. Adblock Plus) is cancelling the redirected page. With Tidewall alone the redirect
renders correctly (covered by the `liveredirect` e2e check); disable other blockers in Incognito
to confirm.
