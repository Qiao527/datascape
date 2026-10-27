import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../shared/base.css';
import '../shared/series.css';
import './tides.css';
import { fontsReady } from '../shared/fonts.js';
import { createComposer, createRenderer } from '../shared/post.js';
import { createDimensionControl } from '../shared/dimension.js';
import { MAX_DELTA, Tween, createCameraRig, createLabels, createStory, deg, lerp, reducedMotion } from '../shared/story.js';
import { createAbout } from '../shared/about.js';
import { CHAPTERS } from './chapters.js';
import { UNIT_M, createSiteModel } from './model.js';
import { createRecorder } from './recorder.js';
import { createTimeline } from './timeline.js';

const BACKGROUND = new THREE.Color(0x0a0b0d);
const DEFAULT_VERT = 8;

const stage = document.querySelector('#stage');
const loader = document.querySelector('#loader');
const readout = document.querySelector('#readout');

let renderer;
try {
  renderer = createRenderer(stage);
} catch (error) {
  stage.innerHTML = '<p class="webgl-error">This piece needs WebGL 2. Try another browser or turn on hardware acceleration.</p>';
  loader.hidden = true;
  throw error;
}
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
scene.background = BACKGROUND;

const camera = new THREE.PerspectiveCamera(30, stage.clientWidth / stage.clientHeight, 0.05, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 3;
controls.maxDistance = 90;
controls.maxPolarAngle = deg(88);
controls.rotateSpeed = 0.6;
const rig = createCameraRig({ camera, controls, stage, offsetY: 0.06 });

// Only the pen is brighter than white, so only the pen glows.
const { composer, resize: resizeComposer } = createComposer(renderer, scene, camera, {
  strength: 0.25,
  radius: 0.5,
  threshold: 1.2
});

const timer = new THREE.Timer();
timer.connect(document);

const state = {
  ready: false,
  meta: null,
  observed: null,
  predicted: null,
  hours: 0,
  hour: 0,
  speed: new Tween(1),
  dim: new Tween(0),
  vert: new Tween(DEFAULT_VERT),
  reach: new Tween(0),
  recorder: new Tween(1),
  marks: new Tween(0),
  forecast: new Tween(0),
  sortedElevations: null,
  scrubbing: false,
  userSpeed: null
};

let story;
let model;
let recorder;
let labels;
let timeline;
let sound = null;

// ---------------------------------------------------------------------------
// Time series

function levelAt(series, hour) {
  const f = Math.min(Math.max(hour / 0.1, 0), series.length - 1.001);
  const i = Math.floor(f);
  return series[i] + (series[i + 1] - series[i]) * (f - i);
}

function maxOver(series, from, to) {
  let best = -Infinity;
  for (let h = Math.max(0, from); h <= to; h += 0.1) best = Math.max(best, levelAt(series, h));
  return best;
}

function submergedArea(level) {
  const sorted = state.sortedElevations;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < level) lo = mid + 1;
    else hi = mid;
  }
  return (lo * state.meta.terrain.cell ** 2) / 1e6;
}

// ---------------------------------------------------------------------------
// Camera framings

function CAMERAS(key) {
  const hw = model.width / 2;
  const hd = model.depth / 2;
  const recorderCenter = (recorder.left + recorder.right) / 2;
  if (camera.aspect < 0.8) {
    const spec = portraitCamera(key, hd, recorderCenter);
    if (spec) return spec;
  }
  switch (key) {
    case 'recorder':
      return { target: [recorderCenter + 0.32, 0.04, -hd], azimuth: 0, polar: deg(88), distance: 7.4, fov: 30 };
    case 'section': {
      // Chart and profile side by side, centered in the frame: the view
      // offset moves the target right of center, so aim right of the middle.
      const middle = (recorder.left + hw) / 2;
      return { target: [middle + 3.6, 0.2, -hd], azimuth: 0, polar: deg(87), distance: 40, fov: 30 };
    }
    case 'bay':
      return { target: [0.5, 0, 0.6], azimuth: deg(24), polar: deg(57), distance: 41, fov: 30 };
    case 'flats':
      return { target: [3.2, 0, -1], azimuth: deg(40), polar: deg(63), distance: 25, fov: 30 };
    case 'forecast':
      // Close over the flats where the measured and predicted waterlines part.
      return { target: [5.4, 0, -3.6], azimuth: deg(10), polar: deg(50), distance: 19, fov: 30 };
    case 'bayLow':
      return { target: [2, 0, 0], azimuth: deg(58), polar: deg(80), distance: 30, fov: 30 };
    default:
      return { target: [0, 0, 0], azimuth: deg(24), polar: deg(57), distance: 41, fov: 30 };
  }
}

