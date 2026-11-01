// The home page shows the real pieces without running them: stills first, a
// film only when asked for, and never a WebGL context.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { watchErrors } from './helpers.js';

const films = (requests) => requests.filter((url) => /\/reveal\.(mp4|webm)/.test(url));

function record(page) {
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  return requests;
}

/** Waits for the hero's frames to load and its control to appear. */
async function heroReady(page) {
  await expect(page.locator('#hero-control')).toBeVisible({ timeout: 30_000 });
}

test.describe('home', () => {
  test('never starts WebGL or downloads a film by itself', async ({ page }) => {
    const errors = watchErrors(page);
    const requests = record(page);
    await page.addInitScript(() => {
      window.contexts = [];
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
        window.contexts.push(type);
        return original.call(this, type, ...rest);
      };
    });
    await page.goto('/');
    await heroReady(page);
    expect(await page.evaluate(() => window.contexts)).toEqual([]);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(films(requests)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the first screen says what this is, from a real frame', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.thesis')).toHaveText('Every chart is flat because something was folded away.');
    const loaded = await page.locator('#hero-a').evaluate((image) => image.complete && image.naturalWidth > 0);
    expect(loaded).toBe(true);
    const box = await page.locator('h1').boundingBox();
    expect(box.y + box.height).toBeLessThan(page.viewportSize().height);
  });

  test('hover plays one film, and leaving stops it', async ({ page }) => {
    const requests = record(page);
    await page.goto('/');
    const storm = page.locator('a[href="/storm.html"]');
    await storm.scrollIntoViewIfNeeded();
    await storm.hover();
    await expect(storm).toHaveClass(/is-playing/, { timeout: 15_000 });
    expect(new Set(films(requests).map((url) => url.match(/media\/(\w+)/)[1]))).toEqual(new Set(['storm']));
    const water = page.locator('a[href="/water.html"]');
    await water.scrollIntoViewIfNeeded();
    await water.hover();
    await expect(water).toHaveClass(/is-playing/, { timeout: 15_000 });
    await expect(storm).not.toHaveClass(/is-playing/);
    expect(await page.evaluate(() => [...document.querySelectorAll('video')].filter((video) => !video.paused).length)).toBe(1);
    await page.mouse.move(2, 2);
    await expect(water).not.toHaveClass(/is-playing/);
  });

  test('keyboard focus plays the film too', async ({ page }) => {
    await page.goto('/');
    await heroReady(page);
    const storm = page.locator('a[href="/storm.html"]');
    await page.locator('a[href="/storm.html#cones"]').focus();
    await page.keyboard.press('Tab');
    await expect(storm).toBeFocused();
    await expect(storm).toHaveClass(/is-playing/, { timeout: 15_000 });
  });

  for (const [failure, respond] of [
    ['is missing', (route) => route.fulfill({ status: 404, body: '' })],
    ['cannot be reached', (route) => route.abort('failed')],
    ['is in a format the browser cannot play', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: 'not a video' })]
  ]) {
    test(`if the film ${failure}, the plate keeps its real still`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.route(/\/reveal\.(mp4|webm)/, respond);
      await page.goto('/');
      const storm = page.locator('a[href="/storm.html"]');
      await storm.scrollIntoViewIfNeeded();
      const image = storm.locator('.plate-media img');
      await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
      await storm.hover();
      await page.waitForTimeout(1500);
      await expect(storm).not.toHaveClass(/is-playing/);
      await expect(image).toBeVisible();
      expect(await storm.locator('video').evaluate((video) => getComputedStyle(video).opacity)).toBe('0');
      expect(pageErrors).toEqual([]);
    });
  }

  test('without video support the stills are all there is, and nothing breaks', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => Promise.reject(new DOMException('unsupported', 'NotSupportedError'));
    });
    await page.goto('/');
    const storm = page.locator('a[href="/storm.html"]');
    await storm.scrollIntoViewIfNeeded();
    await storm.hover();
    await page.waitForTimeout(600);
    await expect(storm).not.toHaveClass(/is-playing/);
    await expect(storm.locator('.plate-media img')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('every film starts on a decodable, non-blank first frame', async ({ page }) => {
    await page.goto('/');
    for (const piece of ['storm', 'water', 'heart', 'tides']) {
      for (const extension of ['webm', 'mp4']) {
        const source = `/media/${piece}/reveal.${extension}`;
        const type = extension === 'mp4' ? 'video/mp4; codecs="avc1.42001f"' : 'video/webm; codecs="vp9"';
        const frame = await page.evaluate(async ({ source, type }) => {
          const video = document.createElement('video');
          if (!video.canPlayType(type)) return { skipped: true };
          video.muted = true;
          video.src = source;
          await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = () => reject(new Error(video.error?.message));
          });
          // Read it the way the page does, which seeks to 0 before playing: headless
          // Chrome draws a video that has only just loaded as blank.
          video.currentTime = 0;
          await new Promise((resolve) => {
            video.onseeked = resolve;
          });
          const canvas = new OffscreenCanvas(96, 60);
          const context = canvas.getContext('2d', { willReadFrequently: true });
          context.drawImage(video, 0, 0, 96, 60);
          const { data } = context.getImageData(0, 0, 96, 60);
          let sum = 0;
          for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
          return { width: video.videoWidth, height: video.videoHeight, mean: sum / (data.length * 0.75), audio: video.mozHasAudio ?? false };
        }, { source, type });
        if (frame.skipped) continue; // bundled Chromium has no H.264
        expect(frame, source).toMatchObject({ width: 960, height: 600, audio: false });
        expect(frame.mean, source).toBeGreaterThan(3);
      }
    }
  });

  test('every image and film it can ask for exists', async ({ page, request }) => {
    await page.goto('/');
    const urls = await page.evaluate(() => [
      ...[...document.images].map((image) => image.getAttribute('src')).filter(Boolean),
      ...[...document.querySelectorAll('[data-preview]')].flatMap((a) => [`${a.dataset.preview}.mp4`, `${a.dataset.preview}.webm`]),
      '/media/hero/frames.json'
    ]);
    for (const url of urls) expect((await request.get(url)).status(), url).toBe(200);
  });

  test('the hero control folds the storm, by pointer, keyboard and end labels', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await heroReady(page);
    const range = page.locator('#hero-range');
    const stop = page.locator('#hero-stop');
    await expect(stop).toHaveText('Fourteen cones, as measured');
    await page.getByRole('button', { name: '2D: fold to the radar map' }).click();
    await expect(range).toHaveValue('0');
    await expect(stop).toContainText('Radar map');
    await page.getByRole('button', { name: '3D: unfold to the interpolated volume' }).click();
    await expect(range).toHaveValue('1');
    await expect(stop).toContainText('Interpolated volume');
    await range.focus();
    await page.keyboard.press('ArrowLeft');
    expect(Number(await range.inputValue())).toBeCloseTo(0.98, 3);
  });

  test('has no detectable accessibility violations once loaded', async ({ page }) => {
    await page.goto('/');
    await heroReady(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe('home with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('neither plays films nor moves the hero on its own', async ({ page }) => {
    const requests = record(page);
    await page.goto('/');
    await heroReady(page);
    const range = page.locator('#hero-range');
    const before = await range.inputValue();
    await page.waitForTimeout(2500);
    expect(await range.inputValue()).toBe(before);
    const storm = page.locator('a[href="/storm.html"]');
    await storm.scrollIntoViewIfNeeded();
    await storm.hover();
    await page.waitForTimeout(600);
    expect(films(requests)).toEqual([]);
    await expect(page.locator('video')).toHaveCount(0);
  });
});

