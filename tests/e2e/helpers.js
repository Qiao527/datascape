import { expect } from '@playwright/test';

/** Collects uncaught errors, console errors and failed requests on a page. */
export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

/** Opens Storm Chamber and waits for the scan to load. */
export async function openStorm(page, hash = '') {
  // Long frame steps keep tweens moving on slow software renderers. In CI the
  // volume is ray-marched on the CPU (SwiftShader), so it is drawn at half
  // resolution: same shaders and code paths, a quarter of the pixels.
  const dpr = process.env.CI ? '&dpr=0.5' : '';
  await page.goto(`/storm.html?maxdt=1${dpr}${hash}`);
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#chapter-title')).not.toBeEmpty();
}

/** The part of the viewport the scene occupies beside the chapter card. */
export function sceneClip(page) {
  const { width, height } = page.viewportSize();
  return { x: Math.round(width / 3), y: Math.round(height * 0.12), width: Math.round(width * 0.48), height: Math.round(height * 0.69) };
}

/**
 * Brightness statistics of the current frame, from a real screenshot, so a
 * black canvas (failed shader, lost context) cannot pass.
 */
export async function frameStats(page, clip) {
  const png = await page.screenshot({ clip });
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let sum = 0;
    let bright = 0;
    let warm = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      if (l > 140) bright += 1;
      if (data[i] - data[i + 2] > 60 && data[i] > 120) warm += 1;
    }
    return { mean: sum / n, bright: bright / n, warm: warm / n };
  }, png.toString('base64'));
}

/** Waits for a chapter's camera move and fades to finish. */
export async function settle(page, ms = 1200) {
  await page.waitForTimeout(ms);
}
