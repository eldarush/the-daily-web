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
  let debounceTimer = null;

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
        '<span class="status-pill status-' + article.status + '">' + article.status + '</span>';
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
    });
  }

  /** Loads an article into the editor, preferring a newer unsaved local backup. */
  function selectArticle(id) {
    const article = findArticle(id);
    if (!article) return;
    currentId = id;
    idEl.value = id;
    panelEl.hidden = false;

    const serverData = article.status === 'published' && article.pendingUpdate && article.pendingUpdate.hasUpdate
      ? article.pendingUpdate
      : article;

    const local = readLocalBackup(id);
    const serverStamp = new Date(serverData.updatedAt || article.updatedAt || 0).getTime();
    if (local && local.stamp > serverStamp) {
      writeForm(local.data);
      setBadge('idle', 'Restored unsaved changes');
    } else {
      writeForm(serverData);
      setBadge('idle', 'Ready');
    }

    rejectionBanner.hidden = article.status !== 'rejected';
    rejectionNotes.textContent = article.editorNotes || '';
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

  async function saveNow() {
    if (!currentId) return;
    const data = readForm();
    writeLocalBackup(currentId, data);
    setBadge('saving', 'Saving…');
    try {
      const res = await fetch('/api/reporter/articles/' + currentId + '/autosave', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const body = await res.json().catch(function () { return {}; });
        setBadge('error', body.error || 'Save failed');
        return;
      }
      setBadge('saved', 'All changes saved · ' + nowTime());
      syncListTitle(data.title);
    } catch (err) {
      setBadge('error', 'Offline — kept locally');
    }
  }

  function syncListTitle(title) {
    const article = findArticle(currentId);
    if (article && article.status !== 'published') {
      article.title = title;
      renderList();
    }
  }

  function handleInput() {
    setBadge('saving', 'Saving…');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(saveNow, DEBOUNCE_MS);
  }

  async function handleNewArticle() {
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
    const article = findArticle(currentId);
    if (article && article.status === 'published') {
      await saveNow();
      setBadge('saved', 'Update staged for editor review');
      return;
    }
    await saveNow();
    try {
      const res = await fetch('/api/reporter/articles/' + currentId + '/submit', { method: 'POST' });
      const body = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setBadge('error', body.error || 'Submit failed');
        return;
      }
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
      const res = await fetch('/api/reporter/articles');
      if (!res.ok) return;
      const body = await res.json();
      articles = body.articles || [];
      renderList();
    } catch (err) {
      listEl.innerHTML = '<li class="empty-hint">Could not load articles.</li>';
    }
  }

  function init() {
    populateCategories();
    formEl.addEventListener('input', handleInput);
    document.getElementById('new-article-btn').addEventListener('click', handleNewArticle);
    document.getElementById('submit-article-btn').addEventListener('click', handleSubmit);
    loadArticles();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
