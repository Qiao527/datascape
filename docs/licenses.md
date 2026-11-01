# What Datascape is built from, and on what terms

An inventory, not legal advice. **The repository has no root `LICENSE`, so the project's own code is
under default copyright.** Choosing a license is the owner's decision, and nothing here makes it.

Versions and license fields were read from `node_modules` and from PyPI metadata in November 2026.

## Shipped to visitors

| What | Version | Terms | How the duty is met |
|---|---|---|---|
| three.js | 0.186.1 | MIT | The minifier strips its notice from the bundle, so the full text ships at `/third-party-notices.txt`, linked from the home page |
| Instrument Serif, via Fontsource | 5.3.0 | SIL OFL 1.1 | Same file. The fonts are not sold alone |
| Inter Variable, via Fontsource | 5.3.0 | SIL OFL 1.1 | As above |
| JetBrains Mono, via Fontsource | 5.3.0 | SIL OFL 1.1 | As above |

`public/third-party-notices.txt` is assembled from each package's own `LICENSE`. Refresh it when one of
these dependencies changes.

## Data on screen

| What | Source | Terms | Attribution |
|---|---|---|---|
| Radar scan KDDC20130519_000455_V06 | NOAA NEXRAD Level II | US government work | Cited in the About panel and README; not legally required |
| Tornado record, event 457695 | NOAA NCEI Storm Events | US government work | As above |
| Tide levels and predictions, 8410140 | NOAA CO-OPS | US government work | As above |
| Terrain, CUDEM 1/9 arc-second | NOAA NCEI | US government work | As above |
| ECG, patient122/s0312lre | PTB Diagnostic ECG Database 1.0.0, PhysioNet | ODC Attribution 1.0 | **Required.** In `heart.html`, the README and `heart.json`. Keep the wording below with `public/data/heart/` |
| Water properties | Computed from IAPWS-95, R10-06, R14-08 | Published formulations | Cited in the About panel, README and `surface.json` |
| Commit City cover | Public GitHub calendar of `torvalds` | Public profile data | A capture of a public page; replace it if you prefer your own |

Stills and films in `public/media/` are captures of this project's own scenes. They carry the terms of
the data they show, and the project's own terms once it has any. The PTB attribution applies to anything
showing the Electric Heart's signal.

### Attribution wording to keep with published data

> **Water (`public/data/water/`).** Fluid properties: IAPWS-95, evaluated with CoolProp 8.0.0. Ice Ih:
> IAPWS R10-06(2009). Sublimation and melting pressures: IAPWS R14-08(2011). Ice and boundary values
> evaluated with the iapws 1.5.5 Python package (GPLv3), which is not part of this repository.
>
> **ECG (`public/data/heart/`).** Derived from the PTB Diagnostic ECG Database 1.0.0, record
> patient122/s0312lre (Bousseljot, Kreiseler and Schnabel, 1995), via PhysioNet (Goldberger et al.,
> *Circulation* 101(23), 2000), under the Open Data Commons Attribution License v1.0. Filtered and
> resampled; see `scripts/heart/generate_heart.py`.

## Used only to make things, not shipped

| What | Version | Terms | Where |
|---|---|---|---|
| **iapws** | 1.5.5 | **GPLv3** (PyPI metadata and the package's `LICENSE`) | `scripts/water/generate_surface.py`, see below |
| CoolProp | 8.0.0 | MIT | `scripts/water/` |
| MetPy | 1.7.1 | BSD-3-Clause | `scripts/storm/` |
| NumPy | 2.5.4 | BSD-3-Clause, with bundled 0BSD, MIT, Zlib, CC0 parts | generators |
| SciPy | 1.18.1 | BSD-3-Clause family | generators |
| imagecodecs, tifffile | 2026.10.10, 2026.10.15 | BSD-3-Clause | `scripts/tides/` |
| Vite, Vitest, ESLint | see `package-lock.json` | MIT | development |
| Playwright | 1.64.1 | Apache-2.0 | tests, media capture |
| axe-core, @axe-core/playwright | 4.14.0 | MPL-2.0 | tests |

## The iapws question

What was checked, against the iapws 1.5.5 source distribution:

| Question | Finding |
|---|---|
| Is it installed with the site? | No. It appears only in `scripts/requirements.txt`, not in `package.json` or the bundle |
| Where is it imported? | One file, `scripts/water/generate_surface.py`, which imports `_Ice`, `_Melting_Pressure` and `_Sublimation_Pressure` |
| Was its code copied into this repository? | No sign of it. `p_sub` and `p_melt` call the library; `t_melt` and `t_sub` invert those calls with this project's own bisection. Its melting-curve coefficients appear nowhere in `src/` or `scripts/` |
| Does the frontend use it? | No. JavaScript reads only the numbers in `surface.bin` and `surface.json`; "sublimation" and "melting" there are names of phases |
| Is its code in the data files? | No. They hold numeric results and a version string |

What follows, as a reading of the GPL rather than legal advice:

- **`public/data/water/`** is program output, which the GPL does not generally cover unless a program copies
  part of itself into its output, and this one does not. The underlying equations are published IAPWS
  formulations. Credit iapws with the wording above.
- **The built site** contains no iapws code, so it does not carry GPL duties from it.
- **`scripts/water/generate_surface.py`** is the one open point. It does not contain iapws, and the repository
  does not distribute iapws, but a program that imports a GPL library is treated by some, including the FSF, as
  a combined work when distributed together with it. So whatever license is chosen should be compatible with
  GPLv3 for this file. MIT, BSD and Apache-2.0 are; a proprietary or non-commercial license is doubtful.
- **To remove the question entirely:** reimplement those three functions directly from the published IAPWS
  releases, and check that the data still reproduce byte for byte. Not done, because it changes a generator.

## Decisions needed from the owner

1. A license for the code. Until one is chosen, others may read this code but not reuse it. Separate terms for
   the media and data may be useful, since they cannot simply be relicensed: the PTB-derived parts stay under ODC-BY.
2. Whether the choice for `generate_surface.py` should be GPLv3-compatible, or the three functions reimplemented.
3. Whether the Commit City cover should show your own calendar. It uses `torvalds` because a dense year makes a
   legible city; `Qiao527` renders correctly but sparsely.
