import * as THREE from 'three';
import { FONT_MONO } from '../shared/fonts.js';

// Two ways to color reflectivity. Smoke, the default: grey to warm white, with
// amber only where the echo is strong enough to mean hail. Data: the standard
// NWS 5-dBZ color steps, for reading values.

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const AMBER = [0.91, 0.71, 0.43];

export function smokeColor(dbz) {
  const t = smoothstep(10, 55, dbz);
  const l = 0.2 + 0.78 * Math.pow(t, 0.9);
  const grey = [l, l * 0.985, l * 0.955];
  const a = smoothstep(48, 63, dbz) * 0.9;
  return grey.map((g, i) => g + (AMBER[i] * 1.05 - g) * a);
}

export function smokeAlpha(dbz) {
  return 0.04 + 0.94 * smoothstep(10, 28, dbz);
}

export function nwsColor(dbz, palette) {
  const i = Math.min(palette.nws.length - 1, Math.max(0, Math.floor((dbz - palette.from) / palette.step)));
  return hex(palette.nws[i]);
}

/**
 * A 256 x 2 lookup texture indexed by the stored code (0 = no echo):
 * row 0 is smoke, row 1 the NWS colors. Alpha is the surface opacity.
 */
export function createPaletteTexture(meta) {
  const { min, step } = meta.encoding;
  const data = new Uint8Array(256 * 2 * 4);
  for (let code = 1; code < 256; code += 1) {
    const dbz = min + (code - 1) * step;
    const smoke = smokeColor(dbz);
    const nws = nwsColor(dbz, meta.palette);
    const a0 = smokeAlpha(dbz);
    const a1 = dbz >= meta.encoding.keep ? 1 : 0;
    data.set([...smoke.map((v) => Math.round(v * 255)), Math.round(a0 * 255)], code * 4);
    data.set([...nws.map((v) => Math.round(v * 255)), Math.round(a1 * 255)], (256 + code) * 4);
  }
  const texture = new THREE.DataTexture(data, 256, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** The dBZ scale under the scene, drawn in whichever palette is showing. */
export function createLegend(container, meta) {
  const canvas = container.querySelector('canvas');
  const caption = container.querySelector('#legend-caption');
  const ctx = canvas.getContext('2d');
  let mode = -1;
  let width = 0;

  function draw(dataMode) {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio, 2);
    if (!rect.width) return;
    width = rect.width;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const lo = 10;
    const hi = 75;
    const x = (dbz) => ((dbz - lo) / (hi - lo)) * (rect.width - 2) + 1;
    const barTop = 2;
    const barHeight = 7;
    for (let px = 0; px < rect.width; px += 1) {
      const dbz = lo + (px / rect.width) * (hi - lo);
      let rgb;
      let alpha = 1;
      if (dataMode) rgb = nwsColor(dbz, meta.palette);
      else {
        rgb = smokeColor(dbz);
        alpha = smokeAlpha(dbz);
      }
      ctx.fillStyle = `rgba(${rgb.map((v) => Math.round(v * 255)).join(',')}, ${alpha})`;
      ctx.fillRect(px, barTop, 1, barHeight);
    }
    ctx.font = `400 9.5px ${FONT_MONO}`;
    ctx.textBaseline = 'top';
    for (let dbz = 10; dbz <= 70; dbz += 10) {
      const px = Math.round(x(dbz)) + 0.5;
      ctx.fillStyle = 'rgba(236, 232, 225, 0.5)';
      ctx.fillRect(px - 0.5, barTop + barHeight, 1, 4);
      ctx.fillStyle = 'rgba(236, 232, 225, 0.55)';
      const text = String(dbz);
      ctx.fillText(text, Math.min(rect.width - ctx.measureText(text).width, Math.max(0, px - ctx.measureText(text).width / 2)), barTop + barHeight + 6);
    }
    caption.textContent = dataMode ? 'Reflectivity · dBZ · NWS colors' : 'Reflectivity · dBZ';
  }

  window.addEventListener('resize', () => draw(mode === 1));
  return {
    update(dataMode, visible) {
      container.classList.toggle('is-visible', visible);
      const next = dataMode > 0.5 ? 1 : 0;
      if (next !== mode || !width) {
        mode = next;
        requestAnimationFrame(() => draw(next === 1));
      }
    }
  };
}
