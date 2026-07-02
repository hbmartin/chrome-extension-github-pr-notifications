import { describe, expect, it } from 'vitest';
import { isPrBookmark, syncPrBookmarks } from '../src/lib/bookmarks.js';

function fakeBookmarksApi(initialChildren) {
  let nextId = 1000;
  const children = [...initialChildren];
  return {
    children,
    async getChildren() {
      return [...children];
    },
    async remove(id) {
      const index = children.findIndex((c) => c.id === id);
      if (index === -1) throw new Error(`no bookmark ${id}`);
      children.splice(index, 1);
    },
    async create(bookmark) {
      const created = { id: String(nextId++), ...bookmark };
      children.push(created);
      return created;
    },
  };
}

describe('isPrBookmark', () => {
  it('matches PR URLs on any host', () => {
    expect(isPrBookmark({ url: 'https://github.com/a/b/pull/1' })).toBe(true);
    expect(isPrBookmark({ url: 'https://github.corp.com/a/b/pull/12345' })).toBe(true);
  });

  it('does not match other bookmarks or folders', () => {
    expect(isPrBookmark({ url: 'https://github.com/a/b/issues/1' })).toBe(false);
    expect(isPrBookmark({ url: 'https://example.com/' })).toBe(false);
    expect(isPrBookmark({ title: 'a folder' })).toBe(false);
  });
});

describe('syncPrBookmarks', () => {
  const prs = [
    {
      number: 1,
      title: 'First',
      repo: 'a/b',
      url: 'https://github.com/a/b/pull/1',
      state: 'OPEN',
      isDraft: false,
      ci: 'SUCCESS',
    },
    {
      number: 2,
      title: 'Second',
      repo: 'a/b',
      url: 'https://github.com/a/b/pull/2',
      state: 'OPEN',
      isDraft: false,
      ci: 'FAILURE',
    },
  ];

  it('removes stale PR bookmarks and adds fresh ones with emoji prefixes', async () => {
    const api = fakeBookmarksApi([
      { id: '1', url: 'https://github.com/a/b/pull/99', title: '🟢 Old PR (a/b#99)' },
    ]);
    const result = await syncPrBookmarks(api, 'folder-1', prs);
    expect(result).toEqual({ removed: 1, added: 2 });
    expect(api.children.map((c) => c.title)).toEqual(['🟢 First (a/b#1)', '🔴 Second (a/b#2)']);
    expect(api.children.every((c) => c.parentId === 'folder-1')).toBe(true);
  });

  it('leaves non-PR bookmarks and subfolders alone', async () => {
    const api = fakeBookmarksApi([
      { id: '1', url: 'https://example.com/', title: 'my other bookmark' },
      { id: '2', title: 'a subfolder' },
      { id: '3', url: 'https://github.com/a/b/pull/5', title: 'stale' },
    ]);
    await syncPrBookmarks(api, 'folder-1', prs);
    const titles = api.children.map((c) => c.title);
    expect(titles).toContain('my other bookmark');
    expect(titles).toContain('a subfolder');
    expect(titles).not.toContain('stale');
    expect(api.children).toHaveLength(4);
  });

  it('handles an empty PR list by just clearing PR bookmarks', async () => {
    const api = fakeBookmarksApi([
      { id: '3', url: 'https://github.com/a/b/pull/5', title: 'stale' },
    ]);
    const result = await syncPrBookmarks(api, 'folder-1', []);
    expect(result).toEqual({ removed: 1, added: 0 });
    expect(api.children).toHaveLength(0);
  });
});
