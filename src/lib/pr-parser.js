/**
 * DOM parsing for GitHub PR pages. Pure functions over a root element so
 * they can be tested against HTML fixtures.
 *
 * GitHub ships (at least) two PR page generations: the legacy Rails markup
 * and the newer React merge box. Selectors here try stable hooks first
 * (fragment anchors like #issuecomment-…, merge-box phrases) and fall back
 * to legacy class names.
 */

export const CiSummary = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  PENDING: 'pending',
};

const SUMMARY_PHRASES = [
  ['All checks have passed', CiSummary.SUCCESS],
  ['All checks have failed', CiSummary.FAILURE],
  ['Some checks were not successful', CiSummary.FAILURE],
  ["Some checks haven't completed yet", CiSummary.PENDING],
  ['Waiting for status to be reported', CiSummary.PENDING],
];

const MERGE_BOX_SELECTORS = [
  '[data-testid="mergebox-partial"]',
  '.mergeability-details',
  '.merge-pr',
  '.discussion-timeline-actions',
];

export function findMergeBox(root) {
  for (const selector of MERGE_BOX_SELECTORS) {
    const el = root.querySelector(selector);
    if (el) return el;
  }
  return null;
}

/**
 * Overall CI state shown in the merge box, or null when there is no merge
 * box / no checks section (e.g. closed PRs, Files tab).
 */
export function getCiSummary(root) {
  const scope = findMergeBox(root) ?? root;
  const text = scope.textContent ?? '';
  for (const [phrase, summary] of SUMMARY_PHRASES) {
    if (text.includes(phrase)) return summary;
  }
  return null;
}

/**
 * Names of currently-failing checks. Best effort: exact on legacy markup,
 * and a generic aria-label scan for newer markup. Returns [] when names
 * can't be determined (callers should still trust getCiSummary()).
 */
export function getFailedCheckNames(root) {
  const scope = findMergeBox(root) ?? root;
  const failed = new Set();

  // Legacy markup: one .merge-status-item per check.
  for (const item of scope.querySelectorAll('.merge-status-item')) {
    const name = item.querySelector('.text-emphasized, strong')?.textContent?.trim();
    if (!name) continue;
    const icon = item.querySelector('svg');
    const failing =
      icon &&
      (icon.classList.contains('octicon-x') ||
        icon.classList.contains('text-red') ||
        icon.classList.contains('color-fg-danger'));
    if (failing) failed.add(name);
  }

  // Newer markup: status is described in aria-labels / alt text.
  for (const el of scope.querySelectorAll('[aria-label*="fail" i], [alt*="fail" i]')) {
    const row = el.closest('li, [role="listitem"], .merge-status-item');
    const name = row?.textContent?.trim().split('\n')[0]?.trim();
    if (name) failed.add(name.slice(0, 120));
  }

  return [...failed];
}

/**
 * Collect timeline comments, review comments, and reviews. Keyed by
 * GitHub's fragment anchors, which are stable across page generations
 * because permalinks depend on them.
 *
 * Returns Map<id, {id, kind, verdict, text}> in document order.
 */
export function collectComments(root) {
  const results = new Map();
  const nodes = root.querySelectorAll(
    '[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"]'
  );
  for (const node of nodes) {
    const id = node.id;
    // Anchors must end in the numeric database id; skip derived elements
    // like "issuecomment-123-permalink".
    if (!/^(issuecomment-|discussion_r|pullrequestreview-)\d+$/.test(id)) continue;
    if (results.has(id)) continue;

    let kind = 'comment';
    if (id.startsWith('discussion_r')) kind = 'review-comment';
    else if (id.startsWith('pullrequestreview-')) kind = 'review';

    const text = extractCommentText(node);
    const verdict = kind === 'review' ? reviewVerdict(node) : null;
    results.set(id, { id, kind, verdict, text });
  }
  return results;
}

function extractCommentText(node) {
  const body = node.querySelector('.comment-body, [class*="MarkdownViewer"], td.comment-body');
  const text = (body ?? node).textContent ?? '';
  return text.trim().replace(/\s+/g, ' ').slice(0, 300);
}

function reviewVerdict(node) {
  const text = node.textContent ?? '';
  if (/approved these changes|approved this/i.test(text)) return 'approved';
  if (/requested changes/i.test(text)) return 'changes-requested';
  return null;
}
