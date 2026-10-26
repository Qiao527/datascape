import { describe, expect, it } from 'vitest';
import { BEAM_GLSL, EARTH_R, beamHeight, groundRange, slantForGround } from '../../src/storm/beam.js';

const RAD = Math.PI / 180;
// The textbook form of the 4/3-Earth beam height (Doviak & Zrnic 2.28b).
const direct = (r, el) => Math.sqrt(r * r + EARTH_R * EARTH_R + 2 * r * EARTH_R * Math.sin(el * RAD)) - EARTH_R;
const ELEVATIONS = [0, 0.5, 0.9, 1.3, 2.4, 4, 6.4, 10, 15.6, 19.5];

describe('4/3-Earth beam model', () => {
  it('uses the effective Earth radius 4/3 x 6371 km', () => {
    expect(EARTH_R).toBeCloseTo(8494.6667, 3);
    expect(BEAM_GLSL).toContain(`const float EARTH_R = ${EARTH_R.toFixed(4)};`);
  });

  it('matches the direct formula to well under a millimetre', () => {
    for (const el of ELEVATIONS) {
      for (let r = 0.25; r <= 230; r += 7.3) expect(Math.abs(beamHeight(r, el) - direct(r, el))).toBeLessThan(1e-6);
    }
  });

  it('gives the familiar rule-of-thumb heights', () => {
    // 0.5 deg at 100 km: r sin(el) + r^2 / (2 Re) = 0.873 + 0.589 km.
    expect(beamHeight(100, 0.5)).toBeCloseTo(1.461, 2);
    // A flat beam still climbs with range because the ground curves away.
    expect(beamHeight(150, 0)).toBeCloseTo(150 ** 2 / (2 * EARTH_R), 3);
  });

  it('measures ground range shorter than slant range, and equal near the radar', () => {
    for (const el of ELEVATIONS) {
      for (let r = 1; r <= 230; r += 11) expect(groundRange(r, el)).toBeLessThanOrEqual(r);
    }
    expect(groundRange(1, 0)).toBeCloseTo(1, 6);
    // Steep beams land a little short of the flat-Earth r cos(el): the ground curves under them.
    const flat = 50 * Math.cos(19.5 * RAD);
    expect(groundRange(50, 19.5)).toBeLessThan(flat);
    expect(flat - groundRange(50, 19.5)).toBeLessThan(0.15);
  });

  it('inverts ground range back to slant range within a metre', () => {
    for (const el of ELEVATIONS) {
      for (let s = 2; s <= 150; s += 4.1) expect(Math.abs(groundRange(slantForGround(s, el), el) - s)).toBeLessThan(1e-3);
    }
  });
});
