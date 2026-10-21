import { filterPrsByAge } from './pr-age.js';

/** Filter only the displayed PRs, retaining the original cache and ordering. */
export function getPrListState(prs, maxAgeDays = 0, now = Date.now()) {
  return filterPrsByAge(prs, maxAgeDays * 86_400_000, now);
}
