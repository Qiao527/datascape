import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../shared/base.css';
import '../shared/series.css';
import { fontsReady } from '../shared/fonts.js';
import { createComposer, createRenderer } from '../shared/post.js';
import { loadWaterData } from './data.js';
import { createSurface } from './surface.js';
import { drawPTDiagram, drawPVDiagram } from './diagrams.js';
import { createStage } from './stage.js';
import { createProcessPlayer } from './process.js';
import { createLabels } from './labels.js';
import { createSound } from './sound.js';
import { CHAPTERS, PRESETS } from './chapters.js';
import { BASE_Y, POSE_B, logPToZ, logRhoToY, tToX, xToT, yToLogRho, zToLogP } from './mapping.js';
import { formatDensity, formatPressure, formatTemperature, phaseName, trim } from './format.js';
import { createDimensionControl } from '../shared/dimension.js';

const BACKGROUND = new THREE.Color(0x0b0b0d);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Longest step the animation may take in one frame. ?maxdt= raises it for
// slow software renderers (used by the screenshot checks).
const MAX_DELTA = Number(new URLSearchParams(location.search).get('maxdt')) || 0.1;

const stage = document.querySelector('#stage');
const loader = document.querySelector('#loader');
const ui = {
  chapter: document.querySelector('#chapter'),
  kicker: document.querySelector('#chapter-kicker'),
  title: document.querySelector('#chapter-title'),
  body: document.querySelector('#chapter-body'),
  extra: document.querySelector('#chapter-extra'),
  prev: document.querySelector('#prev'),
  next: document.querySelector('#next'),
  dots: document.querySelector('#dots'),
  readout: document.querySelector('#readout'),
  tooltip: document.querySelector('#tooltip'),
  labels: document.querySelector('#labels'),
  sound: document.querySelector('#sound'),
  about: document.querySelector('#about'),
  aboutPanel: document.querySelector('#about-panel')
};

// ---------------------------------------------------------------------------
// Small animation helpers

const smooth = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));

class Tween {
  constructor(value) {
    this.value = value;
    this.from = value;
    this.to = value;
    this.elapsed = 0;
    this.duration = 0;
  }

  set(to, duration) {
    if (to === this.to && this.elapsed >= this.duration) return;
    this.from = this.value;
    this.to = to;
    this.elapsed = 0;
    this.duration = reducedMotion ? Math.min(duration, 0.4) : duration;
  }

  update(delta) {
    if (this.elapsed >= this.duration) {
      this.value = this.to;
      return;
    }
    this.elapsed += delta;
    this.value = lerp(this.from, this.to, easeInOut(Math.min(1, this.elapsed / this.duration)));
  }
}

// ---------------------------------------------------------------------------
// Renderer, scene, camera

let renderer;
try {
  renderer = createRenderer(stage);
} catch (error) {
  stage.innerHTML = '<p class="webgl-error">This piece needs WebGL 2. Try another browser or turn on hardware acceleration.</p>';
  loader.hidden = true;
  throw error;
}
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = BACKGROUND;
const fog = { color: BACKGROUND, density: 0.0065 };

const camera = new THREE.PerspectiveCamera(30, stage.clientWidth / stage.clientHeight, 0.1, 600);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 120;
controls.maxPolarAngle = THREE.MathUtils.degToRad(86);
controls.rotateSpeed = 0.6;

const { composer, resize: resizeComposer } = createComposer(renderer, scene, camera, {
  strength: 0.32,
  radius: 0.7,
  threshold: 0.86
});

const timer = new THREE.Timer();
timer.connect(document);

const objectGroup = new THREE.Group();
scene.add(objectGroup);

