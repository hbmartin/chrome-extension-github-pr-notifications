import { describe, expect, it } from 'vitest';
import { getBadgeState } from '../src/lib/badge.js';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-20T12:00:00Z');
const failingPr = (ageHours, overrides = {}) => ({
  state: 'OPEN',
  ci: 'FAILURE',
  updatedAt: new Date(NOW - ageHours * HOUR).toISOString(),
  ...overrides,
});

describe('getBadgeState', () => {
  it('counts only recent failures and schedules the first expiration', () => {
    expect(
      getBadgeState(
        [
          failingPr(1),
          failingPr(23, { ci: 'ERROR' }),
          failingPr(25),
          failingPr(5, { ci: 'SUCCESS' }),
        ],
        24,
        NOW
      )
    ).toEqual({ count: 2, nextExpiry: NOW + HOUR });
  });

  it('expires PRs exactly at the cutoff, preserving PRs one millisecond inside it', () => {
    const justInside = { updatedAt: new Date(NOW - 24 * HOUR + 1).toISOString() };
    expect(getBadgeState([failingPr(24), failingPr(24, justInside)], 24, NOW)).toEqual({
      count: 1,
      nextExpiry: NOW + 1,
    });
  });

  it.each([undefined, null, '', 'invalid', 0])(
    'omits missing or invalid timestamps: %s',
    (updatedAt) => {
      const prs = [failingPr(0, { updatedAt })];
      expect(getBadgeState(prs, 24, NOW)).toEqual({ count: 0, nextExpiry: null });
      expect(getBadgeState(prs, 0, NOW)).toEqual({ count: 1, nextExpiry: null });
    }
  );

  it.each([
    { state: 'CLOSED' },
    { state: 'MERGED' },
    { ci: 'SUCCESS' },
    { ci: 'PENDING' },
    { ci: 'EXPECTED' },
    { ci: null },
  ])('never counts non-failing or non-open PRs: %j', (overrides) => {
    const prs = [failingPr(0, overrides)];
    expect(getBadgeState(prs, 24, NOW)).toEqual({ count: 0, nextExpiry: null });
    expect(getBadgeState(prs, 0, NOW)).toEqual({ count: 0, nextExpiry: null });
  });

  it('preserves all-time counting, including failing drafts and old PRs', () => {
    const prs = [failingPr(100), failingPr(1, { isDraft: true, ci: 'ERROR' })];
    expect(getBadgeState(prs)).toEqual({ count: 2, nextExpiry: null });
  });

  it('returns an empty badge and no alarm when all PRs age out', () => {
    expect(getBadgeState([failingPr(24), failingPr(48)], 24, NOW)).toEqual({
      count: 0,
      nextExpiry: null,
    });
    expect(getBadgeState([], 24, NOW)).toEqual({ count: 0, nextExpiry: null });
  });
});
