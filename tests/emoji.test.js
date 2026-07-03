import { describe, expect, it } from 'vitest';
import { statusEmoji, bookmarkTitle } from '../src/lib/emoji.js';

const openPr = (ci) => ({ state: 'OPEN', isDraft: false, ci });

describe('statusEmoji', () => {
  it('maps merged and closed regardless of CI', () => {
    expect(statusEmoji({ state: 'MERGED', ci: 'FAILURE' })).toBe('🟣');
    expect(statusEmoji({ state: 'CLOSED', ci: 'SUCCESS' })).toBe('⚫');
  });

  it('marks drafts', () => {
    expect(statusEmoji({ state: 'OPEN', isDraft: true, ci: 'SUCCESS' })).toBe('⚪');
  });

  it('maps CI states for open PRs', () => {
    expect(statusEmoji(openPr('SUCCESS'))).toBe('🟢');
    expect(statusEmoji(openPr('FAILURE'))).toBe('🔴');
    expect(statusEmoji(openPr('ERROR'))).toBe('🔴');
    expect(statusEmoji(openPr('PENDING'))).toBe('🟡');
    expect(statusEmoji(openPr('EXPECTED'))).toBe('🟡');
  });

  it('treats missing checks as green', () => {
    expect(statusEmoji(openPr(null))).toBe('🟢');
  });
});

describe('bookmarkTitle', () => {
  it('prefixes the emoji and appends repo#number', () => {
    const pr = {
      ...openPr('FAILURE'),
      title: 'Fix the flux capacitor',
      repo: 'acme/widgets',
      number: 42,
    };
    expect(bookmarkTitle(pr)).toBe('🔴 Fix the flux capacitor (acme/widgets#42)');
  });
});
