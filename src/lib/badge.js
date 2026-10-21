import { filterPrsByAge } from './pr-age.js';

/** Count failing open PRs and find when the next one ages out of the badge. */
export function getBadgeState(prs, maxAgeHours = 0, now = Date.now()) {
  const failing = prs.filter((pr) => pr.state === 'OPEN' && ['FAILURE', 'ERROR'].includes(pr.ci));
  const { prs: recent, nextExpiry } = filterPrsByAge(
    failing,
    maxAgeHours > 0 ? maxAgeHours * 3_600_000 : 0,
    now
  );
  return { count: recent.length, nextExpiry };
}
