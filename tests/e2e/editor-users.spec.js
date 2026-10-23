const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');
const User = require('../../models/User');

const editorName = 'user_ui_editor';
const reporterName = 'user_ui_reporter';
const password = 'ui-test-password-123';

test.beforeAll(async () => {
  const uri = process.env.MONGODB_URI;
  if (process.env.NODE_ENV !== 'test' || !/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\/the_daily_web_(test(?:_[a-z0-9_]+)?|user_ui_[a-z0-9_]+)(\?.*)?$/.test(uri || '')) {
    throw new Error('User UI tests require an isolated local test database.');
  }
  await mongoose.connect(uri);
  await User.init();
  await User.create({ username: editorName, password, fullName: 'User UI Editor', role: 'editor' });
  await User.create({ username: reporterName, password, fullName: 'User UI Reporter', role: 'reporter' });
});

test.afterEach(async () => {
  await User.deleteMany({ username: /^user_ui_created_/ });
  await User.updateOne({ username: editorName }, { $set: { role: 'editor' } });
});

test.afterAll(async () => {
  await User.deleteMany({ username: { $in: [editorName, reporterName] } });
  await mongoose.disconnect();
});

async function login(page, username = editorName) {
  expect((await page.request.post('/api/auth/login', { data: { username, password } })).ok()).toBeTruthy();
}

