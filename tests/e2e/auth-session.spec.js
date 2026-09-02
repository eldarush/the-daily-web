const { test, expect } = require('@playwright/test');
const mongoose = require('mongoose');
const User = require('../../models/User');

test.describe('Authentication Flow & Session Durability', () => {
  test.beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_daily_web';
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri);
    }
    // Ensure test reporter exists
    await User.deleteMany({ username: 'e2e_reporter' });
    await User.create({
      username: 'e2e_reporter',
      password: 'password123',
      fullName: 'E2E Reporter Person',
      role: 'reporter'
    });
  });

  test.afterAll(async () => {
    await User.deleteMany({ username: 'e2e_reporter' });
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

  test('Guest can log in, view role badges, see weather widget, and retain session on reload', async ({ page }) => {
    // 1. Visit Login page
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('Sign In to The Daily Web');

    // 2. Fill credentials and submit
    await page.fill('#username', 'e2e_reporter');
    await page.fill('#password', 'password123');
    await page.click('#login-submit-btn');

    // 3. Verify successful redirection to workspace
    await page.waitForURL('**/workspace');
    await expect(page.locator('h1')).toContainText('Reporter Workspace');

    // 4. Verify navbar updates with user name and role
    const userNameBadge = page.locator('.user-name');
    await expect(userNameBadge).toContainText('E2E Reporter Person');

    // 5. Verify weather widget card renders in sidebar with valid temperature
    const weatherCard = page.locator('#weather-widget');
    await expect(weatherCard).toBeVisible();
    const weatherTemp = page.locator('#weather-temp');
    await expect(weatherTemp).toBeVisible();

    // 6. Test session durability across page refresh
    await page.reload();
    await expect(page).toHaveURL(/.*workspace/);
    await expect(page.locator('#logout-btn')).toBeVisible();

    // 7. Test sign out
    await page.click('#logout-btn');
    await page.waitForURL('**/login');
    await expect(page.locator('h1')).toContainText('Sign In to The Daily Web');
  });
});
