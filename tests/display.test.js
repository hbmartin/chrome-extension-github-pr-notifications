import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureDisplay, POPUP_PATH, supportsSidebar } from '../src/lib/display.js';

function createBrowser(target) {
  return {
    action: { setPopup: vi.fn(async () => {}) },
    ...(target === 'chrome' && {
      sidePanel: { setPanelBehavior: vi.fn(async () => {}) },
    }),
    ...(target === 'firefox' && {
      sidebarAction: { toggle: vi.fn(async () => {}) },
    }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('toolbar display configuration', () => {
  it.each(['chrome', 'firefox'])(
    'switches both ways on %s without opening a view',
    async (target) => {
      const browser = createBrowser(target);
      expect(supportsSidebar(browser)).toBe(true);

      expect(await configureDisplay(browser, 'sidebar')).toBe('sidebar');
      expect(browser.action.setPopup).toHaveBeenLastCalledWith({ popup: '' });
      if (target === 'chrome') {
        expect(browser.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({
          openPanelOnActionClick: true,
        });
      } else {
        expect(browser.sidebarAction.toggle).not.toHaveBeenCalled();
      }

      expect(await configureDisplay(browser, 'popup')).toBe('popup');
      expect(browser.action.setPopup).toHaveBeenLastCalledWith({ popup: POPUP_PATH });
      if (target === 'chrome') {
        expect(browser.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({
          openPanelOnActionClick: false,
        });
      } else {
        expect(browser.sidebarAction.toggle).not.toHaveBeenCalled();
      }
    }
  );

  it('retains a popup on browsers without a sidebar API', async () => {
    const browser = createBrowser('unsupported');
    expect(supportsSidebar(browser)).toBe(false);
    expect(await configureDisplay(browser, 'sidebar')).toBe('popup');
    expect(browser.action.setPopup).toHaveBeenCalledWith({ popup: POPUP_PATH });
  });

  it('does not mistake a partial sidebar API for support', () => {
    expect(supportsSidebar({ sidePanel: {}, sidebarAction: {} })).toBe(false);
  });

  it('restores a popup when native panel configuration rejects', async () => {
    const browser = createBrowser('chrome');
    browser.sidePanel.setPanelBehavior.mockRejectedValue(new Error('Unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await configureDisplay(browser, 'sidebar')).toBe('popup');
    expect(browser.action.setPopup).toHaveBeenLastCalledWith({ popup: POPUP_PATH });
    expect(browser.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({
      openPanelOnActionClick: false,
    });
  });

  it('restores a popup and disables native toolbar handling if clearing the popup fails', async () => {
    const browser = createBrowser('chrome');
    browser.action.setPopup.mockRejectedValueOnce(new Error('Could not clear popup'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await configureDisplay(browser, 'sidebar')).toBe('popup');
    expect(browser.action.setPopup).toHaveBeenLastCalledWith({ popup: POPUP_PATH });
    expect(browser.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({
      openPanelOnActionClick: false,
    });
  });
});
