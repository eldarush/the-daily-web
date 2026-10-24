/* Pure Vanilla JS side-by-side word diff.
   Exposes window.DiffViewer.render(oldText, newText) -> { leftHtml, rightHtml, inlineHtml }.
   Left pane marks deletions (<del>), right pane marks additions (<ins>);
   inlineHtml shows both in one text, as the reporter workspace does. */
(function () {
  'use strict';

  /** Splits text into word/whitespace tokens so spacing is preserved. */
  function tokenize(text) {
    if (!text) return [];
    return String(text).match(/\s+|\S+/g) || [];
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Longest Common Subsequence length table for two token arrays.
   * @returns {number[][]} DP table of size (a.length+1) x (b.length+1).
   */
  function lcsTable(a, b) {
    const table = Array.from({ length: a.length + 1 }, function () {
      return new Array(b.length + 1).fill(0);
    });
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        // Equal tokens extend the diagonal subsequence; otherwise keep the
        // longer result after skipping either token. Time/space are O(m*n).
        table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    return table;
  }

  /**
   * Produces side-by-side diff HTML for two texts.
   * @param {string} oldText - The published (live) content.
   * @param {string} newText - The proposed revision.
   * @returns {{ leftHtml: string, rightHtml: string, inlineHtml: string }}
   */
  function render(oldText, newText) {
    const a = tokenize(oldText);
    const b = tokenize(newText);
    // Budget uses token-pairs, not character count. The fallback keeps ALL text
    // but gives up fine word matching; escaping still precedes our ins/del tags.
    if (a.length * b.length > 250000) {
      const removed = '<del class="diff-del">' + escapeHtml(oldText) + '</del>';
      const added = '<ins class="diff-add">' + escapeHtml(newText) + '</ins>';
      return { leftHtml: removed, rightHtml: added, inlineHtml: removed + added };
    }
    const table = lcsTable(a, b);

    let left = '';
    let right = '';
    let inline = '';
    let i = 0;
    let j = 0;

    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        left += escapeHtml(a[i]);
        right += escapeHtml(b[j]);
        inline += escapeHtml(a[i]);
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        const removed = '<del class="diff-del">' + escapeHtml(a[i]) + '</del>';
        left += removed;
        inline += removed;
        i++;
      } else {
        const added = '<ins class="diff-add">' + escapeHtml(b[j]) + '</ins>';
        right += added;
        inline += added;
        j++;
      }
    }
    while (i < a.length) {
      const removed = '<del class="diff-del">' + escapeHtml(a[i]) + '</del>';
      left += removed;
      inline += removed;
      i++;
    }
    while (j < b.length) {
      const added = '<ins class="diff-add">' + escapeHtml(b[j]) + '</ins>';
      right += added;
      inline += added;
      j++;
    }

    return { leftHtml: left, rightHtml: right, inlineHtml: inline };
  }

  window.DiffViewer = { render: render, tokenize: tokenize };
})();
