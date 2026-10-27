import * as THREE from 'three';
import { FONT_MONO, FONT_SANS, FONT_SERIF } from '../shared/fonts.js';
import {
  DEPTH, LOGP_MAX, LOGP_MIN, LOGRHO_MAX, LOGRHO_MIN, PT_PLOT, PV_PLOT, T_MAX, T_MIN,
  logPToZ, logVToFloorX, tToX
} from './mapping.js';
import { PRESSURE_TICKS } from './format.js';

// Margins around each plot, in world units: left, top, right, bottom.
const MARGIN = [2.4, 1.6, 1.4, 2.6];
const PX_PER_UNIT = 150;

// How the floor looks under the object's shadow. Colors are sRGB.
const INK = {
  paper: 'rgba(0, 0, 0, 0)',
  line: '#17181b',
  softLine: 'rgba(23, 24, 27, 0.55)',
  label: 'rgba(28, 29, 32, 0.92)',
  dimLabel: 'rgba(28, 29, 32, 0.62)',
  shadowText: 'rgba(236, 232, 224, 0.92)',
  shadowDim: 'rgba(236, 232, 224, 0.62)',
  ice: 'rgba(83, 96, 108, 0.86)',
  liquid: 'rgba(52, 70, 88, 0.9)',
  vapor: 'rgba(103, 99, 93, 0.78)',
  super: 'rgba(78, 76, 96, 0.86)',
  twoPhase: 'rgba(66, 66, 66, 0.9)',
  frost: 'rgba(76, 84, 92, 0.86)'
};

/** World rectangle covered by a diagram texture (plot plus margins). */
export function diagramBounds(plot) {
  return [plot[0] - MARGIN[0], plot[1] - MARGIN[1], plot[2] + MARGIN[2], plot[3] + MARGIN[3]];
}

function createCanvas(plot, maxSize) {
  const bounds = diagramBounds(plot);
  const scale = Math.min(PX_PER_UNIT, maxSize / (bounds[2] - bounds[0]), maxSize / (bounds[3] - bounds[1]));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((bounds[2] - bounds[0]) * scale);
  canvas.height = Math.round((bounds[3] - bounds[1]) * scale);
  const ctx = canvas.getContext('2d');
  // World (x, z) -> canvas pixels. Canvas down is world +z (toward low pressure).
  const px = (x) => (x - bounds[0]) * scale;
  const pz = (z) => (z - bounds[1]) * scale;
  const u = (worldUnits) => worldUnits * scale;
  return { canvas, ctx, px, pz, u, bounds };
}

function toTexture(canvas, renderer) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
}

