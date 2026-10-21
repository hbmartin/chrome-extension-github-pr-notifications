import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ browser: undefined }));
vi.mock('webextension-polyfill', () => ({
  default: new Proxy({}, { get: (_target, property) => mock.browser?.[property] }),
}));

const html = readFileSync('src/popup/popup.html', 'utf8');
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const pr = {
  title: 'Fix notification badge',
  url: 'https://github.com/acme/widgets/pull/42',
  repo: 'acme/widgets',
  number: 42,
  state: 'OPEN',
  ci: 'SUCCESS',
};
const syncState = { prs: [pr], lastSync: 1_700_000_000_000, error: null };
let storageListener;
let nextPrNumber;

const agedPr = (ageDays, overrides = {}) => {
  const number = nextPrNumber++;
  return {
    ...pr,
    number,
    url: `https://github.com/acme/widgets/pull/${number}`,
    updatedAt: new Date(NOW - ageDays * DAY).toISOString(),
    ...overrides,
  };
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function openView(mode = 'popup') {
  window.history.replaceState(
    {},
    '',
    `/popup/popup.html${mode === 'sidebar' ? '?view=sidebar' : ''}`
  );
  vi.resetModules();
  await import('../src/popup/popup.js');
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  nextPrNumber = 43;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(window, 'addEventListener');
  vi.spyOn(document, 'addEventListener');
  document.documentElement.innerHTML = html;
  mock.browser = {
    storage: {
      local: { get: vi.fn(async () => ({ syncState })), set: vi.fn() },
      onChanged: {
        addListener: vi.fn((listener) => {
          storageListener = listener;
        }),
      },
    },
    tabs: { create: vi.fn(async () => {}) },
    runtime: {
      openOptionsPage: vi.fn(async () => {}),
      sendMessage: vi.fn(async () => syncState),
    },
  };
  vi.spyOn(window, 'close').mockImplementation(() => {});
});

