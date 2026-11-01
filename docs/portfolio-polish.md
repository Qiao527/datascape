# Portfolio polish: audit, changes and verification

Branch `feat/datascape-polish`, from `b89ff11`, November 2026. All figures are from Apple M1 in Google
Chrome (ANGLE Metal), on the production build, on this date.

## Baseline, before any change

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | 42 passed |
| `npm run build` | passed |
| `npm run test:e2e` | 44 passed, in 4.2 min |

## What the audit found

**Visual.** The home page showed hand-drawn SVGs, not the work, and gave six pieces equal weight. Storm
Chamber's strongest image, the stacked cones, passed in under a second on the way to an overexposed
volume with no readable interior. The Shadow of Water was a pale plane with little form. Chapter text
lost contrast over paper and plaster. Water had 900 drifting dust points that said nothing about water.

**Bugs.**
- Dragging Water's Dimension Control threw a `TypeError`: its local `Tween` had no `snap`. No test covered it.
- On Storm, Heart and Tides, arrow keys on a focused Dimension Control also changed the chapter, and its
  step was 0.001, so it could hardly be moved by keyboard at all.
- Water ignored `hashchange`, unlike the other three, and dropped the query string when it wrote the hash.
- Short screens (a phone held sideways, 320 × 568): the readout, legend and Tides' month chart sat on top of the chapter.
- Water's process presets clipped on phones.

**Science.**
| Where | Was | Problem | Now |
|---|---|---|---|
| Water, chapter 05 | ice "9% less dense" | the committed data give 8.3% (9% is how much denser water is than ice) | "8%", with a unit test |
| Heart, home card, chapter 01 | twelve traces "are projections of one moving point" | overclaims; the loop does not come from them | the 12 leads are flat views; the loop is from Frank X, Y, Z recorded separately |
| Heart, chapter 02 | "Three are enough", "three perpendicular axes" | implies 12 leads reduce to 3; Frank leads are only near-orthogonal | "Three more leads", "roughly perpendicular" |
| Heart, chapter 03 and About | "the heart's electrical field" | the dipole approximation was unstated | one arrow summing up the field; not the heart's shape or how activation spreads |
| Storm, chapter 05 | "air was rising there too fast" | reflectivity does not measure wind | "radar does not measure the wind here. The standard reading is…" |
| Storm, chapter 04, label | echo "means hail" | no hail classification behind it | "almost certainly hail" |
| Water, chapter 01 | "every state water can be in" | only stable states in this range are shown | "every stable state of water across this range" |
| Tides, About | tide at Lubec "within minutes" of Eastport | no source could be found | the model assumes Eastport's level applies unchanged, and says so |
| Tides, chapter 05 | gap above prediction implied to be weather | datums are 1983–2001, so slow sea-level change may contribute | named as a possibility, not asserted |

**Checked and correct:** 7.49 m in 6 h 24 min; 2.2 km² uncovered; mean residual 15 cm; both tide and
ground on NAVD88; 1,600-fold density change at 1 atm; ECG record is a healthy control.

## What changed

**Home.** The first screen is Storm Chamber's own transformation: 27 rendered frames under the Dimension
Control. It rests on the cones, folds to the map and reopens once, and any input ends that. Four stories
get real stills, and hover or keyboard focus plays the recorded transformation, one film at a time.
Instruments are a compact list. No WebGL runs on this page, and a test holds it to that.

**Stories.** One-step reveal from each prologue, each with its own verb and motion: "Open the storm" (which
pauses at the cones), "Raise the surface", "Fold time away", "Carry the level ashore". Each reveal chapter
states what is measured, interpolated, or not modeled. All chapters and deep links are unchanged.

**Dimension Control.** Named stops under the track, spoken through `aria-valuetext`; ticks at those stops;
2D and 3D are buttons; arrows and page keys move it in useful steps; long jumps ease rather than cut.

**Storm.** Thinner smoke so the interior reads; the flat map's own ramp carried into the volume; amber for
echo past about 50 dBZ, stated in About as a data contour; a low camera for scale; quieter weak echo in
NWS colors, without changing a color.

**Water.** Dark scribed plate instead of a pale plane. Brightness follows density; isolines are lighter
than the surface, with 10 K tie lines on the walls; a low side camera puts the wall over the line it casts.
No data or mapping changed. Dust removed.

**Also.** A chapter backdrop that holds over bright scenes; a still of the scene when WebGL is missing;
`/making.html`, the Storm case study, whose beam plot is drawn live by the piece's own `beam.js` and
`storm.json`; Open Graph images; `docs/licenses.md`.

## Performance

**Storm, baseline against this build:** full tables in `docs/storm-chamber.md`, raw data in `docs/polish/perf/`.
The volume and tornado chapters are measurably heavier: about 3.5–5.5 ms a frame at a fixed pixel ratio. Adaptive
quality holds them at 58–59 fps by rendering at a lower resolution. A palette lookup that was wasted is gone,
image-identical, but that gain is unmeasured.

**Home, first load, on `vite preview`, which does not compress** (so JS and CSS are smaller when deployed):

| Condition | First load | With hero frames | Largest paint | Films |
|---|---|---|---|---|
| Desktop, 10 Mbps, 40 ms | 242 kB | 1.8 MB | 192 ms (the `h1`) | 0 |
| Phone, 1.6 Mbps, 150 ms, 3× | 319 kB | 866 kB | 1.82 s (hero image) | 0 |

Baseline home-page load was not measured, so no before/after is claimed. Frames wait for `load` and idle,
and are skipped under data saver. `public/media` is 10 MB in all, almost all fetched on request.

## Before and after

`docs/polish/`: `home-before.jpg` / `home-after.jpg`, `home-phone-before.jpg` / `home-phone-after.jpg`,
`storm-volume-before.jpg` / `storm-volume-after.jpg`, `water-before.jpg` / `water-after.jpg`.

## Media compatibility

| Check | Result |
|---|---|
| MP4 codec | H.264 Baseline, level 3.1 (`avc1.42001f`), 960 × 600, no audio, read from each file's `avcC` box |
| MP4 structure | Fragmented, `moov` at the start, three `moof` fragments |
| Sizes | MP4 1.0–1.2 MB, WebM 0.64–0.81 MB, each 8–10 s |
| WebKit 27.2, Playwright's build, headless, macOS | All 8 files load, play and decode a non-blank first frame; hover preview plays and stops; all 4 stories start with no page errors |
| Film missing, unreachable, or undecodable; `play()` rejected | The real still stays, nothing throws (tests in `home.spec.js`) |
| Reduced motion, data saver, touch | No film is requested, the still stays |

## Not done, and not verified

- **Real Safari, iOS Safari and Firefox were not tested.** The WebKit result above is Playwright's build of the
  engine on macOS, not Safari, and says nothing about iOS.
- **No physical phone, and no real screen reader.** Phones were emulated in Chrome; accessibility is axe-core
  plus keyboard tests.
- **Data reproducibility was not rerun**, since no generator or data file changed. CI will run it on push because
  `scripts/**` changed.
- **The palette-lookup speedup is unmeasured.** Performance testing was stopped by decision at this point.
- **Tides and Heart have copy, framing and shared-control work only.** Tides' water material and the transition
  from curve to water were not reworked, and Heart's trace was not.
- **No root LICENSE:** the owner's decision, in `docs/licenses.md`.
