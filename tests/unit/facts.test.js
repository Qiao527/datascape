// Every number the story states, checked against the scan and against the
// public records it cites. If the data are regenerated and a figure moves,
// these fail before the prose goes stale.
import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../../src/storm/chapters.js';
import { beamHeight, slantForGround } from '../../src/storm/beam.js';
import { readStorm, readText } from './load.js';

const { meta, data } = readStorm();
const f = meta.facts;
const body = (key) => CHAPTERS.find((chapter) => chapter.key === key).body;
const about = readText('storm.html');
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];

describe('the record the piece cites', () => {
  it('is NOAA NCEI Storm Events event 457695 (StormEvents_details d2013, retrieved 2026-10-26)', () => {
    // BEGIN 18-MAY-13 18:18 CST-6, END 18:47, EF4, 7.0 mi, 1100 yd, no injuries or deaths.
    expect(meta.tornado).toMatchObject({
      event: 457695,
      rating: 'EF4',
      startUtc: '2013-05-19T00:18:00Z',
      endUtc: '2013-05-19T00:47:00Z',
      begin: [38.1429, -99.4706],
      end: [38.231, -99.4301],
      lengthMiles: 7,
      widthYards: 1100,
      injuries: 0,
      deaths: 0
    });
  });

  it('is the KDDC volume scan of 00:04:56 UTC in VCP 212 (14 elevations)', () => {
    expect(meta.radar.id).toBe('KDDC');
    expect(meta.radar.vcp).toBe(212);
    expect(meta.radar.lat).toBeCloseTo(37.7608, 3);
    expect(meta.radar.lon).toBeCloseTo(-99.9689, 3);
    expect(meta.startSeconds).toBeCloseTo(4 * 60 + 55.8, 1);
    expect(meta.sweeps).toHaveLength(14);
    expect(meta.sweeps[0].el).toBeCloseTo(0.5, 1);
    expect(meta.sweeps.at(-1).el).toBeCloseTo(19.5, 1);
    for (let i = 1; i < meta.sweeps.length; i += 1) {
      expect(meta.sweeps[i].el).toBeGreaterThan(meta.sweeps[i - 1].el);
      expect(meta.sweeps[i].t0).toBeGreaterThan(meta.sweeps[i - 1].t1);
    }
  });

  it('puts the sun where NREL SPA puts it (az 281.6 deg, el 17.65 deg at 38.15 N, 99.45 W)', () => {
    // pvlib.solarposition.spa_python, 2013-05-19 00:04:55.8 UTC.
    expect(Math.abs(meta.sun.azimuth - 281.6)).toBeLessThan(0.5);
    expect(Math.abs(meta.sun.elevation - 17.65)).toBeLessThan(0.5);
  });
});