/**
 * Portrait screens look along the bay from the west, so the long axis of the
 * model runs into the screen. Distances are absolute.
 */
function portraitCamera(key, hd, recorderCenter) {
  const spec = (target, azimuth, polar, distance) => ({ target, azimuth: deg(azimuth), polar: deg(polar), distance, fov: 30, absolute: true });
  switch (key) {
    case 'recorder':
      return spec([recorderCenter + 0.5, 0.04, -hd], 0, 88, 23);
    case 'section':
      // Too long for a narrow screen: keep the chart, the land and the flats.
      return spec([-7.5, 0.2, -hd], 0, 87, 92);
    case 'bay':
      return spec([0.5, 0, 0], -78, 50, 108);
    case 'flats':
      return spec([4.5, 0, -1.5], -62, 48, 64);
    case 'forecast':
      return spec([4.6, 0, -4.0], -40, 45, 44);
    case 'bayLow':
      return spec([1, 0, 0], -70, 76, 72);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Story

function enterChapter(chapter, index, { instant }) {
  const t = (seconds) => (instant ? 0.01 : seconds);
  state.dim.set(chapter.dim, t(chapter.dimDuration ?? 2.6));
  state.vert.set(chapter.vert ?? DEFAULT_VERT, t(3));
  state.reach.set(chapter.reach, t(chapter.reachDuration ?? 2.2));
  state.recorder.set(chapter.recorder ?? 0, t(1.8));
  state.marks.set(chapter.marks ?? 0, t(1.6));
  state.forecast.set(chapter.forecast ?? 0, t(1.6));
  state.speed.set(state.userSpeed ?? chapter.speed, t(1));
  if (chapter.jumpTo != null) state.hour = chapter.jumpTo;
  labels.show(chapter.labels);
  readout.hidden = index === 0;
  timeline.setVisible(index >= 2);

  const spec = CAMERAS(chapter.camera);
  if (instant) rig.jumpTo(spec);
  else rig.flyTo(spec, chapter.key === 'ground' ? 5.6 : chapter.key === 'level' ? 4 : 3);
}

function extraFor(chapter) {
  if (!chapter.explore) return [];
  const label = document.createElement('p');
  label.className = 'extra-label';
  label.textContent = 'Hours per second';
  const speeds = document.createElement('div');
  speeds.className = 'toggles';
  for (const value of [0, 0.25, 1, 3]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle';
    button.textContent = value === 0 ? 'Pause' : `${value}`;
    button.setAttribute('aria-pressed', String(Math.abs(state.speed.to - value) < 1e-3));
    button.addEventListener('click', () => {
      state.userSpeed = value;
      state.speed.set(value, 0.5);
      speeds.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    });
    speeds.appendChild(button);
  }
  const toggles = document.createElement('div');
  toggles.className = 'toggles';
  toggles.append(
    toggle('Month’s extremes', () => state.marks.to > 0.5, (on) => state.marks.set(on ? 1 : 0, 1)),
    toggle('Prediction', () => state.forecast.to > 0.5, (on) => state.forecast.set(on ? 1 : 0, 1)),
    toggle('True scale', () => state.vert.to < 1.5, (on) => state.vert.set(on ? 1 : DEFAULT_VERT, 2.4))
  );
  return [label, speeds, toggles];
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

const dimension = createDimensionControl(document.querySelector('#dimension'), {
  caption: 'Hidden dimension · ground',
  onInput(value) {
    if (!state.ready) return;
    state.dim.snap(value);
    state.reach.set(1, 0.6);
    state.recorder.set(0, 0.6);
  }
});

// ---------------------------------------------------------------------------
// Readout

const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

function updateReadout(level, trend) {
  const { meta } = state;
  const date = new Date(Date.parse(meta.start) + state.hour * 3600e3);
  const parts = dateFormat.format(date);
  readout.querySelector('[data-field="date"]').textContent = `${parts} EDT`;
  readout.querySelector('[data-field="trend"]').textContent = trend > 0.004 ? 'Rising' : trend < -0.004 ? 'Falling' : 'Turning';
  readout.querySelector('[data-field="level"]').textContent = `${level >= 0 ? '+' : '−'}${Math.abs(level).toFixed(2)} m`;
  readout.querySelector('[data-field="mllw"]').textContent = `${(level - meta.datums.MLLW).toFixed(2)} m`;
  readout.querySelector('[data-field="area"]').textContent = `${submergedArea(level).toFixed(2)} km²`;
  const showPrediction = state.forecast.to > 0.5;
  readout.querySelector('[data-row="prediction"]').hidden = !showPrediction;
  if (showPrediction) {
    const gap = level - levelAt(state.predicted, state.hour);
    readout.querySelector('[data-field="residual"]').textContent = `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(2)} m`;
  }
}

// ---------------------------------------------------------------------------
// Sound: a quiet, slow surf whose loudness follows the rising water.

async function toggleSound() {
  const button = document.querySelector('#sound');
  if (!sound) {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    const length = context.sampleRate * 6;
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const data = buffer.getChannelData(c);
      let brown = 0;
      for (let i = 0; i < length; i += 1) {
        brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = brown * 3;
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const swell = context.createGain();
    swell.gain.value = 0.5;
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.09;
    const depth = context.createGain();
    depth.gain.value = 0.35;
    lfo.connect(depth).connect(swell.gain);
    source.connect(filter).connect(swell).connect(master);
    source.start();
    lfo.start();
    sound = { context, master, filter, on: false };
  }
  sound.on = !sound.on;
  if (sound.on) await sound.context.resume();
  sound.master.gain.setTargetAtTime(sound.on ? 0.6 : 0, sound.context.currentTime, 0.4);
  button.setAttribute('aria-pressed', String(sound.on));
  button.textContent = sound.on ? 'Sound on' : 'Sound off';
}

// ---------------------------------------------------------------------------
// Build

async function load() {
  const [meta, buffer] = await Promise.all([
    fetch('/data/tides/tides.json').then((r) => r.json()),
    fetch('/data/tides/tides.bin').then((r) => r.arrayBuffer()),
    fontsReady()
  ]);
  const { layout, terrain } = meta;
  const quantized = new Uint16Array(buffer, layout.terrain.offset, layout.terrain.length);
  const heights = new Float32Array(quantized.length);
  const [z0, z1] = terrain.zRange;
  for (let i = 0; i < heights.length; i += 1) heights[i] = z0 + (quantized[i] / 65535) * (z1 - z0);
  const toMeters = (entry) => Float32Array.from(new Int16Array(buffer, entry.offset, entry.length), (v) => v / 1000);
  return { meta, heights, observed: toMeters(layout.observed), predicted: toMeters(layout.predicted) };
}

function build({ meta, heights, observed, predicted }) {
  state.meta = meta;
  state.observed = observed;
  state.predicted = predicted;
  state.hours = (observed.length - 1) * 0.1;
  state.sortedElevations = Float32Array.from(heights).sort();
  state.hour = 15 * 24 + 4;
  state.revealX = 1e3;

  model = createSiteModel(meta, heights);
  scene.add(model.object);

  const hw = model.width / 2;
  const hd = model.depth / 2;
  recorder = createRecorder({ observed, predicted, intervalHours: 0.1, datums: meta.datums, left: -hw - 4.6, right: -hw - 0.35, z: -hd });
  scene.add(recorder.object);

  // A dark plinth floor.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(80, 64),
    new THREE.ShaderMaterial({
      uniforms: {
        uNear: { value: new THREE.Color(0x131518) },
        uFar: { value: BACKGROUND }
      },
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        void main() {
          vXZ = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uNear;
        uniform vec3 uFar;
        varying vec2 vXZ;
        void main() {
          // A dim plinth under the model that dissolves into the background.
          float r = length(vXZ * vec2(0.8, 1.0));
          gl_FragColor = vec4(mix(uNear, uFar, smoothstep(10.0, 34.0, r)), 1.0);
        }
      `
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';
  scene.add(floor);
  model.object.userData.floor = floor;

  labels = createLabels(document.querySelector('#labels'), camera);
  // Labels ride on the section while it is a single profile, then settle
  // onto the open bay as the section extends.
  const at = (x, z, lift = 0.12) => () => {
    const zz = lerp(-hd, z, state.dim.value);
    return new THREE.Vector3(x, model.toY(Math.max(model.elevationAt(x, zz), levelAt(observed, state.hour))) + lift, zz);
  };
  labels.add('land', { title: 'South Lubec', detail: 'woods and fields', anchor: at(-13.1, -5), side: 'left', className: 'scene-label-up' });
  labels.add('flats', { title: 'The flats', detail: 'under water at high tide', anchor: at(2.4, -3.2), className: 'scene-label-up' });
  labels.add('channel', { title: 'Lubec Channel', detail: 'toward Quoddy Narrows', anchor: at(11.5, 4.5), className: 'scene-label-up' });

  // On the section: where the carried level meets the ground.
  const shore = new THREE.Vector3();
  labels.add('shore', {
    title: 'Waterline',
    detail: 'the level meets the ground',
    className: 'scene-label-up',
    anchor: () => {
      const level = levelAt(observed, state.hour);
      const x = model.waterlineX(level, -hd) ?? hw;
      return shore.set(Math.min(x, state.revealX), model.toY(level), -hd + 0.03);
    }
  });

  // The gauge chart's axis: tidal datums at the right edge, a title on top.
  const axis = (meters) => () => new THREE.Vector3(recorder.right + 0.06, (meters * state.vert.value) / UNIT_M, -hd);
  const signed = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} m`;
  for (const key of ['MHHW', 'MSL', 'MLLW']) {
    labels.add(`axis-${key}`, { title: '', detail: `${key} ${signed(meta.datums[key])}`, anchor: axis(meta.datums[key]), className: 'axis-label' });
  }
  labels.add('axis-title', {
    title: '',
    detail: 'Eastport · water level · m above NAVD88',
    anchor: () => new THREE.Vector3(recorder.left + 0.12, (recorder.highM * state.vert.value) / UNIT_M + 0.07, -hd),
    className: 'axis-label'
  });

  timeline = createTimeline(document.querySelector('#timeline'), {
    observed,
    meta,
    onScrub(hour, active) {
      state.hour = hour;
      state.scrubbing = active;
    }
  });

  createAbout();
  document.querySelector('#sound').addEventListener('click', toggleSound);

  story = createStory({ chapters: CHAPTERS, onEnter: enterChapter, extraFor });
  state.ready = true;
  onResize();
  story.start();
}

// ---------------------------------------------------------------------------
// Loop

function animate(timestamp) {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), MAX_DELTA);
  const elapsed = timer.getElapsed();

  if (state.ready) {
    story.update(delta);
    for (const key of ['speed', 'dim', 'vert', 'reach', 'recorder', 'marks', 'forecast']) state[key].update(delta);
    dimension.sync(state.dim.value);

    const speed = reducedMotion ? Math.min(state.speed.value, 0.25) : state.speed.value;
    if (!state.scrubbing) state.hour = (state.hour + delta * speed) % state.hours;
    const level = levelAt(state.observed, state.hour);
    const trend = levelAt(state.observed, state.hour + 0.2) - levelAt(state.observed, state.hour - 0.2);
    const vert = state.vert.value;

    const u = model.uniforms;
    u.uVert.value = vert;
    u.uLevel.value = level;
    u.uRecentHigh.value = maxOver(state.observed, state.hour - 3, state.hour);
    u.uCut.value = Math.max(0.0005, state.dim.value);
    u.uTime.value = elapsed;
    u.uMarks.value.z = state.marks.value;
    u.uPredicted.value = levelAt(state.predicted, state.hour);
    u.uShowPrediction.value = state.forecast.value;
    model.object.userData.floor.position.y = model.toY(state.meta.terrain.zRange[0]) - 0.01;

    const reach = lerp(recorder.penX, model.width / 2, state.reach.value);
    state.revealX = state.reach.value > 0.999 ? 1e3 : reach;
    u.uReveal.value = state.revealX;
    const recorderOpacity = Math.max(state.recorder.value, 1 - state.dim.value);
    recorder.update({ hour: state.hour, level, vert, reach, showForecast: state.forecast.value, opacity: recorderOpacity });
    timeline.update(state.hour);
    if (!readout.hidden) updateReadout(level, trend);
    if (sound?.on) sound.filter.frequency.setTargetAtTime(380 + 520 * Math.max(0, (level + 3.5) / 7.5), sound.context.currentTime, 0.5);

    rig.update(delta, elapsed, { sway: story.chapter.camera !== 'recorder' && story.chapter.camera !== 'section' });
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
  recorder?.setResolution(width, height);
}
window.addEventListener('resize', onResize);

onResize();
requestAnimationFrame(animate);
load()
  .then((data) => {
    build(data);
    loader.classList.add('is-done');
    setTimeout(() => {
      loader.hidden = true;
    }, 900);
  })
  .catch((error) => {
    console.error(error);
    loader.querySelector('p').textContent = 'The record could not be loaded. Please reload the page.';
  });

export { UNIT_M };