const state = {
  data: null,
  surface: null,
  stageView: null,
  player: null,
  labels: null,
  chapter: -1,
  chapterTime: 0,
  firedEvents: new Set(),
  rise: new Tween(0),
  pose: new Tween(0),
  beam: new Tween(0),
  ghost: new Tween(1),
  highlight: { boil: 0, frost: 0, super: 0 },
  highlightTarget: { boil: 0, frost: 0, super: 0 },
  camera: null,
  userInteracting: false,
  lastInteraction: 0,
  pointer: new THREE.Vector2(),
  pointerClient: { x: 0, y: 0 },
  pointerInside: false,
  frame: 0,
  exploreProcess: null
};

const sound = createSound();

// The series control: 0 is the flat textbook diagram, 1 the full surface.
const dimension = createDimensionControl(document.querySelector('#dimension'), {
  caption: 'Hidden dimension · density',
  onInput(value) {
    if (!state.data) return;
    if (state.pose.to > 0.5) state.pose.set(0, 2);
    state.rise.snap(value);
    state.beam.set(value > 0.05 ? 1 : 0, 1);
  }
});

// ---------------------------------------------------------------------------
// Camera framings

const deg = THREE.MathUtils.degToRad;

/** Wider than tall screens use the framings as authored; narrower ones back off. */
function framingScale() {
  const aspect = camera.aspect;
  return aspect >= 1.45 ? 1 : Math.pow(1.45 / aspect, 0.85);
}

function topDown(bounds, margin = 1.08) {
  const halfW = (bounds[2] - bounds[0]) / 2;
  const halfD = (bounds[3] - bounds[1]) / 2;
  const fov = 28;
  const tan = Math.tan(deg(fov / 2));
  const usable = camera.aspect > 1.2 ? 0.78 : 1;
  const distance = Math.max(halfD / tan, halfW / (tan * camera.aspect * usable)) * margin;
  return {
    target: [(bounds[0] + bounds[2]) / 2, 0, (bounds[1] + bounds[3]) / 2],
    azimuth: 0,
    polar: 0.0005,
    distance,
    fov,
    absolute: true
  };
}

const CAMERAS = {
  topPT: () => topDown(state.stageView.ptBounds),
  topPV: () => topDown(state.stageView.pvBounds, 1.04),
  rise: () => ({ target: [0, 5.4, -0.5], azimuth: deg(22), polar: deg(60), distance: 47, fov: 32 }),
  wall: () => ({ target: [-0.6, 7.6, -2.6], azimuth: deg(30), polar: deg(64), distance: 42, fov: 32 }),
  kettle: () => ({ target: [-5.2, 6.4, -1.6], azimuth: deg(28), polar: deg(52), distance: 27, fov: 32 }),
  critical: () => ({ target: [5.4, 9.8, -5.0], azimuth: deg(36), polar: deg(62), distance: 25, fov: 32 }),
  triple: () => ({ target: [-9.0, 9.6, 2.4], azimuth: deg(34), polar: deg(70), distance: 18, fov: 32 }),
  side: () => ({ target: [0, 12.5, 0], azimuth: deg(38), polar: deg(68), distance: 58, fov: 32 }),
  explore: () => ({ target: [0, 5.5, -0.5], azimuth: deg(18), polar: deg(58), distance: 46, fov: 32 })
};

function framingFor(spec) {
  const scale = spec.absolute ? 1 : framingScale();
  return { ...spec, distance: spec.distance * scale, target: new THREE.Vector3(...spec.target) };
}

const spherical = new THREE.Spherical();
function currentFraming() {
  const offset = camera.position.clone().sub(controls.target);
  spherical.setFromVector3(offset);
  return { target: controls.target.clone(), azimuth: spherical.theta, polar: spherical.phi, distance: spherical.radius, fov: camera.fov };
}

function flyTo(spec, duration = 2.8) {
  const to = framingFor(spec);
  const from = currentFraming();
  let azimuth = to.azimuth;
  while (azimuth - from.azimuth > Math.PI) azimuth -= Math.PI * 2;
  while (azimuth - from.azimuth < -Math.PI) azimuth += Math.PI * 2;
  state.camera = {
    from,
    to: { ...to, azimuth },
    elapsed: 0,
    duration: reducedMotion ? 0.01 : duration
  };
  controls.enabled = false;
}

