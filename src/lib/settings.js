/**
 * Settings shape and (de)serialization. Pure module: storage access is done
 * by callers so this stays unit-testable.
 */

export const SYNC_ALARM_NAME = 'pr-bookmark-sync';
export const BADGE_EXPIRY_ALARM_NAME = 'pr-badge-expiry';

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
  // Count failing PRs updated within this many hours; 0 means all time.
  badgeMaxAgeHours: 0,
  // What the toolbar icon opens: 'popup' | 'sidebar'.
  displayMode: 'popup',
  // Hide PRs in the popup/sidebar after this many days without updates; 0 shows all.
  prListMaxAgeDays: 0,
  sync: {
    enabled: false,
    // Bookmark folder that PR bookmarks are synced into.
    folderId: '',
    // Relationship between the user and the PRs to list:
    // 'author' | 'assigned' | 'mentioned' | 'review-requested'.
    role: 'author',
    // 'open' | 'closed' | 'all'
    state: 'open',
    // Repositories to omit from PR search, in owner/repo format.
    excludedRepos: [],
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
  const hours =
    typeof merged.badgeMaxAgeHours === 'number' || typeof merged.badgeMaxAgeHours === 'string'
      ? Number(merged.badgeMaxAgeHours)
      : 0;
  merged.badgeMaxAgeHours =
    Number.isSafeInteger(hours * 3_600_000) && Number.isInteger(hours) && hours >= 0 ? hours : 0;
  const days =
    typeof merged.prListMaxAgeDays === 'number' || typeof merged.prListMaxAgeDays === 'string'
      ? Number(merged.prListMaxAgeDays)
      : 0;
  merged.prListMaxAgeDays =
    Number.isSafeInteger(days * 86_400_000) && Number.isInteger(days) && days >= 0 ? days : 0;
  merged.displayMode = merged.displayMode === 'sidebar' ? 'sidebar' : 'popup';
  merged.sync.excludedRepos = normalizeExcludedRepos(merged.sync.excludedRepos);
  merged.sync.limit = clampLimit(merged.sync.limit);
  const interval = Math.floor(Number(merged.sync.intervalMinutes));
  merged.sync.intervalMinutes = Number.isFinite(interval) ? Math.max(1, interval) : 10;
  return merged;
}

/** Only accept owner/repo names, never additional search qualifiers or URLs. */
export function isRepoName(value) {
  return typeof value === 'string' && /^[a-z\d-]+\/[a-z\d_.-]+$/i.test(value);
}

/** Accept textarea input or a stored array; normalize and deduplicate names. */
export function normalizeExcludedRepos(value) {
  const entries = typeof value === 'string' ? value.split(/[\s,]+/) : value;
  if (!Array.isArray(entries)) return [];
  return [
    ...new Set(
      entries
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim().toLowerCase())
        .filter(isRepoName)
    ),
  ];
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
