/** Filter only the displayed PRs, retaining the original cache and ordering. */
export function getPrListState(prs, maxAgeDays = 0, now = Date.now()) {
  if (maxAgeDays === 0) return { prs, nextExpiry: null };

  const visible = [];
  let nextExpiry = null;
  for (const pr of prs) {
    const updatedAt = typeof pr.updatedAt === 'string' ? Date.parse(pr.updatedAt) : NaN;
    if (!Number.isFinite(updatedAt)) continue;
    const expiresAt = updatedAt + maxAgeDays * 86_400_000;
    if (expiresAt <= now) continue;
    visible.push(pr);
    nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
  }
  return { prs: visible, nextExpiry };
}
