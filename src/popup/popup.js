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

function renderEmpty(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  list.replaceChildren(li);
}

function render({ updateFooter = true } = {}) {
  clearTimeout(expiryTimer);
  expiryTimer = undefined;
  if (!currentSyncState) {
    renderEmpty('No sync yet. Enable PR bookmark sync in Options, or hit ↻.');
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
    list.replaceChildren(
      ...prs.map((pr) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = pr.url;
        a.addEventListener('click', (event) => {
          event.preventDefault();
          browser.tabs.create({ url: pr.url });
          if (!isSidebar) window.close();
        });
        const emoji = document.createElement('span');
        emoji.textContent = statusEmoji(pr);
        const title = document.createElement('span');
        title.className = 'pr-title';
        title.textContent = pr.title;
        const repo = document.createElement('span');
        repo.className = 'pr-repo';
        repo.textContent = `${pr.repo}#${pr.number}`;
        a.append(emoji, title, repo);
        li.append(a);
        return li;
      })
    );
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
  footer.textContent = 'Syncing…';
  try {
    const result = await browser.runtime.sendMessage({ type: 'sync-now' });
    if (result?.skipped) footer.textContent = result.reason;
    else {
      syncStateChanged = true;
      currentSyncState = result;
      render();
    }
  } catch (error) {
    footer.textContent = `Sync failed: ${error?.message ?? String(error)}`;
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
  render();
}

initialize();