function jumpTo(spec) {
  const to = framingFor(spec);
  applyFraming(to);
  state.camera = null;
}

const offset = new THREE.Vector3();
function applyFraming({ target, azimuth, polar, distance, fov }) {
  controls.target.copy(target);
  offset.setFromSphericalCoords(distance, polar, azimuth);
  camera.position.copy(target).add(offset);
  camera.fov = fov;
  camera.updateProjectionMatrix();
  camera.lookAt(target);
}

function updateCamera(delta, elapsed) {
  const move = state.camera;
  if (move) {
    move.elapsed += delta;
    const t = easeInOut(Math.min(1, move.elapsed / move.duration));
    const { from, to } = move;
    applyFraming({
      target: from.target.clone().lerp(to.target, t),
      azimuth: lerp(from.azimuth, to.azimuth, t),
      polar: lerp(from.polar, to.polar, t),
      distance: Math.exp(lerp(Math.log(from.distance), Math.log(to.distance), t)),
      fov: lerp(from.fov, to.fov, t)
    });
    if (t >= 1) {
      state.camera = null;
      controls.enabled = true;
    }
    return;
  }

  // A slow breath of motion while nobody is touching anything.
  const idle = elapsed - state.lastInteraction > 2.5 && !state.userInteracting;
  const chapter = CHAPTERS[state.chapter];
  if (idle && !reducedMotion && chapter && chapter.camera !== 'topPT' && !(chapter.key === 'turn' && state.firedEvents.size)) {
    const sway = deg(0.9) * Math.cos(elapsed * 0.12) * delta * 0.12;
    offset.copy(camera.position).sub(controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, sway);
    camera.position.copy(controls.target).add(offset);
  }
  controls.update();
}

// Desktop: keep the subject clear of the chapter card on the left.
function applyViewOffset() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  if (width > 900) camera.setViewOffset(width, height, -width * 0.11, 0, width, height);
  else camera.setViewOffset(width, height, 0, height * 0.14, width, height);
}

// ---------------------------------------------------------------------------
// Story

function buildDots() {
  ui.dots.replaceChildren(...CHAPTERS.map((chapter, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dot';
    button.setAttribute('aria-label', chapter.title);
    button.addEventListener('click', () => goTo(index));
    return button;
  }));
}

function goTo(index, { instant = false } = {}) {
  index = Math.max(0, Math.min(CHAPTERS.length - 1, index));
  if (index === state.chapter) return;
  const chapter = CHAPTERS[index];
  state.chapter = index;
  state.chapterTime = 0;
  state.firedEvents = new Set();
  state.exploreProcess = null;

  state.player.stop();
  ui.readout.hidden = true;
  sound.setBoiling(null);

  const duration = instant ? 0.01 : 1;
  state.rise.set(chapter.rise, index === 1 && !instant ? 3.6 : 1.6 * duration);
  state.pose.set(chapter.pose, instant ? 0.01 : 3.8);
  state.beam.set(chapter.beam, instant ? 0.01 : 2.4);
  state.ghost.set(chapter.ghost ?? 1, instant ? 0.01 : 1.6);
  state.highlightTarget = { boil: 0, frost: 0, super: 0, ...(chapter.highlight ?? {}) };
  state.labels.show(chapter.labels);

  const spec = CAMERAS[chapter.camera]();
  if (instant) jumpTo(spec);
  else flyTo(spec, chapter.key === 'turn' ? 4.2 : index === 1 ? 4.4 : 3);

  renderChapter(chapter, index);
  history.replaceState(null, '', `#${chapter.key}`);
}

function renderChapter(chapter, index) {
  ui.chapter.classList.add('is-changing');
  setTimeout(() => {
    ui.kicker.textContent = chapter.kicker === 'Prologue' || chapter.kicker === 'Explore'
      ? chapter.kicker
      : `${chapter.kicker} / ${String(CHAPTERS.length - 2).padStart(2, '0')}`;
    ui.title.textContent = chapter.title;
    ui.body.textContent = chapter.body;
    ui.extra.replaceChildren(...extraFor(chapter));
    ui.next.textContent = chapter.next ?? (index === CHAPTERS.length - 1 ? 'Restart' : 'Next');
    ui.prev.hidden = index === 0;
    [...ui.dots.children].forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    ui.chapter.dataset.chapter = chapter.key;
    ui.chapter.classList.remove('is-changing');
  }, 260);
}

function extraFor(chapter) {
  const nodes = [];
  if (chapter.replay) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'text-button';
    button.textContent = 'Replay';
    button.addEventListener('click', () => playProcess(chapter.replay));
    nodes.push(button);
  }
  if (chapter.explore) {
    const list = document.createElement('div');
    list.className = 'presets';
    for (const preset of PRESETS) {
      const process = state.data.processes.find((item) => item.key === preset.key);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.key = preset.key;
      button.innerHTML = '<span></span><small></small>';
      button.querySelector('span').textContent = preset.label;
      button.querySelector('small').textContent = process.subtitle;
      button.addEventListener('click', () => exploreProcess(preset.key));
      list.appendChild(button);
    }
    const toggles = document.createElement('div');
    toggles.className = 'toggles';
    toggles.append(
      toggle('Turn on its side', () => state.pose.to > 0.5, (on) => {
        state.player.stop();
        ui.readout.hidden = true;
        state.pose.set(on ? 1 : 0, 3.8);
        flyTo(CAMERAS[on ? 'side' : 'explore'](), 4);
      }),
      toggle('See the shadow', () => state.ghost.to < 0.5, (on) => state.ghost.set(on ? 0.2 : 1, 1))
    );
    nodes.push(list, toggles);
  }
  return nodes;
}

function toggle(label, get, set) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(get()));
  button.addEventListener('click', () => {
    const next = !get();
    set(next);
    button.setAttribute('aria-pressed', String(next));
  });
  return button;
}

function fireEvents() {
  const chapter = CHAPTERS[state.chapter];
  for (const [i, event] of (chapter.events ?? []).entries()) {
    if (state.firedEvents.has(i) || state.chapterTime < event.at) continue;
    state.firedEvents.add(i);
    if (event.play) playProcess(event.play);
    if (event.camera) flyTo(CAMERAS[event.camera](), 3.4);
    if (event.ghost != null) state.ghost.set(event.ghost, 2.6);
  }
}

function playProcess(key) {
  const process = state.data.processes.find((item) => item.key === key);
  state.player.play(process, showReadout);
  ui.readout.hidden = false;
}

function exploreProcess(key) {
  const process = state.data.processes.find((item) => item.key === key);
  state.exploreProcess = key;
  document.querySelectorAll('.preset').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.key === key));
  });
  const goUpright = state.pose.to > 0.5;
  state.pose.set(0, goUpright ? 3.2 : 0.01);
  state.ghost.set(1, 0.8);
  document.querySelectorAll('.toggle').forEach((button) => button.setAttribute('aria-pressed', 'false'));

  // Frame the process from the front-right, where the walls face the viewer.
  objectGroup.updateMatrixWorld(true);
  const restore = objectGroup.matrixWorld.clone();
  objectGroup.position.set(0, BASE_Y, 0);
  objectGroup.rotation.set(0, 0, 0);
  objectGroup.scale.set(1, 1, 1);
  objectGroup.updateMatrixWorld(true);
  const box = state.player.bounds(process);
  objectGroup.matrixWorld.copy(restore);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  flyTo({
    target: center.toArray(),
    azimuth: deg(36),
    polar: deg(67),
    distance: Math.max(14, size * 1.75),
    fov: 34
  }, goUpright ? 3.6 : 2.4);
  setTimeout(() => {
    if (state.exploreProcess === key) playProcess(key);
  }, goUpright ? 3400 : 1900);
}

function showReadout({ process, state: s, progress, done }) {
  const temperature = formatTemperature(s.T);
  const pressure = 10 ** s.logP;
  const rho = 10 ** s.logRho;
  const fraction = s.x == null ? '' : `${Math.round(s.x * 100)}% ${s.phase === 'subliming' ? 'vapor' : 'steam'} by mass`;
  ui.readout.querySelector('[data-field="title"]').textContent = process.title;
  ui.readout.querySelector('[data-field="leg"]').textContent = done ? 'Done' : s.leg;
  ui.readout.querySelector('[data-field="temperature"]').textContent = temperature.celsius;
  ui.readout.querySelector('[data-field="kelvin"]').textContent = temperature.kelvin;
  ui.readout.querySelector('[data-field="pressure"]').textContent = formatPressure(pressure);
  ui.readout.querySelector('[data-field="density"]').textContent = formatDensity(rho);
  ui.readout.querySelector('[data-field="phase"]').textContent = fraction || phaseName(s.phase);
  ui.readout.querySelector('[data-field="progress"]').style.transform = `scaleX(${Math.min(1, progress).toFixed(4)})`;
  ui.readout.dataset.kind = s.kind;
  sound.setBoiling(s.kind === 'boil' && s.x != null ? s.x : null);
}

// ---------------------------------------------------------------------------
// Hover

const raycaster = new THREE.Raycaster();
const localPoint = new THREE.Vector3();

function pick() {
  const surface = state.surface;
  const tooltipAllowed = state.pointerInside && !state.userInteracting && !state.camera
    && state.rise.value > 0.98 && state.ghost.value > 0.3 && Math.abs(state.pose.value - Math.round(state.pose.value)) < 0.01;
  if (!tooltipAllowed) {
    hideTooltip();
    return;
  }
  raycaster.setFromCamera(state.pointer, camera);
  const hit = raycaster.intersectObjects(surface.meshes, false)[0];
  if (!hit) {
    hideTooltip();
    return;
  }
  localPoint.copy(hit.point);
  objectGroup.worldToLocal(localPoint);
  const T = xToT(localPoint.x);
  const logP = zToLogP(localPoint.z);
  const logRho = yToLogRho(localPoint.y);
  surface.uniforms.uHover.value.set(T, logP, 1);
  showTooltip(describeHit(hit.object.userData, T, logP, logRho));
}

function describeHit(userData, T, logP, logRho) {
  const { critical } = state.data.points;
  const pressure = 10 ** logP;
  const rho = 10 ** logRho;
  let phase = userData.phase;
  let detail = formatDensity(rho);
  if (userData.kind === 'patch' && phase !== 'ice') {
    if (T >= critical.T) phase = logP >= critical.logP ? 'supercritical' : 'gas';
  }
  if (userData.kind === 'curtain') {
    const curtain = userData.curtain;
    let i = 0;
    while (i < curtain.count - 2 && (curtain.T[i + 1] - T) * Math.sign(curtain.T[curtain.count - 1] - curtain.T[0]) < 0) i += 1;
    const lo = 10 ** curtain.logRhoLow[i];
    const hi = 10 ** curtain.logRhoHigh[i];
    const x = Math.min(1, Math.max(0, (1 / rho - 1 / hi) / (1 / lo - 1 / hi)));
    const names = { boiling: ['Boiling', 'steam'], sublimation: ['Ice and vapor', 'vapor'], melting: ['Ice and liquid', 'liquid'] };
    const [label, lighter] = names[phase];
    phase = label;
    detail = `${formatDensity(rho)} · ${trim(x * 100, 2)}% ${lighter}`;
    return { phase, T, pressure, detail };
  }
  return { phase: phaseName(phase), T, pressure, detail };
}

function showTooltip({ phase, T, pressure, detail }) {
  const temperature = formatTemperature(T);
  ui.tooltip.querySelector('strong').textContent = phase;
  ui.tooltip.querySelector('[data-field="tp"]').textContent = `${temperature.celsius} · ${formatPressure(pressure)}`;
  ui.tooltip.querySelector('[data-field="detail"]').textContent = detail;
  ui.tooltip.hidden = false;
  const rect = ui.tooltip.getBoundingClientRect();
  const x = Math.min(state.pointerClient.x + 18, window.innerWidth - rect.width - 12);
  const y = Math.min(state.pointerClient.y + 18, window.innerHeight - rect.height - 12);
  ui.tooltip.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function hideTooltip() {
  ui.tooltip.hidden = true;
  if (state.surface) state.surface.uniforms.uHover.value.z = -1;
}

// ---------------------------------------------------------------------------
// Events

ui.next.addEventListener('click', () => goTo(state.chapter === CHAPTERS.length - 1 ? 0 : state.chapter + 1));
ui.prev.addEventListener('click', () => goTo(state.chapter - 1));
window.addEventListener('keydown', (event) => {
  if (!state.data || event.target instanceof HTMLInputElement) return;
  if (event.key === 'ArrowRight' || event.key === 'PageDown') goTo(state.chapter + 1);
  else if (event.key === 'ArrowLeft' || event.key === 'PageUp') goTo(state.chapter - 1);
  else return;
  event.preventDefault();
});

const canvas = renderer.domElement;
canvas.addEventListener('pointermove', (event) => {
  state.pointerInside = true;
  state.pointerClient.x = event.clientX;
  state.pointerClient.y = event.clientY;
  const rect = canvas.getBoundingClientRect();
  state.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
});
canvas.addEventListener('pointerleave', () => {
  state.pointerInside = false;
  hideTooltip();
});
controls.addEventListener('start', () => {
  state.userInteracting = true;
  state.camera = null;
  controls.enabled = true;
});
controls.addEventListener('end', () => {
  state.userInteracting = false;
  state.lastInteraction = timer.getElapsed();
});
canvas.addEventListener('dblclick', () => flyTo(CAMERAS[CHAPTERS[state.chapter].camera](), 1.8));

ui.sound.addEventListener('click', async () => {
  const on = await sound.toggle();
  ui.sound.setAttribute('aria-pressed', String(on));
  ui.sound.textContent = on ? 'Sound on' : 'Sound off';
});
ui.about.addEventListener('click', () => {
  ui.aboutPanel.hidden = !ui.aboutPanel.hidden;
  ui.about.setAttribute('aria-expanded', String(!ui.aboutPanel.hidden));
});
ui.aboutPanel.querySelector('button').addEventListener('click', () => {
  ui.aboutPanel.hidden = true;
  ui.about.setAttribute('aria-expanded', 'false');
});

function onResize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  applyViewOffset();
  camera.updateProjectionMatrix();
  resizeComposer(width, height);
  state.surface?.setResolution(width, height);
  state.player?.setResolution(width, height);
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// Loop

function applyObjectPose() {
  const rise = state.rise.value;
  const pose = state.pose.value;
  const arc = 6 * Math.sin(Math.PI * pose);
  objectGroup.scale.set(1, lerp(0.002, 1, rise), 1);
  objectGroup.position.set(
    lerp(0, POSE_B.x, pose),
    lerp(lerp(0.03, BASE_Y, rise), POSE_B.y, pose) + arc,
    0
  );
  objectGroup.rotation.z = pose * Math.PI / 2;
  state.surface.setOpacity(smoothstep(0.02, 0.3, rise) * state.ghost.value);

  const uniforms = state.stageView.uniforms;
  uniforms.uDiagramMix.value = smoothstep(0.62, 0.96, pose);
  uniforms.uDiagramOpacity.value = 1 - 0.8 * Math.pow(Math.sin(Math.PI * pose), 2);
}

function animate(timestamp) {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), MAX_DELTA);
  const elapsed = timer.getElapsed();

  if (state.data) {
    state.chapterTime += delta;
    fireEvents();
    for (const key of ['rise', 'pose', 'beam', 'ghost']) state[key].update(delta);
    for (const key of Object.keys(state.highlight)) {
      state.highlight[key] += (state.highlightTarget[key] - state.highlight[key]) * Math.min(1, delta * 2.5);
    }
    applyObjectPose();
    dimension.sync(state.rise.value);
    objectGroup.updateMatrixWorld(true);
    const { uniforms } = state.surface;
    uniforms.uTime.value = elapsed;
    uniforms.uHighlight.value.set(state.highlight.boil, state.highlight.frost, state.highlight.super, 0);
    state.surface.bead.scale.setScalar(1 + 0.25 * state.highlight.super * Math.sin(elapsed * 2.4));
    state.stageView.setBeam(state.beam.value);
    state.stageView.update(elapsed);
    state.player.update(delta);
    updateCamera(delta, elapsed);
    state.labels.update(delta, stage.clientWidth, stage.clientHeight);
    state.frame += 1;
    if (state.frame % 2 === 0) pick();
  }

  composer.render();
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Start

