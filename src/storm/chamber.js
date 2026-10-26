import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { beamHeight, groundRange } from './beam.js';

// Measurement traces: the chamber's frame and height ruler, the section's
// outline, the beam while it scans, and the tornado's surveyed path.

const ACCENT = 0xe8b66e;

export function createChamber({ bounds, groundKm, antennaAboveGround, tornado, lowestEl }) {
  const group = new THREE.Group();
  group.name = 'chamber';
  const materials = [];
  const material = (options) => {
    const m = new LineMaterial({ transparent: true, depthWrite: false, ...options });
    materials.push(m);
    return m;
  };

  // ---------------------------------------------------------------- frame
  const frameMaterial = material({ color: 0xd8d3ca, linewidth: 1, opacity: 0 });
  const frameGeometry = new LineSegmentsGeometry();
  const frame = new LineSegments2(frameGeometry, frameMaterial);
  frame.frustumCulled = false;
  frame.renderOrder = 30;
  group.add(frame);

  const tickMaterial = material({ color: 0xd8d3ca, linewidth: 1, opacity: 0 });
  const tickGeometry = new LineSegmentsGeometry();
  const ticks = new LineSegments2(tickGeometry, tickMaterial);
  ticks.frustumCulled = false;
  ticks.renderOrder = 30;
  group.add(ticks);

  // ---------------------------------------------------------------- section
  const cutMaterial = material({ color: ACCENT, linewidth: 1.2, opacity: 0 });
  const cutGeometry = new LineGeometry();
  const cut = new Line2(cutGeometry, cutMaterial);
  cut.frustumCulled = false;
  cut.renderOrder = 31;
  group.add(cut);

  // ---------------------------------------------------------------- beam
  const beamMaterial = material({ color: ACCENT, linewidth: 1.4, opacity: 0 });
  const beamGeometry = new LineGeometry();
  const beamPositions = new Float32Array(48 * 3);
  beamGeometry.setPositions(beamPositions);
  const beam = new Line2(beamGeometry, beamMaterial);
  beam.frustumCulled = false;
  beam.renderOrder = 32;
  group.add(beam);

  // ---------------------------------------------------------------- tornado
  const [bx, by] = tornado.beginXY;
  const [ex, ey] = tornado.endXY;
  const trackMaterial = material({ color: ACCENT, linewidth: 2, opacity: 0, dashed: true, dashSize: 0.9, gapSize: 0.55 });
  const trackGeometry = new LineGeometry();
  trackGeometry.setPositions([bx, 0.06, -by, ex, 0.06, -ey]);
  const track = new Line2(trackGeometry, trackMaterial);
  track.computeLineDistances();
  track.frustumCulled = false;
  track.renderOrder = 10;
  group.add(track);

  const ringPoints = [];
  for (let i = 0; i <= 48; i += 1) {
    const a = (i / 48) * Math.PI * 2;
    ringPoints.push(bx + Math.cos(a) * 0.9, 0.07, -by + Math.sin(a) * 0.9);
  }
  const markGeometry = new LineGeometry();
  markGeometry.setPositions(ringPoints);
  const mark = new Line2(markGeometry, material({ color: ACCENT, linewidth: 1.4, opacity: 0 }));
  mark.frustumCulled = false;
  mark.renderOrder = 10;
  group.add(mark);

  // From the ground up to the centre of the lowest beam over the touchdown.
  const dropMaterial = material({ color: 0xece8e1, linewidth: 1, opacity: 0, dashed: true, dashSize: 0.18, gapSize: 0.14 });
  const dropGeometry = new LineGeometry();
  dropGeometry.setPositions([bx, 0, -by, bx, 1, -by]);
  const drop = new Line2(dropGeometry, dropMaterial);
  drop.frustumCulled = false;
  drop.renderOrder = 33;
  group.add(drop);
  const touchRange = Math.hypot(bx, by);
  const lowestOverTouchdown = (() => {
    // Find the slant range whose ground range is the touchdown distance.
    let r = touchRange;
    for (let i = 0; i < 4; i += 1) r *= touchRange / groundRange(r, lowestEl);
    return beamHeight(r, lowestEl) + antennaAboveGround;
  })();

  let lastKey = '';
  function rebuild(vert) {
    const key = vert.toFixed(4);
    if (key === lastKey) return;
    lastKey = key;
    const { xMin, xMax, nMin, nMax, zTop } = bounds;
    const y1 = (zTop - groundKm) * vert;
    const z0 = -nMax;
    const z1 = -nMin;
    const corners = [
      [xMin, z0], [xMax, z0], [xMax, z1], [xMin, z1]
    ];
    const seg = [];
    for (let i = 0; i < 4; i += 1) {
      const [ax, az] = corners[i];
      const [cx, cz] = corners[(i + 1) % 4];
      seg.push(ax, 0, az, cx, 0, cz, ax, y1, az, cx, y1, cz, ax, 0, az, ax, y1, az);
    }
    frameGeometry.setPositions(seg);

    // Height ruler on the corner nearest the radar: a tick per km, longer every 5.
    const tickSeg = [];
    for (let km = 1; km <= Math.floor(zTop); km += 1) {
      const y = (km - groundKm) * vert;
      const len = km % 5 === 0 ? 2.4 : 1.1;
      tickSeg.push(xMin, y, z1, xMin - len, y, z1);
    }
    tickGeometry.setPositions(tickSeg);
    dropGeometry.setPositions([bx, 0.05, -by, bx, lowestOverTouchdown * vert, -by]);
    drop.computeLineDistances();
  }

  return {
    group,
    lowestOverTouchdown,
    setResolution(w, h) {
      for (const m of materials) m.resolution.set(w, h);
    },
    /** Position of the beam centre at slant range r on a sweep, for labels. */
    update({ vert, frameOpacity, cutKm, cutOpacity, beamAz, beamEl, beamRmax, beamOpacity, tornadoOpacity }) {
      rebuild(vert);
      frameMaterial.opacity = 0.32 * frameOpacity;
      tickMaterial.opacity = 0.5 * frameOpacity;
      frame.visible = ticks.visible = frameOpacity > 0.002;

      cut.visible = cutOpacity > 0.002;
      if (cut.visible) {
        const { xMin, xMax, nMin, nMax } = bounds;
        const y = (cutKm - groundKm) * vert;
        cutGeometry.setPositions([xMin, y, -nMin, xMax, y, -nMin, xMax, y, -nMax, xMin, y, -nMax, xMin, y, -nMin]);
        cutMaterial.opacity = 0.9 * cutOpacity;
      }

      beam.visible = beamOpacity > 0.002;
      if (beam.visible) {
        const a = (beamAz * Math.PI) / 180;
        const n = beamPositions.length / 3;
        for (let i = 0; i < n; i += 1) {
          const r = (i / (n - 1)) * beamRmax;
          const s = groundRange(r, beamEl);
          const h = beamHeight(r, beamEl) + antennaAboveGround;
          beamPositions[i * 3] = s * Math.sin(a);
          beamPositions[i * 3 + 1] = h * vert + 0.08;
          beamPositions[i * 3 + 2] = -s * Math.cos(a);
        }
        beamGeometry.setPositions(beamPositions);
        beamMaterial.opacity = 0.95 * beamOpacity;
      }

      track.visible = mark.visible = drop.visible = tornadoOpacity > 0.002;
      trackMaterial.opacity = tornadoOpacity;
      mark.material.opacity = tornadoOpacity;
      dropMaterial.opacity = 0.7 * tornadoOpacity;
    }
  };
}
