import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { frameStats, openStorm, sceneClip, settle, watchErrors } from './helpers.js';

const field = (page, name) => page.locator(`#readout [data-field="${name}"]`);

const CHAPTERS = [
  ['prologue', 'Storm Chamber'],
  ['cones', 'Fourteen cones'],
  ['scan', 'Four and a half minutes'],
  ['volume', 'Fill the gaps'],
  ['reflectivity', 'Rain and ice, not cloud'],
  ['section', 'Cut it open'],
  ['tornado', 'Thirteen minutes'],
  ['explore', 'Inside the chamber']
];

test.describe('Storm Chamber', () => {
  test.use({ reducedMotion: 'reduce' });

  test('loads the scan and draws the radar map without errors', async ({ page }) => {
    const errors = watchErrors(page);
    await openStorm(page);
    await expect(page.locator('#chapter-title')).toHaveText('Storm Chamber');
    await expect(page.locator('.stage canvas')).toBeVisible();
    await settle(page);
    const stats = await frameStats(page, sceneClip(page));
    // Range rings and the echo: a lit, structured frame, not a cleared one.
    expect(stats.mean).toBeGreaterThan(14);
    expect(stats.bright).toBeGreaterThan(0.003);
    expect(errors).toEqual([]);
  });

  test('walks every chapter with the keyboard, the readout quoting the data', async ({ page }) => {
    const errors = watchErrors(page);
    await openStorm(page);
    for (const [i, [key, title]] of CHAPTERS.entries()) {
      if (i > 0) await page.keyboard.press('ArrowRight');
      await expect(page.locator('#chapter-title')).toHaveText(title);
      await expect(page).toHaveURL(new RegExp(`#${key}$`));
      await expect(page.locator('#dots .dot').nth(i)).toHaveAttribute('aria-current', 'true');
      if (key === 'cones') {
        await expect(field(page, 'value')).toHaveText('14');
        await expect(field(page, 'v2')).toHaveText('19.5°');
      }
      if (key === 'reflectivity') {
        await expect(field(page, 'value')).toHaveText('68.5');
        await expect(page.locator('#legend-caption')).toContainText('NWS colors');
      }
      if (key === 'section') {
        await expect(field(page, 'value')).toHaveText('5.0');
        await expect(field(page, 'v1')).toHaveText('63.8 dBZ');
        await expect(field(page, 'v2')).toHaveText('962 km²');
      }
      if (key === 'tornado') {
        await expect(field(page, 'value')).toHaveText('+13');
        await expect(field(page, 'v1')).toHaveText('900 m');
      }
    }
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#chapter-title')).toHaveText('Thirteen minutes');
    expect(errors).toEqual([]);
  });

  test('renders the volume: smoke, then NWS colors', async ({ page }) => {
    await openStorm(page, '#volume');
    await settle(page, 2500);
    const smoke = await frameStats(page, sceneClip(page));
    expect(smoke.bright).toBeGreaterThan(0.05);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#chapter-title')).toHaveText('Rain and ice, not cloud');
    await settle(page, 2500);
    const colors = await frameStats(page, sceneClip(page));
    expect(colors.warm).toBeGreaterThan(0.03); // yellow-orange core of the NWS scale
  });

  test('starts at the chapter named in the URL', async ({ page }) => {
    await openStorm(page, '#tornado');
    await expect(page.locator('#chapter-title')).toHaveText('Thirteen minutes');
    await expect(page.locator('#prev')).toBeVisible();
    // Changing the hash on a loaded page moves the story too.
    await page.evaluate(() => {
      location.hash = '#section';
    });
    await expect(page.locator('#chapter-title')).toHaveText('Cut it open');
    await expect(field(page, 'leg')).toHaveText('Horizontal section');
  });

  test('scan replay steps through the sweeps in order', async ({ page }) => {
    await openStorm(page, '#scan');
    await expect(field(page, 'leg')).toHaveText(/^Sweep \d+ of 14$/);
    const seen = new Set();
    for (let i = 0; i < 40 && seen.size < 3; i += 1) {
      seen.add(await field(page, 'leg').textContent());
      await page.waitForTimeout(150);
    }
    expect(seen.size).toBeGreaterThan(1);
    await expect(field(page, 'time')).toHaveText(/^19:0[4-9]:\d\d CDT$/);
  });

  test('explore: data colors, section height, true scale and replay', async ({ page }) => {
    const errors = watchErrors(page);
    await openStorm(page, '#explore');
    const extra = page.locator('#chapter-extra');
    const data = extra.getByRole('button', { name: 'Data colors' });
    await data.click();
    await expect(data).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#legend-caption')).toContainText('NWS colors');

    const slider = extra.getByRole('slider');
    await slider.fill('10');
    await expect(extra.locator('output')).toHaveText('10.0 km');
    await expect(extra.getByRole('button', { name: 'Section' })).toHaveAttribute('aria-pressed', 'true');
    await expect(field(page, 'value')).toHaveText('10.0');
    await expect(field(page, 'leg')).toHaveText('Horizontal section');

    const scale = extra.getByRole('button', { name: 'True scale' });
    await scale.click();
    await expect(scale).toHaveAttribute('aria-pressed', 'true');

    await extra.getByRole('button', { name: 'Replay the scan' }).click();
    await expect(field(page, 'leg')).toHaveText(/^Sweep \d+ of 14$/);
    expect(errors).toEqual([]);
  });

  test('the pointer reads the value on the section', async ({ page }) => {
    await openStorm(page, '#section');
    await settle(page);
    const probe = page.locator('#readout [data-row="probe"]');
    const { width, height } = page.viewportSize();
    let found = false;
    for (let fy = 0.28; fy <= 0.78 && !found; fy += 0.1) {
      for (let fx = 0.42; fx <= 0.9 && !found; fx += 0.07) {
        await page.mouse.move(width * fx, height * fy);
        await page.waitForTimeout(80);
        found = await probe.isVisible();
      }
    }
    expect(found).toBe(true);
    await expect(field(page, 'probe')).toHaveText(/^(\d+\.\d dBZ|no echo) · 5\.0 km up$/);
  });

  test('the dimension control folds the chamber back to the map', async ({ page }) => {
    await openStorm(page, '#cones');
    const dimension = page.locator('#dimension input');
    await dimension.fill('0');
    await expect(dimension).toHaveValue('0');
    await dimension.fill('1');
    await settle(page, 600);
    await expect(dimension).toHaveValue('1');
  });

  test('about panel and sound', async ({ page }) => {
    await openStorm(page);
    const about = page.locator('#about');
    await about.click();
    await expect(page.locator('#about-panel')).toBeVisible();
    await expect(about).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#about-panel')).toContainText('KDDC20130519_000455_V06');
    await page.keyboard.press('Escape');
    await expect(page.locator('#about-panel')).toBeHidden();
    await expect(about).toBeFocused();

    const sound = page.locator('#sound');
    await sound.click();
    await expect(sound).toHaveText('Sound on');
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await sound.click();
    await expect(sound).toHaveText('Sound off');
  });

  test('has no detectable accessibility violations', async ({ page }) => {
    await openStorm(page, '#explore');
    await page.locator('#about').click();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

/** Screen rectangles of the label texts that are currently showing. */
async function labelRects(page) {
  return page.locator('.scene-label').evaluateAll((elements) =>
    elements
      .filter((e) => e.style.visibility === 'visible' && Number(e.style.opacity) > 0.6)
      .map((e) => {
        const r = e.querySelector('.scene-label-text').getBoundingClientRect();
        return { text: e.textContent, x0: r.left, x1: r.right, y0: r.top, y1: r.bottom };
      })
      .filter((r) => r.x1 - r.x0 > 0)
  );
}

for (const [device, viewport] of [['phone', { width: 390, height: 844 }], ['laptop', { width: 1280, height: 720 }]]) {
  test.describe(`labels on a ${device}`, () => {
    test.use({ viewport, reducedMotion: 'reduce' });

    for (const chapter of ['prologue', 'cones', 'volume', 'reflectivity', 'tornado']) {
      test(`${chapter}: on screen and apart`, async ({ page }) => {
        await openStorm(page, `#${chapter}`);
        await settle(page, 2000);
        const rects = await labelRects(page);
        expect(rects.length).toBeGreaterThan(0);
        for (const r of rects) {
          expect(r.x0, r.text).toBeGreaterThanOrEqual(0);
          expect(r.x1, r.text).toBeLessThanOrEqual(viewport.width);
        }
        const overlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 2 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 2;
        for (let i = 0; i < rects.length; i += 1) {
          for (let j = i + 1; j < rects.length; j += 1) expect(overlap(rects[i], rects[j]), `${rects[i].text} / ${rects[j].text}`).toBe(false);
        }
        // Nor under the interface: chapter card, readout, legend, bars.
        const panels = await page.evaluate(() =>
          [...document.querySelectorAll('.masthead, .topbar, #chapter, #readout, #legend.is-visible, #dimension')]
            .map((e) => ({ id: e.id || e.className, r: e.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 0)
            .map(({ id, r }) => ({ text: id, x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }))
        );
        for (const r of rects) for (const p of panels) expect(overlap(r, p), `${r.text} under ${p.text}`).toBe(false);
      });
    }
  });
}

test.describe('Storm Chamber on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });

  test('fits the screen and still navigates', async ({ page }) => {
    const errors = watchErrors(page);
    await openStorm(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.locator('#next').tap();
    await expect(page.locator('#chapter-title')).toHaveText('Fourteen cones');
    const card = await page.locator('#chapter').boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
  });
});

test('full motion: the camera flies between chapters', async ({ page }) => {
  await openStorm(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const early = await frameStats(page, sceneClip(page));
  await page.waitForTimeout(6000);
  const late = await frameStats(page, sceneClip(page));
  expect(Math.abs(late.mean - early.mean)).toBeGreaterThan(0.5);
});
