import browser from 'webextension-polyfill';
import { statusEmoji } from '../lib/emoji.js';
import { getPrListState } from '../lib/pr-list.js';
import { mergeSettings } from '../lib/settings.js';

const list = document.getElementById('prList');
const footer = document.getElementById('footer');
const isSidebar = new URLSearchParams(window.location.search).get('view') === 'sidebar';
document.body.classList.toggle('sidebar', isSidebar);

const MAX_TIMEOUT_MS = 2_147_483_647;
let settings = mergeSettings();
let currentSyncState;
let expiryTimer;
let syncStateChanged = false;
let settingsChanged = false;
let syncStateLoaded = false;
let syncStateRevision = 0;
let syncRequestSequence = 0;
const rows = new Map();

function renderEmpty(text) {
  rows.clear();
  if (list.children.length === 1 && list.firstElementChild.className === 'empty') {
    list.firstElementChild.textContent = text;
    return;
  }
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  list.replaceChildren(li);
}

function createRow(url) {
  const li = document.createElement('li');
  const a = document.createElement('a');
  a.href = url;
  a.addEventListener('click', (event) => {
    event.preventDefault();
    browser.tabs.create({ url });
    if (!isSidebar) window.close();
  });
  const emoji = document.createElement('span');
  const title = document.createElement('span');
  title.className = 'pr-title';
  const repo = document.createElement('span');
  repo.className = 'pr-repo';
  a.append(emoji, title, repo);
  li.append(a);
  return { li, a, emoji, title, repo };
}

function renderPrs(prs) {
  const focusedLink = list.contains(document.activeElement) ? document.activeElement : null;
  const urls = new Set(prs.map((pr) => pr.url));
  for (const [url, row] of rows) {
    if (!urls.has(url)) {
      row.li.remove();
      rows.delete(url);
    }
  }
  list.querySelector('.empty')?.remove();
  let cursor = list.firstElementChild;
  for (const pr of prs) {
    let row = rows.get(pr.url);
    if (!row) {
      row = createRow(pr.url);
      rows.set(pr.url, row);
    }
    const fields = [
      [row.emoji, statusEmoji(pr)],
      [row.title, pr.title],
      [row.repo, `${pr.repo}#${pr.number}`],
    ];
    for (const [element, text] of fields) {
      if (element.textContent !== text) element.textContent = text;
    }
    if (row.li !== cursor) list.insertBefore(row.li, cursor);
    cursor = row.li.nextElementSibling;
  }
  if (focusedLink?.isConnected && document.activeElement !== focusedLink) {
    focusedLink.focus({ preventScroll: true });
  }
}

function render({ updateFooter = true } = {}) {
  clearTimeout(expiryTimer);
  expiryTimer = undefined;
  if (!currentSyncState) {
    renderEmpty(
      syncStateLoaded ? 'No sync yet. Enable PR bookmark sync in Options, or hit ↻.' : 'Loading…'
    );
    if (updateFooter) footer.textContent = '';
    return;
  }
  const cachedPrs = currentSyncState.prs ?? [];
  const { prs, nextExpiry } = getPrListState(cachedPrs, settings.prListMaxAgeDays);
  if (nextExpiry !== null) {
    expiryTimer = setTimeout(
      () => render({ updateFooter: false }),
      Math.min(Math.max(0, nextExpiry - Date.now()), MAX_TIMEOUT_MS)
    );
  }
  if (prs.length === 0) {
    renderEmpty(
      cachedPrs.length > 0 && settings.prListMaxAgeDays > 0
        ? `No PRs updated within the past ${settings.prListMaxAgeDays} ${settings.prListMaxAgeDays === 1 ? 'day' : 'days'}.`
        : 'No pull requests found.'
    );
  } else {
    renderPrs(prs);
  }
  if (!updateFooter) return;
  const when = currentSyncState.lastSync
    ? new Date(currentSyncState.lastSync).toLocaleTimeString()
    : 'never';
  footer.textContent = currentSyncState.error
    ? `Last sync failed: ${currentSyncState.error}`
    : `Last synced at ${when}`;
}

document.getElementById('syncNow').addEventListener('click', async () => {
  const request = ++syncRequestSequence;
  const revision = syncStateRevision;
  const isCurrent = () => request === syncRequestSequence && revision === syncStateRevision;
  footer.textContent = 'Syncing…';
  try {
    const result = await browser.runtime.sendMessage({ type: 'sync-now' });
    if (!isCurrent()) return;
    if (result?.skipped) footer.textContent = result.reason;
    else {
      syncStateChanged = true;
      syncStateLoaded = true;
      currentSyncState = result;
      render();
    }
  } catch (error) {
    if (isCurrent()) footer.textContent = `Sync failed: ${error?.message ?? String(error)}`;
  }
});

document.getElementById('openOptions').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

// Keep open views current without changing the stored, unfiltered PR cache.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    settingsChanged = true;
    settings = mergeSettings(changes.settings.newValue);
  }
  if (changes.syncState) {
    syncStateChanged = true;
    syncStateLoaded = true;
    syncStateRevision += 1;
    currentSyncState = changes.syncState.newValue;
  }
  if (changes.settings || changes.syncState) render({ updateFooter: Boolean(changes.syncState) });
});

// Timers may be throttled while a browser or sidebar is in the background.
window.addEventListener('focus', () => render({ updateFooter: false }));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render({ updateFooter: false });
});

// Do not let a slower initial read replace newer settings or PR data.
async function initialize() {
  const stored = await browser.storage.local.get(['settings', 'syncState']);
  if (!settingsChanged) settings = mergeSettings(stored.settings);
  if (!syncStateChanged) currentSyncState = stored.syncState;
  syncStateLoaded = true;
  render();
}

render({ updateFooter: false });
initialize();
