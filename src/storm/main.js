import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../shared/base.css';
import '../shared/series.css';
import './storm.css';
import { fontsReady } from '../shared/fonts.js';
import { createComposer, createRenderer } from '../shared/post.js';
import { createDimensionControl } from '../shared/dimension.js';
import { MAX_DELTA, Tween, createCameraRig, createLabels, createStory, deg, reducedMotion } from '../shared/story.js';
import { CHAPTERS } from './chapters.js';
import { loadStorm } from './data.js';
import { beamHeight, slantForGround } from './beam.js';
import { createLegend, createPaletteTexture } from './palette.js';
import { createSweeps } from './sweeps.js';
import { createVolume } from './volume.js';
import { createGround } from './ground.js';
import { createChamber } from './chamber.js';
import { createSound } from './sound.js';

const BACKGROUND = new THREE.Color(0x0a0a0b);
const DEFAULT_VERT = 2;
const SCAN_SPEED = 30; // seconds of the scan per second on screen
const params = new URLSearchParams(location.search);
const FIXED_DPR = params.has('dpr') ? Number(params.get('dpr')) : null;

const stage = document.querySelector('#stage');
const loader = document.querySelector('#loader');
const readout = document.querySelector('#readout');

let renderer;
try {
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream is not available');
  renderer = createRenderer(stage);
} catch (error) {
  stage.innerHTML = '<p class="webgl-error">This piece needs WebGL 2 and a current browser. Try another browser or turn on hardware acceleration.</p>';
  loader.hidden = true;
  throw error;
}
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
const quality = {
  max: FIXED_DPR ?? Math.min(window.devicePixelRatio, 1.5),
  min: 0.6,
  dpr: FIXED_DPR ?? Math.min(window.devicePixelRatio, 1.5),
  time: 0,
  frames: 0,
  cooldown: 2,
  march: 1
};
renderer.setPixelRatio(quality.dpr);

const scene = new THREE.Scene();
scene.background = BACKGROUND;

const camera = new THREE.PerspectiveCamera(30, stage.clientWidth / stage.clientHeight, 0.5, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 1500;
controls.maxPolarAngle = deg(87);
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.8;
const rig = createCameraRig({ camera, controls, stage, offsetX: 0.11, offsetY: 0.12 });

const { composer, resize: resizeComposer } = createComposer(renderer, scene, camera, null);

const timer = new THREE.Timer();
timer.connect(document);

const state = {
  ready: false,
  dim: new Tween(0),
  vert: new Tween(DEFAULT_VERT),
  data: new Tween(0),
  cut: new Tween(0),
  cutKm: new Tween(5),
  tornado: new Tween(0),
  beam: new Tween(0),
  legend: false,
  readoutMode: null,
  scan: { active: false, time: 1e6, loop: true },
  beamAz: 0,
  pointer: { x: 0, y: 0, over: false }
};

let data;
let meta;
let story;
let sweeps;
let volume;
let ground;
let chamber;
let labels;
let legend;
let groundKm;
let antennaAboveGround;
const sound = createSound();

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** World y of a height in km above sea level. */
const yOf = (kmMsl) => (kmMsl - groundKm) * state.vert.value;

// ---------------------------------------------------------------------------
// Camera framings. Targets are in world units: km east, height, -km north.

function framing(key) {
  const portrait = camera.aspect < 0.8;
  const v = state.vert.to;
  const g = groundKm;
  const spec = (target, azimuth, polar, distance, extra = {}) => ({ target, azimuth: deg(azimuth), polar: deg(polar), distance, fov: 30, ...extra });
  if (portrait) {
    switch (key) {
      case 'map':
        return spec([30, 0, -30], 0, 0.5, 1180, { absolute: true });
      case 'cones':
        return spec([36, 10, -38], -24, 62, 560, { absolute: true });
      case 'scan':
        return spec([40, 9, -42], -38, 64, 500, { absolute: true });
      case 'section':
        return spec([44, (5 - g) * v, -39], -12, 36, 150, { absolute: true });
      case 'tornado':
        return spec([44, 6, -46], 22, 80, 175, { absolute: true });
      case 'data':
        return spec([44, 14, -48], 32, 66, 330, { absolute: true });
      default:
        return spec([46, 14, -54], -26, 70, 380, { absolute: true });
    }
  }
  switch (key) {
    case 'map':
      return spec([22, 0, -14], 0, 0.5, 700);
    case 'cones':
      return spec([30, 12, -32], -24, 66, 360);
    case 'scan':
      return spec([36, 10, -38], -38, 69, 300);
    case 'data':
      return spec([44, 13, -48], 32, 70, 165);
    case 'section':
      return spec([44, (5 - g) * v, -40], -12, 40, 78);
    case 'tornado':
      return spec([44, 4, -45], 22, 84, 82);
    default:
      return spec([46, 13, -54], -26, 76, 200);
  }
}

// ---------------------------------------------------------------------------
// Story

function enterChapter(chapter, index, { instant }) {
  const t = (seconds) => (instant ? 0.01 : seconds);
  state.dim.set(chapter.dim, t(chapter.dimDuration ?? 3));
  state.data.set(chapter.data ?? 0, t(1.4));
  state.cut.set(chapter.cut ? 1 : 0, t(1.6));
  if (chapter.cut) state.cutKm.set(chapter.cut, t(2.4));
  state.tornado.set(chapter.tornado ?? 0, t(1.4));
  state.beam.set(chapter.beam ? 1 : 0, t(1.2));
  state.vert.set(DEFAULT_VERT, t(2));
  state.legend = Boolean(chapter.legend);
  state.readoutMode = chapter.readout ?? null;
  state.scan.active = Boolean(chapter.scan);
  state.scan.loop = true;
  state.scan.time = chapter.scan ? -1.5 : 1e6;
  labels.show(chapter.labels ?? []);
  readout.hidden = !chapter.readout;

  const spec = framing(chapter.camera);
  if (instant) rig.jumpTo(spec);
  else rig.flyTo(spec, chapter.key === 'cones' ? 5.5 : chapter.key === 'volume' ? 4.5 : 3.2);
}

function toggle(text, get, set) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle';
  button.textContent = text;
  button.setAttribute('aria-pressed', String(get()));
  button.addEventListener('click', () => {
    const next = !get();
    set(next);
    button.setAttribute('aria-pressed', String(next));
  });
  return button;
}

