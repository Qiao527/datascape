import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import '../shared/base.css';
import './skyline.css';
import { createComposer, createRenderer } from '../shared/post.js';
import { buildGrid, countOf, describeDay, loadContributions, shortDate, summarize } from './data.js';
import { createCity } from './city.js';
import { createTerrain } from './terrain.js';
import { createDust, createFloor, createPlinth, createSky, createStars, PLINTH_HEIGHT } from './environment.js';

const DEFAULT_USER = 'torvalds';
const FIRST_YEAR = 2008;
const VIEW_DIRECTION = new THREE.Vector3(-0.45, 0.42, 0.79).normalize();
// On portrait screens, look along the length of the city instead of at its side.
const PORTRAIT_VIEW_DIRECTION = new THREE.Vector3(-0.82, 0.48, 0.36).normalize();
const BASE_FOG_DENSITY = 0.0105;

const palette = {
  zenith: new THREE.Color(0x020309),
  horizon: new THREE.Color(0x0c0f2c),
  horizonGlow: new THREE.Color(0x1b2860),
  body: new THREE.Color(0x0a0e1c),
  windowWarm: new THREE.Color(0xffc978),
  windowCool: new THREE.Color(0x8fe3ff),
  levels: [0x0e4429, 0x26a641, 0x39d353, 0xd2ffdc].map((hex) => new THREE.Color(hex))
};
// Distant ground fades to the sky's colour exactly at the horizon (the sky's
// glow band starts just above it), so there is no visible seam.
palette.fog = palette.horizon;

const stage = document.querySelector('#stage');
const form = document.querySelector('#search');
const userInput = form.elements.user;
const yearSelect = form.elements.year;
const submitButton = form.querySelector('button[type="submit"]');
const statusElement = document.querySelector('#status');
const statsElement = document.querySelector('#stats');
const tooltip = document.querySelector('#tooltip');
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const snapshotButton = document.querySelector('#snapshot');

populateYears();

let renderer;
try {
  renderer = createRenderer(stage);
} catch (error) {
  stage.innerHTML = '<p class="webgl-error">Your browser could not start WebGL. Turn on hardware acceleration or try another browser.</p>';
  throw error;
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(palette.fog, BASE_FOG_DENSITY);

const camera = new THREE.PerspectiveCamera(36, stage.clientWidth / stage.clientHeight, 0.1, 1200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 10;
controls.maxDistance = 160;
controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;

scene.add(new THREE.HemisphereLight(0x8899ff, 0x05060c, 0.7));
const moonLight = new THREE.DirectionalLight(0xc4d4ff, 1.6);
moonLight.position.set(-30, 40, 30);
scene.add(moonLight);

const sky = createSky(palette);
const stars = createStars();
const floor = createFloor(renderer, palette, -PLINTH_HEIGHT);
const dust = createDust();
scene.add(sky, stars, floor.object, dust);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const { composer, resize: resizeComposer } = createComposer(renderer, scene, camera, {
  strength: 0.85,
  radius: 0.55,
  threshold: 0.62
});

const timer = new THREE.Timer();
timer.connect(document);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const state = {
  mode: 'city',
  world: null,
  requestId: 0,
  pointerInside: false,
  dragging: false,
  cameraTouched: false,
  pointerClient: { x: 0, y: 0 },
  hoverIndex: -1,
  frame: 0
};

// ---------------------------------------------------------------------------
// Data loading and scene building

async function generate(username, year) {
  const requestId = ++state.requestId;
  submitButton.disabled = true;
  setStatus(`Fetching contributions for @${username}…`, 'loading');

  try {
    const data = await loadContributions(username, year);
    if (requestId !== state.requestId) return;
    buildWorld(data);
    setStatus('');
    updateUrl(username, year);
  } catch (error) {
    if (requestId !== state.requestId) return;
    setStatus(error.message, 'error');
  } finally {
    if (requestId === state.requestId) submitButton.disabled = false;
  }
}

function buildWorld(data) {
  const grid = buildGrid(data.days);
  const stats = summarize(data.days);
  const periodLabel = data.year ? String(data.year) : `${data.from} — ${data.to}`;

  disposeWorld();

  const plinth = createPlinth(grid, { username: data.username, periodLabel, total: stats.total }, renderer);
  const city = createCity(grid, palette);
  const terrain = createTerrain(grid, palette, { width: plinth.width, depth: plinth.depth });
  worldGroup.add(plinth.object, city.object, terrain.object);

  state.world = { grid, stats, plinth, city, terrain };
  state.hoverIndex = -1;
  applyMode();
  renderStats(stats, grid);
  fitCamera();
}

function disposeWorld() {
  if (!state.world) return;
  const { plinth, city, terrain } = state.world;
  worldGroup.remove(plinth.object, city.object, terrain.object);
  plinth.dispose();
  city.dispose();
  terrain.dispose();
  state.world = null;
}

function activeLayer() {
  if (!state.world) return null;
  return state.mode === 'city' ? state.world.city : state.world.terrain;
}

function applyMode() {
  modeButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
  });
  if (!state.world) return;
  const { city, terrain } = state.world;
  city.object.visible = state.mode === 'city';
  terrain.object.visible = state.mode === 'terrain';
  city.setHover(-1);
  terrain.setHover(-1);
  activeLayer().uniforms.uGrowStart.value = timer.getElapsed() + 0.15;
  hideTooltip();
}

// ---------------------------------------------------------------------------
// UI

function populateYears() {
  const current = new Date().getFullYear();
  const options = [new Option('Last 12 months', '')];
  for (let year = current; year >= FIRST_YEAR; year -= 1) {
    options.push(new Option(String(year), String(year)));
  }
  yearSelect.replaceChildren(...options);
}