afterEach(() => {
  for (const [type, listener] of window.addEventListener.mock.calls) {
    if (type === 'focus') window.removeEventListener(type, listener);
  }
  for (const [type, listener] of document.addEventListener.mock.calls) {
    if (type === 'visibilitychange') document.removeEventListener(type, listener);
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.body.className = '';
  mock.browser = undefined;
  storageListener = undefined;
});

describe('PR list age filtering', () => {
  it.each(['popup', 'sidebar'])('hides inactive PRs on opening the %s', async (mode) => {
    const prs = [agedPr(2, { title: 'Recent' }), agedPr(10, { title: 'Old' })];
    mock.browser.storage.local.get.mockResolvedValue({
      settings: { prListMaxAgeDays: 7 },
      syncState: { ...syncState, prs },
    });
    await openView(mode);
    expect([...document.querySelectorAll('.pr-title')].map((node) => node.textContent)).toEqual([
      'Recent',
    ]);
    expect(prs).toHaveLength(2);
    expect(mock.browser.storage.local.set).not.toHaveBeenCalled();
  });

  it.each(['popup', 'sidebar'])(
    'applies saved limits and restores cached PRs without a sync in %s',
    async (mode) => {
      const prs = Object.freeze([agedPr(2, { title: 'Recent' }), agedPr(10, { title: 'Old' })]);
      mock.browser.storage.local.get.mockResolvedValue({ syncState: { ...syncState, prs } });
      await openView(mode);
      expect(document.querySelectorAll('.pr-title')).toHaveLength(2);

      storageListener({ settings: { newValue: { prListMaxAgeDays: 7 } } }, 'local');
      expect(document.querySelectorAll('.pr-title')).toHaveLength(1);
      storageListener({ settings: { newValue: { prListMaxAgeDays: 0 } } }, 'local');
      expect(document.querySelectorAll('.pr-title')).toHaveLength(2);
      expect(mock.browser.storage.local.get).toHaveBeenCalledOnce();
      expect(mock.browser.storage.local.set).not.toHaveBeenCalled();
      expect(mock.browser.runtime.sendMessage).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it.each(['popup', 'sidebar'])(
    'automatically hides PRs at their expiration in %s',
    async (mode) => {
      const prs = [agedPr(1, { updatedAt: new Date(NOW - DAY + 1000).toISOString() })];
      mock.browser.storage.local.get.mockResolvedValue({
        settings: { prListMaxAgeDays: 1 },
        syncState: { ...syncState, prs },
      });
      await openView(mode);
      expect(document.querySelectorAll('.pr-title')).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(document.querySelectorAll('.pr-title')).toHaveLength(0);
      expect(document.getElementById('prList').textContent).toBe(
        'No PRs updated within the past 1 day.'
      );
      expect(prs).toHaveLength(1);
      expect(mock.browser.storage.local.set).not.toHaveBeenCalled();
      expect(mock.browser.runtime.sendMessage).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('caps long timers and checks expiration when the view regains focus', async () => {
    mock.browser.storage.local.get.mockResolvedValue({
      settings: { prListMaxAgeDays: 60 },
      syncState: { ...syncState, prs: [agedPr(1)] },
    });
    await openView('sidebar');
    await vi.advanceTimersByTimeAsync(2_147_483_647);
    expect(document.querySelectorAll('.pr-title')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    vi.setSystemTime(NOW + 60 * DAY);
    window.dispatchEvent(new Event('focus'));
    expect(document.querySelectorAll('.pr-title')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('checks expiration when a hidden page becomes visible again', async () => {
    mock.browser.storage.local.get.mockResolvedValue({
      settings: { prListMaxAgeDays: 7 },
      syncState: { ...syncState, prs: [agedPr(6)] },
    });
    await openView('sidebar');
    vi.setSystemTime(NOW + 2 * DAY);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(document.querySelectorAll('.pr-title')).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows a hidden PR again when a sync reports recent activity', async () => {
    mock.browser.storage.local.get.mockResolvedValue({
      settings: { prListMaxAgeDays: 7 },
      syncState: { ...syncState, prs: [agedPr(10)] },
    });
    await openView('sidebar');
    expect(document.querySelectorAll('.pr-title')).toHaveLength(0);
    storageListener({ syncState: { newValue: { ...syncState, prs: [agedPr(0)] } } }, 'local');
    expect(document.querySelectorAll('.pr-title')).toHaveLength(1);
  });

  it('applies combined settings and PR cache updates together', async () => {
    await openView('sidebar');
    storageListener(
      {
        settings: { newValue: { prListMaxAgeDays: 7 } },
        syncState: { newValue: { ...syncState, prs: [agedPr(2), agedPr(10)] } },
      },
      'local'
    );
    expect(document.querySelectorAll('.pr-title')).toHaveLength(1);
  });

  it('preserves a saved filter while a slower initial cache read completes', async () => {
    let finishRead;
    mock.browser.storage.local.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    await openView('sidebar');
    storageListener({ settings: { newValue: { prListMaxAgeDays: 7 } } }, 'local');
    finishRead({
      settings: { prListMaxAgeDays: 0 },
      syncState: { ...syncState, prs: [agedPr(10)] },
    });
    await Promise.resolve();
    expect(document.querySelectorAll('.pr-title')).toHaveLength(0);
    expect(document.getElementById('prList').textContent).toBe(
      'No PRs updated within the past 7 days.'
    );
  });

  it('preserves both live settings and PR data over a stale initial read', async () => {
    let finishRead;
    mock.browser.storage.local.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    await openView('sidebar');
    storageListener(
      {
        settings: { newValue: { prListMaxAgeDays: 7 } },
        syncState: { newValue: { ...syncState, prs: [agedPr(2), agedPr(10)] } },
      },
      'local'
    );
    finishRead({ settings: { prListMaxAgeDays: 0 }, syncState: { prs: [] } });
    await Promise.resolve();
    expect(document.querySelectorAll('.pr-title')).toHaveLength(1);
  });

  it('preserves sync progress and errors during timer, focus, and settings redraws', async () => {
    mock.browser.storage.local.get.mockResolvedValue({
      settings: { prListMaxAgeDays: 1 },
      syncState: {
        ...syncState,
        prs: [agedPr(1, { updatedAt: new Date(NOW - DAY + 1000).toISOString() })],
      },
    });
    let failSync;
    mock.browser.runtime.sendMessage.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          failSync = reject;
        })
    );
    await openView('sidebar');
    document.getElementById('syncNow').click();
    await vi.advanceTimersByTimeAsync(1000);
    window.dispatchEvent(new Event('focus'));
    expect(document.getElementById('footer').textContent).toBe('Syncing…');
    failSync(new Error('Connection failed'));
    await Promise.resolve();
    storageListener({ settings: { newValue: { prListMaxAgeDays: 0 } } }, 'local');
    window.dispatchEvent(new Event('focus'));
    expect(document.getElementById('footer').textContent).toBe('Sync failed: Connection failed');
    expect(document.querySelectorAll('.pr-title')).toHaveLength(1);
  });

  it('filters manual sync results while retaining the sync error in the footer', async () => {
    mock.browser.storage.local.get.mockResolvedValue({
      settings: { prListMaxAgeDays: 7 },
      syncState,
    });
    mock.browser.runtime.sendMessage.mockResolvedValue({
      ...syncState,
      prs: [agedPr(10)],
      error: 'Offline',
    });
    await openView('popup');
    document.getElementById('syncNow').click();
    await Promise.resolve();
    expect(document.getElementById('prList').textContent).toBe(
      'No PRs updated within the past 7 days.'
    );
    expect(document.getElementById('footer').textContent).toBe('Last sync failed: Offline');
    storageListener({ settings: { newValue: { prListMaxAgeDays: 0 } } }, 'local');
    expect(document.querySelectorAll('.pr-title')).toHaveLength(1);
  });
});

describe('shared PR view', () => {
  it.each(['popup', 'sidebar'])(
    'retains focused links through unchanged redraws in %s',
    async (mode) => {
      await openView(mode);
      const link = document.querySelector('#prList a');
      link.focus();
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      storageListener({ settings: { newValue: { badgeMaxAgeHours: 24 } } }, 'local');
      storageListener({ syncState: { newValue: structuredClone(syncState) } }, 'local');

      expect(document.querySelector('#prList a')).toBe(link);
      expect(document.activeElement).toBe(link);
      link.click();
      expect(mock.browser.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: pr.url });
    }
  );

  it('updates and reorders retained rows without losing their links or focus', async () => {
    const other = {
      ...pr,
      number: 43,
      url: 'https://github.com/acme/widgets/pull/43',
      title: 'Other',
    };
    mock.browser.storage.local.get.mockResolvedValue({
      syncState: { ...syncState, prs: [pr, other] },
    });
    await openView('sidebar');
    const [first, second] = document.querySelectorAll('#prList a');
    first.focus();
    const updated = { ...pr, title: 'Updated title', ci: 'FAILURE', repo: 'acme/renamed' };
    storageListener({ syncState: { newValue: { ...syncState, prs: [other, updated] } } }, 'local');
    expect([...document.querySelectorAll('#prList a')]).toEqual([second, first]);
    expect(first.querySelector('.pr-title').textContent).toBe('Updated title');
    expect(first.querySelector('.pr-repo').textContent).toBe('acme/renamed#42');
    expect(first.firstElementChild.textContent).toBe('🔴');
    expect(document.activeElement).toBe(first);

    storageListener({ syncState: { newValue: { ...syncState, prs: [updated] } } }, 'local');
    expect(second.isConnected).toBe(false);
    expect(document.querySelector('#prList a')).toBe(first);
    expect(document.activeElement).toBe(first);
  });

  it.each([undefined, syncState])(
    'keeps loading state until the initial cache read finishes (%j)',
    async (cached) => {
      const initial = deferred();
      mock.browser.storage.local.get.mockReturnValue(initial.promise);
      await openView('sidebar');
      expect(document.getElementById('prList').textContent).toBe('Loading…');
      storageListener({ settings: { newValue: { badgeMaxAgeHours: 24 } } }, 'local');
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      expect(document.getElementById('prList').textContent).toBe('Loading…');
      initial.resolve({ syncState: cached });
      await Promise.resolve();
      expect(document.getElementById('prList').textContent).toContain(
        cached ? pr.title : 'No sync yet.'
      );
    }
  );

  it.each(['success', 'skipped', 'error'])(
    'ignores a late manual-sync %s after a storage update',
    async (outcome) => {
      const pending = deferred();
      mock.browser.runtime.sendMessage.mockReturnValue(pending.promise);
      await openView('sidebar');
      document.getElementById('syncNow').click();
      const newer = { ...syncState, lastSync: NOW, prs: [{ ...pr, title: 'Newer PR' }] };
      storageListener({ syncState: { newValue: newer } }, 'local');
      const footer = document.getElementById('footer').textContent;
      if (outcome === 'error') pending.reject(new Error('Old request failed'));
      else
        pending.resolve(
          outcome === 'skipped' ? { skipped: true, reason: 'Old skip reason' } : syncState
        );
      await Promise.resolve();
      expect(document.querySelector('.pr-title').textContent).toBe('Newer PR');
      expect(document.getElementById('footer').textContent).toBe(footer);
    }
  );

  it('keeps removed cache state when an older manual reply arrives', async () => {
    const pending = deferred();
    mock.browser.runtime.sendMessage.mockReturnValue(pending.promise);
    await openView('sidebar');
    document.getElementById('syncNow').click();
    storageListener({ syncState: {} }, 'local');
    pending.resolve(syncState);
    await Promise.resolve();
    expect(document.getElementById('prList').textContent).toContain('No sync yet.');
    expect(document.getElementById('footer').textContent).toBe('');
  });

  it('keeps the latest manual request result when requests finish out of order', async () => {
    const first = deferred();
    const second = deferred();
    mock.browser.runtime.sendMessage
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await openView('sidebar');
    document.getElementById('syncNow').click();
    document.getElementById('syncNow').click();
    second.resolve({ ...syncState, prs: [{ ...pr, title: 'Latest request' }] });
    await Promise.resolve();
    first.resolve(syncState);
    await Promise.resolve();
    expect(document.querySelector('.pr-title').textContent).toBe('Latest request');
  });

  it.each(['popup', 'sidebar'])('renders saved PRs in %s mode', async (mode) => {
    await openView(mode);
    expect(document.querySelector('.pr-title').textContent).toBe(pr.title);
    expect(document.body.classList.contains('sidebar')).toBe(mode === 'sidebar');
    expect(document.getElementById('footer').textContent).toContain('Last synced at');
  });

  it.each(['popup', 'sidebar'])('opens a PR from %s and only closes a popup', async (mode) => {
    await openView(mode);
    document.querySelector('#prList a').click();

    expect(mock.browser.tabs.create).toHaveBeenCalledWith({ url: pr.url });
    expect(window.close).toHaveBeenCalledTimes(mode === 'popup' ? 1 : 0);
  });

  it('updates the sidebar from background sync events and handles removed state', async () => {
    await openView('sidebar');
    storageListener({ syncState: { newValue: { prs: [], error: 'API unavailable' } } }, 'local');
    expect(document.getElementById('prList').textContent).toContain('No pull requests found.');
    expect(document.getElementById('footer').textContent).toBe('Last sync failed: API unavailable');

    storageListener({ syncState: { newValue: syncState } }, 'local');
    expect(document.querySelector('.pr-title').textContent).toBe(pr.title);

    storageListener({ syncState: {} }, 'local');
    expect(document.getElementById('prList').textContent).toContain('No sync yet.');
    expect(document.getElementById('footer').textContent).toBe('');
  });

  it('ignores unrelated storage changes', async () => {
    await openView('sidebar');
    storageListener({ settings: { newValue: { displayMode: 'popup' } } }, 'local');
    storageListener({ syncState: { newValue: { prs: [] } } }, 'sync');
    expect(document.querySelector('.pr-title').textContent).toBe(pr.title);
    expect(document.body.classList.contains('sidebar')).toBe(true);
    expect(window.close).not.toHaveBeenCalled();
  });

  it('does not overwrite a live update with a stale initial read', async () => {
    let finishRead;
    mock.browser.storage.local.get.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    await openView('sidebar');
    storageListener({ syncState: { newValue: syncState } }, 'local');
    finishRead({ syncState: { prs: [] } });
    await Promise.resolve();
    expect(document.querySelector('.pr-title').textContent).toBe(pr.title);
  });

  it.each(['popup', 'sidebar'])('retains Sync now and Options actions in %s mode', async (mode) => {
    await openView(mode);
    document.getElementById('syncNow').click();
    await Promise.resolve();
    expect(mock.browser.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sync-now' });
    expect(document.querySelector('.pr-title').textContent).toBe(pr.title);

    document.getElementById('openOptions').click();
    expect(mock.browser.runtime.openOptionsPage).toHaveBeenCalledOnce();
    expect(window.close).not.toHaveBeenCalled();
  });
});
