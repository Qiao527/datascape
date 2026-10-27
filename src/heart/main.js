import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import '../shared/base.css';
import '../shared/series.css';
import './heart.css';
import { fontsReady } from '../shared/fonts.js';
import { createComposer, createRenderer } from '../shared/post.js';
import { createDimensionControl } from '../shared/dimension.js';
import { MAX_DELTA, Tween, createCameraRig, createLabels, createStory, deg, lerp, reducedMotion } from '../shared/story.js';
import { CHAPTERS } from './chapters.js';
import { PAPER, createPaper, createTwelveLead } from './paper.js';
import { createSampleTexture, createTrace } from './trace.js';

const BACKGROUND = new THREE.Color(0x070708);
const STRIP_GAIN = 2; // 20 mm/mV for the three orthogonal leads
const STRIP_BASELINES = [4.6, 0.3, -4.0];
const STRIP_COLORS = [0xf2ece2, 0xc9d6e2, 0xe8c79a];
const LOOP_COLOR = 0xf4efe6;
const HEAD_COLOR = new THREE.Color(3.2, 2.4, 1.5);

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
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();
scene.background = BACKGROUND;

const camera = new THREE.PerspectiveCamera(30, stage.clientWidth / stage.clientHeight, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 90;
controls.rotateSpeed = 0.6;
const rig = createCameraRig({ camera, controls, stage });

const { composer, resize: resizeComposer } = createComposer(renderer, scene, camera, {
  strength: 0.55,
  radius: 0.55,
  threshold: 0.95
});

const timer = new THREE.Timer();
timer.connect(document);

const state = {
  ready: false,
  meta: null,
  xyz: null,
  count: 0,
  time: 0,
  speed: new Tween(0),
  dim: new Tween(0),
  dark: new Tween(0),
  twelve: new Tween(1),
  strips: new Tween(0),
  planes: new Tween(0),
  needle: new Tween(0),
  afterimage: new Tween(0),
  traces: [],
  shadows: [],
  lastBeat: -1,
  userSpeed: null
};

let story;
let labels;
let paper;
let twelveLead;
let needle;
let tip;
let planeGrids;
let loopOrigin;
let loopScale;
let sound = null;

// ---------------------------------------------------------------------------
// Camera framings

const CAMERAS = {
  paper: () => facePaper(1.16),
  paperClose: () => ({ ...facePaper(0.66), target: [-4.6, 3.2, 0] }),
  fold: () => ({ target: loopCenter(), azimuth: deg(34), polar: deg(74), distance: 40, fov: 30 }),
  slow: () => ({ target: loopCenter(0.6), azimuth: deg(22), polar: deg(78), distance: 25, fov: 30 }),
  planes: () => ({ target: loopCenter(-1), azimuth: deg(42), polar: deg(62), distance: 44, fov: 30 }),
  beats: () => ({ target: loopCenter(), azimuth: deg(-28), polar: deg(76), distance: 30, fov: 30 }),
  explore: () => ({ target: loopCenter(), azimuth: deg(30), polar: deg(70), distance: 36, fov: 30 })
};

function facePaper(margin) {
  const fov = 30;
  const tan = Math.tan(deg(fov / 2));
  const usable = camera.aspect > 1.2 ? 0.78 : 1;
  const distance = Math.max((PAPER.height / 2) / tan, (PAPER.width / 2) / (tan * camera.aspect * usable)) * margin;
  return { target: [0, 0, 0], azimuth: 0, polar: deg(90), distance, fov, absolute: true };
}

function loopCenter(dy = 0) {
  return [loopOrigin.x + 3.2, loopOrigin.y - 1 + dy, loopOrigin.z + 0.5];
}

// ---------------------------------------------------------------------------
// Story

function enterChapter(chapter, index, { instant }) {
  const t = (seconds) => (instant ? 0.01 : seconds);
  state.dim.set(chapter.dim, t(chapter.dimDuration ?? 2.6));
  state.dark.set(chapter.paper.dark, t(2.4));
  state.twelve.set(chapter.paper.twelve, t(1.6));
  state.strips.set(chapter.strips, t(1.8));
  state.planes.set(chapter.planes ?? 0, t(2));
  state.needle.set(chapter.needle ?? 0, t(1.4));
  state.afterimage.set(chapter.afterimage ?? 0, t(2));
  state.speed.set(state.userSpeed ?? chapter.speed, t(1.2));
  labels.show(chapter.labels);
  readout.hidden = !(chapter.dim > 0.5 || chapter.strips > 0.5);

  const spec = CAMERAS[chapter.camera]();
  if (instant) rig.jumpTo(spec);
  else rig.flyTo(spec, chapter.key === 'fold' ? 5.6 : 3);
}

function extraFor(chapter) {
  if (!chapter.explore) return [];
  const speeds = document.createElement('div');
  speeds.className = 'toggles';
  const options = [[0.1, '⅒×'], [0.25, '¼×'], [0.5, '½×'], [1, '1×']];
  for (const [value, label] of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(Math.abs(state.speed.to - value) < 1e-3));
    button.addEventListener('click', () => {
      state.userSpeed = value;
      state.speed.set(value, 0.6);
      speeds.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    });
    speeds.appendChild(button);
  }
  const toggles = document.createElement('div');
  toggles.className = 'toggles';
  toggles.append(
    toggle('Shadows on planes', () => state.planes.to > 0.5, (on) => state.planes.set(on ? 1 : 0, 1.2)),
    toggle('Afterimage', () => state.afterimage.to > 0.5, (on) => state.afterimage.set(on ? 1 : 0, 1.2)),
    toggle('Vector', () => state.needle.to > 0.5, (on) => state.needle.set(on ? 1 : 0, 0.8))
  );
  const label = document.createElement('p');
  label.className = 'extra-label';
  label.textContent = 'Speed of time';
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
  labels: ['2D', '3D'],
  caption: 'Hidden dimension · space',
  onInput(value) {
    if (!state.ready) return;
    state.dim.snap(value);
    if (state.strips.to < 0.5) {
      state.strips.set(1, 0.8);
      state.twelve.set(0, 0.8);
      state.dark.set(1, 1.2);
      state.speed.set(state.userSpeed ?? 0.5, 0.8);
      readout.hidden = false;
    }
  }
});

