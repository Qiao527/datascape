# Storm Chamber: data, method and verification

Storm Chamber starts from a single weather-radar volume scan. The flat radar map is opened into the
fourteen cones the scan was measured on, and those cones are filled into a box of sky that can be cut
open. This note records where every number comes from, how it was checked, and what the piece does
not claim.

## Source

| | |
|---|---|
| Radar | WSR-88D KDDC, Dodge City, Kansas (37.7608 N, 99.9689 W; site 789 m, antenna 813 m above sea level) |
| Scan | Volume coverage pattern 212: 14 elevations from 0.49° to 19.49°, starting 00:04:55.8 UTC on 19 May 2013 (7:04:56 p.m. CDT on 18 May) and lasting 268.6 s |
| File | NOAA NEXRAD Level II `2013/05/19/KDDC/KDDC20130519_000455_V06.gz`, public bucket `unidata-nexrad-level2` on AWS |
| SHA-256 | `bfa70e3e6df82e0e05777123fae519cb95c54a76341af844cec406fde04f0c1b` (11.5 MB) |
| Tornado | NOAA NCEI Storm Events Database, event 457695 (Pawnee County, KS) |

## Pipeline

`scripts/storm/generate_storm.py` reads the Level II file with MetPy. It writes two files to
`public/data/storm/`:

- `storm.json`: the manifest. It holds the sweeps (elevation, range, scan timing), the grids, places,
  the tornado record, the sun position, and the facts quoted in the story.
- `storm.bin`: one zlib stream holding three `uint8` arrays. These are the gridded box
  `[41][161][161]`, the lowest sweep `[720 az][600 gates]` at 0.5° × 0.25 km, and the upper 13 sweeps
  `[13][360][300]` at 1° × 0.5 km.

All three arrays use the same code: 0 means no echo, and 1–255 maps to `dBZ = 5 + (code − 1) × 0.3`.
Echoes below 10 dBZ are dropped.

The generator processes the data in this order:

1. **Quality control.** It drops gates with ρhv < 0.8 unless they are ≥ 40 dBZ, then removes small
   isolated patches.
2. **Polar resampling.** Each sweep is resampled onto a regular azimuth × range grid: the nearest ray
   is taken, and gates are averaged in linear Z.
3. **Gridding.** Each voxel centre in the 80 × 80 × 20 km box (0.5 km cells) is converted to slant
   range, azimuth and elevation with the 4/3-Earth beam model. The nearest gate is taken from the two
   sweeps that bracket that elevation, and the two are interpolated linearly in dBZ. The box is left
   empty below the lowest beam and above the highest sweep that reaches the point. A light Gaussian
   smoothing (0.3–0.35 km) follows.
4. **Facts.** The strongest echo, the echo tops at 18 and 50 dBZ, and the beam height over the storm
   are all read from the sweeps themselves, not from the gridded box.

### Reproducing the data

```bash
python -m venv .venv && .venv/bin/pip install -r scripts/storm/requirements.txt
PYTHON=.venv/bin/python scripts/storm/check_reproducible.sh
```

The script runs the unmodified generator in a scratch directory. It then checks the downloaded source
against the SHA-256 above, and checks that both outputs match the committed files byte for byte. On
26 Oct 2026 the check passed with Python 3.12.13, MetPy 1.7.1, NumPy 2.5.4 and SciPy 1.18.1. CI
repeats it whenever the generator or the data change (`.github/workflows/storm-data.yml`).

## What is verified, and how

Unit tests live in `tests/unit` and run with `npm test`. They read the committed data exactly as the
browser does, then check the following.

