import * as THREE from 'three';

// The chamber: the gridded box, ray-marched. In smoke mode the reflectivity is
// shaded as if it were smoke lit by the real evening sun; in data mode it
// glows in the NWS colors. A horizontal section can cut it open.

const SMOKE_DENSITY = 1.15; // per true km at full strength
const DATA_DENSITY = 1.6;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Smoke extinction per true km for a stored code. Mirrors smokeSigma() below. */
function sigmaTable(meta) {
  const table = new Float32Array(256);
  for (let code = 1; code < 256; code += 1) {
    const dbz = meta.encoding.min + (code - 1) * meta.encoding.step;
    const s = smooth(12, 62, dbz);
    table[code] = s * s * SMOKE_DENSITY;
  }
  return table;
}

/**
 * Light inside the box, once, because the sun does not move: R is the
 * transmittance toward the sun, G how open each point is to the sky above.
 * The sun pass walks slice by slice away from the sun, carrying optical depth.
 */
function computeLight(codes, box, sigma, sun) {
  const { nx, ny, nz, cell } = box;
  const n = nx * ny * nz;
  const tau = new Float32Array(n);
  const out = new Uint8Array(n * 2);
  const sx = Math.sign(sun.east) || 1;
  const dj = sun.north / Math.abs(sun.east);
  const dk = sun.up / Math.abs(sun.east);
  const stepKm = cell / Math.abs(sun.east);
  const at = (i, j, k) => (j < 0 || k < 0 || j >= ny || k >= nz ? 0 : tau[i + nx * (j + ny * k)]);
  for (let s = 0; s < nx; s += 1) {
    const i = sx < 0 ? s : nx - 1 - s;
    const iu = i + sx;
    const hasUp = iu >= 0 && iu < nx;
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        const idx = i + nx * (j + ny * k);
        const own = sigma[codes[idx]] * stepKm;
        let up = 0;
        if (hasUp) {
          const jj = j + dj;
          const kk = k + dk;
          const j0 = Math.floor(jj);
          const k0 = Math.floor(kk);
          const fj = jj - j0;
          const fk = kk - k0;
          up = (at(iu, j0, k0) * (1 - fj) + at(iu, j0 + 1, k0) * fj) * (1 - fk)
            + (at(iu, j0, k0 + 1) * (1 - fj) + at(iu, j0 + 1, k0 + 1) * fj) * fk;
        }
        tau[idx] = up + own;
        out[idx * 2] = Math.round(255 * Math.exp(-(up + own * 0.5)));
      }
    }
  }
  // Sky: optical depth straight up, softened, as a stand-in for the open sky.
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      let acc = 0;
      for (let k = nz - 1; k >= 0; k -= 1) {
        const idx = i + nx * (j + ny * k);
        const own = sigma[codes[idx]] * cell;
        out[idx * 2 + 1] = Math.round(255 * Math.exp(-(acc + own * 0.5) * 0.42));
        acc += own;
      }
    }
  }
  return out;
}

/** Which 4x4x4 blocks hold anything, dilated by one block, for skipping. */
function computeOccupancy(codes, box, sigma) {
  const { nx, ny, nz } = box;
  const bx = Math.ceil(nx / 4);
  const by = Math.ceil(ny / 4);
  const bz = Math.ceil(nz / 4);
  const raw = new Uint8Array(bx * by * bz);
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        if (sigma[codes[i + nx * (j + ny * k)]] > 2e-4) raw[(i >> 2) + bx * ((j >> 2) + by * (k >> 2))] = 1;
      }
    }
  }
  const out = new Uint8Array(raw.length);
  for (let k = 0; k < bz; k += 1) {
    for (let j = 0; j < by; j += 1) {
      for (let i = 0; i < bx; i += 1) {
        let any = 0;
        for (let c = -1; c <= 1 && !any; c += 1) {
          for (let b = -1; b <= 1 && !any; b += 1) {
            for (let a = -1; a <= 1 && !any; a += 1) {
              const ii = i + a;
              const jj = j + b;
              const kk = k + c;
              if (ii >= 0 && jj >= 0 && kk >= 0 && ii < bx && jj < by && kk < bz) any = raw[ii + bx * (jj + by * kk)];
            }
          }
        }
        out[i + bx * (j + by * k)] = any ? 255 : 0;
      }
    }
  }
  return { data: out, bx, by, bz };
}

