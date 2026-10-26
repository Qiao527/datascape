// Every figure here was measured by the scan or read from the NOAA Storm
// Events record; see scripts/storm/generate_storm.py and storm.json.

const MAP_LABELS = ['radar', 'storm', 'ring-50', 'ring-100', 'ring-150', 'town-Rozel', 'town-Larned', 'town-Kinsley', 'town-Jetmore', 'town-Great Bend'];
const RULER = ['alt-5', 'alt-10', 'alt-15', 'alt-20'];

export const CHAPTERS = [
  {
    key: 'prologue',
    kicker: 'Prologue',
    title: 'Storm Chamber',
    body: 'A weather radar map from Dodge City, Kansas, at 7:05 in the evening of May 18, 2013. Sixty kilometers to the northeast stands a supercell thunderstorm. In thirteen minutes it will put a tornado on the ground.',
    next: 'Begin',
    camera: 'map',
    dim: 0,
    beam: true,
    legend: true,
    labels: MAP_LABELS
  },
  {
    key: 'cones',
    kicker: '01',
    title: 'Fourteen cones',
    body: 'The map looks flat, but the beam that drew it left the antenna half a degree above the horizon, and the ground curves away beneath it. Then the antenna tilted up through thirteen more angles, to 19.5°. Each sweep is a cone, and the storm is painted on all of them.',
    camera: 'cones',
    dim: 0.64,
    dimDuration: 5.5,
    readout: 'cones',
    legend: true,
    labels: ['radar', 'storm', 'silence']
  },
  {
    key: 'scan',
    kicker: '02',
    title: 'Four and a half minutes',
    body: 'The cones were not measured at once. Each turn of the antenna took 12 to 17 seconds, and the whole stack 4 minutes 29 seconds, from the bottom up. The top of this storm was measured four minutes after its base.',
    camera: 'scan',
    dim: 0.64,
    scan: true,
    readout: 'scan',
    legend: true,
    labels: ['radar']
  },
  {
    key: 'volume',
    kicker: '03',
    title: 'Fill the gaps',
    body: 'Nothing was measured between the cones. Cut an 80-kilometer box of sky around the storm, interpolate from each sweep to the next, and the storm becomes a solid. Its echo reached at least 18 kilometers, as high as any sweep could see this far out.',
    camera: 'volume',
    dim: 1,
    dimDuration: 4.5,
    readout: 'volume',
    labels: ['top', ...RULER]
  },
  {
    key: 'reflectivity',
    kicker: '04',
    title: 'Rain and ice, not cloud',
    body: 'The colors are reflectivity, in dBZ: how strongly raindrops and hailstones sent the pulse back. Cloud droplets are too small for this radar, so the real cloud reached farther. The strongest echo, 68.5 dBZ, sat 5 kilometers up. Echo above 50 dBZ, which at that height means hail, reached 15.',
    camera: 'data',
    dim: 1,
    data: 1,
    legend: true,
    readout: 'data',
    labels: ['core', 'hail', ...RULER]
  },
  {
    key: 'section',
    kicker: '05',
    title: 'Cut it open',
    body: 'Slice the storm 5 kilometers up and there is a hole: a pocket with almost no echo, walled in on every side. Air was rising there too fast for rain to form. This bounded weak-echo region is the mark of a supercell’s updraft.',
    camera: 'section',
    dim: 1,
    cut: 5,
    legend: true,
    readout: 'section',
    labels: ['vault', 'cut']
  },
  {
    key: 'tornado',
    kicker: '06',
    title: 'Thirteen minutes',
    body: 'At 7:18 a tornado touched down here and stayed on the ground for 29 minutes. It was rated EF4, and no one was hurt. Below the lowest beam the radar measures nothing. Here the beam’s center passed 900 meters above the fields, which is why the storm seems to float.',
    camera: 'tornado',
    dim: 1,
    tornado: 1,
    readout: 'tornado',
    labels: ['tornado', 'lowest', 'town-Rozel']
  },
  {
    key: 'explore',
    kicker: 'Explore',
    title: 'Inside the chamber',
    body: 'Drag to turn the chamber, scroll to come closer. Move the section through the storm, or switch to data colors to read the reflectivity.',
    camera: 'volume',
    dim: 1,
    explore: true,
    readout: 'explore',
    labels: ['top', ...RULER]
  }
];
