// The other three stories of the series: every chapter by keyboard, without
// errors, accessible, and fitting a phone.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers.js';

const PIECES = {
  water: ['The Shadow of Water', 'It is a shadow', 'Every line is a wall', 'Boiling a kettle', 'The wall ends', 'Three phases, one line', 'Another shadow', 'Hold it yourself'],
  heart: ['The Electric Heart', 'Twelve directions', 'Three are enough', 'The hidden dimension', 'One beat, slowly', 'Three shadows', 'No two alike', 'Hold the loop'],
  tides: ['Between Tides', 'A height, not a number', 'The ground beneath', 'Six hours', 'Spring and neap', 'Predicted, then measured', 'True scale', 'Hold the month']
};

async function open(page, piece) {
  await page.goto(`/${piece}.html?maxdt=1`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
}

test.describe('series', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const [piece, titles] of Object.entries(PIECES)) {
    test(`${piece}: every chapter, in order, without errors`, async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, piece);
      await expect(page.locator('.brand')).toHaveText('Datascape');
      await expect(page).toHaveTitle(new RegExp(`${titles[0]} · Datascape`));
      for (const [i, title] of titles.entries()) {
        if (i > 0) await page.keyboard.press('ArrowRight');
        await expect(page.locator('#chapter-title')).toHaveText(title);
      }
      expect(errors).toEqual([]);
    });

    test(`${piece}: no detectable accessibility violations`, async ({ page }) => {
      await open(page, piece);
      await page.locator('#about').click();
      await expect(page.locator('#about-panel')).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});

test.describe('series on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });

  for (const piece of Object.keys(PIECES)) {
    test(`${piece}: fits the screen`, async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, piece);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.locator('#next').tap();
      await expect(page.locator('#chapter-title')).toHaveText(PIECES[piece][1]);
      expect(errors).toEqual([]);
    });
  }
});
