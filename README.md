# ClearHead

A **local-only** Chrome extension that blocks pornography sites and redirects to a calm,
CBT-based intervention page (breathing + urge-surfing) instead of a generic error.

## Why local / unpacked?

ClearHead is loaded as an **unpacked extension** — never published to the Chrome Web
Store. Extension supply-chain attacks (ownership changes, malicious auto-updates,
over-broad permissions) are a real risk. A self-authored extension with **no auto-update**
and the **absolute minimum permissions** sidesteps all of it.

Permissions are intentionally tiny:

```
permissions: ["declarativeNetRequest", "storage"]
```

**No `tabs`, no host access, no network.** Chrome itself does the blocking via
`declarativeNetRequest`; the extension never sees your browsing and has nothing to
exfiltrate.

## Status

Pre-implementation. See the design doc:
[`docs/plans/2026-06-12-clearhead-porn-blocker-design.md`](docs/plans/2026-06-12-clearhead-porn-blocker-design.md)

## Install (once built)

1. `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder
