/* Reporter workspace: continuous autosave engine (no manual save button).
   Work persists to the server and to localStorage on every edit, and the last
   version is restored on reload or when switching machines. */
(function () {
  'use strict';

  const DEBOUNCE_MS = 800;
  const LOCAL_PREFIX = 'autosave_';

  const listEl = document.getElementById('article-list');
  const panelEl = document.getElementById('editor-panel');
  const formEl = document.getElementById('article-form');
  const idEl = document.getElementById('article-id');
  const badgeEl = document.getElementById('autosave-badge');
  const rejectionBanner = document.getElementById('rejection-banner');
  const rejectionNotes = document.getElementById('rejection-notes');
  const publishedBanner = document.getElementById('published-banner');
  const categorySelect = document.getElementById('article-category');

  let articles = [];
  let currentId = null;
  let currentArticle = null;
  let debounceTimer = null;
  let page = 1;
  let total = 0;
  let pageSize = 20;
  const pending = new Map();
  const versions = new Map();
  let saving = Promise.resolve(true);
  let switching = false;

  function editable(article) {
    return article.status !== 'pending' && !(article.status === 'published' && article.pendingUpdate && article.pendingUpdate.status === 'pending');
  }

  function updateControls(article) {
    const state = article.status === 'published' && article.pendingUpdate.hasUpdate ? article.pendingUpdate.status : article.status;
    formEl.querySelectorAll('input, textarea, select').forEach(function (control) { control.disabled = !editable(article); });
    const submit = document.getElementById('submit-article-btn');
    submit.disabled = !editable(article);
    submit.textContent = state === 'pending' ? 'Awaiting review' : 'Submit for review';
    rejectionBanner.hidden = state !== 'rejected';
    rejectionNotes.textContent = article.status === 'published' ? article.pendingUpdate.editorNotes || '' : article.editorNotes || '';
  }

  /** Reads the editable fields out of the form into a plain object. */
  function readForm() {
    return {
      title: document.getElementById('article-title-input').value,
      summary: document.getElementById('article-summary-input').value,
      content: document.getElementById('article-content').value,
      category: categorySelect.value,
      imageUrl: document.getElementById('article-image').value
    };
  }

  /** Writes a field object into the form controls. */
  function writeForm(data) {
    document.getElementById('article-title-input').value = data.title || '';
    document.getElementById('article-summary-input').value = data.summary || '';
    document.getElementById('article-content').value = data.content || '';
    categorySelect.value = data.category || (window.__ARTICLE_CATEGORIES__[0] || '');
    document.getElementById('article-image').value = data.imageUrl || '';
  }

  /** Sets the autosave status pill. */
  function setBadge(state, text) {
    badgeEl.className = 'autosave-badge ' + state;
    badgeEl.textContent = text;
  }

  /** Human-readable HH:MM:SS for the "saved" badge. */
  function nowTime() {
    return new Date().toLocaleTimeString();
  }

  function populateCategories() {
    categorySelect.innerHTML = '';
    (window.__ARTICLE_CATEGORIES__ || []).forEach(function (cat) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      categorySelect.appendChild(opt);
    });
  }

  function renderList() {
    listEl.innerHTML = '';
    if (articles.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty-hint';
      li.textContent = 'No articles yet. Create your first one.';
      listEl.appendChild(li);
      return;
    }
    articles.forEach(function (article) {
      const li = document.createElement('li');
      li.className = 'article-list-item' + (article._id === currentId ? ' selected' : '');
      li.dataset.id = article._id;
      li.innerHTML =
        '<span class="item-title">' + escapeHtml(article.title) + '</span>' +
        '<span class="status-pill status-' + article.status + '">' + article.status + (article.status === 'published' && article.pendingUpdate.hasUpdate ? ' · revision ' + article.pendingUpdate.status : '') + '</span>';
      li.addEventListener('click', function () {
        selectArticle(article._id);
      });
      listEl.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function findArticle(id) {
    return articles.find(function (a) {
      return a._id === id;
    }) || (currentArticle && currentArticle._id === id ? currentArticle : null);
  }

  /** Loads an article into the editor, preferring a newer unsaved local backup. */
  async function selectArticle(id) {
    if (switching) return;
    switching = true;
    const ok = await flush();
    switching = false;
    if (!ok) return;
    const article = findArticle(id);
    if (!article) return;
    currentId = id;
    currentArticle = article;
    idEl.value = id;
    panelEl.hidden = false;

    const serverData = article.status === 'published' && article.pendingUpdate && article.pendingUpdate.hasUpdate
      ? article.pendingUpdate
      : article;

    const local = readLocalBackup(id);
    const serverStamp = new Date(serverData.updatedAt || article.updatedAt || 0).getTime();
    if (editable(article) && local && (local.data.saveVersion > article.saveVersion || (local.data.saveVersion === undefined && local.stamp > serverStamp))) {
      writeForm(local.data);
      setBadge('idle', 'Restored unsaved changes');
      pending.set(id, local.data);
      debounceTimer = setTimeout(flush, DEBOUNCE_MS);
    } else {
      writeForm(serverData);
      setBadge('idle', 'Ready');
    }

    updateControls(article);
    publishedBanner.hidden = article.status !== 'published';
    renderList();
  }

  function readLocalBackup(id) {
    try {
      const raw = localStorage.getItem(LOCAL_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function writeLocalBackup(id, data) {
    try {
      localStorage.setItem(LOCAL_PREFIX + id, JSON.stringify({ stamp: Date.now(), data: data }));
    } catch (err) {
      /* storage may be unavailable (private mode / quota) — server save still runs */
    }
  }

  function capture() {
    if (!currentId) return;
    const data = readForm();
    const local = readLocalBackup(currentId);
    data.saveVersion = Math.max(versions.get(currentId) || 0, currentArticle.saveVersion || 0, local && local.data.saveVersion || 0) + 1;
    versions.set(currentId, data.saveVersion);
    writeLocalBackup(currentId, data);
    pending.set(currentId, data);
  }

  function flush() {
    clearTimeout(debounceTimer);
    saving = saving.then(async function () {
      while (pending.size) {
        const [id, data] = pending.entries().next().value;
        if (currentId === id) setBadge('saving', 'Saving…');
        try {
          const res = await fetch('/api/reporter/articles/' + id + '/autosave', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
          });
          const body = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(body.error || 'Save failed');
          const article = findArticle(id);
          if (article) {
            article.saveVersion = body.saveVersion;
            if (article.status === 'published') article.pendingUpdate = Object.assign({}, article.pendingUpdate, data, { hasUpdate: true, updatedAt: body.updatedAt });
            else Object.assign(article, data, { updatedAt: body.updatedAt });
          }
          if (pending.get(id) === data) {
            pending.delete(id);
            try { localStorage.removeItem(LOCAL_PREFIX + id); } catch (err) { /* ignore */ }
            if (currentId === id) setBadge('saved', 'All changes saved · ' + nowTime());
          }
          renderList();
        } catch (err) {
          if (currentId === id) setBadge('error', err.message + ' — kept locally');
          return false;
        }
      }
      return true;
    });
    return saving;
  }

  function handleInput() {
    capture();
    setBadge('saving', 'Changes waiting to save');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, DEBOUNCE_MS);
  }

  function saveOnExit() {
    clearTimeout(debounceTimer);
    pending.forEach(function (data, id) {
      fetch('/api/reporter/articles/' + id + '/autosave', {
        method: 'PUT', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      }).catch(function () { /* recovery copy remains */ });
    });
  }

  async function handleNewArticle() {
    if (!(await flush())) return;
    page = 1;
    setBadge('saving', 'Creating…');
    try {
      const res = await fetch('/api/reporter/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled draft' })
      });
      if (!res.ok) {
        setBadge('error', 'Could not create');
        return;
      }
      const created = await res.json();
      await loadArticles();
      selectArticle(created.id);
    } catch (err) {
      setBadge('error', 'Could not create');
    }
  }

  async function handleSubmit() {
    if (!currentId) return;
    const id = currentId;
    if (!(await flush())) return;
    if (currentId !== id) return;
    try {
      const res = await fetch('/api/reporter/articles/' + id + '/submit', { method: 'POST' });
      const body = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setBadge('error', body.error || 'Submit failed');
        return;
      }
      if (currentArticle.status === 'published') currentArticle.pendingUpdate.status = 'pending';
      else currentArticle.status = 'pending';
      try { localStorage.removeItem(LOCAL_PREFIX + currentId); } catch (err) { /* ignore */ }
      await loadArticles();
      selectArticle(currentId);
      setBadge('saved', 'Submitted for review');
    } catch (err) {
      setBadge('error', 'Submit failed');
    }
  }

  async function loadArticles() {
    try {
      const res = await fetch('/api/reporter/articles?page=' + page);
      if (!res.ok) return;
      const body = await res.json();
      articles = body.articles || [];
      total = body.total;
      pageSize = body.pageSize;
      document.getElementById('workspace-page').textContent = 'Page ' + page + ' of ' + Math.max(1, Math.ceil(total / pageSize));
      document.getElementById('workspace-prev').disabled = page <= 1;
      document.getElementById('workspace-next').disabled = page * pageSize >= total;
      renderList();
    } catch (err) {
      listEl.innerHTML = '<li class="empty-hint">Could not load articles.</li>';
    }
  }

  function init() {
    populateCategories();
    formEl.addEventListener('input', handleInput);
    formEl.addEventListener('submit', function (event) { event.preventDefault(); });
    window.addEventListener('pagehide', saveOnExit);
    window.addEventListener('online', flush);
    document.addEventListener('click', async function (event) {
      const link = event.target.closest('a[href]');
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.button) return;
      event.preventDefault();
      if (await flush()) window.location.assign(link.href);
    });
    ['prev', 'next'].forEach(function (direction) {
      document.getElementById('workspace-' + direction).addEventListener('click', async function () {
        if (!(await flush())) return;
        page += direction === 'prev' ? -1 : 1;
        await loadArticles();
      });
    });
    document.getElementById('new-article-btn').addEventListener('click', handleNewArticle);
    document.getElementById('submit-article-btn').addEventListener('click', handleSubmit);
    loadArticles();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