async function start() {
  const [data] = await Promise.all([loadWaterData(), fontsReady()]);
  state.data = data;

  const surface = createSurface(data, { fog });
  objectGroup.add(surface.object);
  state.surface = surface;

  const pt = drawPTDiagram(data, renderer);
  const pv = drawPVDiagram(data, renderer);
  const stageView = createStage({ pt, pv, fog });
  stageView.ptBounds = pt.bounds;
  stageView.pvBounds = pv.bounds;
  scene.add(stageView.object);
  state.stageView = stageView;

  state.player = createProcessPlayer(objectGroup, scene, stageView);

  const labels = createLabels(ui.labels, camera);
  const worldOf = (local) => () => objectGroup.localToWorld(local.clone());
  const anchor = (name, T, logP) => new THREE.Vector3(tToX(T), surface.heightAt(name, T, logP) + 0.15, logPToZ(logP));
  labels.add('ice', { title: 'Ice', anchor: worldOf(anchor('ice', 228, 5.4)) });
  labels.add('liquid', { title: 'Liquid', anchor: worldOf(anchor('liquid', 430, 6.6)) });
  labels.add('vapor', { title: 'Vapor', anchor: worldOf(anchor('vapor', 600, 1.6)) });
  labels.add('super', { title: 'Supercritical fluid', anchor: worldOf(anchor('liquid', 735, 7.75)) });
  labels.add('critical', {
    title: 'Critical point',
    detail: '373.95 °C · 22.06 MPa',
    anchor: worldOf(surface.anchors.critical.clone().add(new THREE.Vector3(0, 0.25, 0))),
    side: 'left'
  });
  labels.add('triple', {
    title: 'Triple line',
    detail: '0.01 °C · 611.657 Pa',
    anchor: worldOf(surface.anchors.tripleMid),
    side: 'left'
  });
  state.labels = labels;

  onResize();
  buildDots();
  applyObjectPose();

  const fromHash = CHAPTERS.findIndex((chapter) => `#${chapter.key}` === location.hash);
  goTo(fromHash > 0 ? fromHash : 0, { instant: true });
  if (fromHash > 0) state.firedEvents = new Set();

  loader.classList.add('is-done');
  setTimeout(() => {
    loader.hidden = true;
  }, 900);
}

onResize();
requestAnimationFrame(animate);
start().catch((error) => {
  console.error(error);
  loader.querySelector('p').textContent = 'The data could not be loaded. Please reload the page.';
});
