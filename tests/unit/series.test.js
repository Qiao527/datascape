// The data behind The Shadow of Water, The Electric Heart and Between Tides:
// each binary is read the way its page reads it, and the physical numbers are
// checked against the published reference values, not against themselves.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const buffer = (path) => {
  const bytes = readFileSync(new URL(path, root));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
};

/** Entries tile the file: in bounds, aligned, back to back, nothing left over. */
function expectTiles(entries, byteLength, bytesPer) {
  const sorted = [...entries].sort((a, b) => a.offset - b.offset);
  let end = 0;
  for (const { offset, length, size = bytesPer } of sorted) {
    expect(offset % size).toBe(0);
    expect(offset).toBe(end);
    end = offset + length * size;
  }
  expect(end).toBe(byteLength);
}

describe('The Shadow of Water', () => {
  const meta = json('public/data/water/surface.json');
  const bin = buffer('public/data/water/surface.bin');
  const entries = [
    ...meta.patches.flatMap((p) => [p.T, p.logP, p.logRho]),
    ...meta.curtains.flatMap((c) => [c.T, c.logP, c.logRhoLow, c.logRhoHigh])
  ];

  it('stores float32 arrays that tile surface.bin, one value per grid node', () => {
    expectTiles(entries, bin.byteLength, 4);
    for (const patch of meta.patches) {
      for (const key of ['T', 'logP', 'logRho']) expect(patch[key].length).toBe(patch.cols * patch.rows);
    }
  });

  it('holds only finite values inside the declared domain', () => {
    for (const patch of meta.patches) {
      const T = new Float32Array(bin, patch.T.offset, patch.T.length);
      const logP = new Float32Array(bin, patch.logP.offset, patch.logP.length);
      const logRho = new Float32Array(bin, patch.logRho.offset, patch.logRho.length);
      for (let i = 0; i < T.length; i += 1) {
        expect(Number.isFinite(T[i] + logP[i] + logRho[i])).toBe(true);
        expect(T[i]).toBeGreaterThanOrEqual(meta.domain.T[0] - 1e-3);
        expect(T[i]).toBeLessThanOrEqual(meta.domain.T[1] + 1e-3);
        expect(logRho[i]).toBeGreaterThanOrEqual(meta.domain.logRho[0] - 1e-3);
        expect(logRho[i]).toBeLessThanOrEqual(meta.domain.logRho[1] + 1e-3);
      }
    }
  });

  it('puts the critical and triple points where IAPWS-95 and IAPWS R10-06 do', () => {
    const { critical, triple, oneAtm } = meta.points;
    expect(critical.T).toBeCloseTo(647.096, 3); // K
    expect(10 ** critical.logP / 1e6).toBeCloseTo(22.064, 2); // MPa
    expect(10 ** critical.logRho).toBeCloseTo(322, 0); // kg/m3
    expect(triple.T).toBeCloseTo(273.16, 2);
    expect(10 ** triple.logP).toBeCloseTo(611.657, 0); // Pa
    expect(10 ** triple.logRhoLiquid).toBeCloseTo(999.79, 0);
    expect(10 ** triple.logRhoIce).toBeCloseTo(916.7, 0);
    expect(10 ** triple.logRhoVapor).toBeCloseTo(0.00485, 4);
    // Water boils at 99.97 degC under one standard atmosphere (ITS-90).
    expect(10 ** oneAtm.logP).toBeCloseTo(101325, -1);
    expect(oneAtm.Tsat - 273.15).toBeCloseTo(99.97, 1);
  });
});

