import * as THREE from 'three';
import { BEAM_GLSL } from './beam.js';

// The fourteen sweeps of the volume scan. Each is a cone of slant range x
// azimuth, drawn with its own measured samples. The lowest is also the flat
// radar map: lift 0 lays it on the ground, lift 1 raises it to its true height.

const VERTEX = /* glsl */ `
  ${BEAM_GLSL}
  attribute float aRange;
  attribute float aAz;
  uniform float uEl;        // radians, the elevation drawn
  uniform float uLift;
  uniform float uVert;
  uniform float uAntenna;   // antenna height above the drawn ground, km
  varying float vRange;
  varying float vAz;
  void main() {
    float h = beamHeight(aRange, uEl);
    float s = groundRange(aRange, uEl, h);
    float a = radians(aAz);
    vec3 p = vec3(s * sin(a), mix(0.04, (h + uAntenna) * uVert, uLift), -s * cos(a));
    vRange = aRange;
    vAz = aAz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uLut;
#ifdef ARRAY
  precision highp sampler2DArray;
  uniform sampler2DArray uSweeps;
  uniform float uLayer;
#else
  uniform sampler2D uSweep;
#endif
  uniform float uSpan;      // km of range the texture covers
  uniform float uRmax;
  uniform float uData;
  uniform float uOpacity;
  uniform float uGrid;
  uniform float uScanTime;
  uniform float uT0;
  uniform float uT1;
  uniform float uAz0;
  uniform float uGlowTau;
  uniform float uBeamAz;
  uniform float uBeamGlow;
  uniform float uBoxFade;   // hide inside the chamber footprint as the volume takes over
  uniform vec4 uBox;        // x0, x1, north0, north1 (km)
  varying float vRange;
  varying float vAz;

  float line(float v, float spacing, float width) {
    float d = abs(fract(v / spacing - 0.5) - 0.5) * spacing / max(fwidth(v), 1e-4);
    return 1.0 - smoothstep(0.0, width, d);
  }

  void main() {
    vec2 uv = vec2(vRange / uSpan, vAz / 360.0);
#ifdef ARRAY
    float code = texture(uSweeps, vec3(uv, uLayer)).r * 255.0;
#else
    float code = texture2D(uSweep, uv).r * 255.0;
#endif
    vec2 lutUv = vec2((code + 0.5) / 256.0, 0.25);
    vec4 echo = mix(texture2D(uLut, lutUv), texture2D(uLut, lutUv + vec2(0.0, 0.5)), uData);

    // When did the beam pass this azimuth?
    float frac = mod(vAz - uAz0 + 360.0, 360.0) / 360.0;
    float age = uScanTime - mix(uT0, uT1, frac);
    float scanned = step(0.0, age);
    float started = step(uT0, uScanTime);
    float glow = scanned * exp(-max(age, 0.0) / uGlowTau);
    float behind = mod(uBeamAz - vAz + 360.0, 360.0);
    glow = max(glow, uBeamGlow * exp(-behind / 38.0));

    // A faint graticule on the cone: a ring every 25 km and the rim.
    float rim = 1.0 - smoothstep(0.0, 1.6, (uRmax - vRange) / max(fwidth(vRange), 1e-4));
    float grid = max(line(vRange, 25.0, 1.1) * 0.55, rim) * uGrid * 0.2 * started;

    float ea = echo.a * scanned;
    vec3 color = echo.rgb * (1.0 + 0.5 * glow);
    vec3 rgb = color * ea + vec3(0.62, 0.62, 0.64) * grid * (1.0 - ea);
    float coverage = ea + grid * (1.0 - ea);

    // The part over the chamber fades as the volume appears.
    float a = radians(vAz);
    vec2 ground = vec2(sin(a), cos(a)) * vRange;
    float inBox = step(uBox.x, ground.x) * step(ground.x, uBox.y) * step(uBox.z, ground.y) * step(ground.y, uBox.w);
    float alpha = coverage * uOpacity * (1.0 - uBoxFade * inBox);
    if (alpha < 0.003) discard;
    gl_FragColor = vec4(rgb / max(coverage, 1e-4), alpha);
  }
`;