describe('the story', () => {
  it('prologue: 7:05 p.m., a supercell about sixty kilometers to the northeast, thirteen minutes before touchdown', () => {
    const [cx, cy] = meta.core;
    expect(Math.round(Math.hypot(cx, cy) / 10) * 10).toBe(60);
    const bearing = (Math.atan2(cx, cy) * 180) / Math.PI;
    expect(bearing).toBeGreaterThan(22.5);
    expect(bearing).toBeLessThan(67.5);
    expect(body('prologue')).toContain('Sixty kilometers to the northeast');
    expect(body('prologue')).toContain(`In ${WORDS[Math.round(f.minutesBeforeTouchdown)]} minutes`);
    expect(Math.round(meta.startSeconds / 60)).toBe(5); // 19:05 CDT
  });

  it('cones: fourteen sweeps from half a degree to 19.5 degrees', () => {
    expect(body('cones')).toContain(`thirteen more angles, to ${meta.sweeps.at(-1).el.toFixed(1)}°`);
    expect(WORDS[meta.sweeps.length - 1]).toBe('thirteen');
  });

  it('scan: 12 to 17 seconds a turn, 4 minutes 29 seconds in all, bottom up', () => {
    const turns = meta.sweeps.map((s) => s.t1 - s.t0);
    expect(Math.floor(Math.min(...turns))).toBeGreaterThanOrEqual(12);
    expect(Math.ceil(Math.max(...turns))).toBeLessThanOrEqual(17);
    const total = Math.round(f.scanSeconds);
    expect(body('scan')).toContain(`${Math.floor(total / 60)} minutes ${total % 60} seconds`);
    expect(about).toContain(`in ${Math.floor(total / 60)} minutes ${total % 60} seconds`);
  });

  it('volume: echo reached at least 18 km, the highest any sweep reached there', () => {
    expect(f.top18Km).toBeGreaterThanOrEqual(18);
    expect(f.top18El).toBe(+meta.sweeps.at(-2).el.toFixed(2));
    expect(body('volume')).toContain('at least 18 kilometers');
  });

  it('reflectivity: 68.5 dBZ about 5 km up; 50 dBZ reached 15 km', () => {
    expect(body('reflectivity')).toContain(`${f.maxDbz.toFixed(1)} dBZ, sat ${Math.round(f.maxDbzKm)} kilometers up`);
    expect(body('reflectivity')).toContain(`reached ${Math.floor(f.top50Km)}`);
  });

  it('section: at 5 km a pocket with no echo is walled in on every side and capped above', () => {
    expect(body('section')).toContain('5 kilometers up');
    const { x, y } = f.vault;
    expect(data.volumeCode(x, y, 5)).toBe(0);
    // Flood-fill the weak pocket (< 20 dBZ) at 5 km; it must not reach the box edge.
    const { box } = meta;
    const k = Math.round((5 - box.z0) / box.cell);
    const weak = (i, j) => (data.dbz(data.volume[i + box.nx * (j + box.ny * k)]) ?? 0) < 20;
    const start = [Math.round((x - box.x0) / box.cell), Math.round((y - box.y0) / box.cell)];
    const seen = new Set([start.join()]);
    const queue = [start];
    let touchesEdge = false;
    while (queue.length) {
      const [i, j] = queue.pop();
      if (i === 0 || j === 0 || i === box.nx - 1 || j === box.ny - 1) {
        touchesEdge = true;
        break;
      }
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = [i + a, j + b];
        if (!seen.has(next.join()) && weak(...next)) {
          seen.add(next.join());
          queue.push(next);
        }
      }
    }
    expect(touchesEdge).toBe(false);
    expect(seen.size * box.cell ** 2).toBeLessThan(25);
    // A kilometre higher, echo closes over it.
    expect(data.dbz(data.volumeCode(x, y, 6))).toBeGreaterThan(30);
  });

  it('tornado: 7:18 p.m., 29 minutes, EF4, the lowest beam centre about 900 m above the fields', () => {
    expect(body('tornado')).toContain('At 7:18');
    expect(body('tornado')).toContain('29 minutes');
    expect((Date.parse(meta.tornado.endUtc) - Date.parse(meta.tornado.startUtc)) / 60000).toBe(29);
    const [bx, by] = meta.tornado.beginXY;
    const el = meta.sweeps[0].el;
    const centre = beamHeight(slantForGround(Math.hypot(bx, by), el), el) + meta.radar.antennaKm - meta.groundKm;
    expect(Math.abs(centre * 1000 - f.lowestBeamAtTouchdown.centerAboveGroundM)).toBeLessThan(3);
    expect(Math.round(f.lowestBeamAtTouchdown.centerAboveGroundM / 100) * 100).toBe(900);
    expect(body('tornado')).toContain('900 meters');
  });

  it('beam heights over the storm match the generator for every sweep', () => {
    for (const sweep of meta.sweeps) {
      if (sweep.storm.beamAtCoreKm === null) continue;
      const r = slantForGround(Math.hypot(...meta.core), sweep.el);
      expect(Math.abs(beamHeight(r, sweep.el) + meta.radar.antennaKm - sweep.storm.beamAtCoreKm)).toBeLessThan(0.006);
    }
  });

  it('about panel: ground at 653 m, antenna at 813 m, sun 17 deg above the horizon', () => {
    expect(about).toContain(`flat at ${Math.round(meta.groundKm * 1000)} m`);
    expect(about).toContain(`stands at ${Math.round(meta.radar.antennaKm * 1000)} m`);
    expect(about).toContain(`${Math.floor(meta.sun.elevation)}° above the horizon`);
  });
});
