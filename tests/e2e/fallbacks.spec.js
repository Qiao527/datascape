// What a visitor sees when Storm Chamber cannot run.
import { expect, test } from '@playwright/test';

test('without WebGL it says so instead of hanging', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
      return /webgl/.test(type) ? null : original.call(this, type, ...rest);
    };
  });
  await page.goto('/storm.html');
  await expect(page.locator('.webgl-error')).toContainText('needs WebGL 2');
  await expect(page.locator('#loader')).toBeHidden();
});

test('without DecompressionStream it says so instead of hanging', async ({ page }) => {
  await page.addInitScript(() => {
    delete window.DecompressionStream;
  });
  await page.goto('/storm.html');
  await expect(page.locator('.webgl-error')).toContainText('current browser');
  await expect(page.locator('#loader')).toBeHidden();
});

test('if the scan fails to download it asks for a reload', async ({ page }) => {
  await page.route('**/data/storm/storm.bin', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/storm.html');
  await expect(page.locator('#loader')).toContainText('could not be loaded');
});

test('a corrupt scan is reported, not drawn', async ({ page }) => {
  await page.route('**/data/storm/storm.bin', (route) => route.fulfill({ status: 200, body: Buffer.from('not deflate data') }));
  await page.goto('/storm.html');
  await expect(page.locator('#loader')).toContainText('could not be loaded');
});

test('recovers after the GPU context is lost and restored', async ({ page }) => {
  const { frameStats, openStorm, sceneClip, settle } = await import('./helpers.js');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStorm(page, '#volume');
  await settle(page, 2000);
  const before = await frameStats(page, sceneClip(page));
  await page.evaluate(async () => {
    const lose = document.querySelector('.stage canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
    lose.loseContext();
    await new Promise((resolve) => setTimeout(resolve, 500));
    lose.restoreContext();
  });
  await settle(page, 3000);
  const after = await frameStats(page, sceneClip(page));
  expect(after.bright).toBeGreaterThan(before.bright * 0.5);
  expect(Math.abs(after.mean - before.mean)).toBeLessThan(10);
});
