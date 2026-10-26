// Times are hours since 2024-09-03 00:00 UTC. Key moments of the record:
const SPRING_HIGH = 16 * 24 + 16.3; // Sep 19 16:18 UTC, highest water of the month
const NEAP_HIGH = 9 * 24 + 9.9;     // Sep 12 09:54 UTC, smallest range of the month
const SPRING_LOW = 15 * 24 + 21.8;  // Sep 18 21:48 UTC, the low water before a 7.35 m flood
const WIDEST_GAP = 19 * 24 + 22.3;  // Sep 22 22:18 UTC, 38 cm above prediction: 44 ha more under water
const AXIS = ['axis-MHHW', 'axis-MSL', 'axis-MLLW', 'axis-title'];

export const CHAPTERS = [
  {
    key: 'prologue',
    kicker: 'Prologue',
    title: 'Between Tides',
    body: 'A tide gauge at Eastport, Maine, writes the height of the sea every six minutes. Twice a day the line climbs by as much as seven and a half meters, and falls again.',
    next: 'Begin',
    camera: 'recorder',
    dim: 0,
    speed: 1.2,
    reach: 0,
    recorder: 1,
    labels: AXIS
  },
  {
    key: 'level',
    kicker: '01',
    title: 'A height, not a number',
    body: 'Every point on the curve is a height above the same datum the land is surveyed against. Carry the pen’s height sideways and it meets the ground: here, the shore at South Lubec, eight kilometers south.',
    camera: 'section',
    dim: 0,
    speed: 0.8,
    jumpTo: SPRING_LOW - 0.4,
    reach: 1,
    reachDuration: 3.4,
    recorder: 1,
    labels: ['land', 'shore']
  },
  {
    key: 'ground',
    kicker: '02',
    title: 'The ground beneath',
    body: 'Extend the section and the whole bay appears: land and seabed from lidar and sonar surveys, on the same datum as the gauge. The sea surface is nothing but the measured level, laid over the measured ground.',
    camera: 'bay',
    dim: 1,
    dimDuration: 6,
    speed: 0.6,
    reach: 1,
    labels: ['land', 'flats', 'channel']
  },
  {
    key: 'ebb',
    kicker: '03',
    title: 'Six hours',
    body: 'On the afternoon of September 19 the sea fell 7.49 meters in six hours and twenty-four minutes. On parts of this shore the waterline retreated 1.8 kilometers, and 2.2 square kilometers of seabed came up into the air.',
    camera: 'flats',
    dim: 1,
    speed: 1.1,
    jumpTo: SPRING_HIGH - 0.6,
    reach: 1,
    labels: ['flats']
  },
  {
    key: 'spring',
    kicker: '04',
    title: 'Spring and neap',
    body: 'Twice a month, when Sun and Moon pull in line, the range swells. A week before the spring tides of September 19, the range was only 3.70 meters. The amber lines on the ground mark the month’s highest and lowest water.',
    camera: 'bay',
    dim: 1,
    speed: 1.6,
    jumpTo: NEAP_HIGH - 1,
    marks: 1,
    reach: 1,
    labels: []
  },
  {
    key: 'forecast',
    kicker: '05',
    title: 'Predicted, then measured',
    body: 'The pale blue line on the ground is NOAA’s prediction from astronomy alone. This month the sea ran 15 centimeters above it on average, and up to 45 at times. On the evening of September 22 the gap kept 44 more hectares of these flats under water than the tide table expected.',
    camera: 'forecast',
    dim: 1,
    speed: 0.25,
    jumpTo: WIDEST_GAP - 0.5,
    forecast: 1,
    reach: 1,
    labels: []
  },
  {
    key: 'scale',
    kicker: '06',
    title: 'True scale',
    body: 'Until now every height was stretched eight times. At true scale the flats are almost level: their typical slope is about one meter in eighty. That is why seven and a half meters of tide uncover so much ground.',
    camera: 'bayLow',
    dim: 1,
    speed: 1,
    vert: 1,
    reach: 1,
    labels: ['flats']
  },
  {
    key: 'explore',
    kicker: 'Explore',
    title: 'Hold the month',
    body: 'Drag the month below to move through time. Drag the model to turn it, scroll to come closer.',
    camera: 'bay',
    dim: 1,
    speed: 1,
    reach: 1,
    explore: true,
    labels: ['land', 'flats', 'channel']
  }
];
