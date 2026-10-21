import browser from 'webextension-polyfill';
import { BADGE_EXPIRY_ALARM_NAME, loadSettings, SYNC_ALARM_NAME } from './lib/settings.js';
import { fetchPullRequests } from './lib/github.js';
import { syncPrBookmarks } from './lib/bookmarks.js';
import { configureDisplay } from './lib/display.js';
import { getBadgeState } from './lib/badge.js';

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

async function updateBadgeFromCache() {
  const settings = await loadSettings(browser.storage.local);
  const { syncState } = await browser.storage.local.get('syncState');
  const { count, nextExpiry } = getBadgeState(
    settings.sync.enabled ? (syncState?.prs ?? []) : [],
    settings.badgeMaxAgeHours
  );
  await browser.alarms.clear(BADGE_EXPIRY_ALARM_NAME);
  await browser.action.setBadgeBackgroundColor({ color: '#cf222e' });
  await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  if (nextExpiry !== null) {
    await browser.alarms.create(BADGE_EXPIRY_ALARM_NAME, { when: nextExpiry });
  }
}

let badgeRefresh = Promise.resolve();

export function refreshBadge() {
  // Settings changes, alarms, and syncs can overlap. Read the latest cache for
  // each queued refresh so an earlier calculation cannot overwrite a newer one.
  badgeRefresh = badgeRefresh.catch(() => {}).then(updateBadgeFromCache);
  return badgeRefresh;
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
    const syncState = { lastSync: Date.now(), error: null, prs };
    await browser.storage.local.set({ syncState });
    await refreshBadge();
    return syncState;
  } catch (error) {
    const previous = (await browser.storage.local.get('syncState')).syncState ?? {};
    const syncState = { ...previous, lastSync: Date.now(), error: String(error.message ?? error) };
    await browser.storage.local.set({ syncState });
    await refreshBadge();
    return syncState;
  }
}

async function scheduleSyncAlarm() {
  const settings = await loadSettings(browser.storage.local);
  await browser.alarms.clear(SYNC_ALARM_NAME);
  if (settings.sync.enabled) {
    await browser.alarms.create(SYNC_ALARM_NAME, {
      periodInMinutes: settings.sync.intervalMinutes,
      delayInMinutes: 0.5,
    });
  }
  await refreshBadge();
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) return runSync();
  if (alarm.name === BADGE_EXPIRY_ALARM_NAME) return refreshBadge();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    updateDisplay();
    return scheduleSyncAlarm();
  }
});

browser.runtime.onInstalled.addListener(scheduleSyncAlarm);
browser.runtime.onStartup.addListener(scheduleSyncAlarm);

// ---------------------------------------------------------------------------
// Toolbar display mode
// ---------------------------------------------------------------------------

let displayUpdate = Promise.resolve();

function updateDisplay() {
  // Serialize changes so an older storage read cannot overwrite a newer choice.
  displayUpdate = displayUpdate
    .then(async () => {
      const settings = await loadSettings(browser.storage.local);
      await configureDisplay(browser, settings.displayMode);
    })
    .catch((error) => console.warn('Failed to update toolbar display', error));
  return displayUpdate;
}

if (typeof browser.sidebarAction?.toggle === 'function') {
  browser.action.onClicked.addListener(() => {
    // A popup suppresses onClicked. Call directly here to retain the user gesture.
    browser.sidebarAction.toggle().catch((error) => {
      console.warn('Failed to toggle sidebar', error);
    });
  });
}

browser.runtime.onInstalled.addListener(updateDisplay);
browser.runtime.onStartup.addListener(updateDisplay);
updateDisplay();

// ---------------------------------------------------------------------------
// Messages from content script / popup
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'pr-event') {
    handlePrEvent(message, sender).catch((error) => {
      console.warn('Failed to handle PR event', error);
    });
    return undefined;
  }
  if (message?.type === 'sync-now') {
    return runSync();
  }
  return undefined;
});

// Restore the badge and its one-shot alarm whenever the worker is restarted.
refreshBadge().catch((error) => {
  console.warn('Failed to refresh toolbar badge', error);
});
