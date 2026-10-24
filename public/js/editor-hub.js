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
  const reviewFeedback = document.getElementById('review-feedback');
  const reviewMessage = document.getElementById('review-message');
  const reviewRetry = document.getElementById('review-retry');
  const reviewLogin = document.getElementById('review-login');

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
  // Closed reviews and superseded table requests must ignore late responses.
  let modalVersion = 0;
  let tableVersion = 0;
  // Separate from fetch versions: at most one mutation is active for a review.
  // Invalidating a modal response does not cancel a server write already sent.
  let actionVersion = null;

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
    const version = ++tableVersion;
    const params = new URLSearchParams({ page: String(page) });
    if (statusFilter.value) params.set('status', statusFilter.value);
    try {
      const res = await fetch('/api/editor/articles?' + params.toString());
      if (version !== tableVersion) return;
      if (!res.ok) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-hint">Failed to load.</td></tr>';
        return;
      }
      const body = await res.json();
      if (version !== tableVersion) return;
      total = body.total;
      pageSize = body.pageSize;
      renderRows(body.articles || []);
      updatePager();
    } catch (err) {
      if (version !== tableVersion) return;
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
        ? ' <span class="revision-flag" title="Has a proposed revision">revision ' + article.pendingUpdate.status + '</span>'
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
    btnEdit.disabled = false;
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

  // Compare all editable fields, including category/image URL. A body-only diff
  // would hide changes that approval also promotes to the public article.
  function combined(fields) {
    return ['Title: ' + fields.title, 'Summary: ' + fields.summary,
      'Category: ' + fields.category, 'Image URL: ' + (fields.imageUrl || '(none)'),
      'Content:\n' + fields.content].join('\n\n');
  }

  // Approve, Return and Edit only work on submitted work, so when they are off
  // the status line says why.
  function describeState(body, submitted) {
    if (body.pending) {
      const label = 'Revision: ' + body.pending.status;
      if (submitted) return label;
      if (body.pending.status === 'rejected') {
        return label + '. Returned to the reporter. Approve, Return and Edit are off until they fix it and resubmit.';
      }
      return label + '. The reporter is still editing it. Approve, Return and Edit are off until they submit it.';
    }
    if (submitted) return body.status;
    if (body.status === 'published') return 'published. There is no proposed revision to review or edit.';
    return body.status + '. Waiting for the reporter. Approve, Return and Edit are off until they submit it.';
  }

  async function openModal(id) {
    const version = ++modalVersion;
    currentId = id;
    modal.hidden = true;
    modalStatus.textContent = '';
    rejectBox.hidden = true;
    rejectNotes.value = '';
    rejectNotes.disabled = false;
    setEditDisabled(true);
    reviewFeedback.hidden = false;
    reviewMessage.textContent = 'Loading review…';
    reviewRetry.hidden = true;
    reviewLogin.hidden = true;
    try {
      const res = await fetch('/api/editor/articles/' + id + '/diff');
      if (version !== modalVersion) return;
      if (!res.ok) {
        reviewLogin.hidden = res.status !== 401;
        reviewMessage.textContent = res.status === 401
          ? 'Your session has expired. Sign in to continue.'
          : 'Could not load the review. Please retry.';
        reviewRetry.hidden = false;
        return;
      }
      const body = await res.json();
      if (version !== modalVersion) return;
      fillEditForm(body.pending || body.live);
      const submitted = body.status === 'pending' || (body.status === 'published' && body.pending && body.pending.status === 'pending');
      document.getElementById('btn-approve').disabled = !submitted;
      document.getElementById('btn-reject').disabled = !submitted;
      // the reporter's copy is only locked once submitted; editing earlier would race their autosave
      btnEdit.disabled = !submitted;
      modalStatus.textContent = describeState(body, submitted);

      if (body.pending) {
        const diff = window.DiffViewer.render(combined(body.live), combined(body.pending));
        document.getElementById('diff-live').innerHTML = diff.leftHtml;
        document.getElementById('diff-pending').innerHTML = diff.rightHtml;
        diffSection.hidden = false;
      } else {
        diffSection.hidden = true;
      }
      reviewFeedback.hidden = true;
      modal.hidden = false;
    } catch (err) {
      if (version !== modalVersion) return;
      reviewMessage.textContent = 'Could not load the review. Check your connection and retry.';
      reviewRetry.hidden = false;
    }
  }

  function closeModal() {
    modalVersion++;
    modal.hidden = true;
    reviewFeedback.hidden = true;
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
    const version = modalVersion;
    if (actionVersion === version) return false;
    actionVersion = version;
    // Keep the submitted snapshot fixed while the request is in flight.
    const controls = Object.values(EDIT_FIELDS).map(id => document.getElementById(id)).concat(btnEdit, rejectNotes);
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    modalStatus.textContent = 'Working…';
    try {
      const res = await fetch(url, options);
      const body = await res.json().catch(function () { return {}; });
      if (version !== modalVersion) return false;
      if (!res.ok) {
        modalStatus.textContent = body.error || 'Action failed';
        return false;
      }
      modalStatus.textContent = successMsg;
      return true;
    } catch (err) {
      if (version !== modalVersion) return false;
      modalStatus.textContent = 'Network error';
      return false;
    } finally {
      // An old request must not restore controls belonging to a newer review.
      if (version === modalVersion) controls.forEach((control, i) => { control.disabled = disabled[i]; });
      if (actionVersion === version) actionVersion = null;
    }
  }

  // Persist an enabled edit form before publication; approval itself reads the
  // saved database candidate and does not receive these displayed form values.
  async function handleApprove() {
    if (actionVersion === modalVersion) return;
    if (!document.getElementById('edit-title').disabled) {
      const saved = await sendAction('/api/editor/articles/' + currentId,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectEdits()) }, 'Saved');
      if (!saved) return;
      setEditDisabled(true);
    }
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
    if (actionVersion === modalVersion) return;
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
    const version = modalVersion;
    const id = currentId;
    // Save and return are separate requests: if only the return fails, keep the
    // distinction visible rather than implying the editor changes were lost.
    const hasEdits = !document.getElementById('edit-title').disabled;
    if (hasEdits) {
      const saved = await sendAction('/api/editor/articles/' + id,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectEdits()) }, 'Saved');
      if (!saved) return;
      setEditDisabled(true);
    }
    const ok = await sendAction(
      '/api/editor/articles/' + id + '/reject',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: notes }) },
      'Returned to reporter'
    );
    if (ok) {
      closeModal();
      loadTable();
    } else if (hasEdits && version === modalVersion) {
      modalStatus.textContent = 'Changes saved. Return failed: ' + modalStatus.textContent;
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
    reviewRetry.addEventListener('click', function () { if (currentId) openModal(currentId); });
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
