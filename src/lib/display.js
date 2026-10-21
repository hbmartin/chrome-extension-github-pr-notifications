export const POPUP_PATH = 'popup/popup.html';

/** Chrome and Firefox expose different native sidebar APIs. */
export function supportsSidebar(browser) {
  return (
    typeof browser.sidePanel?.setPanelBehavior === 'function' ||
    typeof browser.sidebarAction?.toggle === 'function'
  );
}

/** Change the next toolbar click without opening or closing an existing view. */
export async function configureDisplay(browser, displayMode) {
  const sidebar = displayMode === 'sidebar' && supportsSidebar(browser);
  try {
    if (typeof browser.sidePanel?.setPanelBehavior === 'function') {
      await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: sidebar });
    }
    await browser.action.setPopup({ popup: sidebar ? '' : POPUP_PATH });
    return sidebar ? 'sidebar' : 'popup';
  } catch (error) {
    // Restore an accessible toolbar even if configuring the native sidebar fails.
    await browser.action.setPopup({ popup: POPUP_PATH });
    if (typeof browser.sidePanel?.setPanelBehavior === 'function') {
      await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
    }
    console.warn('Failed to configure display mode; using popup', error);
    return 'popup';
  }
}
