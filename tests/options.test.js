import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const state = { browser: undefined };
  return {
    get browser() {
      return state.browser;
    },
    set browser(value) {
      state.browser = value;
    },
    browserProxy: new Proxy(
      {},
      {
        get(_target, property) {
          return state.browser?.[property];
        },
      }
    ),
  };
});

vi.mock('webextension-polyfill', () => ({
  default: mockState.browserProxy,
}));

function setupDom() {
  document.body.innerHTML = `
    <form id="settingsForm">
      <input id="token" />
      <input id="githubHost" />
      <input type="checkbox" id="notifyCiSuccess" />
      <input type="checkbox" id="notifyCiFailure" />
      <input type="checkbox" id="notifyComments" />
      <input type="checkbox" id="notifyReviews" />
      <select id="iconTheme"><option value="octocat">Octocat</option></select>
      <input type="checkbox" id="syncEnabled" />
      <select id="syncFolder"></select>
      <select id="syncRole"><option value="author">Author</option></select>
      <select id="syncState"><option value="open">Open</option></select>
      <input type="number" id="syncLimit" min="1" max="100" step="1" />
      <input type="number" id="syncInterval" min="1" step="1" />
      <button type="submit" id="save">Save</button>
      <button type="button" id="syncNow">Sync now</button>
      <button type="button" id="createFolder">New folder</button>
      <span id="status"></span>
    </form>
  `;
  globalThis.Option = window.Option;
}

function createBrowserMock(overrides = {}) {
  return {
    storage: {
      local: {
        get: vi.fn(async () => ({ settings: undefined })),
        set: vi.fn(async () => {}),
      },
    },
    bookmarks: {
      create: vi.fn(async ({ title }) => ({ id: 'new-folder', title })),
      getTree: vi.fn(async () => []),
      ...overrides.bookmarks,
    },
    permissions: {
      contains: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    runtime: {
      sendMessage: vi.fn(async () => ({ prs: [] })),
    },
  };
}

async function importOptionsModule() {
  vi.resetModules();
  const optionsModule = await import('../src/options/options.js');
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  return optionsModule;
}

beforeEach(() => {
  vi.useFakeTimers();
  setupDom();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  mockState.browser = undefined;
});

describe('options page submit handling', () => {
  it('reflects sanitized sync values before saving', async () => {
    mockState.browser = createBrowserMock();
    const { handleSettingsSubmit } = await importOptionsModule();
    const form = document.getElementById('settingsForm');
    form.checkValidity = vi.fn(() => true);
    form.reportValidity = vi.fn();

    document.getElementById('githubHost').value = 'github.com';
    document.getElementById('syncLimit').value = '200';
    document.getElementById('syncInterval').value = '15.9';

    await handleSettingsSubmit({ preventDefault: vi.fn(), currentTarget: form });

    expect(document.getElementById('syncLimit').value).toBe('100');
    expect(document.getElementById('syncInterval').value).toBe('15');
    expect(mockState.browser.storage.local.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        githubHost: 'github.com',
        sync: expect.objectContaining({ limit: 100, intervalMinutes: 15 }),
      }),
    });
    expect(document.getElementById('status').textContent).toBe('Saved.');
  });

  it('does not save when browser form validation fails', async () => {
    mockState.browser = createBrowserMock();
    const { handleSettingsSubmit } = await importOptionsModule();
    const form = document.getElementById('settingsForm');
    form.checkValidity = vi.fn(() => false);
    form.reportValidity = vi.fn();

    await handleSettingsSubmit({ preventDefault: vi.fn(), currentTarget: form });

    expect(form.reportValidity).toHaveBeenCalled();
    expect(mockState.browser.storage.local.set).not.toHaveBeenCalled();
  });

  it('does not require sync number fields when sync is disabled', async () => {
    mockState.browser = createBrowserMock();
    const { handleSettingsSubmit } = await importOptionsModule();
    const form = document.getElementById('settingsForm');
    form.reportValidity = vi.fn();

    document.getElementById('syncEnabled').checked = false;
    document.getElementById('syncLimit').value = '';
    document.getElementById('syncInterval').value = '';

    await handleSettingsSubmit({ preventDefault: vi.fn(), currentTarget: form });

    expect(form.reportValidity).not.toHaveBeenCalled();
    expect(mockState.browser.storage.local.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        sync: expect.objectContaining({ enabled: false, limit: 10, intervalMinutes: 10 }),
      }),
    });
  });

  it('requires sync number fields when sync is enabled', async () => {
    mockState.browser = createBrowserMock();
    const { handleSettingsSubmit } = await importOptionsModule();
    const form = document.getElementById('settingsForm');
    form.reportValidity = vi.fn();

    document.getElementById('syncEnabled').checked = true;
    document.getElementById('syncLimit').value = '';
    document.getElementById('syncInterval').value = '';

    await handleSettingsSubmit({ preventDefault: vi.fn(), currentTarget: form });

    expect(form.reportValidity).toHaveBeenCalled();
    expect(mockState.browser.storage.local.set).not.toHaveBeenCalled();
  });
});

describe('options page folder creation', () => {
  it('reports folder-list refresh failures separately from create failures', async () => {
    const getTree = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('tree failed'));
    mockState.browser = createBrowserMock({ bookmarks: { getTree } });
    const { handleCreateFolder } = await importOptionsModule();
    vi.spyOn(window, 'prompt').mockReturnValue('GitHub PRs');

    await handleCreateFolder();

    expect(mockState.browser.bookmarks.create).toHaveBeenCalledWith({ title: 'GitHub PRs' });
    expect(document.getElementById('status').textContent).toBe(
      'Created folder “GitHub PRs”, but failed to update folder list: tree failed'
    );
  });
});
