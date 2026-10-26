import { describe, expect, it } from 'vitest';
import { createPaletteTexture, nwsColor, smokeAlpha, smokeColor } from '../../src/storm/palette.js';
import { readStorm } from './load.js';

const { meta } = readStorm();
const hex = (rgb) => `#${rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;

describe('palette', () => {
  it('steps through the NWS colors every 5 dBZ from 5 dBZ', () => {
    expect(hex(nwsColor(5, meta.palette))).toBe('#00ecec');
    expect(hex(nwsColor(22, meta.palette))).toBe('#00ff00'); // 20-25
    expect(hex(nwsColor(52, meta.palette))).toBe('#ff0000'); // 50-55
    expect(hex(nwsColor(69.9, meta.palette))).toBe('#ff00ff'); // 65-70
    expect(hex(nwsColor(72, meta.palette))).toBe('#9955c9'); // 70-75
    expect(hex(nwsColor(90, meta.palette))).toBe('#ffffff');
    expect(hex(nwsColor(-10, meta.palette))).toBe('#00ecec');
  });

  it('makes smoke brighter and more opaque as the echo strengthens, amber only near hail', () => {
    let last = -1;
    for (let dbz = 10; dbz <= 75; dbz += 0.5) {
      const a = smokeAlpha(dbz);
      expect(a).toBeGreaterThanOrEqual(last);
      last = a;
    }
    const grey = smokeColor(35);
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(0.05);
    const hail = smokeColor(65);
    expect(hail[0] - hail[2]).toBeGreaterThan(0.3);
  });

  it('builds a 256 x 2 lookup with code 0 transparent and sub-10 dBZ hidden in data colors', () => {
    const texture = createPaletteTexture(meta);
    const { data, width, height } = texture.image;
    expect([width, height]).toEqual([256, 2]);
    expect(Array.from(data.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(data.subarray(256 * 4, 256 * 4 + 4))).toEqual([0, 0, 0, 0]);
    const code = (dbz) => Math.round((dbz - meta.encoding.min) / meta.encoding.step) + 1;
    expect(data[(256 + code(8)) * 4 + 3]).toBe(0);
    expect(data[(256 + code(30)) * 4 + 3]).toBe(255);
  });
});
