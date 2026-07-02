import browser from 'webextension-polyfill';
import { loadSettings, SYNC_ALARM_NAME } from './lib/settings.js';
import { fetchPullRequests } from './lib/github.js';
import { syncPrBookmarks } from './lib/bookmarks.js';

/**
 * Background service worker (MV3) / event page (Firefox).
 *  - Shows notifications for PR events reported by the content script.
 *  - Periodically syncs the user's PRs into a bookmark folder.
 *  - Keeps the toolbar badge showing the count of failing PRs.
 */

const OCTOCAT_ICONS = {
  'ci-success': [
    'icons/success/baracktocat.png',
    'icons/success/mardigrastocat.png',
    'icons/success/welcometocat.png',
  ],
  'ci-failure': [
    'icons/error/luchadortocat.png',
    'icons/error/minion.png',
    'icons/error/octofez.png',
  ],
  comment: [
    'icons/comment/murakamicat.png',
    'icons/comment/professortocat.png',
    'icons/comment/sailor.png',
  ],
  review: [
    'icons/comment/murakamicat.png',
    'icons/comment/professortocat.png',
    'icons/comment/sailor.png',
  ],
};

const EVENT_TOGGLES = {
  'ci-success': (n) => n.ciSuccess,
  'ci-failure': (n) => n.ciFailure,
  comment: (n) => n.comments,
  review: (n) => n.reviews,
};

function iconFor(kind, theme) {
  if (theme === 'plain') return 'icons/icon128.png';
  const icons = OCTOCAT_ICONS[kind];
  if (!icons) return 'icons/icon128.png';
  return icons[Math.floor(Math.random() * icons.length)];
}

let notificationSeq = 0;

async function handlePrEvent(message, sender) {
  const settings = await loadSettings(browser.storage.local);
  const enabled = EVENT_TOGGLES[message.kind];
  if (!enabled || !enabled(settings.notifications)) return;

  const notificationId = `pr-event:${Date.now()}:${notificationSeq++}`;
  const title = (message.pageTitle ?? sender.tab?.title ?? 'GitHub').split('·')[0].trim();
  await browser.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: browser.runtime.getURL(iconFor(message.kind, settings.iconTheme)),
    title,
    message: message.content,
  });
  if (sender.tab) {
    // storage.session survives worker restarts within the browser session.
    await browser.storage.session.set({
      [notificationId]: { tabId: sender.tab.id, windowId: sender.tab.windowId },
    });
  }
}

browser.notifications.onClicked.addListener(async (notificationId) => {
  browser.notifications.clear(notificationId);
  const stored = await browser.storage.session.get(notificationId);
  const target = stored[notificationId];
  if (!target) return;
  await browser.storage.session.remove(notificationId);
  try {
    await browser.tabs.update(target.tabId, { active: true });
    await browser.windows.update(target.windowId, { focused: true });
  } catch {
    // Tab or window is gone; nothing to focus.
  }
});

browser.notifications.onClosed.addListener((notificationId) => {
  browser.storage.session.remove(notificationId).catch(() => {});
});

// ---------------------------------------------------------------------------
// PR bookmark sync
// ---------------------------------------------------------------------------

async function updateBadge(prs) {
  const failing = prs.filter((pr) => pr.state === 'OPEN' && ['FAILURE', 'ERROR'].includes(pr.ci));
  await browser.action.setBadgeBackgroundColor({ color: '#cf222e' });
  await browser.action.setBadgeText({ text: failing.length > 0 ? String(failing.length) : '' });
}

export async function runSync() {
  const settings = await loadSettings(browser.storage.local);
  if (!settings.sync.enabled) {
    return { skipped: true, reason: 'Sync is disabled.' };
  }
  if (!settings.token || !settings.sync.folderId) {
    return { skipped: true, reason: 'Set a token and bookmark folder in Options first.' };
  }
  try {
    const prs = await fetchPullRequests(settings);
    await syncPrBookmarks(browser.bookmarks, settings.sync.folderId, prs);
    await updateBadge(prs);
    const syncState = { lastSync: Date.now(), error: null, prs };
    await browser.storage.local.set({ syncState });
    return syncState;
  } catch (error) {
    const previous = (await browser.storage.local.get('syncState')).syncState ?? {};
    const syncState = { ...previous, lastSync: Date.now(), error: String(error.message ?? error) };
    await browser.storage.local.set({ syncState });
    return syncState;
  }
}

async function scheduleSyncAlarm() {
  const settings = await loadSettings(browser.storage.local);
  await browser.alarms.clear(SYNC_ALARM_NAME);
  if (settings.sync.enabled) {
    browser.alarms.create(SYNC_ALARM_NAME, {
      periodInMinutes: settings.sync.intervalMinutes,
      delayInMinutes: 0.1,
    });
  } else {
    await browser.action.setBadgeText({ text: '' });
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) runSync();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) scheduleSyncAlarm();
});

browser.runtime.onInstalled.addListener(scheduleSyncAlarm);
browser.runtime.onStartup.addListener(scheduleSyncAlarm);

// ---------------------------------------------------------------------------
// Messages from content script / popup
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'pr-event') {
    handlePrEvent(message, sender);
    return undefined;
  }
  if (message?.type === 'sync-now') {
    return runSync();
  }
  return undefined;
});
