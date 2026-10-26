import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { UNIT_M } from './model.js';

/**
 * The tide gauge's strip chart, standing beside the model on the same vertical
 * axis: a point on the curve is drawn at exactly the height the sea has in the
 * bay. The record scrolls past a fixed pen.
 */
export function createRecorder({ observed, predicted, intervalHours, datums, left, right, z }) {
  const hoursPerUnit = 12;
  const width = right - left;
  const penX = right - 0.7;
  const lowM = -5;
  const highM = 5.4;

  const group = new THREE.Group();
  group.name = 'recorder';

  const uniforms = {
    uLeft: { value: left },
    uRight: { value: right },
    uLow: { value: lowM },
    uHigh: { value: highM },
    uVert: { value: 8 },
    uHour: { value: 0 },
    uPenX: { value: penX },
    uHoursPerUnit: { value: hoursPerUnit },
    uDatums: { value: new THREE.Vector4(datums.MHHW, datums.MSL, datums.MLLW, 0) },
    uOpacity: { value: 1 }
  };

  const paper = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uLeft;
        uniform float uRight;
        uniform float uLow;
        uniform float uHigh;
        uniform float uVert;
        varying vec2 vPlot; // x world, y meters
        void main() {
          vec3 p = position + 0.5;
          float x = mix(uLeft, uRight, p.x);
          float meters = mix(uLow, uHigh, p.y);
          vPlot = vec2(x, meters);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(x, meters * uVert / ${UNIT_M.toFixed(1)}, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLeft;
        uniform float uRight;
        uniform float uHour;
        uniform float uPenX;
        uniform float uHoursPerUnit;
        uniform vec4 uDatums;
        uniform float uOpacity;
        varying vec2 vPlot;

        float hline(float value, float at, float width) {
          return 1.0 - smoothstep(0.0, width, abs(value - at) / max(fwidth(value), 1e-5));
        }

        void main() {
          float hour = uHour + (vPlot.x - uPenX) * uHoursPerUnit;
          float sixHour = abs(fract(hour / 6.0 - 0.5) - 0.5) / max(fwidth(hour / 6.0), 1e-5);
          float day = abs(fract(hour / 24.0 - 0.5) - 0.5) / max(fwidth(hour / 24.0), 1e-5);
          float meter = abs(fract(vPlot.y - 0.5) - 0.5) / max(fwidth(vPlot.y), 1e-5);
          vec3 color = vec3(0.055, 0.058, 0.065);
          color += vec3(0.05) * (1.0 - smoothstep(0.0, 1.0, sixHour));
          color += vec3(0.11) * (1.0 - smoothstep(0.0, 1.2, day));
          color += vec3(0.035) * (1.0 - smoothstep(0.0, 1.0, meter));
          float datum = max(max(hline(vPlot.y, uDatums.x, 1.0), hline(vPlot.y, uDatums.z, 1.0)), hline(vPlot.y, uDatums.y, 0.8) * 0.6);
          color = mix(color, vec3(0.42, 0.44, 0.47), datum * 0.8);
          // Fade the record toward the left edge, where the paper runs out.
          float fade = smoothstep(uLeft, uLeft + 0.6, vPlot.x) * (1.0 - smoothstep(uRight - 0.12, uRight, vPlot.x));
          // The future, to the right of the pen, is blank paper.
          float future = smoothstep(uPenX, uPenX + 0.02, vPlot.x);
          color = mix(color, color * 0.55, future);
          gl_FragColor = vec4(color, 0.96 * uOpacity * max(fade, 0.35));
        }
      `
    })
  );
  paper.frustumCulled = false;
  paper.position.z = z;
  group.add(paper);

  // The full record as one polyline in chart coordinates, slid under the pen
  // and clipped to the paper.
  const clip = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -left - 0.05), new THREE.Plane(new THREE.Vector3(-1, 0, 0), penX)];
  const clipFuture = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -left - 0.05), new THREE.Plane(new THREE.Vector3(-1, 0, 0), right - 0.08)];
  const curve = (values, material) => {
    const points = [];
    for (let i = 0; i < values.length; i += 1) points.push((i * intervalHours) / hoursPerUnit, values[i], 0);
    const geometry = new LineGeometry();
    geometry.setPositions(points);
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    line.frustumCulled = false;
    return line;
  };
  const inkMaterial = new LineMaterial({ color: 0xf1ebe1, linewidth: 1.8, transparent: true, clippingPlanes: clip, depthWrite: false });
  const forecastMaterial = new LineMaterial({ color: 0x9fc3e0, linewidth: 1.1, transparent: true, opacity: 0, clippingPlanes: clipFuture, depthWrite: false });
  const ink = curve(observed, inkMaterial);
  const forecast = curve(predicted, forecastMaterial);
  const record = new THREE.Group();
  record.add(forecast, ink);
  record.position.z = z + 0.004;
  group.add(record);

  // Pen and the level line carried across to the model.
  const penMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.9, 1.1), transparent: true });
  const pen = new THREE.Mesh(new THREE.SphereGeometry(0.045, 18, 12), penMaterial);
  group.add(pen);
  const levelMaterial = new LineMaterial({ color: 0xe8b66e, linewidth: 1.2, transparent: true, opacity: 0.9, depthWrite: false });
  const levelGeometry = new LineGeometry();
  levelGeometry.setPositions([0, 0, 0, 1, 0, 0]);
  const levelLine = new Line2(levelGeometry, levelMaterial);
  levelLine.frustumCulled = false;
  levelLine.renderOrder = 3; // after the cut faces and the sea, which do not write depth
  group.add(levelLine);

  return {
    object: group,
    uniforms,
    penX,
    materials: [inkMaterial, forecastMaterial, levelMaterial],
    setResolution(w, h) {
      for (const material of [inkMaterial, forecastMaterial, levelMaterial]) material.resolution.set(w, h);
    },
    /** hour: time of the pen; level: water level (m); reach: world x the level line runs to. */
    update({ hour, level, vert, reach, showForecast, opacity }) {
      uniforms.uHour.value = hour;
      uniforms.uVert.value = vert;
      uniforms.uOpacity.value = opacity;
      group.visible = opacity > 0.005;
      penMaterial.opacity = opacity;
      const yScale = vert / UNIT_M;
      record.scale.set(1, yScale, 1);
      record.position.x = penX - hour / hoursPerUnit;
      record.updateMatrixWorld();
      inkMaterial.opacity = opacity;
      forecastMaterial.opacity = showForecast * opacity;
      pen.position.set(penX, level * yScale, z + 0.01);
      // Just in front of the section face, which sits a hair south of z.
      levelGeometry.setPositions([penX, level * yScale, z + 0.03, reach, level * yScale, z + 0.03]);
      levelMaterial.opacity = 0.9 * opacity;
    },
    height(vert) {
      return ((highM - lowM) * vert) / UNIT_M;
    },
    lowM,
    highM,
    left,
    right,
    z,
    width
  };
}