function setStatus(message, kind = '') {
  statusElement.textContent = message;
  statusElement.dataset.kind = kind;
  statusElement.hidden = !message;
}

function renderStats(stats, grid) {
  const best = stats.best.count > 0 ? `${stats.best.count.toLocaleString('en-US')} on ${shortDate(stats.best.date)}` : '—';
  const rows = [
    ['Contributions', stats.total.toLocaleString('en-US')],
    ['Active days', `${stats.activeDays} / ${grid.cells.length}`],
    ['Longest streak', countOf(stats.longestStreak, 'day')],
    ['Busiest day', best]
  ];
  statsElement.replaceChildren(...rows.map(([label, value]) => {
    const wrapper = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    wrapper.append(dt, dd);
    return wrapper;
  }));
  statsElement.hidden = false;
}

function updateUrl(username, year) {
  const params = new URLSearchParams({ user: username });
  if (year) params.set('year', String(year));
  if (state.mode !== 'city') params.set('mode', state.mode);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

function showTooltip(cell) {
  const { date, count } = describeDay(cell);
  tooltip.querySelector('strong').textContent = count;
  tooltip.querySelector('span').textContent = date;
  tooltip.hidden = false;
  const offset = 16;
  const { innerWidth, innerHeight } = window;
  const rect = tooltip.getBoundingClientRect();
  const x = Math.min(state.pointerClient.x + offset, innerWidth - rect.width - 8);
  const y = Math.min(state.pointerClient.y + offset, innerHeight - rect.height - 8);
  tooltip.style.transform = `translate(${x}px, ${y}px)`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = userInput.value.trim().replace(/^@/, '');
  if (!username) return;
  generate(username, yearSelect.value ? Number(yearSelect.value) : null);
});

modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (state.mode === button.dataset.mode) return;
    state.mode = button.dataset.mode;
    applyMode();
    const params = new URLSearchParams(location.search);
    if (params.get('user')) updateUrl(params.get('user'), params.get('year'));
  });
});

snapshotButton.addEventListener('click', () => {
  composer.render();
  const link = document.createElement('a');
  const user = new URLSearchParams(location.search).get('user') ?? 'commit-city';
  link.download = `commit-city-${user}.png`;
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
});

// ---------------------------------------------------------------------------
// Interaction

const canvas = renderer.domElement;
canvas.addEventListener('pointermove', (event) => {
  state.pointerInside = true;
  state.pointerClient.x = event.clientX;
  state.pointerClient.y = event.clientY;
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );
});
canvas.addEventListener('pointerdown', () => {
  state.dragging = true;
  hideTooltip();
});
controls.addEventListener('start', () => {
  state.cameraTouched = true;
});
window.addEventListener('pointerup', () => {
  state.dragging = false;
});
canvas.addEventListener('pointerleave', () => {
  state.pointerInside = false;
  updateHover(-1);
});
canvas.addEventListener('dblclick', fitCamera);

function pick() {
  const layer = activeLayer();
  if (!layer || !state.pointerInside || state.dragging) return;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(layer.object, false)[0];
  updateHover(hit ? layer.cellIndexFromHit(hit) : -1);
}

function updateHover(index) {
  const layer = activeLayer();
  if (!layer) return;
  if (index !== state.hoverIndex) {
    state.hoverIndex = index;
    layer.setHover(index);
  }
  if (index >= 0) showTooltip(state.world.grid.cells[index]);
  else hideTooltip();
}

function fitCamera() {
  const width = state.world?.plinth.width ?? 55;
  const depth = state.world?.plinth.depth ?? 9;
  const portrait = camera.aspect < 0.9;
  const direction = portrait ? PORTRAIT_VIEW_DIRECTION : VIEW_DIRECTION;
  camera.fov = portrait ? 50 : 36;
  camera.updateProjectionMatrix();

  // Width of the plinth as seen from this horizontal viewing angle.
  const horizontal = Math.hypot(direction.x, direction.z);
  const projectedWidth = (width * Math.abs(direction.z) + depth * Math.abs(direction.x)) / horizontal;

  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  // The near end of the city is closer to the camera than the target, so
  // leave extra room beyond a flat-on fit.
  const distance = Math.max(
    (projectedWidth * 0.72) / Math.tan(horizontalFov / 2),
    11 / Math.tan(verticalFov / 2)
  );
  controls.target.set(0, 1.2, 0);
  camera.position.copy(controls.target).addScaledVector(direction, distance);
  controls.update();
  state.cameraTouched = false;

  // Thin the fog when the camera has to stand further back.
  scene.fog.density = Math.min(BASE_FOG_DENSITY, 0.72 / distance);
}

function onResize() {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  resizeComposer(width, height);
  floor.resize();
  // Keep the framing when the window changes, unless the user has taken over.
  if (!state.cameraTouched) fitCamera();
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// Loop

function animate(timestamp) {
  timer.update(timestamp);
  const elapsed = timer.getElapsed();

  stars.material.uniforms.uTime.value = elapsed;
  dust.material.uniforms.uTime.value = elapsed;
  if (state.world) {
    state.world.city.uniforms.uTime.value = elapsed;
    state.world.terrain.uniforms.uTime.value = elapsed;
  }

  controls.update();
  state.frame += 1;
  if (state.frame % 3 === 0) pick();

  composer.render();
  requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Start

const params = new URLSearchParams(location.search);
const initialUser = params.get('user') || DEFAULT_USER;
const initialYear = params.get('year');
if (params.get('mode') === 'terrain') state.mode = 'terrain';
userInput.value = initialUser;
if (initialYear && [...yearSelect.options].some((option) => option.value === initialYear)) {
  yearSelect.value = initialYear;
}
applyMode();
fitCamera();
requestAnimationFrame(animate);
generate(initialUser, initialYear ? Number(initialYear) : null);