async function openForm(page) {
  await login(page);
  await page.goto('/editor');
  await expect(page.getByRole('button', { name: 'Add User', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add User', exact: true }).click();
  await expect(page.locator('#create-user-panel')).toBeVisible();
}

async function fillForm(page, username, role = 'reporter', fullName = 'New UI User') {
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Full name', { exact: true }).fill(fullName);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Role', { exact: true }).selectOption(role);
}

for (const role of ['reporter', 'editor']) {
  test('editor creates a ' + role + ' through the UI with a hashed password and a usable login', async ({ page, browser, baseURL }) => {
    await openForm(page);
    const username = 'user_ui_created_' + role;
    await fillForm(page, username, role);
    const navigation = [];
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigation.push(frame.url()); });
    const response = page.waitForResponse(res => res.url().endsWith('/api/users') && res.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create User', exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(201);
    expect((await result.json()).user.password).toBeUndefined();
    await expect(page.locator('#create-user-status')).toContainText(username);
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    const stored = await User.findOne({ username });
    expect(stored.role).toBe(role);
    expect(stored.password).not.toBe(password);
    expect(stored.password).toMatch(/^\$2[aby]\$12\$/);
    expect(await stored.comparePassword(password)).toBe(true);
    expect(await User.countDocuments({ username })).toBe(1);
    expect(navigation).toEqual([]);
    const context = await browser.newContext({ baseURL });
    try {
      const newcomer = await context.newPage();
      await login(newcomer, username);
      await newcomer.goto(role === 'editor' ? '/editor' : '/workspace');
      await expect(newcomer.locator('h1')).toHaveText(role === 'editor' ? 'Editor Management Hub' : 'Reporter Workspace');
    } finally { await context.close(); }
  });
}

test('guests and reporters cannot see the control or create a user by posting directly', async ({ page }) => {
  const body = { username: 'user_ui_created_forbidden', password, fullName: 'Forbidden', role: 'editor' };
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add User', exact: true })).toHaveCount(0);
  expect((await page.request.post('/api/users', { data: body })).status()).toBe(401);
  await login(page, reporterName);
  await page.goto('/workspace');
  await expect(page.getByRole('button', { name: 'Add User', exact: true })).toHaveCount(0);
  expect((await page.request.get('/editor')).status()).toBe(403);
  expect((await page.request.post('/api/users', { data: body })).status()).toBe(403);
  expect(await User.countDocuments({ username: body.username })).toBe(0);
});

test('blank names are rejected before posting and duplicate usernames preserve values for correction', async ({ page }) => {
  await openForm(page);
  let posts = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/users')) posts++; });
  await fillForm(page, '   ');
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toContainText('Username must contain at least 3 characters');
  expect(posts).toBe(0);
  await fillForm(page, reporterName);
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toHaveText('Username already in use.');
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(reporterName);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(password);
  expect(await User.countDocuments({ username: reporterName })).toBe(1);
  await page.getByLabel('Username', { exact: true }).fill('user_ui_created_retry');
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toContainText('user_ui_created_retry');
  expect(await User.countDocuments({ username: 'user_ui_created_retry' })).toBe(1);
});

test('slow requests cannot create duplicate accounts or clear newly typed values', async ({ page }) => {
  await openForm(page);
  const username = 'user_ui_created_once';
  await fillForm(page, username);
  let release, announce;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { announce = resolve; });
  let posts = 0;
  await page.route('**/api/users', async route => {
    posts++;
    announce();
    await held;
    await route.continue();
  });
  try {
    await page.locator('#create-user-form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await started;
    await expect(page.getByRole('button', { name: 'Create User', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Password', { exact: true })).toBeDisabled();
    await expect(page.locator('#cancel-create-user')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add User', exact: true })).toBeDisabled();
    release();
    await expect(page.locator('#create-user-status')).toContainText(username);
    expect(posts).toBe(1);
    expect(await User.countDocuments({ username })).toBe(1);
  } finally { release(); }
});

test('HTTP and network failures keep the form usable and show errors as text', async ({ page }) => {
  await openForm(page);
  await fillForm(page, 'user_ui_created_network');
  const error = '<img src=x onerror="window.userCreationXss=1"> Service unavailable';
  await page.route('**/api/users', route => route.fulfill({ status: 503, json: { error } }));
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toHaveText(error);
  await expect(page.locator('#create-user-status img')).toHaveCount(0);
  expect(await page.evaluate(() => window.userCreationXss)).toBeUndefined();
  await page.unroute('**/api/users');
  await page.route('**/api/users', route => route.abort());
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toContainText('Could not create the user');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(password);
  await expect(page.getByRole('button', { name: 'Create User', exact: true })).toBeEnabled();
  expect(await User.countDocuments({ username: 'user_ui_created_network' })).toBe(0);
});

for (const failure of ['expired session', 'demoted editor']) {
  test(failure + ' cannot create an account from an already open form', async ({ page, context }) => {
    await openForm(page);
    await fillForm(page, 'user_ui_created_no_permission');
    if (failure === 'expired session') await context.clearCookies();
    else await User.updateOne({ username: editorName }, { $set: { role: 'reporter' } });
    await page.getByRole('button', { name: 'Create User', exact: true }).click();
    await expect(page.locator('#create-user-status')).toContainText(failure === 'expired session' ? 'Sign in' : 'Only editors');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
    expect(await User.countDocuments({ username: 'user_ui_created_no_permission' })).toBe(0);
  });
}

test('success text cannot execute markup from a username', async ({ page }) => {
  await openForm(page);
  const username = 'user_ui_created_<img src=x onerror="window.userCreationXss=1">';
  await fillForm(page, username);
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toContainText(username);
  await expect(page.locator('#create-user-status img')).toHaveCount(0);
  expect(await page.evaluate(() => window.userCreationXss)).toBeUndefined();
});

test('cancelling clears the password and returns focus to the editor control', async ({ page }) => {
  await openForm(page);
  await expect(page.getByRole('button', { name: 'Add User', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#create-user-form')).toHaveAttribute('method', 'post');
  await expect(page.locator('#create-user-form')).toHaveAttribute('action', '/api/users');
  await fillForm(page, 'user_ui_created_cancel');
  await page.locator('#cancel-create-user').click();
  await expect(page.locator('#create-user-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add User', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Add User', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByLabel('Username', { exact: true }).press('Escape');
  await expect(page.locator('#create-user-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add User', exact: true })).toHaveAttribute('aria-expanded', 'false');
  expect(await User.countDocuments({ username: 'user_ui_created_cancel' })).toBe(0);
});

test('deleting an editor revokes an already open user form immediately', async ({ page }) => {
  const removed = await User.create({ username: 'user_ui_created_deleted_editor', password, fullName: 'Deleted Editor', role: 'editor' });
  await login(page, removed.username);
  await page.goto('/editor');
  await page.getByRole('button', { name: 'Add User', exact: true }).click();
  await fillForm(page, 'user_ui_created_after_deletion');
  await User.deleteOne({ _id: removed._id });
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toContainText('Sign in');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  expect(await User.countDocuments({ username: 'user_ui_created_after_deletion' })).toBe(0);
});

test('native and trimmed form validation prevent invalid credentials from being posted', async ({ page }) => {
  await openForm(page);
  let posts = 0;
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/users')) posts++; });
  await fillForm(page, 'user_ui_created_invalid');
  await page.getByLabel('Password', { exact: true }).fill('123');
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  expect(await page.getByLabel('Password', { exact: true }).evaluate(el => el.validity.tooShort)).toBe(true);
  await page.getByLabel('Password', { exact: true }).fill('      ');
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toContainText('Password must contain');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Full name', { exact: true }).fill('   ');
  await page.getByRole('button', { name: 'Create User', exact: true }).click();
  await expect(page.locator('#create-user-status')).toHaveText('Full name is required.');
  expect(posts).toBe(0);
});

test('the API rejects NoSQL objects and invalid roles and ignores mass-assigned fields', async ({ page }) => {
  await login(page);
  const base = { username: 'user_ui_created_bad_payload', password, fullName: 'Validated User', role: 'reporter' };
  for (const invalid of [{ username: { $ne: null } }, { password: { $gt: '' } }, { fullName: { $gt: '' } }, { role: 'admin' }, { role: { $in: ['editor'] } }]) {
    expect((await page.request.post('/api/users', { data: { ...base, ...invalid } })).status()).toBe(400);
  }
  expect(await User.countDocuments({ username: base.username })).toBe(0);
  const username = 'user_ui_created_whitelisted';
  const response = await page.request.post('/api/users', { data: {
    username, password, fullName: '  Whitelisted User  ',
    _id: '000000000000000000000001', createdAt: '2000-01-01', isAdmin: true
  } });
  expect(response.status()).toBe(201);
  const stored = await User.findOne({ username }).lean();
  expect(stored.role).toBe('reporter');
  expect(stored.fullName).toBe('Whitelisted User');
  expect(String(stored._id)).not.toBe('000000000000000000000001');
  expect(stored.createdAt.getFullYear()).not.toBe(2000);
  expect(stored.isAdmin).toBeUndefined();
  expect((await response.json()).user.password).toBeUndefined();
});

test('the user form stays inside the page at the required screen widths', async ({ page }) => {
  await openForm(page);
  for (const width of [320, 375, 768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.locator('#create-user-form').evaluate(form => ({
      pageWidth: document.documentElement.scrollWidth,
      controls: [...form.querySelectorAll('input,select,button')].map(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })),
    }));
    expect(metrics.pageWidth).toBeLessThanOrEqual(width);
    expect(metrics.controls.every(control => control.left >= 0 && control.right <= width)).toBe(true);
  }
});

test('MongoDB uniqueness prevents concurrent duplicate creation even without the UI guard', async ({ page }) => {
  await login(page);
  const body = { username: 'user_ui_created_race', password, fullName: 'Race User', role: 'reporter' };
  const results = await Promise.all([page.request.post('/api/users', { data: body }), page.request.post('/api/users', { data: body })]);
  expect(results.map(res => res.status()).sort()).toEqual([201, 400]);
  expect(await User.countDocuments({ username: body.username })).toBe(1);
  for (const res of results) expect((await res.json()).user?.password).toBeUndefined();
});
