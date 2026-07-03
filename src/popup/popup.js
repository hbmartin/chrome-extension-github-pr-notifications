import browser from 'webextension-polyfill';
import { statusEmoji } from '../lib/emoji.js';

const list = document.getElementById('prList');
const footer = document.getElementById('footer');

function renderEmpty(text) {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = text;
  list.replaceChildren(li);
}

function render(syncState) {
  if (!syncState) {
    renderEmpty('No sync yet. Enable PR bookmark sync in Options, or hit ↻.');
    footer.textContent = '';
    return;
  }
  const prs = syncState.prs ?? [];
  if (prs.length === 0) {
    renderEmpty('No pull requests found.');
  } else {
    list.replaceChildren(
      ...prs.map((pr) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = pr.url;
        a.addEventListener('click', (event) => {
          event.preventDefault();
          browser.tabs.create({ url: pr.url });
          window.close();
        });
        const emoji = document.createElement('span');
        emoji.textContent = statusEmoji(pr);
        const title = document.createElement('span');
        title.className = 'pr-title';
        title.textContent = pr.title;
        const repo = document.createElement('span');
        repo.className = 'pr-repo';
        repo.textContent = `${pr.repo}#${pr.number}`;
        a.append(emoji, title, repo);
        li.append(a);
        return li;
      })
    );
  }
  const when = syncState.lastSync ? new Date(syncState.lastSync).toLocaleTimeString() : 'never';
  footer.textContent = syncState.error
    ? `Last sync failed: ${syncState.error}`
    : `Last synced at ${when}`;
}

async function refresh() {
  const { syncState } = await browser.storage.local.get('syncState');
  render(syncState);
}

document.getElementById('syncNow').addEventListener('click', async () => {
  footer.textContent = 'Syncing…';
  try {
    const result = await browser.runtime.sendMessage({ type: 'sync-now' });
    if (result?.skipped) footer.textContent = result.reason;
    else render(result);
  } catch (error) {
    footer.textContent = `Sync failed: ${error.message ?? error}`;
  }
});

document.getElementById('openOptions').addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

refresh();
