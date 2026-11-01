// Captures the home page's images and videos from the real scenes, so nothing
// on the home page is a mock-up of a piece. Playwright's fake clock steps the
// pages frame by frame, which makes the result independent of machine speed.
//
//   npm run build && npx vite preview --port 4173 --strictPort &
//   node scripts/media/capture.mjs [--only storm,water] [--base http://localhost:4173]
//
// Needs Google Chrome (for H.264 in MediaRecorder) and cwebp. Commit the output
// in public/media/; a piece's framing or light changing means running this again.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const base = option('--base', 'http://localhost:4173');
const only = option('--only', null)?.split(',');
const OUT = resolve(import.meta.dirname, '../../public/media');

const HIDE_INTERFACE = '.masthead,.topbar,.chapter,.dimension,.readout,.legend,.timeline,.scene-label,.tooltip,.title,.controls{display:none!important}';
const FPS = 30;

// Each story: the still is its reveal chapter; the film is the real transformation
// from its flat chart, started by the same control a visitor presses.
const STORIES = {
  storm: { still: 'volume', seconds: 8.6, hold: 1.2 },
  water: { still: 'wall', seconds: 7.2, hold: 1.2 },
  heart: { still: 'slow', seconds: 7.6, hold: 1.2 },
  tides: { still: 'ground', seconds: 7.6, hold: 1.2 }
};

const webp = (png, out, width, quality = 82) => execFileSync('cwebp', ['-quiet', '-q', String(quality), '-m', '6', '-resize', String(width), '0', png, '-o', out]);

async function openPiece(browser, url, { width, height, scale }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`  page error: ${error.message}`));
  await page.clock.install();
  await page.goto(`${base}${url}`);
  await page.locator('#loader').waitFor({ state: 'hidden', timeout: 120_000 });
  await page.addStyleTag({ content: HIDE_INTERFACE });
  return { context, page };
}

async function stills(browser, piece, key, dir) {
  const { context, page } = await openPiece(browser, `/${piece}.html?maxdt=1&dpr=2#${key}`, { width: 1600, height: 1000, scale: 2 });
  await page.waitForTimeout(3000);
  const png = join(dir, `${piece}-still.png`);
  await page.screenshot({ path: png });
  await context.close();
  mkdirSync(join(OUT, piece), { recursive: true });
  webp(png, join(OUT, piece, 'cover-1600.webp'), 1600);
  webp(png, join(OUT, piece, 'cover-800.webp'), 800, 78);
  mkdirSync(join(OUT, 'og'), { recursive: true });
  execFileSync('magick', [png, '-resize', '1200x', '-gravity', 'center', '-crop', '1200x630+0+0', '-quality', '84', join(OUT, 'og', `${piece}.jpg`)]);
  return png;
}

/** Steps the piece's reveal and saves one frame per step. Returns the frame paths and dimension values. */
async function film(browser, piece, seconds, hold, dir, { width, height, fps = FPS }) {
  const { context, page } = await openPiece(browser, `/${piece}.html?maxdt=1&dpr=1`, { width, height, scale: 1 });
  await page.waitForTimeout(800);
  await page.locator('.reveal-button').waitFor({ state: 'attached' });
  await page.clock.pauseAt(Date.now() + 5000);
  await page.evaluate(() => document.querySelector('.reveal-button').click());
  const frames = [];
  const values = [];
  const total = Math.round((seconds + hold) * fps);
  for (let i = 0; i < total; i += 1) {
    await page.clock.runFor(1000 / fps);
    const path = join(dir, `${piece}-${String(i).padStart(4, '0')}.jpg`);
    await page.screenshot({ path, type: 'jpeg', quality: 92 });
    frames.push(path);
    values.push(await page.evaluate(() => Number(document.querySelector('#dimension input')?.value ?? 0)));
  }
  await context.close();
  return { frames, values };
}

/** Plays frames into MediaRecorder inside Chrome: the only encoder this needs. */
async function encode(browser, frames, { width, height, mime, bitrate, fps = FPS }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const data = frames.map((path) => readFileSync(path).toString('base64'));
  const base64 = await page.evaluate(async ({ data, width, height, mime, bitrate, fps }) => {
    if (!MediaRecorder.isTypeSupported(mime)) throw new Error(`${mime} is not supported`);
    const bitmaps = await Promise.all(data.map(async (b64) => createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob())));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmaps[0], 0, 0, width, height);
    const stream = canvas.captureStream(0);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((done) => {
      recorder.onstop = done;
    });
    recorder.start();
    const track = stream.getVideoTracks()[0];
    const start = performance.now();
    for (let i = 0; i < bitmaps.length; i += 1) {
      ctx.drawImage(bitmaps[i], 0, 0, width, height);
      track.requestFrame();
      const wait = start + ((i + 1) * 1000) / fps - performance.now();
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
    }
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }, { data, width, height, mime, bitrate, fps });
  await context.close();
  return Buffer.from(base64, 'base64');
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const work = mkdtempSync(join(tmpdir(), 'datascape-media-'));
const wanted = (name) => !only || only.includes(name);