/** Transmittance toward the sun at ground level around the box: its shadow. */
function computeGroundShadow(codes, box, sigma, sun, groundKm, rect, res) {
  const { nx, ny, nz, cell, x0, y0, z0 } = box;
  const w = Math.round((rect[2] - rect[0]) / res);
  const h = Math.round((rect[3] - rect[1]) / res);
  const out = new Uint8Array(w * h);
  const lo = [x0 - cell / 2, y0 - cell / 2, z0 - cell / 2];
  const hi = [x0 + (nx - 0.5) * cell, y0 + (ny - 0.5) * cell, z0 + (nz - 0.5) * cell];
  const dir = [sun.east, sun.north, sun.up];
  for (let v = 0; v < h; v += 1) {
    for (let u = 0; u < w; u += 1) {
      const o = [rect[0] + (u + 0.5) * res, rect[1] + (v + 0.5) * res, groundKm];
      let t0 = 0;
      let t1 = Infinity;
      for (let a = 0; a < 3; a += 1) {
        if (Math.abs(dir[a]) < 1e-9) {
          if (o[a] < lo[a] || o[a] > hi[a]) t1 = -1;
          continue;
        }
        let ta = (lo[a] - o[a]) / dir[a];
        let tb = (hi[a] - o[a]) / dir[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
      }
      let tau = 0;
      for (let t = t0 + 0.25; t < t1; t += 0.5) {
        const i = Math.round((o[0] + dir[0] * t - x0) / cell);
        const j = Math.round((o[1] + dir[1] * t - y0) / cell);
        const k = Math.round((o[2] + dir[2] * t - z0) / cell);
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue;
        tau += sigma[codes[i + nx * (j + ny * k)]] * 0.5;
        if (tau > 8) break;
      }
      out[u + w * v] = Math.round(255 * Math.exp(-tau));
    }
  }
  return { data: out, w, h };
}

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uVolume;
  uniform sampler3D uLight;
  uniform sampler3D uOcc;
  uniform sampler2D uLut;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform vec3 uTexScale;
  uniform vec3 uTexOffset;
  uniform float uVert;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform float uOpacity;
  uniform float uData;
  uniform float uCutY;
  uniform float uCut;
  uniform float uStep;
  uniform float uSkip;
  uniform float uDebug;
  varying vec3 vWorld;

  float smokeSigma(float dbz) {
    float t = clamp((dbz - 12.0) / 50.0, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return t * t * ${SMOKE_DENSITY.toFixed(3)};
  }
  float dataSigma(float dbz) {
    float t = clamp((dbz - 15.0) / 55.0, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return (0.004 + pow(t, 2.5)) * ${DATA_DENSITY.toFixed(3)} * step(18.0, dbz);
  }
  float hg(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
  }
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }
  vec3 texCoord(vec3 p) {
    return vec3(p.x, p.z, p.y) * uTexScale + uTexOffset;
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorld - ro);
    vec3 inv = 1.0 / rd;
    vec3 ta = (uBoxMin - ro) * inv;
    vec3 tb = (uBoxMax - ro) * inv;
    vec3 tmin = min(ta, tb);
    vec3 tmax = max(ta, tb);
    float tNear = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
    float tFar = min(min(tmax.x, tmax.y), tmax.z);

    // The section, sampled once per pixel, outside the loop.
    float tCut = (uCutY - ro.y) / rd.y;
    vec3 pc = ro + rd * tCut;
    float codeCut = texture(uVolume, texCoord(pc)).r * 255.0;
    float dbzCut = codeCut > 0.5 ? 5.0 + (codeCut - 1.0) * 0.3 : 0.0;
    float iso = 1.0 - smoothstep(0.0, 1.0, abs(fract(dbzCut / 10.0 - 0.5) - 0.5) * 10.0 / max(fwidth(dbzCut), 1e-3));
    vec2 lutCut = vec2((codeCut + 0.5) / 256.0, 0.25);
    vec4 cutEcho = mix(texture(uLut, lutCut), texture(uLut, lutCut + vec2(0.0, 0.5)), uData);
    vec3 cutColor = mix(vec3(0.05, 0.05, 0.056), cutEcho.rgb, cutEcho.a);
    cutColor = mix(cutColor, vec3(0.92, 0.9, 0.86), iso * 0.22 * step(10.0, dbzCut) * (1.0 - uData));
    float cutAlpha = mix(0.9, 1.0, cutEcho.a) * uCut;

    if (tFar <= tNear) discard;
    bool hasCut = uCut > 0.001 && tCut > tNear && tCut < tFar;

    vec3 scale = vec3(1.0, 1.0 / uVert, 1.0);
    float trueLen = length(rd * scale);
    float c = dot(normalize(rd * scale), uSun);
    float phase = mix(hg(c, 0.6), hg(c, -0.18), 0.55);

    float t = tNear + uStep * ign(gl_FragCoord.xy);
    vec3 color = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < 420; i++) {
      if (t >= tFar || T < 0.012) break;
      if (hasCut && t >= tCut) {
        color += T * cutAlpha * cutColor;
        T *= 1.0 - cutAlpha;
        hasCut = false;
        if (T < 0.012) break;
      }
      vec3 p = ro + rd * t;
      vec3 uvw = texCoord(p);
      if (texture(uOcc, uvw).r < 0.5) {
        t += uSkip;
        continue;
      }
      float code = texture(uVolume, uvw).r * 255.0;
      if (code > 0.5) {
        float dbz = 5.0 + (code - 1.0) * 0.3;
        float sigma = mix(smokeSigma(dbz), dataSigma(dbz), uData);
        if (p.y > uCutY) sigma *= mix(1.0, 0.03, uCut);
        if (sigma > 1e-5) {
          float a = 1.0 - exp(-sigma * uStep * trueLen);
          vec2 light = texture(uLight, uvw).rg;
          vec3 smoke = uSunColor * light.r * phase + uSkyColor * (0.22 + 0.78 * light.g);
          if (uDebug > 0.5) smoke = uDebug < 1.5 ? vec3(light.r) : vec3(light.g);
          vec3 dataColor = texture(uLut, vec2((code + 0.5) / 256.0, 0.75)).rgb * (0.62 + 0.5 * light.g);
          color += T * a * mix(smoke, dataColor, uData);
          T *= 1.0 - a;
        }
      }
      t += uStep;
    }
    if (hasCut) {
      color += T * cutAlpha * cutColor;
      T *= 1.0 - cutAlpha;
    }
    gl_FragColor = vec4(color * uOpacity, (1.0 - T) * uOpacity);
  }
