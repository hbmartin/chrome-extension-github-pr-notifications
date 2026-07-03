import browser from 'webextension-polyfill';
import { loadSettings, mergeSettings, saveSettings } from '../lib/settings.js';
import { normalizeGitHubHost } from '../lib/github.js';

const $ = (id) => document.getElementById(id);

/** Flatten the bookmark tree into folders with depth for indentation. */
export function flattenFolders(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    if (node.url) continue; // not a folder
    if (node.id !== '0' && node.id !== 'root________') {
      out.push({ id: node.id, title: node.title || '(unnamed)', depth });
    }
    if (node.children) {
      flattenFolders(
        node.children,
        node.id === '0' || node.id === 'root________' ? 0 : depth + 1,
        out
      );
    }
  }
  return out;
}

async function populateFolders(selectedId) {
  const tree = await browser.bookmarks.getTree();
  const folders = flattenFolders(tree);
  const select = $('syncFolder');
  select.replaceChildren();
  const placeholder = new Option('— choose a folder —', '');
  select.add(placeholder);
  for (const folder of folders) {
    const label = `${' '.repeat(folder.depth * 3)}${folder.title}`;
    select.add(new Option(label, folder.id, false, folder.id === selectedId));
  }
  if (selectedId && select.value !== selectedId) select.value = '';
}

async function restore() {
  const settings = await loadSettings(browser.storage.local);
  $('token').value = settings.token;
  $('githubHost').value = settings.githubHost;
  $('notifyCiSuccess').checked = settings.notifications.ciSuccess;
  $('notifyCiFailure').checked = settings.notifications.ciFailure;
  $('notifyComments').checked = settings.notifications.comments;
  $('notifyReviews').checked = settings.notifications.reviews;
  $('iconTheme').value = settings.iconTheme;
  $('syncEnabled').checked = settings.sync.enabled;
  $('syncRole').value = settings.sync.role;
  $('syncState').value = settings.sync.state;
  $('syncLimit').value = settings.sync.limit;
  $('syncInterval').value = settings.sync.intervalMinutes;
  await populateFolders(settings.sync.folderId);
}

function collect() {
  return {
    token: $('token').value.trim(),
    githubHost: normalizeGitHubHost($('githubHost').value),
    notifications: {
      ciSuccess: $('notifyCiSuccess').checked,
      ciFailure: $('notifyCiFailure').checked,
      comments: $('notifyComments').checked,
      reviews: $('notifyReviews').checked,
    },
    iconTheme: $('iconTheme').value,
    sync: {
      enabled: $('syncEnabled').checked,
      folderId: $('syncFolder').value,
      role: $('syncRole').value,
      state: $('syncState').value,
      limit: Number($('syncLimit').value),
      intervalMinutes: Number($('syncInterval').value),
    },
  };
}

function reflectSanitizedFields(settings) {
  $('githubHost').value = settings.githubHost;
  $('syncLimit').value = settings.sync.limit;
  $('syncInterval').value = settings.sync.intervalMinutes;
}

function setStatus(text) {
  $('status').textContent = text;
  if (text) setTimeout(() => ($('status').textContent = ''), 5000);
}

/** GitHub Enterprise hosts need a runtime-granted host permission. */
async function ensureHostPermission(githubHost) {
  const host = normalizeGitHubHost(githubHost);
  if (host === 'github.com') return true;
  const origin = `https://${host}/*`;
  const granted = await browser.permissions.contains({ origins: [origin] });
  if (granted) return true;
  return browser.permissions.request({ origins: [origin] });
}

export async function handleSettingsSubmit(event) {
  event.preventDefault();
  if (!event.currentTarget.checkValidity()) {
    event.currentTarget.reportValidity();
    return;
  }

  const settings = mergeSettings(collect());
  reflectSanitizedFields(settings);
  if (settings.sync.enabled && !settings.sync.folderId) {
    setStatus('Choose a bookmark folder to enable sync.');
    return;
  }
  if (settings.sync.enabled && !settings.token) {
    setStatus('A personal access token is required for sync.');
    return;
  }
  const permitted = await ensureHostPermission(settings.githubHost);
  if (!permitted) {
    setStatus(`Permission for ${settings.githubHost} was not granted.`);
    return;
  }
  await saveSettings(browser.storage.local, settings);
  setStatus('Saved.');
}

$('syncNow').addEventListener('click', async () => {
  setStatus('Syncing…');
  try {
    const result = await browser.runtime.sendMessage({ type: 'sync-now' });
    if (result?.skipped) setStatus(result.reason);
    else if (result?.error) setStatus(`Sync failed: ${result.error}`);
    else setStatus(`Synced ${result?.prs?.length ?? 0} PRs.`);
  } catch (error) {
    setStatus(`Sync failed: ${error?.message ?? String(error)}`);
  }
});

export async function handleCreateFolder() {
  const title = window.prompt('Name for the new bookmark folder:', 'GitHub PRs');
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) return;
  let folder;
  try {
    folder = await browser.bookmarks.create({ title: trimmedTitle });
  } catch (error) {
    setStatus(`Failed to create folder: ${error?.message ?? String(error)}`);
    return;
  }

  try {
    await populateFolders(folder.id);
    setStatus(`Created folder “${trimmedTitle}”.`);
  } catch (error) {
    setStatus(
      `Created folder “${trimmedTitle}”, but failed to update folder list: ${error?.message ?? String(error)}`
    );
  }
}

$('settingsForm').addEventListener('submit', handleSettingsSubmit);
$('createFolder').addEventListener('click', handleCreateFolder);
restore();
