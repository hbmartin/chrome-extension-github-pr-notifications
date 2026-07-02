import browser from 'webextension-polyfill';
import { CiSummary, getCiSummary, getFailedCheckNames, collectComments } from '../lib/pr-parser.js';

/**
 * Content script: watches the current PR page for CI status transitions and
 * new comments/reviews, and forwards events to the background worker.
 *
 * GitHub navigates with Turbo (SPA-style), so this script may stay alive
 * across several PRs. State is re-baselined whenever the PR under the URL
 * changes, and the initial page content never triggers notifications.
 */

const DEBOUNCE_MS = 400;

const state = {
  prKey: null,
  ciSummary: null,
  failedChecks: new Set(),
  commentIds: new Set(),
};

function currentPrKey() {
  const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return match ? `${match[1]}/${match[2]}#${match[3]}` : null;
}

function notify(kind, content) {
  browser.runtime
    .sendMessage({ type: 'pr-event', kind, content, pageTitle: document.title })
    .catch(() => {
      // Background worker not ready (e.g. right after an update); drop it.
    });
}

function baseline() {
  state.prKey = currentPrKey();
  state.ciSummary = getCiSummary(document);
  state.failedChecks = new Set(getFailedCheckNames(document));
  state.commentIds = new Set(collectComments(document).keys());
}

function scan() {
  const prKey = currentPrKey();
  if (!prKey) return;
  if (prKey !== state.prKey) {
    baseline();
    return;
  }

  const summary = getCiSummary(document);
  if (summary && summary !== state.ciSummary) {
    if (summary === CiSummary.SUCCESS) {
      notify('ci-success', '✅ CI successful');
    } else if (summary === CiSummary.FAILURE) {
      const failures = getFailedCheckNames(document).filter((n) => !state.failedChecks.has(n));
      if (failures.length > 0) {
        for (const name of failures) notify('ci-failure', `❌ ${name}`);
      } else {
        notify('ci-failure', '❌ Some checks were not successful');
      }
    }
    state.ciSummary = summary;
  }
  for (const name of getFailedCheckNames(document)) state.failedChecks.add(name);

  for (const [id, comment] of collectComments(document)) {
    if (state.commentIds.has(id)) continue;
    state.commentIds.add(id);
    if (comment.kind === 'review') {
      const verdict =
        comment.verdict === 'approved'
          ? '🔍 Review: approved'
          : comment.verdict === 'changes-requested'
            ? '🔍 Review: changes requested'
            : '🔍 New review';
      notify('review', comment.text ? `${verdict} — ${comment.text}` : verdict);
    } else {
      notify('comment', `💬 ${comment.text}`);
    }
  }
}

let debounceTimer = null;
function scheduleScan() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(scan, DEBOUNCE_MS);
}

baseline();

// GitHub replaces large DOM regions wholesale (Turbo + React), so observe
// the whole body and debounce instead of pinning fragile target nodes.
const observer = new MutationObserver(scheduleScan);
observer.observe(document.body, { childList: true, subtree: true });

// SPA navigation: re-baseline when the user moves to a different PR so the
// new page's existing content doesn't fire notifications.
for (const event of ['turbo:load', 'turbo:render', 'pjax:end']) {
  document.addEventListener(event, () => {
    if (currentPrKey() !== state.prKey) baseline();
  });
}
window.addEventListener('popstate', () => {
  if (currentPrKey() !== state.prKey) baseline();
});
