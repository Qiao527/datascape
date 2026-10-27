import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { FONT_MONO, FONT_SANS, FONT_SERIF } from '../shared/fonts.js';

// Paper in centimeters: 25 mm/s and 10 mm/mV become 2.5 units/s and 1 unit/mV.
export const PAPER = { width: 28, height: 21, speed: 2.5, gain: 1 };
const LAYOUT = [
  ['i', 'avr', 'v1', 'v4'],
  ['ii', 'avl', 'v2', 'v5'],
  ['iii', 'avf', 'v3', 'v6']
];
const ROWS_Y = [6.2, 2.1, -2.0];
const RHYTHM_Y = -6.3;
const X0 = -12.5;
const LABEL = { i: 'I', ii: 'II', iii: 'III', avr: 'aVR', avl: 'aVL', avf: 'aVF', v1: 'V1', v2: 'V2', v3: 'V3', v4: 'V4', v5: 'V5', v6: 'V6' };

/**
 * ECG paper: 1 mm and 5 mm grid drawn procedurally, with the printed header
 * from a canvas. uDark fades it from a lit printout to a faint dark grid.
 */
export function createPaper(meta, renderer) {
  const text = drawPrint(meta, renderer);
  const uniforms = {
    uDark: { value: 0 },
    uPrint: { value: text },
    uPrintOpacity: { value: 1 },
    uSize: { value: new THREE.Vector2(PAPER.width, PAPER.height) },
    uFade: { value: 1 }
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(PAPER.width, PAPER.height),
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
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
        uniform float uDark;
        uniform sampler2D uPrint;
        uniform float uPrintOpacity;
        uniform vec2 uSize;
        uniform float uFade;
        varying vec2 vUv;
        varying vec2 vPos;

        float grid(vec2 p, float spacing, float width) {
          vec2 g = abs(fract(p / spacing - 0.5) - 0.5) / fwidth(p / spacing);
          return 1.0 - min(min(g.x, g.y) / width, 1.0);
        }

        void main() {
          float minor = grid(vPos, 0.1, 0.9);
          float major = grid(vPos, 0.5, 1.2);
          vec3 paperLit = vec3(0.96, 0.93, 0.88);
          vec3 inkMinor = vec3(0.93, 0.62, 0.6);
          vec3 inkMajor = vec3(0.86, 0.38, 0.38);
          vec3 lit = mix(paperLit, inkMinor, minor * 0.55);
          lit = mix(lit, inkMajor, major * 0.75);
          // In the dark, only a trace of the grid remains: the measurement
          // the loop came from.
          vec3 dark = vec3(0.028, 0.025, 0.027) + vec3(0.3, 0.1, 0.1) * (minor * 0.025 + major * 0.09);
          vec3 color = mix(lit, dark, uDark);

          vec4 print = texture2D(uPrint, vUv);
          vec3 printInk = mix(vec3(0.1, 0.09, 0.09), vec3(0.75, 0.72, 0.68), uDark);
          color = mix(color, printInk, print.a * uPrintOpacity * (1.0 - 0.75 * uDark));

          // A soft edge, like a sheet on a dark table.
          vec2 d = abs(vPos) - (uSize * 0.5 - 0.6);
          float inside = 1.0 - smoothstep(0.0, 0.6, max(d.x, d.y));
          float vignette = 1.0 - 0.25 * dot(vUv - 0.5, vUv - 0.5) * 4.0 * (1.0 - uDark);
          float alpha = mix(inside, inside * 0.9, uDark) * uFade;
          gl_FragColor = vec4(color * vignette, alpha);
        }
      `
    })
  );
  mesh.renderOrder = -1;
  return { mesh, uniforms };
}

function drawPrint(meta, renderer) {
  const scale = Math.min(140, renderer.capabilities.maxTextureSize / PAPER.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAPER.width * scale);
  canvas.height = Math.round(PAPER.height * scale);
  const ctx = canvas.getContext('2d');
  const px = (x) => (x + PAPER.width / 2) * scale;
  const py = (y) => (PAPER.height / 2 - y) * scale;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `600 ${0.36 * scale}px ${FONT_SANS}`;
  ctx.fillText('12-lead electrocardiogram', px(X0), py(9.6));
  ctx.font = `400 ${0.24 * scale}px ${FONT_MONO}`;
  ctx.fillText(`Healthy control · PTB Diagnostic ECG Database · ${meta.source.record}`, px(X0), py(9.15));
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(meta.heartRate)} bpm · 25 mm/s · 10 mm/mV · 0.05–40 Hz`, px(12.5), py(9.15));
  ctx.font = `italic 400 ${0.4 * scale}px ${FONT_SERIF}`;
  ctx.fillText('Each trace: the same ten seconds, seen from another direction.', px(12.5), py(-9.6));

  ctx.textAlign = 'left';
  ctx.font = `600 ${0.26 * scale}px ${FONT_SANS}`;
  LAYOUT.forEach((row, r) => {
    row.forEach((lead, c) => {
      ctx.fillText(LABEL[lead], px(X0 + 0.6 + c * 6.25), py(ROWS_Y[r] + 1.25));
    });
  });
  ctx.fillText('II', px(X0 + 0.6), py(RHYTHM_Y + 1.25));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

/** The printed 12-lead traces: 2.5 s per lead in a 3 × 4 layout, plus a 10 s rhythm strip. */
export function createTwelveLead(twelve, meta) {
  const group = new THREE.Group();
  const material = new LineMaterial({
    color: 0x141212,
    linewidth: 1.3,
    transparent: true,
    opacity: 1,
    depthWrite: false
  });
  const fs = meta.displayFs;
  const per = Math.round(2.5 * fs);
  const leadIndex = (lead) => meta.leads.indexOf(lead);
  const total = twelve.length / meta.leads.length;
  const sample = (lead, i) => twelve[leadIndex(lead) * total + i] / 1000;

  const calibration = (x, y) => [x, y, 0, x + 0.05, y, 0, x + 0.05, y + 1, 0, x + 0.45, y + 1, 0, x + 0.45, y, 0, x + 0.5, y, 0];

  LAYOUT.forEach((row, r) => {
    const points = calibration(X0 - 0.5, ROWS_Y[r]);
    row.forEach((lead, c) => {
      for (let i = 0; i < per; i += 1) {
        const t = c * 2.5 + i / fs;
        points.push(X0 + t * PAPER.speed, ROWS_Y[r] + sample(lead, c * per + i) * PAPER.gain, 0);
      }
    });
    group.add(line(points, material));
    // Lead separators, as on a printed ECG.
    for (let c = 1; c < 4; c += 1) {
      const x = X0 + c * 6.25;
      group.add(line([x, ROWS_Y[r] + 0.35, 0, x, ROWS_Y[r] - 0.35, 0], material));
    }
  });
  const rhythm = calibration(X0 - 0.5, RHYTHM_Y);
  for (let i = 0; i < total; i += 1) {
    rhythm.push(X0 + (i / fs) * PAPER.speed, RHYTHM_Y + sample('ii', i) * PAPER.gain, 0);
  }
  group.add(line(rhythm, material));
  group.position.z = 0.01;
  return {
    object: group,
    material,
    setResolution(width, height) {
      material.resolution.set(width, height);
    }
  };
}

function line(points, material) {
  const geometry = new LineGeometry();
  geometry.setPositions(points);
  const object = new Line2(geometry, material);
  object.computeLineDistances();
  return object;
}