`;

export function createVolume({ data, lut, groundKm, sunDirection }) {
  const { meta, volume } = data;
  const box = meta.box;
  const sigma = sigmaTable(meta);
  const sun = { east: sunDirection.x, north: -sunDirection.z, up: sunDirection.y };

  const make3D = (array, w, h, d, format, filter) => {
    const texture = new THREE.Data3DTexture(array, w, h, d);
    texture.format = format;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = filter;
    texture.magFilter = filter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  };
  const volumeTexture = make3D(volume, box.nx, box.ny, box.nz, THREE.RedFormat, THREE.LinearFilter);
  const lightTexture = make3D(computeLight(volume, box, sigma, sun), box.nx, box.ny, box.nz, THREE.RGFormat, THREE.LinearFilter);
  const occ = computeOccupancy(volume, box, sigma);
  const occTexture = make3D(occ.data, occ.bx, occ.by, occ.bz, THREE.RedFormat, THREE.NearestFilter);

  const shadowRect = [-40, -40, 220, 220];
  const shadow = computeGroundShadow(volume, box, sigma, sun, groundKm, shadowRect, 1);
  const shadowTexture = new THREE.DataTexture(shadow.data, shadow.w, shadow.h, THREE.RedFormat, THREE.UnsignedByteType);
  shadowTexture.minFilter = shadowTexture.magFilter = THREE.LinearFilter;
  shadowTexture.unpackAlignment = 1;
  shadowTexture.needsUpdate = true;

  const c = box.cell;
  const xMin = box.x0 - c / 2;
  const xMax = box.x0 + (box.nx - 0.5) * c;
  const nMin = box.y0 - c / 2;
  const nMax = box.y0 + (box.ny - 0.5) * c;
  const zTop = box.z0 + (box.nz - 0.5) * c;

  const uniforms = {
    uVolume: { value: volumeTexture },
    uLight: { value: lightTexture },
    uOcc: { value: occTexture },
    uLut: { value: lut },
    uBoxMin: { value: new THREE.Vector3() },
    uBoxMax: { value: new THREE.Vector3() },
    uTexScale: { value: new THREE.Vector3() },
    uTexOffset: { value: new THREE.Vector3() },
    uVert: { value: 2 },
    uSun: { value: sunDirection.clone().normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.8, 0.6).multiplyScalar(2.2) },
    uSkyColor: { value: new THREE.Color(0.3, 0.335, 0.4).multiplyScalar(0.8) },
    uOpacity: { value: 0 },
    uData: { value: 0 },
    uCutY: { value: 1e4 },
    uCut: { value: 0 },
    uStep: { value: 0.5 },
    uSkip: { value: 1.6 },
    uDebug: { value: { light: 1, sky: 2 }[new URLSearchParams(location.search).get('debug')] ?? 0 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.BackSide,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: false
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.name = 'chamber-volume';

  let lastVert = -1;
  function setVert(vert) {
    if (vert === lastVert) return;
    lastVert = vert;
    const yMax = (zTop - groundKm) * vert;
    uniforms.uBoxMin.value.set(xMin, 0, -nMax);
    uniforms.uBoxMax.value.set(xMax, yMax, -nMin);
    uniforms.uTexScale.value.set(1 / (box.nx * c), -1 / (box.ny * c), 1 / (vert * box.nz * c));
    uniforms.uTexOffset.value.set(-xMin / (box.nx * c), -nMin / (box.ny * c), (groundKm - (box.z0 - c / 2)) / (box.nz * c));
    uniforms.uVert.value = vert;
    mesh.scale.set(xMax - xMin, yMax, nMax - nMin);
    mesh.position.set((xMin + xMax) / 2, yMax / 2, -(nMin + nMax) / 2);
    mesh.updateMatrixWorld();
  }
  setVert(2);

  return {
    mesh,
    uniforms,
    shadow: { texture: shadowTexture, rect: new THREE.Vector4(...shadowRect) },
    bounds: { xMin, xMax, nMin, nMax, zTop },
    update({ vert, opacity, dataMode, cutKm, cut, quality }) {
      setVert(vert);
      uniforms.uOpacity.value = opacity;
      uniforms.uData.value = dataMode;
      uniforms.uCut.value = cut;
      uniforms.uCutY.value = cut > 0.001 ? (cutKm - groundKm) * vert : 1e4;
      uniforms.uStep.value = 0.5 / quality;
      mesh.visible = opacity > 0.002;
    }
  };
}
