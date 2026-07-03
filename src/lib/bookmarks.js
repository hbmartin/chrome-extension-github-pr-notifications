import { bookmarkTitle } from './emoji.js';

/** Matches PR URLs on github.com and GitHub Enterprise hosts. */
const PR_URL_RE = /^https:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+/;

export function isPrBookmark(bookmark) {
  return typeof bookmark.url === 'string' && PR_URL_RE.test(bookmark.url);
}

function errorMessage(error) {
  return error?.message ?? String(error);
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
  try {
    for (const pr of prs) {
      created.push(
        await bookmarksApi.create({
          parentId: folderId,
          title: bookmarkTitle(pr),
          url: pr.url,
        })
      );
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const bookmark of created) {
      try {
        await bookmarksApi.remove(bookmark.id);
      } catch (rollbackError) {
        rollbackFailures.push({ bookmarkId: bookmark.id, error: rollbackError });
      }
    }
    if (rollbackFailures.length > 0) {
      const bookmarkIds = rollbackFailures.map((failure) => failure.bookmarkId).join(', ');
      const wrappedError = new Error(
        `Failed to create PR bookmark: ${errorMessage(error)}. Rollback failed for bookmark ID(s): ${bookmarkIds}.`
      );
      wrappedError.cause = error;
      wrappedError.rollbackFailures = rollbackFailures;
      throw wrappedError;
    }
    throw error;
  }
  for (const bookmark of stale) {
    await bookmarksApi.remove(bookmark.id);
  }
  return { removed: stale.length, added: created.length };
}
