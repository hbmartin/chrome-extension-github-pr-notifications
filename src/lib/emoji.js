/**
 * Colored-circle status emoji for a pull request.
 *
 *   🟣 merged        ⚫ closed without merging
 *   ⚪ draft         🟢 open, checks passing (or no checks)
 *   🟡 open, checks pending
 *   🔴 open, checks failing
 */
export function statusEmoji(pr) {
  if (pr.state === 'MERGED') return '🟣';
  if (pr.state === 'CLOSED') return '⚫';
  if (pr.isDraft) return '⚪';
  switch (pr.ci) {
    case 'SUCCESS':
      return '🟢';
    case 'FAILURE':
    case 'ERROR':
      return '🔴';
    case 'PENDING':
    case 'EXPECTED':
      return '🟡';
    default:
      return '🟢';
  }
}

export function bookmarkTitle(pr) {
  return `${statusEmoji(pr)} ${pr.title} (${pr.repo}#${pr.number})`;
}
