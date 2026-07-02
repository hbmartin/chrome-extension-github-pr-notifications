import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, clampLimit } from '../src/lib/settings.js';

describe('mergeSettings', () => {
  it('returns defaults for empty storage', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('deep-merges partial stored settings over defaults', () => {
    const merged = mergeSettings({ token: 'abc', sync: { limit: 25 } });
    expect(merged.token).toBe('abc');
    expect(merged.sync.limit).toBe(25);
    expect(merged.sync.role).toBe('author');
    expect(merged.notifications.ciFailure).toBe(true);
  });

  it('drops unknown keys from storage', () => {
    const merged = mergeSettings({ bogus: true, sync: { alsoBogus: 1 } });
    expect(merged).not.toHaveProperty('bogus');
    expect(merged.sync).not.toHaveProperty('alsoBogus');
  });

  it('sanitizes limit and interval', () => {
    const merged = mergeSettings({ sync: { limit: -5, intervalMinutes: 0 } });
    expect(merged.sync.limit).toBe(10);
    expect(merged.sync.intervalMinutes).toBe(1);
  });
});

describe('clampLimit', () => {
  it('defaults to 10 for garbage input', () => {
    expect(clampLimit('nope')).toBe(10);
    expect(clampLimit(0)).toBe(10);
    expect(clampLimit(NaN)).toBe(10);
  });

  it('caps at the GraphQL maximum of 100', () => {
    expect(clampLimit(250)).toBe(100);
  });

  it('passes through valid values, flooring floats', () => {
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(15.7)).toBe(15);
    expect(clampLimit(1)).toBe(1);
  });
});
