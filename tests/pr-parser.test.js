// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  CiSummary,
  getCiSummary,
  getFailedCheckNames,
  collectComments,
  findMergeBox,
} from '../src/lib/pr-parser.js';

function dom(html) {
  document.body.innerHTML = html;
  return document;
}

const LEGACY_MERGE_BOX = (heading, items = '') => `
  <div class="discussion-timeline-actions">
    <div class="mergeability-details">
      <div class="branch-action-item">
        <h3 class="status-heading">${heading}</h3>
        <div class="merge-status-list js-updatable-content-preserve-scroll-position">
          ${items}
        </div>
      </div>
    </div>
  </div>`;

const legacyStatusItem = (name, failing) => `
  <div class="merge-status-item">
    <svg class="octicon ${failing ? 'octicon-x text-red' : 'octicon-check text-green'}"></svg>
    <strong class="text-emphasized">${name}</strong>
  </div>`;

describe('getCiSummary (legacy markup)', () => {
  it('detects success', () => {
    const root = dom(LEGACY_MERGE_BOX('All checks have passed'));
    expect(getCiSummary(root)).toBe(CiSummary.SUCCESS);
  });

  it('detects failure', () => {
    const root = dom(LEGACY_MERGE_BOX('Some checks were not successful'));
    expect(getCiSummary(root)).toBe(CiSummary.FAILURE);
  });

  it('detects pending', () => {
    const root = dom(LEGACY_MERGE_BOX("Some checks haven't completed yet"));
    expect(getCiSummary(root)).toBe(CiSummary.PENDING);
  });

  it('returns null when there is no checks section', () => {
    const root = dom('<div class="discussion-timeline-actions"><p>Nothing here</p></div>');
    expect(getCiSummary(root)).toBeNull();
  });

  it('does not match CI phrases outside a merge box', () => {
    const root = dom(`
      <div id="issuecomment-1">
        <div class="comment-body">All checks have passed on my machine.</div>
      </div>`);
    expect(getCiSummary(root)).toBeNull();
  });
});

describe('getCiSummary (react merge box)', () => {
  it('scopes phrase matching to the merge box so comment text cannot spoof it', () => {
    const root = dom(`
      <div id="issuecomment-1" class="timeline-comment">
        <div class="comment-body">Weird, it says "All checks have passed" for me</div>
      </div>
      <div data-testid="mergebox-partial">
        <h3>Some checks were not successful</h3>
      </div>`);
    expect(findMergeBox(root)).not.toBeNull();
    expect(getCiSummary(root)).toBe(CiSummary.FAILURE);
  });
});

describe('getFailedCheckNames', () => {
  it('extracts failing check names from legacy status items', () => {
    const root = dom(
      LEGACY_MERGE_BOX(
        'Some checks were not successful',
        legacyStatusItem('ci/lint', false) + legacyStatusItem('ci/build', true)
      )
    );
    expect(getFailedCheckNames(root)).toEqual(['ci/build']);
  });

  it('finds failing checks via aria-labels in newer markup', () => {
    const root = dom(`
      <div data-testid="mergebox-partial">
        <ul>
          <li><span aria-label="build: this check failed"></span>build — failed after 2m</li>
          <li><span aria-label="lint succeeded"></span>lint</li>
        </ul>
      </div>`);
    const names = getFailedCheckNames(root);
    expect(names).toHaveLength(1);
    expect(names[0]).toContain('build');
  });

  it('returns [] when nothing is failing', () => {
    const root = dom(
      LEGACY_MERGE_BOX('All checks have passed', legacyStatusItem('ci/build', false))
    );
    expect(getFailedCheckNames(root)).toEqual([]);
  });

  it('does not scan the full document when there is no merge box', () => {
    const root = dom('<span aria-label="build failed"></span>');
    expect(getFailedCheckNames(root)).toEqual([]);
  });
});

describe('collectComments', () => {
  it('collects timeline comments, review comments, and reviews by anchor id', () => {
    const root = dom(`
      <div id="issuecomment-111"><div class="comment-body">First comment</div></div>
      <div id="discussion_r222"><div class="comment-body">Inline nit</div></div>
      <div id="pullrequestreview-333">alice approved these changes
        <div class="comment-body">LGTM!</div>
      </div>`);
    const comments = collectComments(root);
    expect([...comments.keys()]).toEqual([
      'issuecomment-111',
      'discussion_r222',
      'pullrequestreview-333',
    ]);
    expect(comments.get('issuecomment-111')).toMatchObject({
      kind: 'comment',
      text: 'First comment',
    });
    expect(comments.get('discussion_r222').kind).toBe('review-comment');
    expect(comments.get('pullrequestreview-333')).toMatchObject({
      kind: 'review',
      verdict: 'approved',
    });
  });

  it('detects changes-requested reviews', () => {
    const root = dom(
      '<div id="pullrequestreview-9">bob requested changes<div class="comment-body">fix this</div></div>'
    );
    expect(collectComments(root).get('pullrequestreview-9').verdict).toBe('changes-requested');
  });

  it('ignores derived anchors like -permalink and deduplicates', () => {
    const root = dom(`
      <div id="issuecomment-5"><div class="comment-body">hello</div></div>
      <a id="issuecomment-5-permalink"></a>`);
    expect([...collectComments(root).keys()]).toEqual(['issuecomment-5']);
  });

  it('normalizes whitespace and truncates long bodies', () => {
    const long = 'word '.repeat(200);
    const root = dom(`<div id="issuecomment-6"><div class="comment-body">${long}</div></div>`);
    const text = collectComments(root).get('issuecomment-6').text;
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).not.toMatch(/\s{2,}/);
  });
});