| Check | Result |
|---|---|
| `storm.bin` hash, layout and sizes against the manifest | exact |
| No stored echo below 10 dBZ; upper sweeps empty beyond the range each one measured; box empty below the radar site | exact |
| JS beam model (`beam.js`) against the textbook 4/3-Earth formula | < 1 µm |
| `slantForGround` inverts `groundRange` | < 1 m, 0–150 km, 0–19.5° |
| JS beam height over the storm against the generator's `beamAtCoreKm` (Python) | within 5 m on all 14 sweeps |
| Gridded box against the sweeps it came from, sampled on sweeps 3, 6 and 9 | median \|Δ\| 1.5 dB, p90 ≈ 4.5 dB, 90–95 % echo overlap |
| Tornado fields against the NCEI 2013 details file (`d2013_c20260323`): EF4, 18:18–18:47 CST (00:18–00:47 UTC), 7.0 mi, 1100 yd, 0 injuries, begin and end coordinates | exact |
| Sun position against NREL SPA (`pvlib`): azimuth 281.6°, elevation 17.65° | generator gives 281.4°, 17.4° |
| Every figure in the chapter text and the About panel (60 km NE, 13 minutes, 14 sweeps, 4 min 29 s, 12–17 s per turn, ≥ 18 km, 68.5 dBZ at 5 km, 50 dBZ to 15 km, 900 m, 653 m, 813 m, 17°) | derived from the data |
| Weak-echo region at 5 km | flood fill: the no-echo pocket is enclosed by ≥ 20 dBZ (≈ 10 km²) and capped by 37 dBZ at 6 km |

The browser tests live in `tests/e2e` and run with `npm run test:e2e`. They drive the production
build in Chrome. They check that:

- every chapter loads without console errors, by keyboard and from deep links;
- the readouts quote the data;
- frames are actually drawn, using brightness statistics from real screenshots;
- the scan replay, Explore controls, pointer probe, dimension control, About dialog and sound all work;
- phone layout and full-motion camera flights work;
- on a phone and on a 1280 × 720 laptop, scene labels stay on screen, never overlap one another, and
  never sit under the chapter card, readout, legend or top bars;
- the page explains itself rather than hanging when WebGL or `DecompressionStream` is missing, or when
  the scan fails to download or is corrupt;
- the scene comes back after the GPU context is lost and restored;
- axe-core reports no accessibility violations.

Commit City and PSR B1919+21 have smoke tests in the same suite.

## Performance

Measured on Apple M1 in Chrome (ANGLE Metal) at 1440 × 900 with a device scale factor of 2:

| | median frame | p95 | dropped |
|---|---|---|---|
| With vsync, adaptive quality (what visitors get), every chapter | 16.7 ms | 17.6 ms | ≤ 1 in 240 |
| Without vsync, pixel ratio 1 | 3.1–4.0 ms | ≤ 6 ms | |
| Without vsync, pixel ratio 1.5 (the default cap) | 6.7–13.2 ms | 15–35 ms | |

The volume is ray-marched in one pass. A 4 × 4 × 4 occupancy grid lets the march skip empty space.
Sunlight and sky light are precomputed once on the CPU, because the sun does not move. When frames
run slow, the page lowers its pixel ratio (down to 0.6) and coarsens the ray-march step.

## Limitations

- **Reflectivity is not cloud.** The radar sees raindrops, hail and snow, not cloud droplets. The
  piece says so in chapter 04 and in the About panel.
- **The box between the cones is interpolated, not measured.** Interpolation runs in dBZ between
  neighbouring sweeps, so fine structure smaller than the sweep spacing is invented smoothly or lost.
- **The scan takes time.** It lasts 4.5 minutes, so the top of the storm is about four minutes
  "later" than its base. Chapter 02 shows this, but the box treats the scan as a single instant.
- **Texture filtering blends stored codes.** The sweeps and the box are sampled with linear filtering
  of the stored codes, so a strong gate beside an empty one renders a thin fringe of weaker values.
  The numeric readouts use nearest-neighbour lookups and do not have this fringe.
- **The weak-echo region is real but modest.** At 5 km it is enclosed by echo of at least 20 dBZ.
  With a 30 dBZ threshold the pocket opens to one side, and below 5 km it is not closed. The vault
  coordinates in the generator were placed by hand from the 3.2–5.2° sweeps.
- **"≥ 18 dBZ" volume quantisation.** The generator's `boxVolumeKm3Above18` counts codes from
  17.9 dBZ, which is one 0.3 dB step low. Fixing it would change the regenerated facts, so it is left
  as is. The same off-by-one step was fixed in the browser's "Echo ≥ 30 dBZ" slice readout.
- **The lighting is a rendering choice.** The smoke shading uses the sun's real position at 7:05
  p.m., but it is not a physical cloud simulation.
- **Places are approximate.** Places are positioned with a local equirectangular projection around
  the radar, which is accurate to well under 1 km within 150 km.