function extraFor(chapter) {
  if (!chapter.explore) return [];
  const toggles = document.createElement('div');
  toggles.className = 'toggles';
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'toggle';
  replay.textContent = 'Replay the scan';
  replay.addEventListener('click', () => {
    state.dim.set(0.64, 2);
    state.cut.set(0, 0.8);
    state.scan.active = true;
    state.scan.loop = false;
    state.scan.time = -1.5;
    state.readoutMode = 'scan';
    readout.hidden = false;
    section.setAttribute('aria-pressed', 'false');
  });
  const section = toggle('Section', () => state.cut.to > 0.5, (on) => {
    state.cut.set(on ? 1 : 0, 1.2);
    if (on && state.dim.to < 1) state.dim.set(1, 2);
    state.readoutMode = on ? 'section' : 'explore';
  });
  toggles.append(
    toggle('Data colors', () => state.data.to > 0.5, (on) => state.data.set(on ? 1 : 0, 1)),
    section,
    toggle('True scale', () => state.vert.to < 1.5, (on) => state.vert.set(on ? 1 : DEFAULT_VERT, 2.2)),
    replay
  );

  const label = document.createElement('label');
  label.className = 'extra-slider';
  label.innerHTML = '<span class="extra-label">Section height</span><input type="range" min="1.5" max="18" step="0.25" /><output></output>';
  const input = label.querySelector('input');
  const output = label.querySelector('output');
  input.value = String(state.cutKm.to);
  output.textContent = `${Number(input.value).toFixed(1)} km`;
  input.addEventListener('input', () => {
    state.cutKm.snap(Number(input.value));
    output.textContent = `${Number(input.value).toFixed(1)} km`;
    if (state.cut.to < 0.5) {
      state.cut.set(1, 0.8);
      section.setAttribute('aria-pressed', 'true');
    }
    if (state.dim.to < 1) state.dim.set(1, 1.5);
    state.scan.active = false;
    state.scan.time = 1e6;
    state.readoutMode = 'section';
  });
  return [toggles, label];
}

const dimension = createDimensionControl(document.querySelector('#dimension'), {
  caption: 'Hidden dimension · height',
  onInput(value) {
    if (!state.ready) return;
    state.dim.snap(value);
    state.scan.active = false;
    state.scan.time = 1e6;
  }
});

// ---------------------------------------------------------------------------
// Readout