function path(ctx, points, map, move = true) {
  points.forEach(([a, b], index) => {
    const [x, y] = map(a, b);
    if (index === 0 && move) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}

function stroke(ctx, width, color, dash = []) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.setLineDash(dash);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.setLineDash([]);
}

function text(ctx, value, x, y, { font, color, align = 'left', baseline = 'alphabetic', spacing = 0, rotate = 0 }) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotate);
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing}px`;
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

function caption(ctx, c, plot, figure, title) {
  const y = c.pz(plot[3]) + c.u(2.05);
  text(ctx, figure, c.px(plot[0]), y, { font: `500 ${c.u(0.2)}px ${FONT_MONO}`, color: INK.dimLabel, spacing: c.u(0.03) });
  text(ctx, title, c.px(plot[0]) + c.u(1.15), y, { font: `italic 400 ${c.u(0.3)}px ${FONT_SERIF}`, color: INK.label });
}

function pressureAxis(ctx, c, plot) {
  const x = c.px(plot[0]);
  for (let decade = LOGP_MIN; decade <= LOGP_MAX; decade += 1) {
    const y = c.pz(logPToZ(decade));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - c.u(0.16), y);
    stroke(ctx, c.u(0.018), INK.line);
    text(ctx, PRESSURE_TICKS[decade], x - c.u(0.26), y, {
      font: `400 ${c.u(0.2)}px ${FONT_MONO}`, color: INK.label, align: 'right', baseline: 'middle'
    });
  }
  text(ctx, 'Pressure', x - c.u(1.95), c.pz(0), {
    font: `400 ${c.u(0.34)}px ${FONT_SERIF}`, color: INK.label, align: 'center', baseline: 'middle', rotate: -Math.PI / 2
  });
}

function frame(ctx, c, plot) {
  ctx.beginPath();
  ctx.rect(c.px(plot[0]), c.pz(plot[1]), c.px(plot[2]) - c.px(plot[0]), c.pz(plot[3]) - c.pz(plot[1]));
  stroke(ctx, c.u(0.022), INK.line);
}

function dot(ctx, x, y, radius, fill, ring) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (ring) {
    ctx.lineWidth = radius * 0.45;
    ctx.strokeStyle = ring;
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Fig. 1: pressure against temperature — the shadow of the upright object.

export function drawPTDiagram(data, renderer) {
  const maxSize = Math.min(8192, renderer.capabilities.maxTextureSize);
  const plot = PT_PLOT;
  const c = createCanvas(plot, maxSize);
  const { ctx } = c;
  const map = (T, logP) => [c.px(tToX(T)), c.pz(logPToZ(logP))];
  const { sublimation, boiling, melting } = data.diagrams.pt;
  const { triple, critical, oneAtm } = data.points;
  const cornerT = melting[melting.length - 1][0];

  ctx.save();
  ctx.beginPath();
  ctx.rect(c.px(plot[0]), c.pz(plot[1]), c.px(plot[2]) - c.px(plot[0]), c.pz(plot[3]) - c.pz(plot[1]));
  ctx.clip();

  // Regions.
  ctx.beginPath();
  path(ctx, [[T_MIN, LOGP_MIN], [sublimation[0][0], LOGP_MIN]], map);
  path(ctx, sublimation, map, false);
  path(ctx, melting, map, false);
  path(ctx, [[T_MIN, LOGP_MAX]], map, false);
  ctx.closePath();
  ctx.fillStyle = INK.ice;
  ctx.fill();

  ctx.beginPath();
  path(ctx, boiling, map);
  path(ctx, [[critical.T, LOGP_MAX], [cornerT, LOGP_MAX]], map, false);
  path(ctx, [...melting].reverse(), map, false);
  ctx.closePath();
  ctx.fillStyle = INK.liquid;
  ctx.fill();

  ctx.beginPath();
  path(ctx, [[critical.T, critical.logP], [T_MAX, critical.logP], [T_MAX, LOGP_MAX], [critical.T, LOGP_MAX]], map);
  ctx.closePath();
  ctx.fillStyle = INK.super;
  ctx.fill();

  ctx.beginPath();
  path(ctx, [[sublimation[0][0], LOGP_MIN], [T_MAX, LOGP_MIN], [T_MAX, critical.logP], [critical.T, critical.logP]], map);
  path(ctx, [...boiling].reverse(), map, false);
  path(ctx, [...sublimation].reverse(), map, false);
  ctx.closePath();
  ctx.fillStyle = INK.vapor;
  ctx.fill();

  // Isotherms and isobars of the object, faint.
  for (let T = 250; T < T_MAX; T += 50) {
    ctx.beginPath();
    path(ctx, [[T, LOGP_MIN], [T, LOGP_MAX]], map);
    stroke(ctx, c.u(0.01), 'rgba(236, 232, 224, 0.12)');
  }
  for (let logP = 1; logP < LOGP_MAX; logP += 1) {
    ctx.beginPath();
    path(ctx, [[T_MIN, logP], [T_MAX, logP]], map);
    stroke(ctx, c.u(0.01), 'rgba(236, 232, 224, 0.12)');
  }

  // Conventional dashed limits of the supercritical region.
  ctx.beginPath();
  path(ctx, [[critical.T, critical.logP], [critical.T, LOGP_MAX]], map);
  stroke(ctx, c.u(0.02), 'rgba(236, 232, 224, 0.35)', [c.u(0.12), c.u(0.1)]);
  ctx.beginPath();
  path(ctx, [[critical.T, critical.logP], [T_MAX, critical.logP]], map);
  stroke(ctx, c.u(0.02), 'rgba(236, 232, 224, 0.35)', [c.u(0.12), c.u(0.1)]);

  // 1 atm.
  ctx.beginPath();
  path(ctx, [[T_MIN, oneAtm.logP], [T_MAX, oneAtm.logP]], map);
  stroke(ctx, c.u(0.016), 'rgba(236, 232, 224, 0.42)', [c.u(0.04), c.u(0.09)]);
  const [atmX, atmY] = map(T_MAX, oneAtm.logP);
  text(ctx, '1 atm', atmX - c.u(0.18), atmY - c.u(0.12), {
    font: `400 ${c.u(0.19)}px ${FONT_MONO}`, color: INK.shadowDim, align: 'right'
  });

  // The phase boundaries: where the object's walls stand edge-on.
  for (const curve of [sublimation, boiling, melting]) {
    ctx.beginPath();
    path(ctx, curve, map);
    stroke(ctx, c.u(0.075), INK.line);
  }

  // Region names.
  const serif = (size) => `400 ${c.u(size)}px ${FONT_SERIF}`;
  const italic = (size) => `italic 400 ${c.u(size)}px ${FONT_SERIF}`;
  let [x, y] = map(232, 5.4);
  text(ctx, 'Ice', x, y, { font: serif(0.8), color: INK.shadowText, align: 'center' });
  [x, y] = map(440, 6.45);
  text(ctx, 'Liquid', x, y, { font: serif(0.8), color: INK.shadowText, align: 'center' });
  [x, y] = map(560, 2.0);
  text(ctx, 'Vapor', x, y, { font: serif(0.8), color: INK.shadowText, align: 'center' });
  [x, y] = map(724, 7.72);
  text(ctx, 'Supercritical fluid', x, y, { font: italic(0.36), color: INK.shadowText, align: 'center' });

  // Triple and critical points.
  [x, y] = map(triple.T, triple.logP);
  dot(ctx, x, y, c.u(0.11), '#f4efe6', INK.line);
  text(ctx, 'Triple point', x + c.u(0.26), y + c.u(0.42), { font: italic(0.3), color: INK.shadowText });
  text(ctx, '0.01 °C · 611.657 Pa', x + c.u(0.26), y + c.u(0.74), {
    font: `400 ${c.u(0.17)}px ${FONT_MONO}`, color: INK.shadowDim
  });
  [x, y] = map(critical.T, critical.logP);
  dot(ctx, x, y, c.u(0.11), '#f4efe6', INK.line);
  text(ctx, 'Critical point', x + c.u(0.26), y + c.u(0.42), { font: italic(0.3), color: INK.shadowText });
  text(ctx, '373.95 °C · 22.064 MPa', x + c.u(0.26), y + c.u(0.74), {
    font: `400 ${c.u(0.17)}px ${FONT_MONO}`, color: INK.shadowDim
  });
  [x, y] = map(oneAtm.Tsat, oneAtm.logP);
  dot(ctx, x, y, c.u(0.06), '#f4efe6');
  text(ctx, '100 °C', x + c.u(0.14), y + c.u(0.3), { font: `400 ${c.u(0.17)}px ${FONT_MONO}`, color: INK.shadowDim });
  ctx.restore();

  frame(ctx, c, plot);
  pressureAxis(ctx, c, plot);

  // Temperature axis.
  const axisY = c.pz(plot[3]);
  for (let T = T_MIN; T <= T_MAX; T += 100) {
    const tx = c.px(tToX(T));
    ctx.beginPath();
    ctx.moveTo(tx, axisY);
    ctx.lineTo(tx, axisY + c.u(0.16));
    stroke(ctx, c.u(0.018), INK.line);
    text(ctx, `${T} K`, tx, axisY + c.u(0.46), {
      font: `400 ${c.u(0.2)}px ${FONT_MONO}`, color: INK.label, align: 'center'
    });
    text(ctx, `${Math.round(T - 273.15)} °C`, tx, axisY + c.u(0.74), {
      font: `400 ${c.u(0.16)}px ${FONT_MONO}`, color: INK.dimLabel, align: 'center'
    });
  }
  text(ctx, 'Temperature', c.px(0), axisY + c.u(1.28), {
    font: `400 ${c.u(0.34)}px ${FONT_SERIF}`, color: INK.label, align: 'center'
  });
  caption(ctx, c, plot, 'FIG. 1', 'The phase diagram of water. Pressure on a logarithmic scale.');

  return { texture: toTexture(c.canvas, renderer), bounds: c.bounds };
}

// ---------------------------------------------------------------------------
// Fig. 2: pressure against specific volume — the shadow of the object on its side.

export function drawPVDiagram(data, renderer) {
  const maxSize = Math.min(8192, renderer.capabilities.maxTextureSize);
  const plot = PV_PLOT;
  const c = createCanvas(plot, maxSize);
  const { ctx } = c;
  const map = (logV, logP) => [c.px(logVToFloorX(logV)), c.pz(logPToZ(logP))];
  const pv = data.diagrams.pv;
  const { triple, critical } = data.points;
  const vMin = -LOGRHO_MAX;
  const vMax = -LOGRHO_MIN;

  ctx.save();
  ctx.beginPath();
  ctx.rect(c.px(plot[0]), c.pz(plot[1]), c.px(plot[2]) - c.px(plot[0]), c.pz(plot[3]) - c.pz(plot[1]));
  ctx.clip();

  // Everything under the object is in shadow; single-phase vapor is the lightest.
  ctx.fillStyle = INK.vapor;
  ctx.fillRect(c.px(plot[0]), c.pz(plot[1]), c.px(plot[2]) - c.px(plot[0]), c.pz(plot[3]) - c.pz(plot[1]));

  const logPt = triple.logP;
  // Liquid + vapor dome.
  ctx.beginPath();
  path(ctx, pv.satLiquid, map);
  path(ctx, [...pv.satVapor].reverse(), map, false);
  ctx.closePath();
  ctx.fillStyle = INK.twoPhase;
  ctx.fill();
  // Ice + vapor, below the triple line.
  ctx.beginPath();
  path(ctx, pv.subIce, map);
  path(ctx, [...pv.subVapor].reverse(), map, false);
  ctx.closePath();
  ctx.fillStyle = INK.frost;
  ctx.fill();
  // Condensed phases: a narrow band at the far left.
  ctx.beginPath();
  path(ctx, [[vMin, LOGP_MIN], [pv.subIce[0][0], LOGP_MIN]], map);
  path(ctx, pv.subIce, map, false);
  path(ctx, pv.meltIce, map, false);
  path(ctx, [[vMin, LOGP_MAX]], map, false);
  ctx.closePath();
  ctx.fillStyle = INK.ice;
  ctx.fill();
  ctx.beginPath();
  path(ctx, pv.satLiquid, map);
  path(ctx, [[critical.logRho * -1, LOGP_MAX]], map, false);
  path(ctx, [...pv.meltLiquid].reverse(), map, false);
  ctx.closePath();
  ctx.fillStyle = INK.liquid;
  ctx.fill();

  // Isotherms: sections of the object at constant temperature. Their flat
  // parts are the tie lines across the dome.
  for (const isotherm of pv.isotherms) {
    const critical_ = Math.abs(isotherm.T - critical.T) < 0.5;
    ctx.beginPath();
    path(ctx, isotherm.points, map);
    stroke(ctx, c.u(critical_ ? 0.04 : 0.022), critical_ ? 'rgba(236, 232, 224, 0.9)' : 'rgba(236, 232, 224, 0.42)');
    const last = isotherm.points[isotherm.points.length - 1];
    const first = isotherm.points[0];
    const anchor = first[0] < vMax ? first : last;
    const [lx, ly] = map(Math.min(anchor[0], vMax - 0.15), Math.max(anchor[1], LOGP_MIN + 0.12));
    if (isotherm.T >= 300 && isotherm.T % 100 === 0) {
      text(ctx, `${isotherm.T} K`, lx - c.u(0.06), ly - c.u(0.1), {
        font: `400 ${c.u(0.15)}px ${FONT_MONO}`, color: INK.shadowDim, align: 'right'
      });
    }
  }

  // Saturation and solid boundaries.
  for (const curve of [pv.satLiquid, pv.satVapor, pv.subIce, pv.subVapor, pv.meltIce, pv.meltLiquid]) {
    ctx.beginPath();
    path(ctx, curve, map);
    stroke(ctx, c.u(0.06), INK.line);
  }
  // Triple line: where all three phases share one pressure.
  ctx.beginPath();
  path(ctx, [[-triple.logRhoLiquid, logPt], [-triple.logRhoVapor, logPt]], map);
  stroke(ctx, c.u(0.07), '#f4efe6');

  const serif = (size) => `400 ${c.u(size)}px ${FONT_SERIF}`;
  const italic = (size) => `italic 400 ${c.u(size)}px ${FONT_SERIF}`;
  let [x, y] = map(-0.2, 5.0);
  text(ctx, 'Liquid', x, y, { font: italic(0.42), color: INK.shadowText, align: 'center' });
  text(ctx, '+ vapor', x, y + c.u(0.48), { font: italic(0.42), color: INK.shadowText, align: 'center' });
  [x, y] = map(2.2, 1.35);
  text(ctx, 'Ice + vapor', x, y, { font: italic(0.42), color: INK.shadowText, align: 'center' });
  [x, y] = map(3.4, 4.9);
  text(ctx, 'Vapor', x, y, { font: serif(0.6), color: INK.shadowText, align: 'center' });
  [x, y] = map(-1.55, 7.62);
  text(ctx, 'Supercritical', x, y, { font: italic(0.3), color: INK.shadowText, align: 'left' });
  [x, y] = map(-triple.logRhoVapor, logPt);
  text(ctx, 'Triple line', x - c.u(0.1), y - c.u(0.16), { font: italic(0.28), color: INK.shadowText, align: 'right' });
  [x, y] = map(-critical.logRho, critical.logP);
  dot(ctx, x, y, c.u(0.09), '#f4efe6', INK.line);
  text(ctx, 'Critical point', x + c.u(0.2), y - c.u(0.18), { font: italic(0.28), color: INK.shadowText });
  ctx.restore();

  // The condensed phases are too dense to fit in the plot as text: label outside.
  const [bandX] = map(-2.95, 0);
  text(ctx, 'Ice and liquid', bandX, c.pz(plot[1]) - c.u(0.22), {
    font: italic(0.26), color: INK.label, align: 'left'
  });

  frame(ctx, c, plot);
  pressureAxis(ctx, c, plot);

  const axisY = c.pz(plot[3]);
  const superscript = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵' };
  for (let decade = -3; decade <= 5; decade += 1) {
    const tx = c.px(logVToFloorX(decade));
    ctx.beginPath();
    ctx.moveTo(tx, axisY);
    ctx.lineTo(tx, axisY + c.u(0.16));
    stroke(ctx, c.u(0.018), INK.line);
    const label = decade === 0 ? '1' : decade === 1 ? '10' : `10${String(decade).split('').map((d) => superscript[d]).join('')}`;
    text(ctx, label, tx, axisY + c.u(0.46), { font: `400 ${c.u(0.2)}px ${FONT_MONO}`, color: INK.label, align: 'center' });
  }
  text(ctx, 'Specific volume', c.px((plot[0] + plot[2]) / 2), axisY + c.u(1.0), {
    font: `400 ${c.u(0.34)}px ${FONT_SERIF}`, color: INK.label, align: 'center'
  });
  text(ctx, 'm³/kg', c.px((plot[0] + plot[2]) / 2), axisY + c.u(1.34), {
    font: `400 ${c.u(0.17)}px ${FONT_MONO}`, color: INK.dimLabel, align: 'center'
  });
  const y2 = c.pz(plot[3]) + c.u(2.05);
  text(ctx, 'FIG. 2', c.px(plot[0]), y2, { font: `500 ${c.u(0.2)}px ${FONT_MONO}`, color: INK.dimLabel, spacing: c.u(0.03) });
  text(ctx, 'Pressure against volume.', c.px(plot[0]) + c.u(1.15), y2, {
    font: `italic 400 ${c.u(0.3)}px ${FONT_SERIF}`, color: INK.label
  });

  return { texture: toTexture(c.canvas, renderer), bounds: c.bounds };
}

export { FONT_SANS, DEPTH };
