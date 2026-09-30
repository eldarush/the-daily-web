(function () {
  const STORAGE_KEY = 'the_daily_web_viewed_ids';

  function getViewedIds() {
    try {
      const ids = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(ids)
        ? ids.filter(id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)).map(id => id.toLowerCase())
        : [];
    } catch {
      return [];
    }
  }

  // Record real article visits, including direct links and visits in another tab.
  const articlePage = document.querySelector('.article-detail-container[data-article-id]');
  if (articlePage) {
    const id = articlePage.dataset.articleId;
    const ids = getViewedIds();
    if (/^[a-f\d]{24}$/i.test(id) && !ids.includes(id)) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.concat(id)));
      } catch {
        // Reading still works when browser storage is unavailable.
      }
    }
  }

  const grid = document.getElementById('articles-grid');
  if (!grid) return;

  const search = document.getElementById('feed-search');
  const categories = document.getElementById('category-tabs');
  const readingFilter = document.getElementById('viewed-filter');
  const sort = document.getElementById('feed-sort');
  const status = document.getElementById('feed-status');
  const empty = document.getElementById('empty-feed');
  const loading = document.getElementById('loading-spinner');
  const errorMessage = document.getElementById('feed-error');
  const endMessage = document.getElementById('end-of-feed-msg');
  const moreButton = document.getElementById('load-more');
  const sentinel = document.getElementById('infinite-scroll-sentinel');
  const template = document.getElementById('article-card-template');
  const state = { page: 1, category: 'all', loading: false, hasMore: grid.dataset.hasMore === 'true' };
  let requestNumber = 0;
  let searchTimer;
  let observer;

  function prepareCard(card) {
    const isRead = getViewedIds().includes(card.dataset.articleId);
    card.classList.toggle('is-read', isRead);
    card.querySelector('.read-badge').hidden = !isRead;
    const image = card.querySelector('.card-image');
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    if (image.complete && !image.naturalWidth) image.hidden = true;
  }

  function createCard(article) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.articleId = article._id;
    const link = card.querySelector('.card-title-link');
    link.href = '/articles/' + article._id;
    // Article text must never be interpreted as HTML.
    link.textContent = article.title;
    card.querySelector('.card-summary').textContent = article.summary;
    card.querySelector('.card-category').textContent = article.category;
    card.querySelector('.card-author').textContent = 'By ' + (article.author ? article.author.fullName : 'Staff Reporter');
    card.querySelector('.card-views').textContent = (article.viewsCount || 0) + ' views';
    const time = card.querySelector('.card-date');
    if (article.publishedAt) {
      time.dateTime = article.publishedAt;
      time.textContent = new Date(article.publishedAt).toLocaleDateString('en-GB');
    }
    const image = card.querySelector('.card-image');
    image.src = article.imageUrl || '/images/default-article.jpg';
    image.alt = article.title;
    prepareCard(card);
    return card;
  }

  async function loadArticles(reset) {
    if (!reset && (state.loading || !state.hasMore)) return;
    const currentRequest = ++requestNumber;
    if (reset) {
      state.page = 0;
      state.hasMore = true;
      grid.replaceChildren();
      empty.hidden = true;
      status.textContent = 'Loading articles…';
    }
    const nextPage = state.page + 1;
    state.loading = true;
    loading.hidden = false;
    errorMessage.hidden = true;
    endMessage.hidden = true;
    moreButton.hidden = true;
    grid.setAttribute('aria-busy', 'true');

    const query = {
      page: String(nextPage), limit: '20', category: state.category, search: search.value.trim(),
      sort: sort.value, viewedFilter: readingFilter.value
    };
    let url = '/api/articles?' + new URLSearchParams(query);
    let options = {};
    if (readingFilter.value !== 'all') {
      query.viewedIds = getViewedIds().join(',');
      url = '/api/articles/search';
      options = {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query)
      };
    }

    let succeeded = false;
    try {
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load articles. Please try again.');
      // A newer filter request takes priority over a slower, older response.
      if (currentRequest !== requestNumber) return;
      data.articles.forEach(article => grid.appendChild(createCard(article)));
      state.page = nextPage;
      state.hasMore = data.hasMore;
      status.textContent = data.total + ' articles · ' + grid.children.length + ' shown';
      empty.hidden = grid.children.length > 0;
      endMessage.hidden = state.hasMore || grid.children.length === 0;
      succeeded = true;
    } catch (error) {
      if (currentRequest !== requestNumber) return;
      errorMessage.textContent = error.message;
      errorMessage.hidden = false;
      if (!grid.children.length) status.textContent = 'Articles could not be loaded.';
    } finally {
      if (currentRequest === requestNumber) {
        state.loading = false;
        loading.hidden = true;
        grid.setAttribute('aria-busy', 'false');
        moreButton.hidden = !state.hasMore;
        moreButton.textContent = succeeded ? 'Load more' : 'Retry';
        // Recheck short result lists; failures wait for an explicit retry.
        if (observer) {
          observer.unobserve(sentinel);
          if (succeeded && state.hasMore) observer.observe(sentinel);
        }
      }
    }
  }

  function resetFeed() {
    clearTimeout(searchTimer);
    loadArticles(true);
  }

  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(resetFeed, 300);
  });
  categories.addEventListener('click', event => {
    const button = event.target.closest('button[data-category]');
    if (!button) return;
    state.category = button.dataset.category;
    categories.querySelectorAll('button').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    resetFeed();
  });
  readingFilter.addEventListener('change', resetFeed);
  sort.addEventListener('change', resetFeed);
  moreButton.addEventListener('click', () => loadArticles(false));

  function refreshReadingStatus() {
    if (readingFilter.value === 'all') {
      grid.querySelectorAll('.article-card').forEach(prepareCard);
    } else {
      resetFeed();
    }
  }
  window.addEventListener('pageshow', refreshReadingStatus);
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY || event.key === null) refreshReadingStatus();
  });
  grid.querySelectorAll('.article-card').forEach(prepareCard);

  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadArticles(false);
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  }
})();
