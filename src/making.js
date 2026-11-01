// The making-of page. Its one live figure uses the same beam model and the same
// manifest as the piece, so it cannot drift from what the piece actually draws.
import './shared/base.css';
import './shared/fonts.js';
import './making.css';
import { beamHeight, slantForGround } from './storm/beam.js';

const SVG = 'http://www.w3.org/2000/svg';
const RANGE_KM = 150;
const TOP_KM = 22;
const BOX = { left: 46, right: 690, top: 14, bottom: 326 };

function drawBeams(svg, meta) {
  const x = (km) => BOX.left + (km / RANGE_KM) * (BOX.right - BOX.left);
  const y = (km) => BOX.bottom - (km / TOP_KM) * (BOX.bottom - BOX.top);
  const add = (name, attributes, text) => {
    const element = document.createElementNS(SVG, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (text) element.textContent = text;
    svg.appendChild(element);
  };
  for (const km of [0, 5, 10, 15, 20]) {
    add('line', { x1: BOX.left, x2: BOX.right, y1: y(km), y2: y(km), class: 'grid' });
    add('text', { x: BOX.left - 8, y: y(km) + 3.5, class: 'axis end' }, String(km));
  }
  for (const km of [0, 50, 100, 150]) {
    add('line', { x1: x(km), x2: x(km), y1: BOX.top, y2: BOX.bottom, class: 'grid' });
    add('text', { x: x(km), y: BOX.bottom + 18, class: 'axis middle' }, `${km} km`);
  }
  add('text', { x: BOX.left, y: BOX.top - 2, class: 'axis' }, 'km above the antenna');

  const coreKm = Math.hypot(...meta.core);
  add('rect', { x: x(coreKm - 15), y: BOX.top, width: x(30) - x(0), height: BOX.bottom - BOX.top, class: 'storm' });
  for (const sweep of meta.sweeps) {
    const points = [];
    for (let km = 0; km <= sweep.rmax; km += 2) {
      const height = beamHeight(slantForGround(km, sweep.el), sweep.el);
      if (height > TOP_KM) break;
      points.push(`${x(km).toFixed(1)},${y(height).toFixed(1)}`);
    }
    add('polyline', { points: points.join(' '), class: 'beam' });
  }
  add('text', { x: x(coreKm), y: BOX.top + 14, class: 'axis middle storm-label' }, 'the storm');
}

fetch('/data/storm/storm.json')
  .then((response) => response.json())
  .then((meta) => drawBeams(document.querySelector('#beam-plot'), meta))
  .catch(() => {
    document.querySelector('#beam-caption').textContent = 'The plot of the fourteen beams could not be drawn: the scan manifest did not load.';
  });
