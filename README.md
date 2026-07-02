# GitHub PR Notifications extension

Browser notifications for GitHub pull request CI status changes, comments, and reviews — plus
automatic syncing of your PRs into a bookmark folder.

<a href="https://chrome.google.com/webstore/detail/github-pr-notifications/ekcbhjllakigielkhnkingmfpbgfgiie"><img src="media/chrome-store-icon.png" height="90" />
<br />Click to Install
</a>

## Features

- **CI notifications** — get a desktop notification when checks on an open PR tab finish
  (✅ all passed) or when an individual check fails (❌).
- **Comment & review notifications** — new comments (💬), inline review comments, and reviews
  (🔍 approved / changes requested) on the PR you have open.
- **Click to focus** — clicking a notification focuses the window and tab of the PR it came from.
- **PR bookmark sync** — periodically fetches your pull requests from the GitHub API and mirrors
  them into a bookmark folder of your choice. Bookmark titles are prefixed with a colored circle
  showing status:

  | Emoji | Meaning                        |
  | ----- | ------------------------------ |
  | 🟢    | open, checks passing (or none) |
  | 🟡    | open, checks pending           |
  | 🔴    | open, checks failing           |
  | ⚪    | draft                          |
  | 🟣    | merged                         |
  | ⚫    | closed without merging         |

- **Toolbar popup** — your synced PRs at a glance, with a badge counting failing PRs.
- **Configurable** — which events notify, which PRs to sync (opened by you / assigned /
  mentioned / review-requested; open, closed, or all), how many (default 10, single request,
  no pagination), how often, notification icon style, and GitHub Enterprise hosts.

## Setup

1. Install the extension and open **Options** (right-click the toolbar icon → Options).
2. For bookmark sync, add a
   [personal access token](https://github.com/settings/tokens) — classic with `repo` scope, or
   fine-grained with read access to pull requests. The token is stored locally in your browser
   and only ever sent to your GitHub host.
3. Enable **PR bookmark sync**, pick (or create) a bookmark folder, and save.

On each sync, PR bookmarks in the folder are removed and re-created from the API response;
anything else you keep in the folder (other bookmarks, subfolders) is left untouched.

CI/comment notifications need no token — they work by watching PR pages you have open in a tab.
Notifications are per-tab, so a PR must be open in some tab for you to get them; bookmark sync
is what covers everything else.

## Development

```bash
npm install
npm test          # vitest unit tests
npm run lint      # eslint + prettier
npm run build     # bundles to dist/chrome and dist/firefox
npm run build:zip # also produces store-ready zips
```

Load `dist/chrome` as an unpacked extension via `chrome://extensions` (Developer mode →
"Load unpacked"). For Firefox, load `dist/firefox/manifest.json` via
`about:debugging#/runtime/this-firefox` (note: Firefox MV3 host permissions must be granted
in the extension's Permissions settings).

Source layout:

- `src/background.js` — service worker: notifications, badge, sync alarm
- `src/content/inject.js` — PR page watcher (MutationObserver + Turbo navigation handling)
- `src/lib/` — testable modules: GitHub GraphQL client, bookmark sync, DOM parsing, settings
- `src/options`, `src/popup` — UI pages
- `tests/` — vitest suites for the lib modules

Releases: bump `version` in `package.json` (the build stamps it into the manifest), tag
`v<version>`, and push the tag — the release workflow builds zips, attaches them to a GitHub
Release, and publishes to the Chrome Web Store when store credentials are configured as
repository secrets (`CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`).

## Notes & limitations

- CI/comment notifications rely on parsing GitHub's DOM, which changes over time. The parser
  targets stable anchors (comment permalinks, merge-box phrases) and falls back gracefully, but
  a GitHub redesign can still break it — the API-backed bookmark sync is unaffected by that.
- This is not an official GitHub project but is made with ❤️ for GitHub.

All Octocat images borrowed from the [Octodex](https://octodex.github.com/) or generated with
[myOctocat](https://myoctocat.com/build-your-octocat/).

#### Legal

GitHub, the GitHub logo design, Octocat and the Octocat logo design are exclusive trademarks
registered in the United States by GitHub, Inc.

Released under [MIT license](LICENSE)
