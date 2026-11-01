// Screenshots every chapter of every story, without the interface, so framing
// and light can be judged. Usage: node scripts/media/survey.mjs <out> [base]
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:4173';
const PIECES = {
  storm: ['prologue', 'cones', 'scan', 'volume', 'reflectivity', 'section', 'tornado', 'explore'],
  water: ['prologue', 'shadow', 'wall', 'kettle', 'critical', 'triple', 'turn', 'explore'],
  heart: ['prologue', 'directions', 'axes', 'fold', 'slow', 'planes', 'beats', 'explore'],
  tides: ['prologue', 'level', 'ground', 'ebb', 'spring', 'forecast', 'scale', 'explore']
};
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const [piece, keys] of Object.entries(PIECES)) {
  for (const key of keys) {
    await page.goto('about:blank'); // a fresh load: a hash change alone would animate
    await page.goto(`${base}/${piece}.html?maxdt=1&dpr=1.5#${key}`);
    await page.locator('#loader').waitFor({ state: 'hidden', timeout: 90_000 });
    await page.addStyleTag({ content: '.masthead,.topbar,.chapter,.dimension,.readout,.legend,.timeline,.scene-label{display:none!important}' });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${out}/${piece}-${key}.png` });
    console.log(piece, key);
  }
}
await browser.close();
