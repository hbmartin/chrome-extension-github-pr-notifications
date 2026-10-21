import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  clampLimit,
  loadSettings,
  saveSettings,
} from '../src/lib/settings.js';

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
    expect(merged.sync.excludedRepos).toEqual([]);
  });

  it('keeps nested defaults, stored input, and separately loaded settings independent', async () => {
    const defaults = structuredClone(DEFAULT_SETTINGS);
    const input = { sync: { excludedRepos: ['acme/widgets'] }, notifications: { comments: false } };
    const originalInput = structuredClone(input);
    const first = mergeSettings();
    const second = mergeSettings(input);
    first.sync.enabled = true;
    first.sync.excludedRepos.push('other/tools');
    first.notifications.comments = false;
    second.sync.excludedRepos.push('another/repo');
    second.notifications.comments = true;

    expect(DEFAULT_SETTINGS).toEqual(defaults);
    expect(input).toEqual(originalInput);
    expect(mergeSettings()).toEqual(defaults);
    expect(await loadSettings({ get: async () => ({ settings: input }) })).toEqual(
      mergeSettings(originalInput)
    );
  });

  it('retains repository owners with enterprise-managed account underscores', async () => {
    const storage = { set: vi.fn(), get: vi.fn() };
    await saveSettings(storage, { sync: { excludedRepos: 'Mona_Acme/tools, mona_acme/tools' } });
    expect(storage.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({
        sync: expect.objectContaining({ excludedRepos: ['mona_acme/tools'] }),
      }),
    });
    storage.get.mockResolvedValue(storage.set.mock.calls[0][0]);
    expect((await loadSettings(storage)).sync.excludedRepos).toEqual(['mona_acme/tools']);
  });

  it('preserves the sidebar preference alongside existing settings', () => {
    const settings = mergeSettings({
      displayMode: 'sidebar',
      token: 'secret',
      sync: { excludedRepos: ['acme/widgets'] },
      notifications: { comments: false },
    });
    expect(settings.displayMode).toBe('sidebar');
    expect(settings.token).toBe('secret');
    expect(settings.sync.excludedRepos).toEqual(['acme/widgets']);
    expect(settings.notifications.comments).toBe(false);
  });

  it.each([undefined, null, '', 'invalid', 'SIDEBAR', 1, {}, []])(
    'defaults malformed display modes to popup: %j',
    (displayMode) => {
      expect(mergeSettings({ displayMode }).displayMode).toBe('popup');
    }
  );

  it('normalizes saved repository exclusions and removes duplicates', () => {
    const merged = mergeSettings({
      sync: { excludedRepos: [' Acme/Widgets ', 'acme/widgets', 'octo-org/.github'] },
    });
    expect(merged.sync.excludedRepos).toEqual(['acme/widgets', 'octo-org/.github']);
  });

  it('parses repository exclusions separated by commas or whitespace', () => {
    const merged = mergeSettings({
      sync: { excludedRepos: ' Acme/Widgets,\r\nocto-org/repo_name.js\n\nacme/widgets ' },
    });
    expect(merged.sync.excludedRepos).toEqual(['acme/widgets', 'octo-org/repo_name.js']);
  });

  it.each([null, 123, {}, ''])('handles malformed or empty exclusions: %j', (excludedRepos) => {
    expect(mergeSettings({ sync: { excludedRepos } }).sync.excludedRepos).toEqual([]);
  });

  it('drops invalid stored entries instead of inserting search syntax', () => {
    const merged = mergeSettings({
      sync: {
        excludedRepos: [
          'acme/widgets',
          null,
          123,
          'widgets',
          'https://github.com/acme/widgets',
          'acme/widgets is:closed',
          'acme/*',
        ],
      },
    });
    expect(merged.sync.excludedRepos).toEqual(['acme/widgets']);
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

describe('badge age setting', () => {
  it('defaults existing settings to all time', () => {
    expect(mergeSettings({ token: 'existing-token' }).badgeMaxAgeHours).toBe(0);
  });

  it.each([1, 24, '48'])('accepts whole hours: %s', (value) => {
    expect(mergeSettings({ badgeMaxAgeHours: value }).badgeMaxAgeHours).toBe(Number(value));
  });

  it.each([
    undefined,
    null,
    '',
    'nope',
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER,
    true,
    {},
    [24],
  ])('normalizes blank or invalid stored hours to all time: %j', (value) => {
    expect(mergeSettings({ badgeMaxAgeHours: value }).badgeMaxAgeHours).toBe(0);
  });

  it('persists and loads the badge limit alongside other settings', async () => {
    let stored;
    const storage = {
      set: vi.fn(async (value) => {
        stored = value;
      }),
      get: vi.fn(async () => stored),
    };
    await saveSettings(storage, {
      badgeMaxAgeHours: 24,
      sync: { excludedRepos: ['acme/widgets'] },
    });
    const settings = await loadSettings(storage);
    expect(settings.badgeMaxAgeHours).toBe(24);
    expect(settings.sync.excludedRepos).toEqual(['acme/widgets']);
  });
});

describe('PR list age setting', () => {
  it('defaults existing settings to showing every PR', () => {
    expect(mergeSettings({ badgeMaxAgeHours: 24 }).prListMaxAgeDays).toBe(0);
  });

  it.each([1, 7, '30'])('accepts whole days: %s', (value) => {
    expect(mergeSettings({ prListMaxAgeDays: value }).prListMaxAgeDays).toBe(Number(value));
  });

  it.each([
    undefined,
    null,
    '',
    'invalid',
    -1,
    1.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER,
    true,
    {},
    [7],
  ])('disables list filtering for blank or invalid stored days: %j', (value) => {
    expect(mergeSettings({ prListMaxAgeDays: value }).prListMaxAgeDays).toBe(0);
  });

  it('persists the list limit independently of badge and sync settings', async () => {
    let stored;
    const storage = {
      set: vi.fn(async (value) => {
        stored = value;
      }),
      get: vi.fn(async () => stored),
    };
    await saveSettings(storage, {
      prListMaxAgeDays: 7,
      badgeMaxAgeHours: 24,
      sync: { limit: 25, excludedRepos: ['acme/widgets'] },
    });
    const settings = await loadSettings(storage);
    expect(settings.prListMaxAgeDays).toBe(7);
    expect(settings.badgeMaxAgeHours).toBe(24);
    expect(settings.sync.limit).toBe(25);
    expect(settings.sync.excludedRepos).toEqual(['acme/widgets']);
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
