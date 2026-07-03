/**
 * GitHub GraphQL client for listing the user's pull requests.
 * A single search query returns PR metadata plus the CI status rollup,
 * so one request per sync regardless of the PR limit.
 */

const ROLE_QUALIFIERS = {
  author: 'author:@me',
  assigned: 'assignee:@me',
  mentioned: 'mentions:@me',
  'review-requested': 'review-requested:@me',
};

export const SYNC_ROLES = Object.keys(ROLE_QUALIFIERS);

export function buildSearchQuery({ role, state }) {
  const qualifier = ROLE_QUALIFIERS[role] ?? ROLE_QUALIFIERS.author;
  let query = `is:pr ${qualifier} sort:updated-desc`;
  if (state === 'open' || state === 'closed') {
    query += ` is:${state}`;
  }
  return query;
}

export function graphqlEndpoint(githubHost) {
  const host = (githubHost || 'github.com')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  return host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`;
}

const PR_SEARCH_QUERY = `
query PrSearch($searchQuery: String!, $limit: Int!) {
  search(query: $searchQuery, type: ISSUE, first: $limit) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        state
        isDraft
        repository { nameWithOwner }
        commits(last: 1) {
          nodes { commit { statusCheckRollup { state } } }
        }
      }
    }
  }
}`;

export function normalizePullRequest(node) {
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state,
    isDraft: Boolean(node.isDraft),
    repo: node.repository?.nameWithOwner ?? '',
    ci: node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
  };
}

/**
 * Fetch the user's pull requests. Returns normalized PR objects:
 * { number, title, url, state, isDraft, repo, ci }
 */
export async function fetchPullRequests(settings, fetchImpl = fetch) {
  if (!settings.token) {
    throw new Error('A GitHub personal access token is required (set one in Options).');
  }
  const response = await fetchImpl(graphqlEndpoint(settings.githubHost), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: PR_SEARCH_QUERY,
      variables: {
        searchQuery: buildSearchQuery(settings.sync),
        limit: settings.sync.limit,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`GitHub API error: ${payload.errors[0].message}`);
  }
  const nodes = payload.data?.search?.nodes ?? [];
  // Non-PR search results come back as empty objects; drop them.
  return nodes.filter((node) => node && node.url).map(normalizePullRequest);
}
