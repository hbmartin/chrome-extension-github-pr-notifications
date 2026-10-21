import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BADGE_EXPIRY_ALARM_NAME, mergeSettings, SYNC_ALARM_NAME } from '../src/lib/settings.js';

const mocks = vi.hoisted(() => {
  const event = () => ({ addListener: vi.fn() });
  return {
    fetchPullRequests: vi.fn(),
    syncPrBookmarks: vi.fn(),
    browser: {
      action: { setBadgeBackgroundColor: vi.fn(), setBadgeText: vi.fn(), setPopup: vi.fn() },
      alarms: { clear: vi.fn(), create: vi.fn(), onAlarm: event() },
      storage: { local: { get: vi.fn(), set: vi.fn() }, onChanged: event() },
      notifications: { onClicked: event(), onClosed: event() },
      runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
      bookmarks: {},
    },
  };
});

vi.mock('webextension-polyfill', () => ({ default: mocks.browser }));
vi.mock('../src/lib/github.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchPullRequests: mocks.fetchPullRequests,
}));
vi.mock('../src/lib/bookmarks.js', () => ({ syncPrBookmarks: mocks.syncPrBookmarks }));

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const failingPr = (ageHours) => ({
  state: 'OPEN',
  ci: 'FAILURE',
  updatedAt: new Date(NOW - ageHours * HOUR).toISOString(),
});
let stored;
let syncAlarmTimer;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  stored = {
    settings: mergeSettings({
      token: 'test-token',
      badgeMaxAgeHours: 24,
      sync: { enabled: true, folderId: 'folder' },
    }),
    syncState: { lastSync: NOW, error: null, prs: [failingPr(23), failingPr(1), failingPr(25)] },
  };
  mocks.browser.storage.local.get.mockImplementation(async (key) => ({
    [key]: structuredClone(stored[key]),
  }));
  mocks.browser.storage.local.set.mockImplementation(async (values) => {
    Object.assign(stored, structuredClone(values));
  });
  mocks.fetchPullRequests.mockResolvedValue([]);
  mocks.syncPrBookmarks.mockResolvedValue(undefined);
  syncAlarmTimer = undefined;
  mocks.browser.alarms.clear.mockImplementation(async (name) => {
    if (name === SYNC_ALARM_NAME) clearTimeout(syncAlarmTimer);
  });
  mocks.browser.alarms.create.mockImplementation(async (name, options) => {
    if (name !== SYNC_ALARM_NAME) return;
    clearTimeout(syncAlarmTimer);
    const fire = async () => {
      syncAlarmTimer = setTimeout(fire, options.periodInMinutes * 60_000);
      await mocks.browser.alarms.onAlarm.addListener.mock.calls.at(-1)[0]({ name });
    };
    syncAlarmTimer = setTimeout(fire, options.delayInMinutes * 60_000);
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function startBackground() {
  const background = await import('../src/background.js');
  // Wait behind the refresh scheduled during service worker initialization.
  await background.refreshBadge();
  return background;
}

async function changeSettings(overrides) {
  const oldValue = stored.settings;
  stored.settings = mergeSettings({ ...oldValue, ...overrides });
  const listener = mocks.browser.storage.onChanged.addListener.mock.calls.at(-1)[0];
  await listener({ settings: { oldValue, newValue: stored.settings } }, 'local');
}

describe('background badge refresh', () => {
  it('restores the badge and its next expiration from cached PRs', async () => {
    await startBackground();
    expect(mocks.browser.action.setBadgeBackgroundColor).toHaveBeenLastCalledWith({
      color: '#cf222e',
    });
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '2' });
    expect(mocks.browser.alarms.create).toHaveBeenLastCalledWith(BADGE_EXPIRY_ALARM_NAME, {
      when: NOW + HOUR,
    });
    expect(mocks.fetchPullRequests).not.toHaveBeenCalled();
  });

  it('applies saved hours immediately without fetching or editing bookmarks', async () => {
    await startBackground();
    await changeSettings({ badgeMaxAgeHours: 48 });
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '3' });
    expect(mocks.browser.alarms.create).toHaveBeenLastCalledWith(BADGE_EXPIRY_ALARM_NAME, {
      when: NOW + 23 * HOUR,
    });
    expect(mocks.fetchPullRequests).not.toHaveBeenCalled();
    expect(mocks.syncPrBookmarks).not.toHaveBeenCalled();
  });

  it('clears the expiry alarm when switching to all time', async () => {
    await startBackground();
    mocks.browser.alarms.create.mockClear();
    await changeSettings({ badgeMaxAgeHours: 0 });
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '3' });
    expect(mocks.browser.alarms.clear).toHaveBeenCalledWith(BADGE_EXPIRY_ALARM_NAME);
    expect(mocks.browser.alarms.create).not.toHaveBeenCalledWith(
      BADGE_EXPIRY_ALARM_NAME,
      expect.anything()
    );
  });

  it('clears the badge and alarm when sync is disabled', async () => {
    await startBackground();
    mocks.browser.alarms.create.mockClear();
    await changeSettings({ sync: { ...stored.settings.sync, enabled: false } });
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(mocks.browser.alarms.clear).toHaveBeenCalledWith(BADGE_EXPIRY_ALARM_NAME);
    expect(mocks.browser.alarms.clear).toHaveBeenCalledWith(SYNC_ALARM_NAME);
    expect(mocks.browser.alarms.create).not.toHaveBeenCalled();
  });

  it('ages out cached PRs and reschedules until no failing PRs remain', async () => {
    await startBackground();
    const onAlarm = mocks.browser.alarms.onAlarm.addListener.mock.calls[0][0];
    vi.setSystemTime(NOW + HOUR);
    await onAlarm({ name: BADGE_EXPIRY_ALARM_NAME });
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(mocks.browser.alarms.create).toHaveBeenLastCalledWith(BADGE_EXPIRY_ALARM_NAME, {
      when: NOW + 23 * HOUR,
    });

    mocks.browser.alarms.create.mockClear();
    vi.setSystemTime(NOW + 23 * HOUR);
    await onAlarm({ name: BADGE_EXPIRY_ALARM_NAME });
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(mocks.browser.alarms.create).not.toHaveBeenCalled();
    expect(mocks.fetchPullRequests).not.toHaveBeenCalled();
    expect(mocks.browser.storage.local.set).not.toHaveBeenCalled();
  });

  it('refreshes expired cached PRs and rebuilds alarms after browser startup', async () => {
    vi.setSystemTime(NOW + HOUR);
    await startBackground();
    const badgeCalls = mocks.browser.action.setBadgeText.mock.calls.length;
    const listeners = mocks.browser.runtime.onStartup.addListener.mock.calls.map(
      ([listener]) => listener
    );
    await Promise.all(listeners.map((listener) => listener()));
    expect(mocks.browser.action.setBadgeText).toHaveBeenCalledTimes(badgeCalls);
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(mocks.browser.alarms.create).toHaveBeenCalledWith(SYNC_ALARM_NAME, {
      periodInMinutes: 10,
      delayInMinutes: 0.5,
    });
    expect(mocks.browser.alarms.create).toHaveBeenCalledWith(BADGE_EXPIRY_ALARM_NAME, {
      when: NOW + 23 * HOUR,
    });
  });

  it.each([
    { badgeMaxAgeHours: 48 },
    { prListMaxAgeDays: 7 },
    { displayMode: 'sidebar' },
    { iconTheme: 'plain' },
    { notifications: { comments: false } },
  ])(
    'preserves the existing periodic sync after a display/notification save: %j',
    async (change) => {
      await startBackground();
      await mocks.browser.alarms.create(SYNC_ALARM_NAME, {
        periodInMinutes: 10,
        delayInMinutes: 10,
      });
      mocks.browser.alarms.create.mockClear();
      mocks.browser.alarms.clear.mockClear();
      await changeSettings(change);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(mocks.browser.alarms.clear).not.toHaveBeenCalledWith(SYNC_ALARM_NAME);
      expect(mocks.browser.alarms.create).not.toHaveBeenCalledWith(
        SYNC_ALARM_NAME,
        expect.anything()
      );
      expect(mocks.fetchPullRequests).not.toHaveBeenCalled();
      expect(mocks.syncPrBookmarks).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(570_000);
      expect(mocks.fetchPullRequests).toHaveBeenCalledOnce();
      expect(mocks.syncPrBookmarks).toHaveBeenCalledOnce();
    }
  );

  it.each([
    { token: 'replacement-token' },
    { githubHost: 'github.example.com' },
    { sync: { folderId: 'other-folder' } },
    { sync: { role: 'assigned' } },
    { sync: { state: 'all' } },
    { sync: { excludedRepos: ['acme/widgets'] } },
    { sync: { limit: 20 } },
    { sync: { intervalMinutes: 15 } },
  ])('schedules one early sync when sync inputs change: %j', async (change) => {
    await startBackground();
    mocks.browser.alarms.create.mockClear();
    await changeSettings({
      ...change,
      ...(change.sync && { sync: { ...stored.settings.sync, ...change.sync } }),
    });
    expect(
      mocks.browser.alarms.create.mock.calls.filter(([name]) => name === SYNC_ALARM_NAME)
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.fetchPullRequests).toHaveBeenCalledOnce();
    expect(mocks.syncPrBookmarks).toHaveBeenCalledOnce();
  });

  it('does not reschedule for equivalent normalized settings or reordered exclusions', async () => {
    stored.settings.sync.excludedRepos = ['acme/widgets', 'octo/tools'];
    await startBackground();
    mocks.browser.alarms.clear.mockClear();
    mocks.browser.alarms.create.mockClear();
    await changeSettings({
      githubHost: 'https://GITHUB.COM/',
      sync: {
        ...stored.settings.sync,
        limit: '10',
        intervalMinutes: '10',
        excludedRepos: ['OCTO/TOOLS', 'Acme/Widgets', 'acme/widgets'],
      },
    });
    expect(mocks.browser.alarms.clear).not.toHaveBeenCalledWith(SYNC_ALARM_NAME);
    expect(mocks.browser.alarms.create).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'keeps badge failures separate from a sync error (%s)',
    async (failFetch) => {
      const { runSync, refreshBadge } = await startBackground();
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const previousPrs = structuredClone(stored.syncState.prs);
      if (failFetch) mocks.fetchPullRequests.mockRejectedValueOnce(new Error('Offline'));
      mocks.browser.action.setBadgeText.mockRejectedValue(new Error('Badge unavailable'));
      mocks.browser.storage.local.set.mockClear();

      const result = await runSync();
      expect(result.error).toBe(failFetch ? 'Offline' : null);
      expect(result.prs).toEqual(failFetch ? previousPrs : []);
      expect(stored.syncState).toEqual(result);
      expect(mocks.browser.storage.local.set).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith('Failed to refresh toolbar badge', expect.any(Error));

      mocks.browser.action.setBadgeText.mockResolvedValue(undefined);
      await refreshBadge();
      expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({
        text: failFetch ? '2' : '',
      });
    }
  );

  it('contains badge errors during worker restoration and badge alarms', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.browser.action.setBadgeText.mockRejectedValue(new Error('Badge unavailable'));
    await import('../src/background.js');
    await vi.waitFor(() => expect(warning).toHaveBeenCalledOnce());
    const listener = mocks.browser.alarms.onAlarm.addListener.mock.calls[0][0];
    await expect(listener({ name: BADGE_EXPIRY_ALARM_NAME })).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(2);
    expect(mocks.browser.storage.local.set).not.toHaveBeenCalled();
  });

  it('recreates the expiry alarm after a service worker restart', async () => {
    await startBackground();
    mocks.browser.alarms.create.mockClear();
    vi.resetModules();
    vi.setSystemTime(NOW + HOUR);
    await startBackground();
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(mocks.browser.alarms.create).toHaveBeenLastCalledWith(BADGE_EXPIRY_ALARM_NAME, {
      when: NOW + 23 * HOUR,
    });
  });

  it('handles empty and legacy caches without timestamps', async () => {
    delete stored.syncState;
    const { refreshBadge } = await startBackground();
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    stored.syncState = { prs: [{ state: 'OPEN', ci: 'ERROR' }] };
    await refreshBadge();
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    await changeSettings({ badgeMaxAgeHours: 0 });
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
  });

  it('keeps every fetched PR in bookmarks and the popup cache', async () => {
    const { runSync } = await startBackground();
    const prs = [failingPr(2), failingPr(48), { ...failingPr(1), ci: 'SUCCESS' }];
    mocks.fetchPullRequests.mockResolvedValue(prs);
    const result = await runSync();
    expect(mocks.syncPrBookmarks).toHaveBeenCalledWith(mocks.browser.bookmarks, 'folder', prs);
    expect(result.prs).toEqual(prs);
    expect(stored.syncState.prs).toEqual(prs);
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
  });

  it('retains cached timestamps and expires the badge after a failed sync', async () => {
    const { runSync } = await startBackground();
    const previousPrs = structuredClone(stored.syncState.prs);
    mocks.fetchPullRequests.mockRejectedValueOnce(new Error('Offline'));
    vi.setSystemTime(NOW + HOUR);
    const result = await runSync();
    expect(result.error).toBe('Offline');
    expect(result.prs).toEqual(previousPrs);
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(mocks.browser.alarms.create).toHaveBeenLastCalledWith(BADGE_EXPIRY_ALARM_NAME, {
      when: NOW + 23 * HOUR,
    });
    vi.setSystemTime(NOW + 24 * HOUR);
    await mocks.browser.alarms.onAlarm.addListener.mock.calls[0][0]({
      name: BADGE_EXPIRY_ALARM_NAME,
    });
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(mocks.fetchPullRequests).toHaveBeenCalledOnce();
  });

  it('keeps the badge cleared if sync is disabled while a fetch is still pending', async () => {
    const { runSync } = await startBackground();
    let finishFetch;
    mocks.fetchPullRequests.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFetch = resolve;
        })
    );
    const syncing = runSync();
    await vi.waitFor(() => expect(finishFetch).toBeTypeOf('function'));
    await changeSettings({ sync: { ...stored.settings.sync, enabled: false } });
    mocks.browser.alarms.create.mockClear();
    finishFetch([failingPr(1)]);
    await syncing;
    expect(mocks.browser.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(mocks.browser.alarms.create).not.toHaveBeenCalled();
  });
});