try {
  for (const [piece, { still, seconds, hold }] of Object.entries(STORIES)) {
    if (!wanted(piece)) continue;
    console.log(piece);
    await stills(browser, piece, still, work);
    const size = { width: 960, height: 600 };
    const { frames } = await film(browser, piece, seconds, hold, work, size);
    writeFileSync(join(OUT, piece, 'reveal.mp4'), await encode(browser, frames, { ...size, mime: 'video/mp4;codecs=avc1.42E01F', bitrate: 1_100_000 }));
    writeFileSync(join(OUT, piece, 'reveal.webm'), await encode(browser, frames, { ...size, mime: 'video/webm;codecs=vp9', bitrate: 800_000 }));
  }

  // The first screen: the storm folding, one image per step of the control.
  if (wanted('hero')) {
    console.log('hero');
    const dir = join(OUT, 'hero');
    mkdirSync(dir, { recursive: true });
    const { frames, values } = await film(browser, 'storm', 8.6, 0.4, work, { width: 1600, height: 1000, fps: 3 });
    const list = [];
    frames.forEach((path, i) => {
      const name = `frame-${String(i).padStart(2, '0')}`;
      execFileSync('cwebp', ['-quiet', '-q', '72', '-m', '6', path, '-o', join(dir, `${name}-1600.webp`)]);
      execFileSync('cwebp', ['-quiet', '-q', '68', '-m', '6', '-resize', '900', '0', path, '-o', join(dir, `${name}-900.webp`)]);
      list.push({ name, dimension: Number(values[i].toFixed(3)) });
    });
    // The page rests on the last frame of the pause at the cones.
    const rest = list.findLastIndex((frame) => frame.dimension <= 0.642);
    copyFileSync(join(dir, `${list[rest].name}-1600.webp`), join(dir, 'rest-1600.webp'));
    copyFileSync(join(dir, `${list[rest].name}-900.webp`), join(dir, 'rest-900.webp'));
    writeFileSync(join(dir, 'frames.json'), `${JSON.stringify({ rest, frames: list }, null, 1)}\n`);
    mkdirSync(join(OUT, 'og'), { recursive: true });
    execFileSync('magick', [frames[rest], '-resize', '1200x', '-gravity', 'center', '-crop', '1200x630+0+0', '-quality', '84', join(OUT, 'og', 'home.jpg')]);
  }

  // Figures for the making-of page: the same scan, read three other ways.
  if (wanted('making')) {
    console.log('making');
    mkdirSync(join(OUT, 'making'), { recursive: true });
    for (const key of ['prologue', 'volume', 'reflectivity', 'section']) {
      const { context, page } = await openPiece(browser, `/storm.html?maxdt=1&dpr=1.5#${key}`, { width: 1200, height: 750, scale: 1.5 });
      await page.waitForTimeout(2500);
      const png = join(work, `making-${key}.png`);
      await page.screenshot({ path: png });
      await context.close();
      webp(png, join(OUT, 'making', `${key}.webp`), 1200, 78);
    }
  }

  // The two instruments take the visitor's own input, so they get stills only.
  if (wanted('instruments')) {
    console.log('instruments');
    for (const [piece, url] of [['skyline', '/skyline.html?user=torvalds'], ['pulsar', '/pulsar.html']]) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 750 }, deviceScaleFactor: 2 });
      const page = await context.newPage();
      await page.goto(`${base}${url}`);
      await page.waitForTimeout(piece === 'skyline' ? 7000 : 6000);
      await page.addStyleTag({ content: `body > *:not(.stage):not(main), main > *:not(.stage), .labels, .tooltip { display: none !important; }` });
      await page.waitForTimeout(300);
      const png = join(work, `${piece}.png`);
      await page.screenshot({ path: png });
      await context.close();
      mkdirSync(join(OUT, piece), { recursive: true });
      webp(png, join(OUT, piece, 'cover-800.webp'), 800, 78);
    }
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
