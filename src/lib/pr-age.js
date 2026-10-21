/** Apply a rolling age limit without changing cached objects or their order. */
export function filterPrsByAge(prs, maxAgeMs, now) {
  if (maxAgeMs === 0) return { prs, nextExpiry: null };

  const visible = [];
  let nextExpiry = null;
  for (const pr of prs) {
    const updatedAt = typeof pr.updatedAt === 'string' ? Date.parse(pr.updatedAt) : NaN;
    if (!Number.isFinite(updatedAt)) continue;
    const expiresAt = updatedAt + maxAgeMs;
    if (expiresAt <= now) continue;
    visible.push(pr);
    nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
  }
  return { prs: visible, nextExpiry };
}