function coneGeometry(rmax, azSegments = 180, rangeStep = 2.5) {
  const ranges = [];
  for (let r = 0.25; r < rmax; r += rangeStep) ranges.push(r);
  ranges.push(rmax);
  const nr = ranges.length;
  const na = azSegments + 1;
  const position = new Float32Array(nr * na * 3);
  const aRange = new Float32Array(nr * na);
  const aAz = new Float32Array(nr * na);
  for (let i = 0; i < na; i += 1) {
    for (let j = 0; j < nr; j += 1) {
      const n = i * nr + j;
      aRange[n] = ranges[j];
      aAz[n] = (i / azSegments) * 360;
    }
  }
  const index = [];
  for (let i = 0; i < azSegments; i += 1) {
    for (let j = 0; j < nr - 1; j += 1) {
      const a = i * nr + j;
      const b = (i + 1) * nr + j;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aRange', new THREE.BufferAttribute(aRange, 1));
  geometry.setAttribute('aAz', new THREE.BufferAttribute(aAz, 1));
  geometry.setIndex(index);
  return geometry;
}

export function createSweeps({ data, lut, antennaAboveGround }) {
  const { meta } = data;
  const group = new THREE.Group();
  group.name = 'sweeps';
  const deg = Math.PI / 180;
  const box = meta.box;
  const boxBounds = new THREE.Vector4(box.x0 - box.cell / 2, box.x0 + (box.nx - 0.5) * box.cell, box.y0 - box.cell / 2, box.y0 + (box.ny - 0.5) * box.cell);

  const lowTexture = new THREE.DataTexture(data.low, meta.polar.low.ngates, meta.polar.low.naz, THREE.RedFormat, THREE.UnsignedByteType);
  const upperTexture = new THREE.DataArrayTexture(data.upper, meta.polar.upper.ngates, meta.polar.upper.naz, meta.polar.upper.layers);
  upperTexture.format = THREE.RedFormat;
  upperTexture.type = THREE.UnsignedByteType;
  for (const texture of [lowTexture, upperTexture]) {
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
  }

  const items = meta.sweeps.map((sweep, index) => {
    const isLow = index === 0;
    const grid = isLow ? meta.polar.low : meta.polar.upper;
    const uniforms = {
      uLut: { value: lut },
      uSpan: { value: grid.ngates * grid.gate },
      uRmax: { value: sweep.rmax },
      uEl: { value: sweep.el * deg },
      uLift: { value: isLow ? 0 : 1 },
      uVert: { value: 2 },
      uAntenna: { value: antennaAboveGround },
      uData: { value: 0 },
      uOpacity: { value: isLow ? 1 : 0 },
      uGrid: { value: 0 },
      uScanTime: { value: 1e6 },
      uT0: { value: sweep.t0 },
      uT1: { value: sweep.t1 },
      uAz0: { value: sweep.az0 },
      uGlowTau: { value: 3 },
      uBeamAz: { value: 0 },
      uBeamGlow: { value: 0 },
      uBoxFade: { value: 0 },
      uBox: { value: boxBounds }
    };
    if (isLow) uniforms.uSweep = { value: lowTexture };
    else {
      uniforms.uSweeps = { value: upperTexture };
      uniforms.uLayer = { value: index - 1 };
    }
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      defines: isLow ? {} : { ARRAY: 1 },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(coneGeometry(sweep.rmax, isLow ? 240 : 180, isLow ? 2 : 2.5), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2 + index;
    mesh.name = `sweep-${index}`;
    group.add(mesh);
    return { sweep, mesh, uniforms };
  });

  return {
    group,
    items,
    /**
     * dim: 0 flat map .. 1 chamber. Returns the elevation each sweep is drawn at.
     */
    update({ dim, vert, dataMode, scanTime, glowTau, beamAz, beamGlow, fill }) {
      const smooth = (a, b, x) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
      };
      const bend = smooth(0.02, 0.3, dim);
      const lowEl = items[0].sweep.el;
      items.forEach(({ sweep, uniforms }, index) => {
        uniforms.uVert.value = vert;
        uniforms.uData.value = dataMode;
        uniforms.uScanTime.value = scanTime;
        uniforms.uGlowTau.value = glowTau;
        uniforms.uBoxFade.value = fill;
        if (index === 0) {
          uniforms.uLift.value = bend;
          uniforms.uOpacity.value = 1 - 0.86 * fill;
          uniforms.uGrid.value = bend * (1 - fill);
          uniforms.uBeamAz.value = beamAz;
          uniforms.uBeamGlow.value = beamGlow;
          return;
        }
        const start = 0.24 + (index - 1) * 0.026;
        const rise = smooth(start, start + 0.13, dim);
        uniforms.uEl.value = (lowEl + (sweep.el - lowEl) * rise) * deg;
        uniforms.uOpacity.value = Math.sqrt(rise) * (1 - 0.94 * fill);
        uniforms.uGrid.value = rise * (1 - fill);
        uniforms.uBeamAz.value = beamAz;
        uniforms.uBeamGlow.value = 0;
        items[index].mesh.visible = uniforms.uOpacity.value > 0.003;
      });
    }
  };
}
