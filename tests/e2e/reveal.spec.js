// What the four stories share: one step from the flat chart to the reveal, a
// statement of what is measured, and a Dimension Control that works by hand.
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers.js';

const STORIES = {
  storm: { label: 'Open the storm', key: 'volume', title: 'Fill the gaps', provenance: 'Interpolated' },
  water: { label: 'Raise the surface', key: 'wall', title: 'Every line is a wall', provenance: 'Computed' },
  heart: { label: 'Fold time away', key: 'fold', title: 'The hidden dimension', provenance: 'Recorded' },
  tides: { label: 'Carry the level ashore', key: 'ground', title: 'The ground beneath', provenance: 'Not modeled' }
};

async function open(page, piece, hash = '') {
  const dpr = process.env.CI ? '&dpr=0.5' : '';
  await page.goto(`/${piece}.html?maxdt=1${dpr}${hash}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#chapter-title')).not.toBeEmpty();
}

for (const [piece, story] of Object.entries(STORIES)) {
  test.describe(piece, () => {
    test.use({ reducedMotion: 'reduce' });

    test('reaches its reveal in one step from the flat chart', async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, piece);
      await expect(page.locator('#dimension input')).toHaveValue('0');
      await page.getByRole('button', { name: story.label }).click();
      await expect(page.locator('#chapter-title')).toHaveText(story.title);
      await expect(page).toHaveURL(new RegExp(`#${story.key}$`));
      await expect.poll(async () => Number(await page.locator('#dimension input').inputValue()), { timeout: 30_000 }).toBeGreaterThan(0.99);
      // The reveal says plainly what is measured and what is not.
      await expect(page.locator('.provenance')).toContainText(story.provenance);
      expect(errors).toEqual([]);
    });

    test('the chapters are still there afterwards', async ({ page }) => {
      await open(page, piece);
      await page.getByRole('button', { name: story.label }).click();
      await expect(page.locator('#chapter-title')).toHaveText(story.title);
      await page.locator('#prev').click();
      await expect(page.locator('#chapter-title')).not.toHaveText(story.title);
    });

    test('the Dimension Control works by keyboard and keeps its arrow keys', async ({ page }) => {
      const errors = watchErrors(page);
      await open(page, piece, '#explore');
      const input = page.locator('#dimension input');
      await expect.poll(async () => Number(await input.inputValue()), { timeout: 30_000 }).toBeGreaterThan(0.99);
      const title = await page.locator('#chapter-title').textContent();
      await input.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(page.locator('#chapter-title')).toHaveText(title);
      expect(Number(await input.inputValue())).toBeCloseTo(0.98, 2);
      // A longer step eases there rather than jumping the geometry.
      await page.keyboard.press('PageDown');
      await expect.poll(async () => Number(await input.inputValue()), { timeout: 10_000 }).toBeCloseTo(0.88, 2);
      expect(errors).toEqual([]);
      await expect(input).toHaveAttribute('aria-valuetext', /\S/);
    });

    test('the end labels go to 2D and 3D', async ({ page }) => {
      await open(page, piece, '#explore');
      const input = page.locator('#dimension input');
      await page.locator('#dimension .dimension-end[data-to="0"]').click();
      await expect.poll(async () => Number(await input.inputValue()), { timeout: 30_000 }).toBeLessThan(0.01);
      await page.locator('#dimension .dimension-end[data-to="1"]').click();
      await expect.poll(async () => Number(await input.inputValue()), { timeout: 30_000 }).toBeGreaterThan(0.99);
    });

    test('a changed hash moves the story', async ({ page }) => {
      await open(page, piece);
      await page.evaluate((key) => {
        location.hash = `#${key}`;
      }, story.key);
      await expect(page.locator('#chapter-title')).toHaveText(story.title);
    });
  });

  test(`${piece} without WebGL shows a still of itself and no dead controls`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
        return /webgl/.test(type) ? null : original.call(this, type, ...rest);
      };
    });
    await page.goto(`/${piece}.html`);
    await expect(page.locator('.webgl-error')).toContainText('WebGL 2');
    await expect(page.locator('.webgl-fallback img')).toBeVisible();
    await expect(page.locator('#chapter')).toBeHidden();
    await expect(page.locator('.brand')).toBeVisible();
  });
}

test('full motion: the Storm reveal stops at the cones on its way to the volume', async ({ page }) => {
  await open(page, 'storm');
  await page.getByRole('button', { name: 'Open the storm' }).click();
  const input = page.locator('#dimension input');
  await expect.poll(async () => Number(await input.inputValue()), { timeout: 20_000 }).toBeCloseTo(0.64, 2);
  await expect(page.locator('#dimension .dimension-stop')).toHaveText('fourteen cones');
  await expect.poll(async () => Number(await input.inputValue()), { timeout: 40_000 }).toBeGreaterThan(0.99);
  await expect(page.locator('#dimension .dimension-stop')).toHaveText('interpolated volume');
});

test('taking the camera during the reveal finishes the storm without moving the view again', async ({ page }) => {
  await open(page, 'storm');
  await page.getByRole('button', { name: 'Open the storm' }).click();
  await page.waitForTimeout(1500);
  const { width, height } = page.viewportSize();
  await page.mouse.move(width * 0.7, height * 0.5);
  await page.mouse.down();
  await page.mouse.move(width * 0.75, height * 0.5, { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.locator('#dimension input').inputValue()), { timeout: 40_000 }).toBeGreaterThan(0.99);
});

for (const [name, viewport] of [['a phone held sideways', { width: 844, height: 390 }], ['the smallest phone', { width: 320, height: 568 }]]) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });

    for (const piece of Object.keys(STORIES)) {
      test(`${piece}: the chapter and its controls stay reachable`, async ({ page }) => {
        await open(page, piece, '#explore');
        await expect(page.locator('#readout')).toBeHidden();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        const card = await page.locator('#chapter').boundingBox();
        expect(card.y).toBeGreaterThanOrEqual(0);
        expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);
        const next = page.locator('#next');
        // Nothing that must be read or dragged lies under the chapter.
        const timeline = page.locator('#timeline');
        if (await timeline.isVisible()) {
          const box = await timeline.boundingBox();
          const apart = box.x >= card.x + card.width || box.x + box.width <= card.x || box.y >= card.y + card.height || box.y + box.height <= card.y;
          expect(apart, 'the month is not under the chapter').toBe(true);
        }
        await next.scrollIntoViewIfNeeded();
        await expect(next).toBeInViewport();
        await next.tap();
        await expect(page.locator('#chapter-title')).toHaveText(/\S/);
      });
    }
  });
}
