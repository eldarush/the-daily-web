/**
 * Demo data seeder for The Daily Web.
 *
 * Generates the dataset required for the oral defense:
 *   - 1 editor + 4 reporters (passwords hashed via the User pre-save hook)
 *   - 520 articles across all 7 categories and all 4 states
 *   - published articles carrying update histories (analytics milestones)
 *   - 15 live articles with a staged revision, for the diff demo
 *   - 168 hours of hourly view buckets per published article, with a visible
 *     readership bump after each editor update
 *   - comments (only if a teammate's Comment model is present)
 *
 * Usage: npm run seed
 */
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const User = require('../models/User');
const Article = require('../models/Article');
const ViewAnalytics = require('../models/ViewAnalytics');

const { ARTICLE_CATEGORIES } = Article;

const TOTAL_ARTICLES = 520;
const HISTORY_HOURS = 168; // 7 days
const HOUR_MS = 60 * 60 * 1000;

const REPORTERS = [
  { username: 'reporter1', fullName: 'Dana Levi', role: 'reporter' },
  { username: 'reporter2', fullName: 'Omar Khan', role: 'reporter' },
  { username: 'reporter3', fullName: 'Maya Cohen', role: 'reporter' },
  { username: 'reporter4', fullName: 'Noa Bar', role: 'reporter' }
];
const EDITOR = { username: 'editor', fullName: 'Eli Editor', role: 'editor' };
const SEED_PASSWORD = 'password123';

// Headline fragments per category, combined for variety.
const HEADLINE_PARTS = {
  News: ['City council approves', 'New policy targets', 'Officials respond to', 'Report reveals'],
  Technology: ['Startup unveils', 'New chip promises', 'Researchers demo', 'Open-source project'],
  Economy: ['Markets react to', 'Central bank signals', 'Report: inflation', 'Analysts weigh'],
  Sports: ['Late goal seals', 'Underdogs stun', 'Season opener brings', 'Record crowd for'],
  Culture: ['Festival celebrates', 'New exhibition explores', 'Author debuts', 'Critics praise'],
  Health: ['Study links', 'Clinic launches', 'New guidelines on', 'Breakthrough in'],
  World: ['Summit addresses', 'Talks resume over', 'Region braces for', 'Leaders agree on']
};
const HEADLINE_SUBJECTS = [
  'the housing plan', 'regional transit', 'renewable energy', 'a landmark deal', 'the annual budget',
  'public health', 'the coastal cleanup', 'digital privacy', 'the youth program', 'climate resilience',
  'urban farming', 'the championship', 'small business relief', 'the new campus', 'water conservation'
];

/** Deterministic-ish pick helpers. */
function pick(arr, i) {
  return arr[i % arr.length];
}
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeHeadline(category, i) {
  return pick(HEADLINE_PARTS[category], i) + ' ' + pick(HEADLINE_SUBJECTS, i + randInt(0, 14));
}

function makeContent(title) {
  const para = () =>
    `${title} — reporting continues as more details emerge. Sources close to the matter described a ` +
    'developing situation with implications for residents and stakeholders across the region. ' +
    'Officials are expected to provide further comment in the coming days.';
  return [para(), para(), para()].join('\n\n');
}

/** Builds one hourly view curve for a published article, with post-update bumps. */
function buildViewBuckets(articleId, publishedAt, updateTimes) {
  const now = Date.now();
  const start = now - HISTORY_HOURS * HOUR_MS;
  const buckets = [];
  const publishedMs = publishedAt ? publishedAt.getTime() : start;

  for (let h = 0; h < HISTORY_HOURS; h++) {
    const bucketMs = start + h * HOUR_MS;
    if (bucketMs < publishedMs) continue; // no views before publication

    const hourOfDay = new Date(bucketMs).getUTCHours();
    const daytime = hourOfDay >= 7 && hourOfDay <= 22 ? 1 : 0.35; // diurnal pattern
    const ageHours = (now - bucketMs) / HOUR_MS;
    const freshness = Math.max(0.2, 1 - ageHours / HISTORY_HOURS); // newer hours busier

    // Readership bump in the ~12h after each editor update.
    let bump = 1;
    updateTimes.forEach(function (t) {
      const since = bucketMs - t.getTime();
      if (since >= 0 && since < 12 * HOUR_MS) {
        bump = Math.max(bump, 2.2 - since / (12 * HOUR_MS));
      }
    });

    const base = 20 * daytime * freshness * bump;
    const views = Math.max(0, Math.round(base + randInt(-3, 5)));
    if (views > 0) {
      buckets.push({ article: articleId, timestampBucket: new Date(bucketMs), views: views });
    }
  }
  return buckets;
}

function chooseStatus(index) {
  const r = index / TOTAL_ARTICLES;
  if (r < 0.75) return 'published';
  if (r < 0.85) return 'draft';
  if (r < 0.95) return 'pending';
  return 'rejected';
}

