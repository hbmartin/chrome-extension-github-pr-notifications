import { bookmarkTitle } from './emoji.js';

/** Matches PR URLs on github.com and GitHub Enterprise hosts. */
const PR_URL_RE = /^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+/;

export function isPrBookmark(bookmark) {
  return typeof bookmark.url === 'string' && PR_URL_RE.test(bookmark.url);
}

/**
 * Replace the PR bookmarks in `folderId` with fresh ones for `prs`.
 * Only bookmarks that look like PR links are removed; anything else the
 * user keeps in the folder (including subfolders) is left alone.
 *
 * `bookmarksApi` is the WebExtension `browser.bookmarks` namespace (or a
 * test double with getChildren/remove/create).
 */
export async function syncPrBookmarks(bookmarksApi, folderId, prs) {
  const children = await bookmarksApi.getChildren(folderId);
  const stale = children.filter(isPrBookmark);
  const created = [];
  for (const pr of prs) {
    created.push(
      await bookmarksApi.create({
        parentId: folderId,
        title: bookmarkTitle(pr),
        url: pr.url,
      })
    );
  }
  for (const bookmark of stale) {
    await bookmarksApi.remove(bookmark.id);
  }
  return { removed: stale.length, added: created.length };
}