test.describe('home in full motion', () => {
  test('the hero folds to the chart and reopens once, unless taken over', async ({ page }) => {
    await page.goto('/');
    await heroReady(page);
    const range = page.locator('#hero-range');
    const rest = Number(await range.inputValue());
    await expect.poll(async () => Number(await range.inputValue()), { timeout: 15_000 }).toBeLessThan(0.05);
    await expect.poll(async () => Number(await range.inputValue()), { timeout: 20_000 }).toBeGreaterThan(0.95);
    await expect.poll(async () => Number(await range.inputValue()), { timeout: 20_000 }).toBeCloseTo(rest, 1);
  });
});

for (const [name, viewport] of [['a phone', { width: 390, height: 844 }], ['a small phone', { width: 320, height: 568 }]]) {
  test.describe(`home on ${name}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test('fits the width, and a tap goes to the piece without a film', async ({ page }) => {
      const errors = watchErrors(page);
      const requests = record(page);
      await page.goto('/');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      const pulsar = page.locator('a[href="/pulsar.html"]');
      await pulsar.scrollIntoViewIfNeeded();
      await pulsar.tap();
      await expect(page).toHaveURL(/\/pulsar(\.html)?/);
      expect(films(requests)).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('how it was made', () => {
  test('plots the fourteen beams from the data, without errors', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/making.html');
    await expect(page.locator('h1')).toHaveText('How Storm Chamber was made');
    await expect(page.locator('#beam-plot polyline')).toHaveCount(14);
    expect(errors).toEqual([]);
  });

  test('is accessible and reachable from home', async ({ page }) => {
    await page.goto('/');
    await page.locator('.method a[href="/making.html"]').click();
    await expect(page).toHaveURL(/making/);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('fits the width', async ({ page }) => {
      await page.goto('/making.html');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});

test('the third-party notices ship with the site', async ({ request }) => {
  const notices = await (await request.get('/third-party-notices.txt')).text();
  expect(notices).toContain('three.js');
  expect(notices).toContain('MIT License');
  expect(notices).toContain('SIL OPEN FONT LICENSE');
});

test('every page has social metadata pointing at an image that exists', async ({ page, request }) => {
  for (const path of ['/', '/making.html', '/storm.html', '/water.html', '/heart.html', '/tides.html']) {
    await page.goto(path);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    expect((await request.get(new URL(image).pathname)).status(), path).toBe(200);
  }
});
