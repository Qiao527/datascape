import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { logPToZ, logRhoToY, tToX } from './mapping.js';

const LEG_SECONDS = { heat: 3.4, boil: 6.5, expand: 4.2 };
const ACCENT = new THREE.Color(0xe8b66e);

/** Nudges a line toward the camera in clip space so it never sinks into the surface. */
function biasDepth(material, amount) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(/}\s*$/, `  gl_Position.z -= ${amount.toFixed(4)} * gl_Position.w;\n}`);
  };
  return material;
}

/**
 * A state point that follows one of the precomputed processes across the
 * surface, leaving a trail, with a plumb line down to its shadow on the floor.
 */
export function createProcessPlayer(parent, scene, stage) {
  const trailMaterial = biasDepth(new LineMaterial({
    color: ACCENT,
    linewidth: 2.4,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  }), 0.004);
  const trailGeometry = new LineGeometry();
  trailGeometry.setPositions([0, 0, 0, 0, 0, 0]);
  const trail = new Line2(trailGeometry, trailMaterial);
  trail.frustumCulled = false;
  trail.renderOrder = 3;
  trail.visible = false;
  parent.add(trail);

  const bead = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.7, 0.85) })
  );
  bead.visible = false;
  bead.renderOrder = 4;
  scene.add(bead);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(),
    color: new THREE.Color(1.4, 0.95, 0.55),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  halo.scale.setScalar(1.3);
  bead.add(halo);

  const plumbMaterial = new LineMaterial({
    color: ACCENT,
    linewidth: 1,
    transparent: true,
    opacity: 0.55,
    dashed: true,
    dashSize: 0.12,
    gapSize: 0.12,
    depthWrite: false,
    depthTest: false
  });
  const plumbGeometry = new LineGeometry();
  plumbGeometry.setPositions([0, 0, 0, 0, 1, 0]);
  const plumb = new Line2(plumbGeometry, plumbMaterial);
  plumb.frustumCulled = false;
  plumb.visible = false;
  scene.add(plumb);

  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  let process = null;
  let points = [];
  let states = [];
  let timeline = [];
  let elapsed = 0;
  let duration = 0;
  let playing = false;
  let fade = 0;
  let onUpdate = () => {};

  function load(nextProcess) {
    process = nextProcess;
    states = [];
    timeline = [];
    let t = 0;
    for (const leg of process.legs) {
      const seconds = LEG_SECONDS[leg.kind] ?? 3;
      leg.states.forEach((state, index) => {
        if (states.length && index === 0) return; // legs share their end points
        states.push({ ...state, leg: leg.label, kind: leg.kind });
        timeline.push(t + (seconds * index) / (leg.states.length - 1));
      });
      t += seconds;
    }
    duration = t;
    points = states.flatMap((s) => [tToX(s.T), logRhoToY(s.logRho), logPToZ(s.logP)]);
    trailGeometry.setPositions(points);
    trail.computeLineDistances();
    trailGeometry.instanceCount = 0;
  }

  function play(nextProcess, callback = () => {}) {
    load(nextProcess);
    onUpdate = callback;
    elapsed = -0.6;
    playing = true;
    trail.visible = true;
    bead.visible = true;
    plumb.visible = true;
  }

  function stop() {
    playing = false;
    process = null;
  }

  function sample(time) {
    if (!states.length) return null;
    if (time <= 0) return { state: states[0], index: 0, f: 0 };
    let i = timeline.findIndex((value) => value > time);
    if (i === -1) return { state: states[states.length - 1], index: states.length - 1, f: 0 };
    i = Math.max(1, i);
    const f = (time - timeline[i - 1]) / (timeline[i] - timeline[i - 1]);
    const a = states[i - 1];
    const b = states[i];
    const mix = (key) => a[key] + (b[key] - a[key]) * f;
    return {
      index: i - 1,
      f,
      state: {
        T: mix('T'),
        logP: mix('logP'),
        logRho: mix('logRho'),
        x: a.x == null ? null : mix('x'),
        phase: f < 0.5 ? a.phase : b.phase,
        leg: b.leg,
        kind: b.kind
      }
    };
  }

  function update(delta) {
    const target = playing || process ? 1 : 0;
    fade += (target - fade) * Math.min(1, delta * 4);
    trailMaterial.opacity = 0.95 * fade;
    plumbMaterial.opacity = 0.55 * fade;
    bead.material.opacity = fade;
    halo.material.opacity = fade;
    const visible = fade > 0.01;
    trail.visible = bead.visible = plumb.visible = visible;
    if (!visible) {
      stage.uniforms.uMarker.value.z = 0;
      return;
    }

    if (playing) {
      elapsed += delta;
      if (elapsed >= duration + 1.5) playing = false;
    }
    const current = sample(Math.min(elapsed, duration));
    if (!current) return;

    const { state, index, f } = current;
    local.set(tToX(state.T), logRhoToY(state.logRho), logPToZ(state.logP));
    world.copy(local);
    parent.localToWorld(world);
    bead.position.copy(world);
    plumbGeometry.setPositions([world.x, world.y, world.z, world.x, 0.01, world.z]);
    plumb.computeLineDistances();
    stage.uniforms.uMarker.value.set(world.x, world.z, fade);
    trailGeometry.instanceCount = Math.max(0, Math.min(states.length - 1, index + (f > 0 ? 1 : 0)));
    if (process) onUpdate({ process, state, progress: Math.max(0, elapsed) / duration, done: !playing });
  }

  return {
    play,
    stop,
    update,
    get active() {
      return Boolean(process);
    },
    clear() {
      stop();
    },
    setResolution(width, height) {
      trailMaterial.resolution.set(width, height);
      plumbMaterial.resolution.set(width, height);
    },
    /** World-space bounding box of a process, for framing the camera. */
    bounds(nextProcess) {
      const box = new THREE.Box3();
      for (const leg of nextProcess.legs) {
        for (const s of leg.states) {
          const p = new THREE.Vector3(tToX(s.T), logRhoToY(s.logRho), logPToZ(s.logP));
          box.expandByPoint(parent.localToWorld(p));
        }
      }
      return box;
    }
  };
}

function haloTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
