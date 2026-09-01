/* Pure Vanilla JS side-by-side word diff.
   Exposes window.DiffViewer.render(oldText, newText) -> { leftHtml, rightHtml }.
   Left pane marks deletions (<del>), right pane marks additions (<ins>). */
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
        table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    return table;
  }

  /**
   * Produces side-by-side diff HTML for two texts.
   * @param {string} oldText - The published (live) content.
   * @param {string} newText - The proposed revision.
   * @returns {{ leftHtml: string, rightHtml: string }}
   */
  function render(oldText, newText) {
    const a = tokenize(oldText);
    const b = tokenize(newText);
    const table = lcsTable(a, b);

    let left = '';
    let right = '';
    let i = 0;
    let j = 0;

    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        left += escapeHtml(a[i]);
        right += escapeHtml(b[j]);
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        left += '<del class="diff-del">' + escapeHtml(a[i]) + '</del>';
        i++;
      } else {
        right += '<ins class="diff-add">' + escapeHtml(b[j]) + '</ins>';
        j++;
      }
    }
    while (i < a.length) {
      left += '<del class="diff-del">' + escapeHtml(a[i]) + '</del>';
      i++;
    }
    while (j < b.length) {
      right += '<ins class="diff-add">' + escapeHtml(b[j]) + '</ins>';
      j++;
    }

    return { leftHtml: left, rightHtml: right };
  }

  window.DiffViewer = { render: render, tokenize: tokenize };
})();
