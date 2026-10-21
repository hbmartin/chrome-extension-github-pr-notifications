/** Count failing open PRs and find when the next one ages out of the badge. */
export function getBadgeState(prs, maxAgeHours = 0, now = Date.now()) {
  let count = 0;
  let nextExpiry = null;

  for (const pr of prs) {
    if (pr.state !== 'OPEN' || !['FAILURE', 'ERROR'].includes(pr.ci)) continue;
    if (maxAgeHours > 0) {
      const updatedAt = typeof pr.updatedAt === 'string' ? Date.parse(pr.updatedAt) : NaN;
      if (!Number.isFinite(updatedAt)) continue;
      const expiresAt = updatedAt + maxAgeHours * 3_600_000;
      if (expiresAt <= now) continue;
      nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
    }
    count += 1;
  }

  return { count, nextExpiry };
}
