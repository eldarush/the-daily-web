const Article = require('../models/Article');

const PAGE_SIZE = 20;
const PUBLIC_FIELDS = 'title summary category imageUrl author viewsCount publishedAt';

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

async function loadFeed(query) {
  if (Array.isArray(query)) badRequest('Filters must be a JSON object.');
  const {
    page = '1', limit = '20', category = 'all', search = '',
    sort = 'date', viewedFilter = 'all', viewedIds = ''
  } = query;
  if ([page, limit, category, search, sort, viewedFilter, viewedIds].some(value => typeof value !== 'string')) {
    badRequest('Query parameters must be single text values.');
  }

  const pageNumber = Number(page);
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || !Number.isSafeInteger(pageNumber * PAGE_SIZE)) {
    badRequest('Page must be a positive whole number.');
  }
  if (limit !== '20') badRequest('The feed page size is always 20.');
  if (category !== 'all' && !Article.ARTICLE_CATEGORIES.includes(category)) badRequest('Invalid category.');
  if (!['date', 'popularity'].includes(sort)) badRequest('Invalid sort order.');
  if (!['all', 'viewed', 'unviewed'].includes(viewedFilter)) badRequest('Invalid reading filter.');
  if (search.length > 100) badRequest('Search must be at most 100 characters.');

  const filter = { status: 'published' };
  if (category !== 'all') filter.category = category;
  if (search.trim()) {
    // Search user text literally, even when it contains regex characters.
    const text = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { title: { $regex: text, $options: 'i' } },
      { summary: { $regex: text, $options: 'i' } }
    ];
  }
  if (viewedFilter !== 'all') {
    const ids = viewedIds ? viewedIds.split(',') : [];
    if (ids.some(id => !/^[a-f\d]{24}$/i.test(id))) badRequest('Invalid viewed article ID.');
    filter._id = viewedFilter === 'viewed' ? { $in: ids } : { $nin: ids };
  }

  // The ID breaks ties so consecutive pages have a consistent order.
  const order = sort === 'popularity'
    ? { viewsCount: -1, publishedAt: -1, _id: -1 }
    : { publishedAt: -1, _id: -1 };
  const [articles, total] = await Promise.all([
    Article.find(filter).select(PUBLIC_FIELDS).sort(order)
      .skip((pageNumber - 1) * PAGE_SIZE).limit(PAGE_SIZE)
      .populate('author', 'fullName').lean(),
    Article.countDocuments(filter)
  ]);
  return { articles, total, page: pageNumber, limit: PAGE_SIZE, hasMore: pageNumber * PAGE_SIZE < total };
}

async function getFeedArticles(req, res, next) {
  try {
    res.json(await loadFeed(req.method === 'POST' ? req.body : req.query));
  } catch (error) {
    next(error);
  }
}

async function renderHome(req, res, next) {
  try {
    const feed = await loadFeed({});
    res.render('pages/home', {
      title: 'The Daily Web - Home', ...feed, categories: Article.ARTICLE_CATEGORIES
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getFeedArticles, renderHome };
