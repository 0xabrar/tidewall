# Chrome Web Store Listing — Tidewall

> Last Updated: 2026-06-20
> This file is a copy-paste source for the Chrome Web Store dashboard. It is NOT
> shipped in the extension package (excluded by `npm run package`).

## Store Listing

**Extension Name** [REQUIRED]
Tidewall: Porn Blocker & Adult Site Filter

**Short Description** [REQUIRED] _(114 / 132 chars)_
Porn blocker that redirects adult sites to a calm breathing exercise. Block porn and 18+ sites. Private and local.

**Detailed Description** [REQUIRED]

```
Tidewall blocks pornography and adult websites. Instead of a blank error page, it gently opens a calm breathing exercise to help the urge pass.

FEATURES
• Blocks a large built-in list of adult sites (400+), on by default, including tubes, cam sites, hentai, and international sites.
• Replaces the blocked page with a quiet, guided breathing exercise (4-7-8 or box breathing) so you can ride out the urge instead of hitting a dead error screen.
• A short, optional check-in afterward helps you notice how you were feeling and choose something else to do.
• Add your own sites or URLs to block, any time.
• Turning protection off has a deliberate cooldown and a type-to-confirm step, so it's always a calm, intentional decision, never an impulsive one.
• Works in Incognito once you allow it (see below).

HOW TO USE
1. Install Tidewall. The built-in blocklist is active right away.
2. When you open a blocked site, you'll land on a calm breathing screen instead.
3. Breathe, check in, and pick something else to do.
4. Click the Tidewall toolbar icon to open Settings, where you can add your own sites or change how long the breathing runs.

To stay protected while browsing privately, open chrome://extensions, click Details on Tidewall, and turn on "Allow in Incognito."

PRIVACY
Tidewall collects nothing and sends nothing anywhere. Your blocklist, settings, and a local tally of urges surfed are stored only on your device. No accounts, no analytics, no tracking, and no network connections of any kind.

PERMISSIONS
• "Read and change your data on" the blocklisted sites: used only to redirect those specific adult sites to the calm breathing page. Tidewall can only ever touch the sites on its blocklist, never your general browsing.
• Storage: saves your blocklist, settings, and local stats on your device.

SUPPORT
Questions or suggestions? Email hello@getansel.app or open an issue at https://github.com/0xabrar/tidewall

Version 0.1.0. Initial release.
```

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Blocks adult and pornographic websites and redirects them to a calm breathing exercise.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `store-assets/screenshot-1-block-framed.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `store-assets/screenshot-2-settings-framed.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |

### Screenshot Notes
- **Screenshot 1** — the calm "block page" intervention (breathing screen). This is the core experience and contains no adult content.
- **Screenshot 2** — the Settings page (blocklist + breathing controls), showing it's local and configurable.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `declarativeNetRequest` | permissions | Redirects the specific adult sites on the blocklist to the extension's own calm breathing page. It matches and redirects requests; it does not read page content. |
| `storage` | permissions | Stores the user's blocklist, breathing settings, and a local count of "urges surfed" — entirely on the user's device. |
| Adult-domain host access (~412 domains) | host_permissions | Chrome requires host access to *redirect* a request. Access is scoped to exactly the blocklisted adult domains so the breathing page can replace them — the extension cannot touch any other website. |
| `*://*/*` | host_permissions (optional) | Requested per-domain, only at the moment the user manually adds their own site to block. Never granted wholesale; Chrome prompts for that one domain when they add it. |

## Privacy & Data Use

**Does the extension collect user data?** **No.**

All data (blocklist, settings, local stats) is stored on-device via Chrome's local
storage and never transmitted. No network calls, no analytics, no third parties.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
`https://0xabrar.github.io/tidewall/privacy`
<!-- Hosted via GitHub Pages (main branch /docs/privacy/index.html). The repo
     copy at github.com/0xabrar/tidewall/blob/main/PRIVACY.md mirrors it. -->

**Homepage / landing**: `https://0xabrar.github.io/tidewall/`

## Distribution

**Visibility**: Public  <!-- Use "Unlisted" if you only want to share it via direct link. -->
**Regions**: All regions

## Developer Info

**Publisher Name** [REQUIRED]: Ansel
**Contact Email** [REQUIRED]: hello@getansel.app  _(shown publicly)_
**Support URL / Email** [RECOMMENDED]: hello@getansel.app · https://github.com/0xabrar/tidewall/issues
**Homepage URL** [RECOMMENDED]: https://github.com/0xabrar/tidewall

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-06-20 | Draft update: custom additions paginate cleanly, including dark-mode controls, and custom blocking now uses the same redirect-rule builder and host permission patterns as the built-in blocklist. | Draft |

## Review Notes

### Known Issues / Limitations
- **The long host-permission list IS the blocklist.** The ~412 adult domains in
  `host_permissions` are the sites Tidewall blocks; host access is required to
  redirect them to the breathing page. It is not over-broad — it cannot access
  any site outside the blocklist.
- **`web_accessible_resources` is `<all_urls>`** for `pages/blocked.html` only:
  that page is the redirect *target*, and since users can add arbitrary domains
  to block, the matches can't be narrowed. No other resources are web-accessible.
- **Incognito**: protection requires the user to enable "Allow in Incognito"
  (a deliberate Chrome rule, not something an extension can set).

### Rejection History
<!-- (none yet) -->