const field = (name) => readout.querySelector(`[data-field="${name}"]`);
const clockFormat = (seconds) => {
  // The scan started at 00:04:55.8 UTC, 19:04:55.8 CDT.
  const total = Math.max(0, meta.startSeconds + seconds) + (24 + meta.utcOffsetHours) * 3600;
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor(total / 60) % 60;
  const s = Math.floor(total % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${meta.zone}`;
};

function currentSweep(time) {
  let index = 0;
  for (let i = 0; i < meta.sweeps.length; i += 1) if (time >= meta.sweeps[i].t0) index = i;
  return index;
}

let lastReadout = '';
function setReadout(values) {
  const key = JSON.stringify(values);
  if (key === lastReadout) return;
  lastReadout = key;
  for (const [name, value] of Object.entries(values)) field(name).textContent = value;
}

function updateReadout() {
  const f = meta.facts;
  const mode = state.readoutMode === 'explore' ? (state.cut.to > 0.5 ? 'section' : 'volume') : state.readoutMode;
  const date = 'May 18, 2013';
  switch (mode) {
    case 'cones':
      setReadout({ time: `${clockFormat(0)} · ${date}`, leg: 'One volume scan', value: '14', unit: 'sweeps', k1: 'Lowest', v1: `${meta.sweeps[0].el.toFixed(1)}°`, k2: 'Highest', v2: `${meta.sweeps.at(-1).el.toFixed(1)}°` });
      break;
    case 'scan': {
      const time = Math.min(Math.max(state.scan.time, 0), f.scanSeconds);
      const i = currentSweep(time);
      const sweep = meta.sweeps[i];
      const over = sweep.storm.beamAtCoreKm;
      setReadout({
        time: clockFormat(time),
        leg: `Sweep ${i + 1} of ${meta.sweeps.length}`,
        value: `${sweep.el.toFixed(1)}°`,
        unit: 'elevation',
        k1: 'Beam over the storm',
        v1: over ? `${over.toFixed(1)} km` : 'out of range',
        k2: 'Strongest there',
        v2: sweep.storm.max ? `${sweep.storm.max.toFixed(1)} dBZ` : 'none'
      });
      break;
    }
    case 'data':
      setReadout({ time: `${clockFormat(0)} · ${date}`, leg: 'Strongest echo', value: f.maxDbz.toFixed(1), unit: 'dBZ', k1: 'Height', v1: `${f.maxDbzKm.toFixed(1)} km`, k2: 'Sweep', v2: `${f.maxDbzEl.toFixed(1)}°` });
      break;
    case 'section': {
      const km = state.cutKm.value;
      const stats = data.sliceStats(km);
      setReadout({
        time: `${clockFormat(0)} · ${date}`,
        leg: 'Horizontal section',
        value: km.toFixed(1),
        unit: 'km above sea level',
        k1: 'Strongest in slice',
        v1: stats.max ? `${stats.max.toFixed(1)} dBZ` : 'none',
        k2: 'Echo ≥ 30 dBZ',
        v2: `${Math.round(stats.areaKm2).toLocaleString('en-US')} km²`
      });
      break;
    }
    case 'tornado':
      setReadout({
        time: `19:18 ${meta.zone} · ${date}`,
        leg: 'Touchdown',
        value: `+${Math.round(f.minutesBeforeTouchdown)}`,
        unit: 'min after the scan began',
        k1: 'Lowest beam above it',
        v1: `${Math.round(f.lowestBeamAtTouchdown.centerAboveGroundM / 10) * 10} m`,
        k2: 'Rating',
        v2: `${meta.tornado.rating} · 29 min`
      });
      break;
    default:
      setReadout({
        time: `${clockFormat(0)}–${clockFormat(f.scanSeconds).slice(0, 5)} ${meta.zone}`,
        leg: 'The chamber',
        value: f.boxVolumeKm3Above18.toLocaleString('en-US'),
        unit: 'km³ of echo',
        k1: 'Box',
        v1: '80 × 80 × 20 km',
        k2: 'Grid',
        v2: `${meta.box.cell} km`
      });
  }
}

// ---------------------------------------------------------------------------
// Pointer probe: the value under the pointer, on the map or on the section.

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
const ndc = new THREE.Vector2();
renderer.domElement.addEventListener('pointermove', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  state.pointer.over = event.buttons === 0;
});
renderer.domElement.addEventListener('pointerleave', () => {
  state.pointer.over = false;
});

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function probe() {
  const row = readout.querySelector('[data-row="probe"]');
  const onMap = state.dim.value < 0.04;
  const onCut = state.cut.value > 0.5 && state.dim.value > 0.98;
  if (!state.pointer.over || readout.hidden || (!onMap && !onCut)) {
    row.hidden = true;
    return;
  }
  ndc.set(state.pointer.x, state.pointer.y);
  raycaster.setFromCamera(ndc, camera);
  plane.constant = onCut ? -yOf(state.cutKm.value) : -0.04;
  if (!raycaster.ray.intersectPlane(plane, hit)) {
    row.hidden = true;
    return;
  }
  const east = hit.x;
  const north = -hit.z;
  let code;
  let where;
  if (onCut) {
    code = data.volumeCode(east, north, state.cutKm.value);
    where = `${state.cutKm.value.toFixed(1)} km up`;
  } else {
    const s = Math.hypot(east, north);
    const az = (Math.atan2(east, north) * 180) / Math.PI;
    code = data.sweepCode(0, slantForGround(s, meta.sweeps[0].el), az);
    where = `${Math.round(s)} km ${COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16]}`;
  }
  if (code < 0) {
    row.hidden = true;
    return;
  }
  row.hidden = false;
  const value = data.dbz(code);
  field('probe').textContent = `${value === null ? 'no echo' : `${value.toFixed(1)} dBZ`} · ${where}`;
}

// ---------------------------------------------------------------------------
// About, sound

function toggleAbout(force) {
  const panel = document.querySelector('#about-panel');
  const chip = document.querySelector('#about');
  const open = force ?? panel.hidden;
  if (open === !panel.hidden) return;
  panel.hidden = !open;
  chip.setAttribute('aria-expanded', String(open));
  // Focus follows the panel in and back out to the chip that opened it.
  if (open) panel.querySelector('.about-close').focus();
  else if (panel.contains(document.activeElement) || document.activeElement === document.body) chip.focus();
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') toggleAbout(false);
});

async function toggleSound() {
  const button = document.querySelector('#sound');
  const on = await sound.toggle();
  button.setAttribute('aria-pressed', String(on));
  button.textContent = on ? 'Sound on' : 'Sound off';
}

// ---------------------------------------------------------------------------
// Build

function addLabels() {
  labels = createLabels(document.querySelector('#labels'), camera);
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const f = meta.facts;
  const lowEl = meta.sweeps[0].el;
  const bend = () => smooth(0.02, 0.3, state.dim.value);
  const lowestAt = (s) => beamHeight(slantForGround(s, lowEl), lowEl) + antennaAboveGround;

  labels.add('radar', { title: 'KDDC', detail: 'Dodge City radar', anchor: () => v3(0, antennaAboveGround * state.vert.value * bend() + 0.05, 0) });
  const [cx, cy] = meta.core;
  const coreLow = lowestAt(Math.hypot(cx, cy));
  labels.add('storm', { title: 'Supercell', detail: 'about 60 km away', anchor: () => v3(cx + 4, coreLow * state.vert.value * bend() + 0.1, -cy - 6), className: 'scene-label-up' });
  for (const s of [50, 100, 150]) {
    const a = deg(205);
    labels.add(`ring-${s}`, { title: '', detail: `${s} km`, anchor: v3(s * Math.sin(a), 0.05, -s * Math.cos(a)), className: 'axis-label' });
  }
  for (const place of meta.places) {
    labels.add(`town-${place.name}`, { title: '', detail: place.name, anchor: v3(place.x, 0.05, -place.y), className: 'town-label' });
  }
  labels.add('silence', { title: 'Cone of silence', detail: 'nothing measured above 19.5°', anchor: () => v3(0, 9 * state.vert.value, 0), side: 'left' });
  labels.add('top', {
    title: 'Echo at 18 km',
    detail: 'as high as the sweeps reach here',
    anchor: () => v3(f.top18XY[0], yOf(f.top18Km) + 0.6, -f.top18XY[1]),
    className: 'scene-label-up'
  });
  labels.add('core', { title: `${f.maxDbz.toFixed(1)} dBZ`, detail: `strongest echo, ${f.maxDbzKm.toFixed(1)} km up`, anchor: () => v3(f.maxDbzXY[0], yOf(f.maxDbzKm), -f.maxDbzXY[1]) });
  labels.add('hail', { title: '50 dBZ at 15 km', detail: 'hail, carried up by the updraft', anchor: () => v3(f.top50XY[0], yOf(f.top50Km), -f.top50XY[1]), side: 'left' });
  labels.add('vault', {
    title: 'Weak-echo region',
    detail: 'the updraft',
    anchor: () => v3(f.vault.x, yOf(state.cutKm.value) + 0.05, -f.vault.y),
    className: 'scene-label-up'
  });
  labels.add('cut', { title: '', detail: '', anchor: () => v3(volume.bounds.xMin, yOf(state.cutKm.value), -volume.bounds.nMin), side: 'left', className: 'axis-label' });
  const [bx, by] = meta.tornado.beginXY;
  labels.add('tornado', { title: 'Tornado, 7:18 p.m.', detail: 'EF4 · 29 minutes on the ground', anchor: v3(bx, 0.1, -by) });
  labels.add('lowest', {
    title: 'Lowest beam',
    detail: `its center ${Math.round(f.lowestBeamAtTouchdown.centerAboveGroundM / 10) * 10} m above the fields`,
    anchor: () => v3(bx, chamber.lowestOverTouchdown * state.vert.value, -by),
    side: 'left'
  });
  for (const km of [5, 10, 15, 20]) {
    labels.add(`alt-${km}`, { title: '', detail: `${km} km`, anchor: () => v3(volume.bounds.xMin - 2.8, yOf(km), -volume.bounds.nMin), side: 'left', className: 'axis-label' });
  }
}

function build(loaded) {
  data = loaded;
  meta = data.meta;
  groundKm = meta.groundKm;
  antennaAboveGround = meta.radar.antennaKm - groundKm;

  const sunAz = deg(meta.sun.azimuth);
  const sunEl = deg(meta.sun.elevation);
  const sunDirection = new THREE.Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl));

  const lut = createPaletteTexture(meta);
  volume = createVolume({ data, lut, groundKm, sunDirection });
  ground = createGround({ background: BACKGROUND, shadow: volume.shadow });
  sweeps = createSweeps({ data, lut, antennaAboveGround });
  chamber = createChamber({ bounds: volume.bounds, groundKm, antennaAboveGround, tornado: meta.tornado, lowestEl: meta.sweeps[0].el });
  scene.add(createSky(sunDirection), ground.mesh, sweeps.group, volume.mesh, chamber.group);

  legend = createLegend(document.querySelector('#legend'), meta);
  addLabels();

  document.querySelector('#about-panel button').addEventListener('click', () => toggleAbout(false));
  document.querySelector('#about').addEventListener('click', () => toggleAbout());
  document.querySelector('#sound').addEventListener('click', toggleSound);

  story = createStory({ chapters: CHAPTERS, onEnter: enterChapter, extraFor });
  state.ready = true;
  onResize();
  story.start();
}

/** A dark dome with a faint warm glow low in the west, where the sun was. */
function createSky(sunDirection) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(4000, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDirection }, uBackground: { value: BACKGROUND } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun;
        uniform vec3 uBackground;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          vec3 flatSun = normalize(vec3(uSun.x, 0.0, uSun.z));
          float toward = max(dot(normalize(vec3(d.x, 0.0, d.z)), flatSun), 0.0);
          float low = exp(-max(d.y, 0.0) * 9.0) * smoothstep(-0.08, 0.02, d.y);
          vec3 color = uBackground + vec3(0.075, 0.048, 0.026) * pow(toward, 5.0) * low + vec3(0.012, 0.013, 0.016) * low;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false
    })
  );
  mesh.renderOrder = -1;
  mesh.name = 'sky';
  return mesh;
}

// ---------------------------------------------------------------------------
// Loop

function adaptQuality(rawDelta) {
  if (FIXED_DPR) return;
  quality.time += rawDelta;
  quality.frames += 1;
  quality.cooldown -= rawDelta;
  if (quality.time < 1) return;
  const average = quality.time / quality.frames;
  quality.time = 0;
  quality.frames = 0;
  if (quality.cooldown > 0) return;
  let next = quality.dpr;
  if (average > 1 / 36 && quality.dpr > quality.min) next = Math.max(quality.min, quality.dpr * 0.82);
  else if (average < 1 / 58 && quality.dpr < quality.max) next = Math.min(quality.max, quality.dpr * 1.12);
  quality.march = average > 1 / 30 && quality.dpr <= quality.min + 0.01 ? 0.75 : 1;
  if (Math.abs(next - quality.dpr) > 0.01) {
    quality.dpr = next;
    quality.cooldown = 2;
    renderer.setPixelRatio(next);
    onResize();
  }
}

function animate(timestamp) {
  timer.update(timestamp);
  const rawDelta = timer.getDelta();
  const delta = Math.min(rawDelta, MAX_DELTA);
  const elapsed = timer.getElapsed();

  if (state.ready) {
    story.update(delta);
    for (const key of ['dim', 'vert', 'data', 'cut', 'cutKm', 'tornado', 'beam']) state[key].update(delta);
    dimension.sync(state.dim.value);
    adaptQuality(rawDelta);

    const dim = state.dim.value;
    const vert = state.vert.value;
    const fill = smooth(0.66, 0.97, dim);
    const scan = state.scan;
    const scanEnd = meta.facts.scanSeconds;

    // The scan replay, or the idle beam turning over the map.
    let beamOpacity = 0;
    let beamEl = meta.sweeps[0].el;
    let beamRmax = meta.sweeps[0].rmax;
    let intensity = 0.25;
    if (scan.active) {
      scan.time += delta * (reducedMotion ? SCAN_SPEED * 2 : SCAN_SPEED);
      if (scan.time > scanEnd + 4 * SCAN_SPEED) {
        if (scan.loop) scan.time = -1.5;
        else {
          scan.active = false;
          scan.time = 1e6;
        }
      }
      const i = currentSweep(Math.max(scan.time, 0));
      const sweep = meta.sweeps[i];
      if (scan.time >= sweep.t0 && scan.time <= sweep.t1) {
        state.beamAz = (sweep.az0 + ((scan.time - sweep.t0) / (sweep.t1 - sweep.t0)) * 360) % 360;
        beamEl = sweep.el;
        beamRmax = sweep.rmax;
        beamOpacity = 1;
        const peaks = data.rayPeaks[i];
        intensity = Math.pow(Math.min(1, Math.max(0, (peaks[Math.floor((state.beamAz / 360) * peaks.length) % peaks.length] - 15) / 50)), 1.3);
      } else intensity = 0.1;
    } else if (state.beam.value > 0.001) {
      const lowest = meta.sweeps[0];
      state.beamAz = (lowest.az0 + (elapsed * 360) / (lowest.t1 - lowest.t0)) % 360;
      beamOpacity = state.beam.value * (1 - smooth(0.0, 0.08, dim));
      const peaks = data.rayPeaks[0];
      intensity = Math.pow(Math.min(1, Math.max(0, (peaks[Math.floor((state.beamAz / 360) * peaks.length) % peaks.length] - 15) / 50)), 1.3) * state.beam.value;
    }
    sound.update(intensity);

    sweeps.update({
      dim,
      vert,
      dataMode: state.data.value,
      scanTime: scan.active ? scan.time : 1e6,
      glowTau: scan.active ? 0.12 * SCAN_SPEED : 3,
      beamAz: state.beamAz,
      beamGlow: state.beam.value * (1 - smooth(0.0, 0.08, dim)) * 0.8,
      fill
    });
    volume.update({ vert, opacity: fill, dataMode: state.data.value, cutKm: state.cutKm.value, cut: state.cut.value * fill, quality: quality.march });
    ground.uniforms.uScope.value = 1 - 0.55 * fill;
    ground.uniforms.uShadowAmount.value = fill * (1 - state.data.value * 0.7);
    chamber.update({
      vert,
      frameOpacity: fill,
      cutKm: state.cutKm.value,
      cutOpacity: state.cut.value * fill,
      beamAz: state.beamAz,
      beamEl,
      beamRmax,
      beamOpacity,
      tornadoOpacity: state.tornado.value
    });
    labels.setText('cut', { detail: `${state.cutKm.value.toFixed(1)} km` });
    legend.update(state.data.value, state.legend || state.data.value > 0.5 || state.cut.value > 0.5);

    if (!readout.hidden) {
      updateReadout();
      probe();
    }
    rig.update(delta, elapsed, { sway: story.chapter.camera !== 'map' && !scan.active });
    labels.update(delta, stage.clientWidth, stage.clientHeight);
  }

  composer.render();
  requestAnimationFrame(animate);
}

function onResize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  rig.applyViewOffset();
  resizeComposer(width, height);
  chamber?.setResolution(width, height);
}
window.addEventListener('resize', onResize);

onResize();
requestAnimationFrame(animate);
Promise.all([loadStorm(), fontsReady()])
  .then(([loaded]) => {
    build(loaded);
    loader.classList.add('is-done');
    setTimeout(() => {
      loader.hidden = true;
    }, 900);
  })
  .catch((error) => {
    console.error(error);
    loader.querySelector('p').textContent = 'The scan could not be loaded. Please reload the page.';
  });
