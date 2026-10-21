import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ browser: undefined }));
vi.mock('webextension-polyfill', () => ({
  default: new Proxy({}, { get: (_target, property) => mock.browser?.[property] }),
}));

function event() {
  const listeners = [];
  return {
    addListener: vi.fn((listener) => listeners.push(listener)),
    emit: (...args) => Promise.all(listeners.map((listener) => listener(...args))),
  };
}

function createBrowser(displayMode = 'popup', target = 'chrome') {
  return {
    storage: {
      local: { get: vi.fn(async () => ({ settings: { displayMode } })) },
      onChanged: event(),
    },
    action: {
      setPopup: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setBadgeText: vi.fn(async () => {}),
      onClicked: event(),
    },
    sidePanel: target === 'chrome' ? { setPanelBehavior: vi.fn(async () => {}) } : undefined,
    sidebarAction: target === 'firefox' ? { toggle: vi.fn(async () => {}) } : undefined,
    notifications: { onClicked: event(), onClosed: event() },
    alarms: { onAlarm: event(), clear: vi.fn(async () => {}) },
    runtime: { onInstalled: event(), onStartup: event(), onMessage: event() },
  };
}

async function startBackground() {
  vi.resetModules();
  await import('../src/background.js');
  await vi.waitFor(() => expect(mock.browser.action.setPopup).toHaveBeenCalled());
  await vi.waitFor(() => expect(mock.browser.action.setBadgeText).toHaveBeenCalled());
}

beforeEach(() => {
  mock.browser = createBrowser();
});

afterEach(() => {
  vi.restoreAllMocks();
  mock.browser = undefined;
});

describe('background display lifecycle', () => {
  it.each(['popup', 'sidebar'])(
    'restores saved %s mode on each background initialization',
    async (mode) => {
      mock.browser = createBrowser(mode);
      await startBackground();
      expect(mock.browser.action.setPopup).toHaveBeenLastCalledWith({
        popup: mode === 'sidebar' ? '' : 'popup/popup.html',
      });

      mock.browser = createBrowser(mode);
      await startBackground();
      expect(mock.browser.action.setPopup).toHaveBeenLastCalledWith({
        popup: mode === 'sidebar' ? '' : 'popup/popup.html',
      });
    }
  );

  it.each(['onInstalled', 'onStartup'])(
    'restores the UI once when %s loads the worker',
    async (name) => {
      mock.browser = createBrowser('sidebar');
      await startBackground();
      await mock.browser.runtime[name].emit();

      expect(mock.browser.action.setPopup).toHaveBeenCalledExactlyOnceWith({ popup: '' });
      expect(mock.browser.action.setBadgeText).toHaveBeenCalledOnce();
      expect(mock.browser.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({
        openPanelOnActionClick: true,
      });
    }
  );

  it('applies saved changes in both directions and ignores unrelated storage events', async () => {
    await startBackground();
    mock.browser.storage.local.get.mockResolvedValue({ settings: { displayMode: 'sidebar' } });
    await mock.browser.storage.onChanged.emit(
      { settings: { newValue: { displayMode: 'sidebar' } } },
      'local'
    );
    await vi.waitFor(() =>
      expect(mock.browser.action.setPopup).toHaveBeenLastCalledWith({ popup: '' })
    );

    mock.browser.storage.local.get.mockResolvedValue({ settings: { displayMode: 'popup' } });
    await mock.browser.storage.onChanged.emit(
      { settings: { oldValue: { displayMode: 'sidebar' }, newValue: { displayMode: 'popup' } } },
      'local'
    );
    await vi.waitFor(() =>
      expect(mock.browser.action.setPopup).toHaveBeenLastCalledWith({ popup: 'popup/popup.html' })
    );

    mock.browser.action.setPopup.mockClear();
    await mock.browser.storage.onChanged.emit({ syncState: { newValue: {} } }, 'local');
    await mock.browser.storage.onChanged.emit({ settings: { newValue: {} } }, 'sync');
    expect(mock.browser.action.setPopup).not.toHaveBeenCalled();
  });

  it('serializes preference changes while earlier configuration is still pending', async () => {
    await startBackground();
    let finishUpdate;
    mock.browser.sidePanel.setPanelBehavior.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpdate = resolve;
        })
    );
    mock.browser.storage.local.get.mockResolvedValue({ settings: { displayMode: 'sidebar' } });
    const firstUpdate = mock.browser.storage.onChanged.emit(
      { settings: { oldValue: { displayMode: 'popup' }, newValue: { displayMode: 'sidebar' } } },
      'local'
    );
    await vi.waitFor(() => expect(finishUpdate).toBeTypeOf('function'));

    mock.browser.storage.local.get.mockResolvedValue({ settings: { displayMode: 'popup' } });
    const secondUpdate = mock.browser.storage.onChanged.emit(
      { settings: { oldValue: { displayMode: 'sidebar' }, newValue: { displayMode: 'popup' } } },
      'local'
    );
    finishUpdate();
    await Promise.all([firstUpdate, secondUpdate]);
    await vi.waitFor(() =>
      expect(mock.browser.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({
        openPanelOnActionClick: false,
      })
    );
    expect(mock.browser.action.setPopup).toHaveBeenLastCalledWith({ popup: 'popup/popup.html' });
  });

  it('toggles Firefox sidebar directly during the toolbar click without reading storage', async () => {
    mock.browser = createBrowser('sidebar', 'firefox');
    await startBackground();
    mock.browser.storage.local.get.mockClear();

    const clicked = mock.browser.action.onClicked.emit();
    expect(mock.browser.sidebarAction.toggle).toHaveBeenCalledOnce();
    expect(mock.browser.storage.local.get).not.toHaveBeenCalled();
    await clicked;
  });

  it('handles Firefox sidebar rejection without an unhandled promise', async () => {
    mock.browser = createBrowser('sidebar', 'firefox');
    mock.browser.sidebarAction.toggle.mockRejectedValue(new Error('Could not open sidebar'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startBackground();
    await mock.browser.action.onClicked.emit();
    expect(warning).toHaveBeenCalledWith('Failed to toggle sidebar', expect.any(Error));
  });
});
