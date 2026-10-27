// Commit City and PSR B1919+21 must keep working next to Storm Chamber.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers.js';

test('home links to all six pieces, in English', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Datascape · The Hidden Dimension');
  await expect(page.locator('h1')).toHaveText('Datascape');
  await expect(page.locator('.eyebrow')).toHaveText('The Hidden Dimension');
  const pieces = [
    ['/storm.html', 'Storm Chamber'],
    ['/water.html', 'The Shadow of Water'],
    ['/heart.html', 'The Electric Heart'],
    ['/tides.html', 'Between Tides'],
    ['/skyline.html', 'Commit City'],
    ['/pulsar.html', 'PSR B1919+21']
  ];
  for (const [href, name] of pieces) await expect(page.locator(`a[href="${href}"] h3`)).toHaveText(name);
  await page.locator('a[href="/storm.html"]').click();
  await expect(page).toHaveURL(/\/storm(\.html)?(\?|#|$)/); // Pages serves clean URLs
  expect(errors).toEqual([]);
});

test('no page is left in Chinese', async ({ page }) => {
  for (const path of ['/', '/storm.html', '/water.html', '/heart.html', '/tides.html', '/skyline.html', '/pulsar.html']) {
    await page.goto(path);
    expect(await page.getAttribute('html', 'lang'), path).toBe('en');
    const text = await page.locator('body').innerText();
    expect(text, path).not.toMatch(/[\u4e00-\u9fff]/);
  }
});

test('home has no detectable accessibility violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

for (const path of ['/skyline.html', '/pulsar.html']) {
  test(`${path} has no detectable accessibility violations`, async ({ page }) => {
    await page.route('**/api/contributions**', (route) => route.fulfill({ status: 404, json: { error: 'No GitHub user named test' } }));
    await page.goto(path);
    await page.waitForTimeout(1500);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}

test('PSR B1919+21 starts and draws', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/pulsar.html');
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});

test('Commit City starts and draws', async ({ page }) => {
  // The contribution API needs the network; answer it locally so the check
  // covers the page, not GitHub.
  await page.route('**/api/contributions**', (route) => {
    const days = [];
    const start = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 365; i += 1) {
      const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
      const count = (i * 7) % 13;
      days.push({ date, count, level: Math.min(4, Math.ceil(count / 3)) });
    }
    route.fulfill({ json: { username: 'octocat', year: 2025, from: days[0].date, to: days.at(-1).date, days } });
  });
  const errors = watchErrors(page);
  await page.goto('/skyline.html');
  await expect(page.locator('canvas').first()).toBeVisible();
  // The URL is rewritten only after the city has been built from the data.
  await expect(page).toHaveURL(/\?user=/);
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
