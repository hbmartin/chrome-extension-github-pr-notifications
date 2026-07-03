import { describe, expect, it, vi } from 'vitest';
import {
  buildSearchQuery,
  graphqlEndpoint,
  normalizePullRequest,
  fetchPullRequests,
} from '../src/lib/github.js';
import { mergeSettings } from '../src/lib/settings.js';

describe('buildSearchQuery', () => {
  it('defaults to PRs authored by the user, open only', () => {
    expect(buildSearchQuery({ role: 'author', state: 'open' })).toBe(
      'is:pr author:@me sort:updated-desc is:open'
    );
  });

  it('supports other roles', () => {
    expect(buildSearchQuery({ role: 'assigned', state: 'open' })).toContain('assignee:@me');
    expect(buildSearchQuery({ role: 'mentioned', state: 'open' })).toContain('mentions:@me');
    expect(buildSearchQuery({ role: 'review-requested', state: 'open' })).toContain(
      'review-requested:@me'
    );
  });

  it('omits the state qualifier for "all" and falls back to author for unknown roles', () => {
    expect(buildSearchQuery({ role: 'wat', state: 'all' })).toBe(
      'is:pr author:@me sort:updated-desc'
    );
  });
});

describe('graphqlEndpoint', () => {
  it('uses api.github.com for github.com', () => {
    expect(graphqlEndpoint('github.com')).toBe('https://api.github.com/graphql');
    expect(graphqlEndpoint('')).toBe('https://api.github.com/graphql');
  });

  it('uses /api/graphql on enterprise hosts and strips scheme/paths', () => {
    expect(graphqlEndpoint('github.mycorp.com')).toBe('https://github.mycorp.com/api/graphql');
    expect(graphqlEndpoint('https://github.mycorp.com/foo')).toBe(
      'https://github.mycorp.com/api/graphql'
    );
  });
});

describe('normalizePullRequest', () => {
  it('flattens the GraphQL node', () => {
    const node = {
      number: 7,
      title: 'Add tests',
      url: 'https://github.com/acme/widgets/pull/7',
      state: 'OPEN',
      isDraft: false,
      repository: { nameWithOwner: 'acme/widgets' },
      commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] },
    };
    expect(normalizePullRequest(node)).toEqual({
      number: 7,
      title: 'Add tests',
      url: 'https://github.com/acme/widgets/pull/7',
      state: 'OPEN',
      isDraft: false,
      repo: 'acme/widgets',
      ci: 'PENDING',
    });
  });

  it('handles PRs with no checks', () => {
    const node = {
      number: 1,
      title: 'x',
      url: 'u',
      state: 'OPEN',
      repository: { nameWithOwner: 'a/b' },
      commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    };
    expect(normalizePullRequest(node).ci).toBeNull();
  });
});

describe('fetchPullRequests', () => {
  const settings = mergeSettings({ token: 'tok', sync: { limit: 5 } });

  it('requires a token', async () => {
    await expect(fetchPullRequests(mergeSettings({}), vi.fn())).rejects.toThrow(/token/i);
  });

  it('sends the query with auth and returns normalized PRs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          search: {
            nodes: [
              {},
              {
                number: 3,
                title: 'Hello',
                url: 'https://github.com/a/b/pull/3',
                state: 'MERGED',
                isDraft: false,
                repository: { nameWithOwner: 'a/b' },
                commits: { nodes: [] },
              },
            ],
          },
        },
      }),
    });
    const prs = await fetchPullRequests(settings, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.github.com/graphql');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(body.variables).toEqual({
      searchQuery: 'is:pr author:@me sort:updated-desc is:open',
      limit: 5,
    });

    // Empty (non-PR) nodes are dropped.
    expect(prs).toHaveLength(1);
    expect(prs[0].state).toBe('MERGED');
  });

  it('throws on HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(fetchPullRequests(settings, fetchImpl)).rejects.toThrow(/401/);
  });

  it('throws on GraphQL errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ errors: [{ message: 'Bad credentials' }] }),
    });
    await expect(fetchPullRequests(settings, fetchImpl)).rejects.toThrow(/Bad credentials/);
  });
});
