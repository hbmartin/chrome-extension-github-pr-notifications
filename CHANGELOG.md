# Changelog

## 1.0.0

Complete modernization and new bookmark-sync feature.

### Added

- **PR bookmark sync**: periodically fetches your pull requests from the GitHub GraphQL API
  (opened by you, or assigned / mentioned / review-requested — configurable) and mirrors them
  into a chosen bookmark folder. Configurable limit (default 10, single request) and interval.
  Bookmark titles are prefixed with a colored circle emoji indicating status
  (🟢 passing · 🟡 pending · 🔴 failing · ⚪ draft · 🟣 merged · ⚫ closed).
- Options page: token, GitHub Enterprise host, notification toggles per event type,
  notification icon style, and all sync settings including a bookmark folder picker.
- Toolbar popup listing synced PRs with status emoji; badge shows the failing-PR count.
- Review notifications (approved / changes requested), in addition to comments.
- Clicking a notification now also focuses the browser window, not just the tab.
- Firefox build (event page + `browser_specific_settings`).
- Tooling: esbuild bundling, ESLint, Prettier, vitest unit tests, GitHub Actions CI, and a
  tag-triggered release workflow with optional Chrome Web Store publishing.

### Changed

- Migrated from Manifest V2 to **Manifest V3** (service worker background).
- Replaced deprecated `chrome.extension.onMessage` with `runtime.onMessage` via
  `webextension-polyfill`.
- Content script rewritten: handles GitHub's SPA (Turbo) navigation, keys comments by their
  permalink anchors instead of body text (edited comments no longer re-notify, identical
  comments are no longer missed), scopes CI detection to the merge box, and survives GitHub's
  newer React PR page markup where possible.
- Notifications get unique IDs, so a comment no longer overwrites an unseen CI notification.
- Dropped the `tabs` permission; narrowed `web_accessible_resources` away entirely.

### Removed

- `Makefile` release flow (replaced by npm scripts + GitHub Actions).
- Committed IDE project files.
