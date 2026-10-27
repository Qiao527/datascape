import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { tToX, logPToZ, logRhoToY, LOGRHO_MIN } from './mapping.js';

export const PHASE = { ICE: 0, LIQUID: 1, VAPOR: 2, BOILING: 3, SUBLIMATION: 4, MELTING: 5 };
const PATCH_PHASE = { ice: PHASE.ICE, liquid: PHASE.LIQUID, vapor: PHASE.VAPOR };
const CURTAIN_PHASE = { boiling: PHASE.BOILING, sublimation: PHASE.SUBLIMATION, melting: PHASE.MELTING };

export const PALETTE = {
  ice: new THREE.Color(0xdde6ec),
  liquid: new THREE.Color(0x7d9bb2),
  vapor: new THREE.Color(0xd8d2c8),
  supercritical: new THREE.Color(0xb3b2c6),
  boiling: new THREE.Color(0xf3efe8),
  frost: new THREE.Color(0xe2eaf0),
  accent: new THREE.Color(0xe8b66e)
};

/**
 * Builds the object: three single-phase patches, three coexistence curtains,
 * and the rim lines that trace the saturation curves and the triple line.
 */
export function createSurface(data, { fog }) {
  const { triple, critical } = data.points;
  const uniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 1 },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uIce: { value: PALETTE.ice },
    uLiquid: { value: PALETTE.liquid },
    uVapor: { value: PALETTE.vapor },
    uSuper: { value: PALETTE.supercritical },
    uBoil: { value: PALETTE.boiling },
    uFrost: { value: PALETTE.frost },
    uAccent: { value: PALETTE.accent },
    // x: boiling wall, y: sublimation and melting walls, z: supercritical region, w: hover pulse
    uHighlight: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHover: { value: new THREE.Vector3(0, 0, -1) },
    uLines: { value: 1 },
    uFogColor: { value: fog.color },
    uFogDensity: { value: fog.density }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    defines: {
      T_CRIT: critical.T.toFixed(4),
      LOGP_CRIT: critical.logP.toFixed(5),
      T_TRIPLE: triple.T.toFixed(4),
      LOGRHO_MIN: LOGRHO_MIN.toFixed(4)
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aFrac;
      attribute vec3 aState; // T, log10 P, log10 rho
      varying vec3 vState;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vPhase;
      varying float vFrac;

      void main() {
        vState = aState;
        vPhase = aPhase;
        vFrac = aFrac;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        // Inverse-transpose keeps normals right while the object is squashed
        // flat during its rise from the floor.
        vNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uLightDir;
      uniform vec3 uIce;
      uniform vec3 uLiquid;
      uniform vec3 uVapor;
      uniform vec3 uSuper;
      uniform vec3 uBoil;
      uniform vec3 uFrost;
      uniform vec3 uAccent;
      uniform vec4 uHighlight;
      uniform vec3 uHover;
      uniform float uLines;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying vec3 vState;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vPhase;
      varying float vFrac;

      float isoline(float coordinate, float width) {
        float d = abs(fract(coordinate - 0.5) - 0.5) / max(fwidth(coordinate), 1e-5);
        return 1.0 - smoothstep(0.0, width, d);
      }

      void main() {
        float T = vState.x;
        float logP = vState.y;
        float logRho = vState.z;

        vec3 tint;
        float wall = 0.0;
        if (vPhase < 0.5) {
          tint = uIce;
        } else if (vPhase < 2.5) {
          vec3 below = vPhase < 1.5 ? uLiquid : uVapor;
          float hot = smoothstep(T_CRIT - 3.0, T_CRIT + 3.0, T);
          float dense = smoothstep(LOGP_CRIT - 0.03, LOGP_CRIT + 0.03, logP);
          tint = mix(below, mix(uVapor, uSuper, dense), hot);
          // Fluid tints follow density so the supercritical slope blends
          // smoothly from vapor-like to liquid-like.
          if (vPhase > 1.5 && T < T_CRIT) tint = uVapor;
        } else if (vPhase < 3.5) {
          tint = uBoil;
          wall = 1.0;
        } else if (vPhase < 4.5) {
          tint = uFrost;
          wall = 1.0;
        } else {
          tint = mix(uIce, uLiquid, 0.5);
          wall = 1.0;
        }

        vec3 n = normalize(vNormal);
        if (!gl_FrontFacing) n = -n;
        vec3 v = normalize(cameraPosition - vWorld);

        // Key: the overhead lamp, a spotlight with the same falloff as on the
        // floor. Fill: faint bounce light from the front-right, so the walls
        // that the lamp cannot reach still read as form.
        float r = length(vWorld.xz * vec2(0.82, 1.0));
        float pool = 0.2 + 0.8 * exp(-pow(r / 19.0, 2.2));
        float key = max(dot(n, uLightDir), 0.0);
        float fill = max(dot(n, normalize(vec3(0.45, 0.32, 0.83))), 0.0);
        float back = max(dot(n, normalize(vec3(-0.5, 0.2, -0.84))), 0.0);
        float underside = smoothstep(0.05, -0.7, dot(n, uLightDir));
        vec3 h = normalize(uLightDir + v);
        float specular = pow(max(dot(n, h), 0.0), 90.0) * 0.12 * (1.0 - wall);
        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 5.0);

        float lit = 0.06 + 0.64 * key * pool + 0.3 * fill + 0.08 * back;
        vec3 color = tint * lit + specular * pool;
        color = mix(color, tint * 0.05, underside * 0.5);
        color += tint * fresnel * 0.12;

        if (wall > 0.5) {
          // Coexistence walls: a matte veil lit only by the bounce light,
          // with a faint glow toward the dense rim that brightens on cue.
          float highlight = vPhase < 3.5 ? uHighlight.x : uHighlight.y;
          float rim = pow(vFrac, 3.0);
          color = tint * (0.1 + 0.42 * fill + 0.1 * back + 0.08 * rim);
          float breathe = 0.75 + 0.25 * sin(uTime * 1.4 - logRho * 1.1);
          color += uBoil * highlight * (0.05 + 0.12 * rim) * breathe;
          color += tint * fresnel * 0.08;
        }

        float region = uHighlight.z * smoothstep(T_CRIT - 2.0, T_CRIT + 6.0, T) * smoothstep(LOGP_CRIT - 0.02, LOGP_CRIT + 0.1, logP);
        color += uSuper * region * 0.35;

        // Engraved isolines: isotherms every 50 K, isobars every decade,
        // density contours every decade.
        float lines = max(isoline(T / 50.0, 0.9) * 0.55, isoline(logP, 0.9) * 0.55);
        lines = max(lines, isoline(logRho, 1.0) * 0.8);
        color = mix(color, color * (wall > 0.5 ? 0.62 : 0.5), lines * uLines);

        // Hovered isotherm and isobar.
        if (uHover.z > 0.0) {
          float near = isoline((T - uHover.x) / 600.0 + 0.5, 1.3) + isoline((logP - uHover.y) / 8.0 + 0.5, 1.3);
          color = mix(color, uAccent * 1.4, clamp(near, 0.0, 1.0) * 0.75);
        }

        float distance = length(vWorld - cameraPosition);
        float fogAmount = 1.0 - exp(-pow(uFogDensity * distance, 2.0));
        color = mix(color, uFogColor, fogAmount);

        gl_FragColor = vec4(color, uOpacity);
      }
    `
  });

  const group = new THREE.Group();
  group.name = 'water-surface';
  const meshes = [];

  const patchGeometries = data.patches.map((patch) => patchGeometry(patch, PATCH_PHASE[patch.name]));
  smoothSupercriticalSeam(data, patchGeometries);
  patchGeometries.forEach((geometry, index) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = data.patches[index].name;
    mesh.userData = { kind: 'patch', phase: data.patches[index].name };
    group.add(mesh);
    meshes.push(mesh);
  });

  data.curtains.forEach((curtain) => {
    const mesh = new THREE.Mesh(curtainGeometry(curtain, CURTAIN_PHASE[curtain.name]), material);
    mesh.name = curtain.name;
    mesh.userData = { kind: 'curtain', phase: curtain.name, curtain };
    mesh.renderOrder = 1;
    group.add(mesh);
    meshes.push(mesh);
  });

  const lineMaterial = new LineMaterial({
    color: 0xf6f1e8,
    linewidth: 1.25,
    transparent: true,
    opacity: 0.7,
    depthWrite: false
  });
  const tripleMaterial = new LineMaterial({
    color: 0xffffff,
    linewidth: 2.2,
    transparent: true,
    opacity: 0.95,
    depthWrite: false
  });
  const lines = new THREE.Group();
  group.add(lines);
  for (const curtain of data.curtains) {
    if (curtain.name === 'melting') continue;
    lines.add(polyline(curtain, curtain.logRhoLow, lineMaterial));
    lines.add(polyline(curtain, curtain.logRhoHigh, lineMaterial));
  }
  const tripleLine = makeLine([
    tToX(triple.T), logRhoToY(triple.logRhoVapor), logPToZ(triple.logP),
    tToX(triple.T), logRhoToY(triple.logRhoLiquid), logPToZ(triple.logP)
  ], tripleMaterial);
  lines.add(tripleLine);

  // Critical point: a small bright bead.
  const critical3 = new THREE.Vector3(tToX(critical.T), logRhoToY(critical.logRho), logPToZ(critical.logP));
  const bead = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 24, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.35), transparent: true })
  );
  bead.position.copy(critical3);
  group.add(bead);

  return {
    object: group,
    meshes,
    uniforms,
    lineMaterials: [lineMaterial, tripleMaterial],
    bead,
    anchors: {
      critical: critical3,
      tripleTop: new THREE.Vector3(tToX(triple.T), logRhoToY(triple.logRhoLiquid), logPToZ(triple.logP)),
      tripleMid: new THREE.Vector3(
        tToX(triple.T),
        logRhoToY((triple.logRhoVapor + triple.logRhoLiquid) / 2),
        logPToZ(triple.logP)
      )
    },
    setOpacity(opacity) {
      uniforms.uOpacity.value = opacity;
      // Only sort as transparent while fading, to avoid self-sorting artifacts.
      material.transparent = opacity < 0.999;
      lineMaterial.opacity = 0.7 * opacity;
      tripleMaterial.opacity = 0.95 * opacity;
      bead.material.opacity = opacity;
      group.visible = opacity > 0.001;
    },
    setResolution(width, height) {
      lineMaterial.resolution.set(width, height);
      tripleMaterial.resolution.set(width, height);
    },
    /** Height (local y) of the surface nearest to (T, logP) in the given patch. */
    heightAt(name, T, logP) {
      const patch = data.patches.find((item) => item.name === name);
      let best = Infinity;
      let y = 0;
      for (let i = 0; i < patch.T.length; i += 1) {
        const dx = (patch.T[i] - T) / 50;
        const dz = patch.logP[i] - logP;
        const d = dx * dx + dz * dz;
        if (d < best) {
          best = d;
          y = logRhoToY(patch.logRho[i]);
        }
      }
      return y;
    }
  };
}

function patchGeometry(patch, phase) {
  const count = patch.cols * patch.rows;
  const positions = new Float32Array(count * 3);
  const state = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = tToX(patch.T[i]);
    positions[i * 3 + 1] = logRhoToY(patch.logRho[i]);
    positions[i * 3 + 2] = logPToZ(patch.logP[i]);
    state[i * 3] = patch.T[i];
    state[i * 3 + 1] = patch.logP[i];
    state[i * 3 + 2] = patch.logRho[i];
  }
  const index = [];
  for (let row = 0; row < patch.rows - 1; row += 1) {
    for (let col = 0; col < patch.cols - 1; col += 1) {
      const a = row * patch.cols + col;
      const b = a + 1;
      const c = a + patch.cols;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aState', new THREE.BufferAttribute(state, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(count).fill(phase), 1));
  geometry.setAttribute('aFrac', new THREE.BufferAttribute(new Float32Array(count), 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Above the critical temperature the vapor and liquid patches are one smooth
 * fluid surface that merely meets along the critical isochore. Average the
 * normals of the coincident vertices there so no shading seam shows.
 */
function smoothSupercriticalSeam(data, geometries) {
  const vaporIndex = data.patches.findIndex((patch) => patch.name === 'vapor');
  const liquidIndex = data.patches.findIndex((patch) => patch.name === 'liquid');
  const vapor = data.patches[vaporIndex];
  const { jTriple, jCrit } = data.split;
  const vaporNormals = geometries[vaporIndex].attributes.normal;
  const liquidNormals = geometries[liquidIndex].attributes.normal;
  const n = new THREE.Vector3();
  const m = new THREE.Vector3();
  for (let j = jCrit; j < vapor.cols; j += 1) {
    const vi = (vapor.rows - 1) * vapor.cols + j;
    const li = j - jTriple;
    n.fromBufferAttribute(vaporNormals, vi);
    m.fromBufferAttribute(liquidNormals, li);
    n.add(m).normalize();
    vaporNormals.setXYZ(vi, n.x, n.y, n.z);
    liquidNormals.setXYZ(li, n.x, n.y, n.z);
  }
}

function curtainGeometry(curtain, phase) {
  const count = curtain.count;
  const positions = new Float32Array(count * 6);
  const state = new Float32Array(count * 6);
  const frac = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const x = tToX(curtain.T[i]);
    const z = logPToZ(curtain.logP[i]);
    positions.set([x, logRhoToY(curtain.logRhoLow[i]), z, x, logRhoToY(curtain.logRhoHigh[i]), z], i * 6);
    state.set([
      curtain.T[i], curtain.logP[i], curtain.logRhoLow[i],
      curtain.T[i], curtain.logP[i], curtain.logRhoHigh[i]
    ], i * 6);
    frac[i * 2] = 0;
    frac[i * 2 + 1] = 1;
  }
  const index = [];
  for (let i = 0; i < count - 1; i += 1) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aState', new THREE.BufferAttribute(state, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(count * 2).fill(phase), 1));
  geometry.setAttribute('aFrac', new THREE.BufferAttribute(frac, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function polyline(curtain, logRho, material) {
  const points = [];
  for (let i = 0; i < curtain.count; i += 1) {
    points.push(tToX(curtain.T[i]), logRhoToY(logRho[i]), logPToZ(curtain.logP[i]));
  }
  return makeLine(points, material);
}

function makeLine(points, material) {
  const geometry = new LineGeometry();
  geometry.setPositions(points);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  return line;
}
