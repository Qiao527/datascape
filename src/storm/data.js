// Loads the volume scan written by scripts/storm/generate_storm.py and gives
// CPU-side access to the same numbers the shaders draw.

async function inflate(buffer) {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
}

export async function loadStorm() {
  const [meta, compressed] = await Promise.all([
    fetch('/data/storm/storm.json').then((r) => {
      if (!r.ok) throw new Error(`storm.json: ${r.status}`);
      return r.json();
    }),
    fetch('/data/storm/storm.bin').then((r) => {
      if (!r.ok) throw new Error(`storm.bin: ${r.status}`);
      return r.arrayBuffer();
    })
  ]);
  const bytes = new Uint8Array(await inflate(compressed));
  const part = ({ offset, length }) => bytes.subarray(offset, offset + length);
  return createStormData(meta, part(meta.layout.volume), part(meta.layout.low), part(meta.layout.upper));
}

export function createStormData(meta, volume, low, upper) {
  const { min, step } = meta.encoding;
  const { box } = meta;
  const dbz = (code) => (code > 0 ? min + (code - 1) * step : null);

  /** Nearest voxel at km east, km north, km above sea level. */
  function volumeCode(x, y, zMsl) {
    const i = Math.round((x - box.x0) / box.cell);
    const j = Math.round((y - box.y0) / box.cell);
    const k = Math.round((zMsl - box.z0) / box.cell);
    if (i < 0 || j < 0 || k < 0 || i >= box.nx || j >= box.ny || k >= box.nz) return -1;
    return volume[i + box.nx * (j + box.ny * k)];
  }

  /** Nearest bin of sweep `index` at slant range r and azimuth az (deg). */
  function sweepCode(index, r, az) {
    const grid = index === 0 ? meta.polar.low : meta.polar.upper;
    const g = Math.floor(r / grid.gate);
    if (g < 0 || g >= grid.ngates || r > meta.sweeps[index].rmax) return -1;
    const a = Math.floor((((az % 360) + 360) % 360) / (360 / grid.naz)) % grid.naz;
    if (index === 0) return low[a * grid.ngates + g];
    return upper[(index - 1) * grid.naz * grid.ngates + a * grid.ngates + g];
  }

  /** Strongest echo along each ray of each sweep, for the sound. */
  const rayPeaks = meta.sweeps.map((sweep, index) => {
    const grid = index === 0 ? meta.polar.low : meta.polar.upper;
    const peaks = new Float32Array(grid.naz);
    for (let a = 0; a < grid.naz; a += 1) {
      let best = 0;
      for (let g = 0; g < grid.ngates; g += 1) {
        const code = index === 0 ? low[a * grid.ngates + g] : upper[(index - 1) * grid.naz * grid.ngates + a * grid.ngates + g];
        if (code > best) best = code;
      }
      peaks[a] = dbz(best) ?? 0;
    }
    return peaks;
  });

  /** Strongest echo and echo area (>= 30 dBZ) in a horizontal slice. */
  function sliceStats(zMsl) {
    const k = Math.round((zMsl - box.z0) / box.cell);
    let best = 0;
    let area = 0;
    // The first code that decodes to 30 dBZ or more (code 84 is 29.9).
    const threshold = Math.ceil((30 - min) / step - 1e-9) + 1;
    if (k >= 0 && k < box.nz) {
      const base = box.nx * box.ny * k;
      for (let n = 0; n < box.nx * box.ny; n += 1) {
        const code = volume[base + n];
        if (code > best) best = code;
        if (code >= threshold) area += 1;
      }
    }
    return { max: dbz(best), areaKm2: area * box.cell * box.cell };
  }

  return { meta, volume, low, upper, dbz, volumeCode, sweepCode, rayPeaks, sliceStats };
}
