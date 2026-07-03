/**
 * Settings shape and (de)serialization. Pure module: storage access is done
 * by callers so this stays unit-testable.
 */

export const SYNC_ALARM_NAME = 'pr-bookmark-sync';

export const DEFAULT_SETTINGS = {
  // GitHub personal access token. Required for bookmark sync; never sent
  // anywhere except the configured GitHub host.
  token: '',
  // Hostname of the GitHub instance ("github.com" or a GitHub Enterprise host).
  githubHost: 'github.com',
  notifications: {
    ciSuccess: true,
    ciFailure: true,
    comments: true,
    reviews: true,
  },
  // 'octocat' → random themed Octodex icons; 'plain' → the extension icon.
  iconTheme: 'octocat',
  sync: {
    enabled: false,
    // Bookmark folder that PR bookmarks are synced into.
    folderId: '',
    // Relationship between the user and the PRs to list:
    // 'author' | 'assigned' | 'mentioned' | 'review-requested'.
    role: 'author',
    // 'open' | 'closed' | 'all'
    state: 'open',
    // Max number of PRs fetched (single request, no pagination).
    limit: 10,
    intervalMinutes: 10,
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  if (!isPlainObject(overrides)) return result;
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in defaults)) continue;
    if (isPlainObject(defaults[key])) {
      result[key] = deepMerge(defaults[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** Merge stored (possibly partial/outdated) settings over the defaults. */
export function mergeSettings(stored) {
  const merged = deepMerge(DEFAULT_SETTINGS, stored);
  merged.sync.limit = clampLimit(merged.sync.limit);
  const interval = Math.floor(Number(merged.sync.intervalMinutes));
  merged.sync.intervalMinutes = Number.isFinite(interval) ? Math.max(1, interval) : 10;
  return merged;
}

/** GitHub's GraphQL API caps `first` at 100; keep the value sane. */
export function clampLimit(limit) {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(n, 100);
}

export async function loadSettings(storageArea) {
  const { settings } = await storageArea.get('settings');
  return mergeSettings(settings);
}

export async function saveSettings(storageArea, settings) {
  await storageArea.set({ settings: mergeSettings(settings) });
}
