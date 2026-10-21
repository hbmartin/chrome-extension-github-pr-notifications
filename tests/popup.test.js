import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ browser: undefined }));
vi.mock('webextension-polyfill', () => ({
  default: new Proxy({}, { get: (_target, property) => mock.browser?.[property] }),
}));

const html = readFileSync('src/popup/popup.html', 'utf8');
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
  document.documentElement.innerHTML = html;
  mock.browser = {
    storage: {
      local: { get: vi.fn(async () => ({ syncState })) },
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
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.body.className = '';
  mock.browser = undefined;
  storageListener = undefined;
});

describe('shared PR view', () => {
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