describe('The Electric Heart', () => {
  const meta = json('public/data/heart/heart.json');
  const bin = buffer('public/data/heart/heart.bin');

  it('is PTB record patient122/s0312lre, a healthy control', () => {
    expect(meta.source).toMatchObject({ record: 'patient122/s0312lre', subject: 'healthy control' });
    expect(meta.fs).toBe(1000); // the PTB database's sampling rate
    expect(meta.leads).toEqual(['i', 'ii', 'iii', 'avr', 'avl', 'avf', 'v1', 'v2', 'v3', 'v4', 'v5', 'v6']);
  });

  it('stores int16 arrays whose lengths follow from leads, duration and sampling rate', () => {
    const { twelve, xyz, median } = meta.layout;
    expectTiles([twelve, xyz, median], bin.byteLength, 2);
    expect(twelve.length).toBe(12 * meta.duration * meta.displayFs);
    expect(xyz.length).toBe(3 * meta.duration * meta.fs);
    expect(median.length).toBe(3 * meta.medianLength);
  });

  it('reports a heart rate that matches its own R peaks', () => {
    const rr = meta.beats.slice(1).map((r, i) => r - meta.beats[i]); // ms at 1000 Hz
    const mean = rr.reduce((sum, x) => sum + x, 0) / rr.length;
    expect(60000 / mean).toBeCloseTo(meta.heartRate, 0);
    expect(meta.heartRate).toBeGreaterThan(50);
    expect(meta.heartRate).toBeLessThan(100);
  });

  it('orders the waves of the median beat P, QRS, T', () => {
    const f = meta.fiducials;
    const order = [f.pOn, f.pPeak, f.pOff, f.qrsOn, f.r, f.qrsOff, f.tPeak, f.tEnd];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(f.qrsOff - f.qrsOn).toBeLessThan(120); // a normal QRS is under 120 ms
  });
});

describe('Between Tides', () => {
  const meta = json('public/data/tides/tides.json');
  const bin = buffer('public/data/tides/tides.bin');
  const { terrain, observed, predicted } = meta.layout;
  const metres = (entry) => Array.from(new Int16Array(bin, entry.offset, entry.length), (v) => v / 1000);

  it('is NOAA CO-OPS station 8410140, Eastport, every six minutes for 30 days, on NAVD88', () => {
    expect(meta.station).toMatchObject({ id: '8410140', name: 'Eastport, Maine' });
    expect(meta.datum).toBe('NAVD88');
    expect(meta.intervalMinutes).toBe(6);
    expect(meta.count).toBe((30 * 24 * 60) / 6);
  });

  it('tiles tides.bin with the terrain grid and both water-level series', () => {
    expectTiles([{ ...terrain, size: 2 }, { ...observed, size: 2 }, { ...predicted, size: 2 }], bin.byteLength, 2);
    expect(terrain.length).toBe(meta.terrain.nx * meta.terrain.nz);
    expect(observed.length).toBe(meta.count);
    expect(predicted.length).toBe(meta.count);
  });

  it('agrees with its own summary: extremes, datums and the 7.49 m range', () => {
    const levels = metres(observed);
    const max = Math.max(...levels);
    const min = Math.min(...levels);
    expect(max).toBeCloseTo(meta.observedMax.value, 3);
    expect(min).toBeCloseTo(meta.observedMin.value, 3);
    expect(levels.indexOf(max) * 0.1).toBeCloseTo(meta.observedMax.hour, 1);
    const d = meta.datums;
    expect([d.MLLW, d.MLW, d.MSL, d.MHW, d.MHHW]).toEqual([...[d.MLLW, d.MLW, d.MSL, d.MHW, d.MHHW]].sort((a, b) => a - b));
    // The largest fall from one high water to the next low, as chapter 03 tells it.
    let range = 0;
    for (let i = 1; i < meta.extrema.length; i += 1) {
      const [a, b] = [meta.extrema[i - 1], meta.extrema[i]];
      if (a.kind === 'high' && b.kind === 'low') range = Math.max(range, a.value - b.value);
    }
    expect(range).toBeCloseTo(meta.rangeMax, 3);
    expect(meta.rangeMax).toBeCloseTo(7.49, 2);
  });

  it('keeps the prediction close to the measurement (the residual is surge, not error)', () => {
    const o = metres(observed);
    const p = metres(predicted);
    const residual = o.map((v, i) => v - p[i]);
    const rms = Math.sqrt(residual.reduce((s, r) => s + r * r, 0) / residual.length);
    expect(rms).toBeLessThan(0.25);
    expect(Math.max(...residual.map(Math.abs))).toBeLessThan(0.6);
  });
});
