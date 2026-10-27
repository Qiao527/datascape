import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../shared/base.css';
import './pulsar.css';
import { createComposer, createRenderer } from '../shared/post.js';
import { createRidges } from './ridges.js';
import { createRowShaper } from './shaping.js';
import { AudioEngine } from './audio.js';

const BINS = 160;
const ROWS = 80;
const ROWS_PER_SECOND = 22;
const LINE_WIDTH_CSS_PX = 1.5;
const INTRO_SECONDS = 4;

const stage = document.querySelector('#stage');
const sourceLabel = document.querySelector('#source');
const statusElement = document.querySelector('#status');
const demoButton = document.querySelector('#demo');
const fileInput = document.querySelector('#file');
const micButton = document.querySelector('#mic');
const pauseButton = document.querySelector('#pause');
const stopButton = document.querySelector('#stop');
const sensitivityInput = document.querySelector('#sensitivity');
const dropOverlay = document.querySelector('#drop');

let renderer;
try {
  renderer = createRenderer(stage);
} catch (error) {
  stage.innerHTML = '<p class="webgl-error">Your browser could not start WebGL. Turn on hardware acceleration or try another browser.</p>';
  throw error;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const ridges = createRidges({ bins: BINS, rows: ROWS, width: 30, spacing: 0.55, amplitude: 3.4 });
scene.add(ridges.object);

// A high, narrow-angle view keeps the rows evenly spaced on screen, like the
// flat stacked plot on the cover; orbiting reveals that it is really 3D.
const camera = new THREE.PerspectiveCamera(26, stage.clientWidth / stage.clientHeight, 0.1, 400);
const target = new THREE.Vector3(0, 1.2, -ridges.depth * 0.46);
const homeOffset = new THREE.Vector3(0, 40, 58);
const introOffset = new THREE.Vector3().setFromSphericalCoords(
  homeOffset.length() * 1.15,
  THREE.MathUtils.degToRad(64),
  THREE.MathUtils.degToRad(-38)
);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 18;
controls.maxDistance = 120;
controls.minPolarAngle = THREE.MathUtils.degToRad(30);
controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
controls.minAzimuthAngle = THREE.MathUtils.degToRad(-80);
controls.maxAzimuthAngle = THREE.MathUtils.degToRad(80);
controls.target.copy(target);

// No bloom: with this many white lines it turns into grey haze. The cover's
// look depends on crisp white on pure black.
const { composer, resize: resizeComposer } = createComposer(renderer, scene, camera, null);

const shaper = createRowShaper(BINS);
const engine = new AudioEngine(syncControls);
const timer = new THREE.Timer();
timer.connect(document);

const state = {
  rowClock: 0,
  audioMix: 0,
  gain: Number(sensitivityInput.value),
  introProgress: 0,
  userMovedCamera: false,
  idleTimeout: null
};

// Fill the screen with pulses before the first frame so it never starts empty.
for (let i = 0; i < ROWS; i += 1) ridges.push(nextRow());
camera.position.copy(target).add(introOffset);
controls.update();
onResize();

// ---------------------------------------------------------------------------
// Rows

function nextRow() {
  return shaper.next({
    frequencyData: engine.getFrequencyData(),
    sampleRate: engine.sampleRate,
    gain: state.gain,
    audioMix: state.audioMix
  });
}

// ---------------------------------------------------------------------------
// Controls

async function run(action) {
  setStatus('');
  try {
    await action();
  } catch (error) {
    setStatus(error.message ?? String(error));
  }
}

function syncControls() {
  const hasSource = engine.mode !== null;
  sourceLabel.textContent = hasSource ? engine.label : 'No sound yet · playing the pulsar signal';
  pauseButton.hidden = !hasSource || engine.mode === 'mic';
  stopButton.hidden = !hasSource;
  pauseButton.textContent = engine.paused ? 'Resume' : 'Pause';
  demoButton.setAttribute('aria-pressed', String(engine.mode === 'demo'));
  micButton.setAttribute('aria-pressed', String(engine.mode === 'mic'));
  document.body.dataset.playing = String(engine.active);
  wakeInterface();
}

function setStatus(message) {
  statusElement.textContent = message;
  statusElement.hidden = !message;
}

demoButton.addEventListener('click', () => run(() => engine.playDemo()));
micButton.addEventListener('click', () => run(() => engine.useMicrophone()));
pauseButton.addEventListener('click', () => run(() => engine.togglePause()));
stopButton.addEventListener('click', () => engine.stop());
fileInput.addEventListener('change', () => {
  const [file] = fileInput.files;
  if (file) run(() => engine.playFile(file));
  fileInput.value = '';
});
sensitivityInput.addEventListener('input', () => {
  state.gain = Number(sensitivityInput.value);
});

window.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || event.target instanceof HTMLInputElement) return;
  event.preventDefault();
  if (engine.mode && engine.mode !== 'mic') run(() => engine.togglePause());
});

// Drag & drop an audio file anywhere on the page.
let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  dragDepth += 1;
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.hidden = true;
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  const file = [...event.dataTransfer.files].find((item) => item.type.startsWith('audio/'));
  if (file) run(() => engine.playFile(file));
  else setStatus('Drop an audio file (mp3, wav, m4a, ogg…)');
});

// Hide the interface while music plays and the mouse is still.
function wakeInterface() {
  document.body.classList.remove('ui-idle');
  clearTimeout(state.idleTimeout);
  if (engine.active) {
    state.idleTimeout = setTimeout(() => document.body.classList.add('ui-idle'), 3500);
  }
}
window.addEventListener('pointermove', wakeInterface);

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', () => {
  state.userMovedCamera = true;
});
canvas.addEventListener('wheel', () => {
  state.userMovedCamera = true;
}, { passive: true });
canvas.addEventListener('dblclick', () => {
  state.userMovedCamera = true;
  camera.position.copy(target).add(homeOffset);
  controls.target.copy(target);
  controls.update();
});

function onResize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  resizeComposer(width, height);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  ridges.setResolution(size.x, size.y);
  ridges.uniforms.uThickness.value = LINE_WIDTH_CSS_PX * renderer.getPixelRatio();
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// Loop

const introFrom = new THREE.Vector3();
const introTo = new THREE.Vector3();

function animate(timestamp) {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), 0.1);

  // Crossfade between pulsar and music over ~0.6 s.
  const targetMix = engine.active ? 1 : 0;
  state.audioMix += (targetMix - state.audioMix) * Math.min(1, delta * 3.5);

  state.rowClock += delta * ROWS_PER_SECOND;
  if (state.rowClock > 4) state.rowClock = 1; // tab was in the background
  while (state.rowClock >= 1) {
    state.rowClock -= 1;
    ridges.push(nextRow());
  }
  ridges.setScroll(state.rowClock);

  // Opening move: swing from a three-quarter view to the classic front view.
  if (state.introProgress < 1 && !state.userMovedCamera) {
    state.introProgress = Math.min(1, state.introProgress + delta / INTRO_SECONDS);
    const t = state.introProgress;
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    introFrom.copy(introOffset);
    introTo.copy(homeOffset);
    camera.position.copy(target).add(introFrom.lerp(introTo, eased));
  }

  controls.update();
  composer.render();
  requestAnimationFrame(animate);
}

syncControls();
requestAnimationFrame(animate);
