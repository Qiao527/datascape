// The guided story. Camera framings refer to keys in CAMERAS (main.js).
// Events fire at the given number of seconds after a chapter opens.

export const CHAPTERS = [
  {
    key: 'prologue',
    kicker: 'Prologue',
    title: 'The Shadow of Water',
    body: 'Every chemistry textbook has this diagram: ice, liquid and vapor, divided by three lines that meet at a single point. It looks flat. It is not.',
    next: 'Begin',
    camera: 'topPT',
    rise: 0,
    pose: 0,
    beam: 0,
    labels: []
  },
  {
    key: 'shadow',
    kicker: '01',
    title: 'It is a shadow',
    body: 'The diagram is cast straight down by a real object: the surface of every state water can be in. Across is temperature, back is pressure, and height is density, the mass packed into each cubic meter, on a logarithmic scale.',
    camera: 'rise',
    rise: 1,
    pose: 0,
    beam: 1,
    labels: []
  },
  {
    key: 'wall',
    kicker: '02',
    title: 'Every line is a wall',
    body: 'From above, the boiling line has no width. From the side it is a sheer wall where liquid and vapor exist together, at one temperature and one pressure. At sea level the wall spans a 1,600-fold change in density.',
    camera: 'wall',
    rise: 1,
    pose: 0,
    beam: 1,
    highlight: { boil: 1 },
    labels: ['liquid', 'vapor']
  },
  {
    key: 'kettle',
    kicker: '03',
    title: 'Boiling a kettle',
    body: 'Heat water at 1 atm. Its state slides across the dense plateau until it meets the wall at 100 °C, then falls down it. The temperature stops rising until the last of the water is steam. On the floor, its shadow waits on the line.',
    camera: 'kettle',
    rise: 1,
    pose: 0,
    beam: 1,
    ghost: 0.45,
    labels: [],
    events: [{ at: 2.2, play: 'kettle' }],
    replay: 'kettle'
  },
  {
    key: 'critical',
    kicker: '04',
    title: 'The wall ends',
    body: 'At 373.95 °C and 22.06 MPa the wall shrinks to nothing. Beyond this critical point, liquid and vapor are one fluid. Go around it and water becomes vapor without ever boiling.',
    camera: 'critical',
    rise: 1,
    pose: 0,
    beam: 1,
    highlight: { super: 1 },
    labels: ['critical'],
    events: [{ at: 2.4, play: 'around-critical' }],
    replay: 'around-critical'
  },
  {
    key: 'triple',
    kicker: '05',
    title: 'Three phases, one line',
    body: 'Where the walls meet, ice, liquid and vapor coexist along a single vertical line at 0.01 °C and 611.657 Pa. Seen end-on from above, the line is the triple point. Ice is only 9% less dense than water, so the step between them is too small to see.',
    camera: 'triple',
    rise: 1,
    pose: 0,
    beam: 1,
    highlight: { frost: 1 },
    labels: ['triple', 'ice']
  },
  {
    key: 'turn',
    kicker: '06',
    title: 'Another shadow',
    body: 'Turn the object on its side and the same light casts a different diagram: pressure against volume. The walls now lie flat, and their shadow is the dome every engineering student draws. Both diagrams are views of one shape.',
    camera: 'side',
    rise: 1,
    pose: 1,
    beam: 1,
    labels: [],
    events: [{ at: 4.6, camera: 'topPV', ghost: 0.18 }]
  },
  {
    key: 'explore',
    kicker: 'Explore',
    title: 'Hold it yourself',
    body: 'Drag to turn, scroll to zoom, hover to read any state. Choose a process to follow it across the surface.',
    camera: 'explore',
    rise: 1,
    pose: 0,
    beam: 1,
    explore: true,
    labels: ['ice', 'liquid', 'vapor', 'super', 'critical', 'triple']
  }
];

export const PRESETS = [
  { key: 'kettle', label: 'Kettle at sea level' },
  { key: 'everest', label: 'Summit of Everest' },
  { key: 'cooker', label: 'Pressure cooker' },
  { key: 'freeze-dry', label: 'Freeze-drying' },
  { key: 'around-critical', label: 'Around the critical point' }
];