// ---------------------------------------------------------------------------
// Scene

async function load() {
  const [meta, buffer] = await Promise.all([
    fetch('/data/heart/heart.json').then((r) => r.json()),
    fetch('/data/heart/heart.bin').then((r) => r.arrayBuffer()),
    fontsReady()
  ]);
  const view = (entry) => new Int16Array(buffer, entry.offset, entry.length);
  const xyzRaw = view(meta.layout.xyz);
  const xyz = new Float32Array(xyzRaw.length);
  for (let i = 0; i < xyz.length; i += 1) xyz[i] = xyzRaw[i] / 1000;
  return { meta, xyz, twelve: view(meta.layout.twelve), median: view(meta.layout.median) };
}

function build({ meta, xyz, twelve, median }) {
  state.meta = meta;
  state.xyz = xyz;
  state.count = xyz.length / 3;

  paper = createPaper(meta, renderer);
  scene.add(paper.mesh);
  twelveLead = createTwelveLead(twelve, meta);
  scene.add(twelveLead.object);

  // Fit the loop in front of the paper.
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const p = new THREE.Vector3();
  for (let i = 0; i < state.count; i += 1) {
    p.set(xyz[i * 3], -xyz[i * 3 + 1], -xyz[i * 3 + 2]);
    min.min(p);
    max.max(p);
  }
  const size = max.clone().sub(min);
  loopScale = 13 / Math.max(size.x, size.y, size.z);
  const center = min.clone().add(max).multiplyScalar(0.5 * loopScale);
  loopOrigin = new THREE.Vector3(0, 0.6, 5.5).sub(center);

  const samples = createSampleTexture(xyz, state.count);
  const common = { samples, count: state.count, fs: meta.fs, duration: meta.duration, origin: loopOrigin, scale: loopScale };
  for (let lead = 0; lead < 3; lead += 1) {
    const trace = createTrace({
      ...common,
      lead,
      strip: [-12.5, PAPER.speed, STRIP_BASELINES[lead], STRIP_GAIN],
      color: STRIP_COLORS[lead],
      headColor: HEAD_COLOR,
      width: 2
    });
    scene.add(trace.mesh);
    state.traces.push(trace);
  }

  // Shadows of the loop on the frontal (the paper), horizontal and sagittal planes.
  const floorY = loopOrigin.y + min.y * loopScale - 2.2;
  const wallX = loopOrigin.x + min.x * loopScale - 2.6;
  const shadowSpecs = [
    { mask: [0, 0, 1], plane: [0, 0, 0.03], name: 'frontal' },
    { mask: [0, 1, 0], plane: [0, floorY, 0], name: 'horizontal' },
    { mask: [1, 0, 0], plane: [wallX, 0, 0], name: 'sagittal' }
  ];
  for (const spec of shadowSpecs) {
    const shadow = createTrace({ ...common, lead: 0, strip: [0, 0, 0, 0], color: 0x9fb4c6, headColor: new THREE.Color(1.6, 1.2, 0.8), width: 1.4 });
    shadow.uniforms.uDim.value = 1;
    shadow.uniforms.uProjectMask.value.set(...spec.mask);
    shadow.uniforms.uProjectPlane.value.set(...spec.plane);
    shadow.uniforms.uFloor.value = 0.22;
    scene.add(shadow.mesh);
    state.shadows.push(shadow);
  }
  planeGrids = createPlaneGrids(floorY, wallX, min, max);
  scene.add(planeGrids.group);

  // The instantaneous vector: a needle from the origin to the loop.
  const needleMaterial = new LineMaterial({ color: 0xe8b66e, linewidth: 1.4, transparent: true, depthWrite: false, opacity: 0 });
  const needleGeometry = new LineGeometry();
  needleGeometry.setPositions([0, 0, 0, 0, 0, 1]);
  needle = new Line2(needleGeometry, needleMaterial);
  needle.frustumCulled = false;
  scene.add(needle);
  tip = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.1, 1.2), transparent: true }));
  scene.add(tip);
  const originDot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10), new THREE.MeshBasicMaterial({ color: 0xe8b66e, transparent: true }));
  originDot.position.copy(loopOrigin);
  needle.userData.origin = originDot;
  scene.add(originDot);

  // Labels.
  labels = createLabels(document.querySelector('#labels'), camera);
  const medianPoint = (msFromR) => {
    const i = (meta.medianR + msFromR) * 3;
    return new THREE.Vector3(median[i] / 1000, -median[i + 1] / 1000, -median[i + 2] / 1000).multiplyScalar(loopScale).add(loopOrigin);
  };
  const f = meta.fiducials;
  labels.add('p', { title: 'P', detail: 'atria', anchor: medianPoint(f.pPeak).add(new THREE.Vector3(0.3, 0.3, 0)) });
  labels.add('qrs', { title: 'QRS', detail: 'ventricles fire', anchor: medianPoint(f.r).add(new THREE.Vector3(0.3, 0.2, 0)) });
  labels.add('t', { title: 'T', detail: 'ventricles recover', anchor: medianPoint(f.tPeak).add(new THREE.Vector3(0.3, 0.3, 0)) });
  labels.add('lead-x', { title: 'X', detail: 'right to left', anchor: new THREE.Vector3(-13.2, STRIP_BASELINES[0], 0.02), side: 'left' });
  labels.add('lead-y', { title: 'Y', detail: 'head to feet', anchor: new THREE.Vector3(-13.2, STRIP_BASELINES[1], 0.02), side: 'left' });
  labels.add('lead-z', { title: 'Z', detail: 'front to back', anchor: new THREE.Vector3(-13.2, STRIP_BASELINES[2], 0.02), side: 'left' });
  labels.add('plane-frontal', { title: 'Frontal plane', anchor: new THREE.Vector3(wallX + 1, floorY + 0.6, 0.05) });
  labels.add('plane-horizontal', { title: 'Horizontal plane', anchor: new THREE.Vector3(loopOrigin.x + max.x * loopScale, floorY, loopOrigin.z + max.z * loopScale + 1) });
  labels.add('plane-sagittal', { title: 'Sagittal plane', anchor: new THREE.Vector3(wallX, loopOrigin.y + max.y * loopScale + 0.8, loopOrigin.z + 2), side: 'left' });

  document.querySelector('#about-panel button').addEventListener('click', () => toggleAbout(false));
  document.querySelector('#about').addEventListener('click', () => toggleAbout());
  document.querySelector('#sound').addEventListener('click', toggleSound);

  story = createStory({ chapters: CHAPTERS, onEnter: enterChapter, extraFor });
  state.ready = true;
  onResize();
  story.start();
}