async function seed() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_daily_web';
  await mongoose.connect(mongoUri);
  console.log('Connected to', mongoUri);

  // Reset the collections this seeder owns.
  const seedUsernames = REPORTERS.map((r) => r.username).concat(EDITOR.username);
  await User.deleteMany({ username: { $in: seedUsernames } });
  await Article.deleteMany({});
  await ViewAnalytics.deleteMany({});
  console.log('Cleared previous seed data');

  // Users (created individually so the bcrypt pre-save hook runs).
  const editor = await User.create({ ...EDITOR, password: SEED_PASSWORD });
  const reporters = [];
  for (const r of REPORTERS) {
    reporters.push(await User.create({ ...r, password: SEED_PASSWORD }));
  }
  console.log(`Seeded ${reporters.length} reporters + 1 editor`);

  const now = Date.now();
  const articleDocs = [];

  for (let i = 0; i < TOTAL_ARTICLES; i++) {
    const category = pick(ARTICLE_CATEGORIES, i);
    const author = pick(reporters, i);
    const status = chooseStatus(i);
    const title = makeHeadline(category, i);

    const doc = {
      title: title,
      summary: `${title}. Here is what we know so far and why it matters.`,
      content: makeContent(title),
      category: category,
      author: author._id,
      status: status,
      imageUrl: '/images/default-article.jpg',
      publishedUpdates: [],
      pendingUpdate: { hasUpdate: false }
    };

    if (status === 'published') {
      const daysAgo = randInt(2, 7);
      doc.publishedAt = new Date(now - daysAgo * 24 * HOUR_MS);
    }
    if (status === 'rejected') {
      doc.editorNotes = 'Please add a source for the second paragraph and tighten the headline.';
    }
    articleDocs.push(doc);
  }

  const articles = await Article.insertMany(articleDocs);
  console.log(`Seeded ${articles.length} articles`);

  const published = articles.filter((a) => a.status === 'published');

  // Give ~40 published articles an update history (analytics milestones),
  // and 15 of those a live staged revision for the diff demo.
  const withUpdates = published.slice(0, 40);
  const withRevision = new Set(published.slice(0, 15).map((a) => a._id.toString()));
  const viewDocs = [];

  for (const article of published) {
    const updateTimes = [];
    if (withUpdates.includes(article)) {
      const count = randInt(1, 3);
      for (let u = 0; u < count; u++) {
        const t = new Date(article.publishedAt.getTime() + (u + 1) * randInt(18, 36) * HOUR_MS);
        if (t.getTime() < now) {
          updateTimes.push(t);
          article.publishedUpdates.push({
            publishedAt: t,
            editor: editor._id,
            changelogNote: pick(
              ['Updated with official statement', 'Corrected figures', 'Added expert reaction', 'Expanded background'],
              u
            )
          });
        }
      }
    }

    if (withRevision.has(article._id.toString())) {
      article.pendingUpdate = {
        hasUpdate: true,
        title: article.title + ' (revised)',
        summary: article.summary + ' Updated with the latest confirmed details.',
        content: article.content + '\n\nUPDATE: additional confirmation received from a second source.',
        category: article.category,
        imageUrl: article.imageUrl,
        updatedAt: new Date(now - randInt(1, 20) * HOUR_MS)
      };
    }

    const buckets = buildViewBuckets(article._id, article.publishedAt, updateTimes);
    article.viewsCount = buckets.reduce((sum, b) => sum + b.views, 0);
    for (const b of buckets) viewDocs.push(b);

    await article.save();
  }
  console.log(`Applied updates + view curves to ${published.length} published articles`);

  // Bulk insert view buckets in chunks.
  const CHUNK = 5000;
  for (let i = 0; i < viewDocs.length; i += CHUNK) {
    await ViewAnalytics.insertMany(viewDocs.slice(i, i + CHUNK), { ordered: false });
  }
  console.log(`Seeded ${viewDocs.length} hourly view buckets`);

  await seedCommentsIfAvailable(articles, editor);

  await mongoose.connection.close();
  console.log('\nDone. Log in with editor / reporter1..4, password: ' + SEED_PASSWORD);
}

/**
 * Seeds comments only if a teammate's Comment model exists — this module owns
 * Articles and ViewAnalytics, not Comments.
 */
async function seedCommentsIfAvailable(articles, editor) {
  let Comment;
  try {
    Comment = require('../models/Comment');
  } catch (err) {
    console.log('Comment model not present yet — skipping comment seeding');
    return;
  }
  try {
    const published = articles.filter((a) => a.status === 'published').slice(0, 60);
    const docs = [];
    for (const article of published) {
      const n = randInt(0, 4);
      for (let c = 0; c < n; c++) {
        docs.push({
          article: article._id,
          author: editor._id,
          authorName: 'Guest reader',
          body: pick(['Great coverage.', 'Thanks for the update.', 'Any sources?', 'Well written.'], c)
        });
      }
    }
    if (docs.length > 0) {
      await Comment.insertMany(docs, { ordered: false });
    }
    console.log(`Seeded ${docs.length} comments`);
  } catch (err) {
    console.log('Comment seeding skipped:', err.message);
  }
}

seed().catch(function (err) {
  console.error('Seed failed:', err);
  process.exit(1);
});
