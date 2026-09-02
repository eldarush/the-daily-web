/* Editor hub: article table, review/diff modal, approve / reject / edit / delete. */
(function () {
  'use strict';

  const tbody = document.getElementById('article-tbody');
  const statusFilter = document.getElementById('status-filter');
  const resultCount = document.getElementById('result-count');
  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');
  const pageLabel = document.getElementById('page-label');

  const modal = document.getElementById('review-modal');
  const modalStatus = document.getElementById('modal-status');
  const diffSection = document.getElementById('diff-section');
  const rejectBox = document.getElementById('reject-box');
  const rejectNotes = document.getElementById('reject-notes');
  const btnEdit = document.getElementById('btn-edit');
  const btnSaveEdit = document.getElementById('btn-save-edit');

  const EDIT_FIELDS = {
    title: 'edit-title',
    summary: 'edit-summary',
    category: 'edit-category',
    imageUrl: 'edit-image',
    content: 'edit-content'
  };

  let page = 1;
  let total = 0;
  let pageSize = 20;
  let currentId = null;

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  }

  async function loadTable() {
    const params = new URLSearchParams({ page: String(page) });
    if (statusFilter.value) params.set('status', statusFilter.value);
    try {
      const res = await fetch('/api/editor/articles?' + params.toString());
      if (!res.ok) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-hint">Failed to load.</td></tr>';
        return;
      }
      const body = await res.json();
      total = body.total;
      pageSize = body.pageSize;
      renderRows(body.articles || []);
      updatePager();
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-hint">Failed to load.</td></tr>';
    }
  }

  function renderRows(articles) {
    if (articles.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-hint">No articles match this filter.</td></tr>';
      resultCount.textContent = '0 articles';
      return;
    }
    resultCount.textContent = total + ' article' + (total === 1 ? '' : 's');
    tbody.innerHTML = '';
    articles.forEach(function (article) {
      const tr = document.createElement('tr');
      const author = article.author && article.author.fullName ? article.author.fullName : 'Unknown';
      const staged = article.pendingUpdate && article.pendingUpdate.hasUpdate
        ? ' <span class="revision-flag" title="Has a proposed revision">✎ revision</span>'
        : '';
      tr.innerHTML =
        '<td>' + escapeHtml(article.title) + staged + '</td>' +
        '<td>' + escapeHtml(author) + '</td>' +
        '<td>' + escapeHtml(article.category) + '</td>' +
        '<td><span class="status-pill status-' + article.status + '">' + article.status + '</span></td>' +
        '<td>' + formatDate(article.updatedAt) + '</td>' +
        '<td class="actions-col"></td>';
      const reviewBtn = document.createElement('button');
      reviewBtn.className = 'btn btn-small btn-primary';
      reviewBtn.textContent = 'Review';
      reviewBtn.addEventListener('click', function () {
        openModal(article._id);
      });
      tr.querySelector('.actions-col').appendChild(reviewBtn);
      tbody.appendChild(tr);
    });
  }

  function updatePager() {
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    pageLabel.textContent = 'Page ' + page + ' of ' + maxPage;
    prevBtn.disabled = page <= 1;
    nextBtn.disabled = page >= maxPage;
  }

  function setEditDisabled(disabled) {
    Object.values(EDIT_FIELDS).forEach(function (elId) {
      document.getElementById(elId).disabled = disabled;
    });
    btnSaveEdit.hidden = disabled;
    btnEdit.hidden = !disabled;
  }

  function fillEditForm(live) {
    document.getElementById('edit-title').value = live.title || '';
    document.getElementById('edit-summary').value = live.summary || '';
    document.getElementById('edit-category').value = live.category || '';
    document.getElementById('edit-image').value = live.imageUrl || '';
    document.getElementById('edit-content').value = live.content || '';
  }

  function combined(fields) {
    return [fields.title, fields.summary, fields.content].filter(Boolean).join('\n\n');
  }

  async function openModal(id) {
    currentId = id;
    modalStatus.textContent = '';
    rejectBox.hidden = true;
    setEditDisabled(true);
    try {
      const res = await fetch('/api/editor/articles/' + id + '/diff');
      if (!res.ok) return;
      const body = await res.json();
      fillEditForm(body.live);

      if (body.pending) {
        const diff = window.DiffViewer.render(combined(body.live), combined(body.pending));
        document.getElementById('diff-live').innerHTML = diff.leftHtml;
        document.getElementById('diff-pending').innerHTML = diff.rightHtml;
        diffSection.hidden = false;
      } else {
        diffSection.hidden = true;
      }
      modal.hidden = false;
    } catch (err) {
      /* leave modal closed on failure */
    }
  }

  function closeModal() {
    modal.hidden = true;
    currentId = null;
  }

  function collectEdits() {
    const out = {};
    Object.keys(EDIT_FIELDS).forEach(function (key) {
      out[key] = document.getElementById(EDIT_FIELDS[key]).value;
    });
    return out;
  }

  async function sendAction(url, options, successMsg) {
    modalStatus.textContent = 'Working…';
    try {
      const res = await fetch(url, options);
      const body = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        modalStatus.textContent = body.error || 'Action failed';
        return false;
      }
      modalStatus.textContent = successMsg;
      return true;
    } catch (err) {
      modalStatus.textContent = 'Network error';
      return false;
    }
  }

  async function handleApprove() {
    const ok = await sendAction(
      '/api/editor/articles/' + currentId + '/approve',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      'Approved'
    );
    if (ok) {
      closeModal();
      loadTable();
    }
  }

  async function handleReject() {
    if (rejectBox.hidden) {
      rejectBox.hidden = false;
      rejectNotes.focus();
      modalStatus.textContent = 'Add notes, then click again to confirm.';
      return;
    }
    const notes = rejectNotes.value.trim();
    if (!notes) {
      modalStatus.textContent = 'Notes are required to return an article.';
      return;
    }
    const ok = await sendAction(
      '/api/editor/articles/' + currentId + '/reject',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: notes }) },
      'Returned to reporter'
    );
    if (ok) {
      closeModal();
      loadTable();
    }
  }

  function handleEdit() {
    setEditDisabled(false);
    modalStatus.textContent = 'Editing — save your changes when done.';
  }

  async function handleSaveEdit() {
    const ok = await sendAction(
      '/api/editor/articles/' + currentId,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectEdits()) },
      'Saved'
    );
    if (ok) {
      closeModal();
      loadTable();
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this article permanently?')) return;
    const ok = await sendAction(
      '/api/editor/articles/' + currentId,
      { method: 'DELETE' },
      'Deleted'
    );
    if (ok) {
      closeModal();
      loadTable();
    }
  }

  function handlePrev() {
    if (page > 1) {
      page--;
      loadTable();
    }
  }

  function handleNext() {
    page++;
    loadTable();
  }

  function handleFilterChange() {
    page = 1;
    loadTable();
  }

  function init() {
    statusFilter.addEventListener('change', handleFilterChange);
    prevBtn.addEventListener('click', handlePrev);
    nextBtn.addEventListener('click', handleNext);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('btn-approve').addEventListener('click', handleApprove);
    document.getElementById('btn-reject').addEventListener('click', handleReject);
    btnEdit.addEventListener('click', handleEdit);
    btnSaveEdit.addEventListener('click', handleSaveEdit);
    document.getElementById('btn-delete').addEventListener('click', handleDelete);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
    loadTable();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
