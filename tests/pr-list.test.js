import { describe, expect, it } from 'vitest';
import { getPrListState } from '../src/lib/pr-list.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const pr = (ageDays, overrides = {}) =>
  Object.freeze({
    updatedAt: new Date(NOW - ageDays * DAY).toISOString(),
    ...overrides,
  });

describe('getPrListState', () => {
  it('preserves cached objects and ordering while filtering only the display list', () => {
    const prs = Object.freeze([pr(8), pr(2), pr(1), pr(6)]);
    expect(getPrListState(prs, 7, NOW)).toEqual({
      prs: [prs[1], prs[2], prs[3]],
      nextExpiry: NOW + DAY,
    });
    expect(prs).toHaveLength(4);
  });

  it('uses rolling 24-hour days and hides PRs exactly at expiration', () => {
    const inside = pr(1, { updatedAt: new Date(NOW - DAY + 1).toISOString() });
    expect(getPrListState([pr(1), inside], 1, NOW)).toEqual({ prs: [inside], nextExpiry: NOW + 1 });
  });

  it('applies the same cutoff to passing, failing, draft, closed, and merged PRs', () => {
    const states = [
      { state: 'OPEN', ci: 'SUCCESS' },
      { state: 'OPEN', ci: 'FAILURE' },
      { state: 'OPEN', isDraft: true },
      { state: 'CLOSED' },
      { state: 'MERGED' },
    ];
    const recent = states.map((state) => pr(2, state));
    const old = states.map((state) => pr(10, state));
    expect(getPrListState([...recent, ...old], 7, NOW).prs).toEqual(recent);
  });

  it.each([undefined, null, '', 'invalid', 0])(
    'hides invalid timestamps only while filtering: %s',
    (updatedAt) => {
      const prs = [pr(1, { updatedAt })];
      expect(getPrListState(prs, 7, NOW)).toEqual({ prs: [], nextExpiry: null });
      expect(getPrListState(prs, 0, NOW)).toEqual({ prs, nextExpiry: null });
    }
  );

  it('returns all cached PRs by default and no expiration timer', () => {
    const prs = Object.freeze([pr(100), pr(1), pr(5, { updatedAt: null })]);
    expect(getPrListState(prs)).toEqual({ prs, nextExpiry: null });
  });

  it('does not schedule expiration for empty or entirely hidden lists', () => {
    expect(getPrListState([], 7, NOW)).toEqual({ prs: [], nextExpiry: null });
    expect(getPrListState([pr(8)], 7, NOW)).toEqual({ prs: [], nextExpiry: null });
  });
});