function createPlaneGrids(floorY, wallX, min, max) {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec2 vPos;
      void main() {
        vUv = uv;
        vPos = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec2 vPos;
      void main() {
        vec2 g = abs(fract(vPos / 0.5 - 0.5) - 0.5) / fwidth(vPos / 0.5);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 e = min(vUv, 1.0 - vUv);
        float fade = smoothstep(0.0, 0.18, min(e.x, e.y));
        gl_FragColor = vec4(vec3(0.6, 0.62, 0.66) * line * 0.22 * fade * uOpacity, 1.0);
      }
    `,
    blending: THREE.AdditiveBlending
  });
  const span = Math.max(max.x - min.x, max.y - min.y) * loopScale + 8;
  const center = min.clone().add(max).multiplyScalar(0.5 * loopScale).add(loopOrigin);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span * 0.8), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, floorY, center.z);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.8, span), material);
  wall.rotation.y = Math.PI / 2;
  wall.position.set(wallX, center.y, center.z);
  group.add(floor, wall);
  return { group, material };
}

// ---------------------------------------------------------------------------
// Readout, sound

const PHASES = [
  ['pOn', 'pOff', 'P wave · atria depolarize'],
  ['qrsOn', 'qrsOff', 'QRS · ventricles depolarize'],
  ['qrsOff', 'tEnd', 'ST–T · ventricles repolarize']
];

function phaseAt(sampleIndex) {
  const { beats, fiducials } = state.meta;
  let nearest = 0;
  for (let i = 0; i < beats.length; i += 1) {
    if (Math.abs(beats[i] - sampleIndex) < Math.abs(beats[nearest] - sampleIndex)) nearest = i;
  }
  const ms = sampleIndex - beats[nearest];
  for (const [from, to, label] of PHASES) {
    if (ms >= fiducials[from] && ms < fiducials[to]) return { label, beat: nearest };
  }
  return { label: 'Electrical rest', beat: nearest };
}

function updateReadout(sampleIndex, magnitude) {
  const { label, beat } = phaseAt(sampleIndex);
  readout.querySelector('[data-field="time"]').textContent = `${(sampleIndex / state.meta.fs).toFixed(2)} s`;
  readout.querySelector('[data-field="beat"]').textContent = `Beat ${beat + 1} of ${state.meta.beats.length}`;
  readout.querySelector('[data-field="phase"]').textContent = label;
  readout.querySelector('[data-field="magnitude"]').textContent = `${magnitude.toFixed(2)} mV`;
  const speed = state.speed.value;
  readout.querySelector('[data-field="speed"]').textContent = speed < 0.01 ? 'Paused' : speed > 0.99 ? 'Real time' : `${trimSpeed(speed)} real time`;
}

function trimSpeed(speed) {
  const known = [[0.1, '⅒'], [0.2, '⅕'], [0.25, '¼'], [0.35, '⅓'], [0.5, '½']];
  const match = known.find(([value]) => Math.abs(value - speed) < 0.02);
  return match ? match[1] : `${speed.toFixed(2)}×`;
}

async function toggleSound() {
  const button = document.querySelector('#sound');
  if (!sound) {
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
    sound = { context, master, on: false };
  }
  sound.on = !sound.on;
  if (sound.on) await sound.context.resume();
  sound.master.gain.setTargetAtTime(sound.on ? 0.8 : 0, sound.context.currentTime, 0.2);
  button.setAttribute('aria-pressed', String(sound.on));
  button.textContent = sound.on ? 'Sound on' : 'Sound off';
}

/** A low, soft thump: one per R peak, slowed with time. */
function thump(stretch) {
  if (!sound?.on) return;
  const { context, master } = sound;
  const now = context.currentTime;
  const length = Math.min(1.2, 0.18 / Math.max(stretch, 0.15));
  for (const [delay, frequency, level] of [[0, 52, 0.55], [0.14 / Math.max(stretch, 0.2), 44, 0.32]]) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.setValueAtTime(frequency * 1.6, now + delay);
    osc.frequency.exponentialRampToValueAtTime(frequency, now + delay + 0.06);
    gain.gain.setValueAtTime(0.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(level, now + delay + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + length);
    osc.connect(gain).connect(master);
    osc.start(now + delay);
    osc.stop(now + delay + length + 0.05);
  }
}

function toggleAbout(force) {
  const panel = document.querySelector('#about-panel');
  const open = force ?? panel.hidden;
  panel.hidden = !open;
  document.querySelector('#about').setAttribute('aria-expanded', String(open));
}

// ---------------------------------------------------------------------------
// Loop

const sampleVector = new THREE.Vector3();

function animate(timestamp) {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), MAX_DELTA);
  const elapsed = timer.getElapsed();

  if (state.ready) {
    story.update(delta);
    for (const key of ['speed', 'dim', 'dark', 'twelve', 'strips', 'planes', 'needle', 'afterimage']) state[key].update(delta);
    dimension.sync(state.dim.value);

    const speed = reducedMotion ? Math.min(state.speed.value, 0.25) : state.speed.value;
    state.time = (state.time + delta * speed) % state.meta.duration;
    const dim = state.dim.value;

    paper.uniforms.uDark.value = state.dark.value;
    paper.uniforms.uPrintOpacity.value = state.twelve.value;
    twelveLead.material.opacity = state.twelve.value;
    twelveLead.object.visible = state.twelve.value > 0.01;

    const after = state.afterimage.value;
    state.traces.forEach((trace, lead) => {
      const u = trace.uniforms;
      u.uDim.value = dim;
      u.uTime.value = state.time;
      u.uStatic.value = speed < 0.01 ? 1 : 0;
      u.uTrail.value = lerp(lerp(2.2, 0.9, dim), 1.6, after);
      u.uFloor.value = lerp(lerp(0.16, 0.05, dim), 0.12, after);
      // In space the three strips land on the same path: keep one of them.
      const keep = lead === 0 ? 1 : 1 - Math.pow(dim, 1.5);
      u.uOpacity.value = state.strips.value * keep;
      u.uColor.value.set(STRIP_COLORS[lead]).lerp(new THREE.Color(LOOP_COLOR), dim);
    });
    for (const shadow of state.shadows) {
      shadow.uniforms.uTime.value = state.time;
      shadow.uniforms.uOpacity.value = state.planes.value * dim * 0.75;
      shadow.uniforms.uTrail.value = lerp(1.2, 2, after);
    }
    planeGrids.material.uniforms.uOpacity.value = state.planes.value * dim;

    // The heart's vector right now.
    const i = Math.min(state.count - 1, Math.floor(state.time * state.meta.fs));
    const x = state.xyz;
    sampleVector.set(x[i * 3], -x[i * 3 + 1], -x[i * 3 + 2]);
    const magnitude = sampleVector.length();
    const tipPosition = sampleVector.clone().multiplyScalar(loopScale).add(loopOrigin);
    const needleOpacity = state.needle.value * Math.pow(dim, 3) * (speed > 0.01 ? 1 : 0);
    needle.geometry.setPositions([loopOrigin.x, loopOrigin.y, loopOrigin.z, tipPosition.x, tipPosition.y, tipPosition.z]);
    needle.material.opacity = needleOpacity * 0.85;
    needle.visible = needleOpacity > 0.01;
    tip.position.copy(tipPosition);
    tip.material.opacity = Math.pow(dim, 3) * (speed > 0.01 ? 1 : 0);
    tip.visible = tip.material.opacity > 0.01;
    needle.userData.origin.material.opacity = Math.max(needleOpacity, state.planes.value * dim);

    const beat = phaseAt(i).beat;
    const r = state.meta.beats[beat];
    if (i >= r && i < r + 30 && state.lastBeat !== beat) {
      state.lastBeat = beat;
      thump(speed);
    }
    if (!readout.hidden) updateReadout(i, magnitude);

    rig.update(delta, elapsed, { sway: story.chapter.camera !== 'paper' && story.chapter.camera !== 'paperClose' });
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
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  for (const trace of [...state.traces, ...state.shadows]) {
    trace.uniforms.uResolution.value.copy(size);
    trace.uniforms.uWidth.value = (trace.uniforms.uWidth.userBase ??= trace.uniforms.uWidth.value) * renderer.getPixelRatio();
  }
  twelveLead?.setResolution(width, height);
  needle?.material.resolution.set(width, height);
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
    loader.querySelector('p').textContent = 'The recording could not be loaded. Please reload the page.';
  });
