import * as THREE from 'three';

// World: 100 m per unit horizontally; heights are meters × uVert / 100.
export const UNIT_M = 100;

/**
 * The site model: surveyed ground, the sea at the measured level, and the cut
 * faces of the block. A section plane (uCut) sweeps from the north edge to the
 * south edge, so at 0 the model is a single profile and at 1 the whole bay.
 */
export function createSiteModel(meta, terrainHeights) {
  const { nx, nz, cell } = meta.terrain;
  const width = ((nx - 1) * cell) / UNIT_M;
  const depth = ((nz - 1) * cell) / UNIT_M;

  const half = new Uint16Array(nx * nz);
  for (let i = 0; i < half.length; i += 1) half[i] = THREE.DataUtils.toHalfFloat(terrainHeights[i]);
  const heights = new THREE.DataTexture(half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  heights.minFilter = THREE.LinearFilter;
  heights.magFilter = THREE.LinearFilter;
  heights.wrapS = heights.wrapT = THREE.ClampToEdgeWrapping;
  heights.needsUpdate = true;

  const uniforms = {
    uHeights: { value: heights },
    uSize: { value: new THREE.Vector2(width, depth) },
    uTexel: { value: new THREE.Vector2(1 / nx, 1 / nz) },
    uCellM: { value: cell },
    uVert: { value: 8 },
    uLevel: { value: 0 },
    uRecentHigh: { value: 0 },
    uCut: { value: 1 },
    uBase: { value: meta.terrain.zRange[0] },
    uTime: { value: 0 },
    uMarks: { value: new THREE.Vector3(meta.observedMax.value, meta.observedMin.value, 0) },
    uPredicted: { value: 0 },
    uShowPrediction: { value: 0 },
    uSun: { value: new THREE.Vector3(-0.55, 0.62, -0.56).normalize() },
    // World x beyond which nothing is drawn yet: the section grows out of the
    // gauge chart along the level line.
    uReveal: { value: 1e3 }
  };

  const common = /* glsl */ `
    uniform sampler2D uHeights;
    uniform vec2 uSize;
    uniform vec2 uTexel;
    uniform float uCellM;
    uniform float uVert;
    uniform float uLevel;
    uniform float uCut;
    uniform float uBase;
    uniform float uReveal;
    float elevation(vec2 xz) {
      vec2 uv = (xz + 0.5 * uSize) / uSize;
      uv = uv * (1.0 - uTexel) + 0.5 * uTexel;
      return texture2D(uHeights, uv).r;
    }
    float toY(float meters) { return meters * uVert / ${UNIT_M.toFixed(1)}; }
    float cutZ() { return -0.5 * uSize.y + uCut * uSize.y; }
  `;

  // ---------------------------------------------------------------- ground
  const groundGeometry = new THREE.PlaneGeometry(width, depth, nx - 1, nz - 1);
  groundGeometry.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${common}
      varying vec3 vLocal;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        float e = elevation(p.xz);
        p.y = toY(e);
        vLocal = vec3(p.x, e, p.z);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform float uRecentHigh;
      uniform vec3 uMarks;
      uniform float uPredicted;
      uniform float uShowPrediction;
      uniform vec3 uSun;
      uniform float uTime;
      varying vec3 vLocal;
      varying vec3 vWorld;

      float isoline(float value, float spacing, float width) {
        float v = value / spacing;
        float w = max(fwidth(v), 1e-5);
        float d = abs(fract(v - 0.5) - 0.5) / w;
        // Thin the lines out where they crowd closer than a few pixels, so
        // steep ground reads as slope and not as a stack of terraces.
        return (1.0 - smoothstep(0.0, width, d)) * (1.0 - smoothstep(0.12, 0.4, w));
      }

      float level(float value, float at, float width) {
        float d = abs(value - at) / max(fwidth(value), 1e-5);
        return 1.0 - smoothstep(0.0, width, d);
      }

      void main() {
        if (vLocal.z > cutZ() || vLocal.x > uReveal) discard;
        float e = vLocal.y;

        // Normal from the height field, in exaggerated world units.
        vec2 step = uTexel * uSize;
        float hx = toY(elevation(vLocal.xz + vec2(step.x, 0.0))) - toY(elevation(vLocal.xz - vec2(step.x, 0.0)));
        float hz = toY(elevation(vLocal.xz + vec2(0.0, step.y))) - toY(elevation(vLocal.xz - vec2(0.0, step.y)));
        vec3 n = normalize(vec3(-hx / (2.0 * step.x), 1.0, -hz / (2.0 * step.y)));

        // Plaster model: warm white, lit by a low sun and a cool sky.
        vec3 plaster = vec3(0.86, 0.84, 0.8);
        float key = max(dot(n, uSun), 0.0);
        float sky = 0.5 + 0.5 * n.y;
        vec3 color = plaster * (0.16 + 0.78 * key) + vec3(0.1, 0.12, 0.15) * sky;

        // The intertidal band, faintly sandier.
        float intertidal = smoothstep(uMarks.y - 0.2, uMarks.y + 0.4, e) * (1.0 - smoothstep(uMarks.x - 0.3, uMarks.x + 0.1, e));
        color *= mix(vec3(1.0), vec3(1.0, 0.95, 0.86), intertidal * 0.7);

        // Wet ground: below the last few hours' high water, still above the sea.
        float wet = smoothstep(0.0, 0.25, uRecentHigh - e) * smoothstep(-0.05, 0.3, e - uLevel);
        color *= 1.0 - 0.32 * wet;

        // Contours every meter, stronger every five; the month's water marks.
        float fine = isoline(e, 1.0, 0.7) * 0.18;
        float bold = isoline(e, 5.0, 0.9) * 0.32;
        color *= 1.0 - max(fine, bold);
        float marks = max(level(e, uMarks.x, 1.1), level(e, uMarks.y, 1.1)) * uMarks.z;
        color = mix(color, vec3(0.91, 0.71, 0.43), marks * 0.85);
        float forecast = level(e, uPredicted, 1.2) * uShowPrediction;
        color = mix(color, vec3(0.62, 0.78, 0.92), forecast * 0.9);
        gl_FragColor = vec4(color, 1.0);
      }
    `
  }));
  ground.name = 'ground';

  // ---------------------------------------------------------------- water
  const waterGeometry = new THREE.PlaneGeometry(width, depth, 1, 1);
  waterGeometry.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeometry, new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      ${common}
      varying vec3 vLocal;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        p.y = toY(uLevel);
        vLocal = p;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform float uTime;
      uniform vec3 uSun;
      varying vec3 vLocal;
      varying vec3 vWorld;

      float ripple(vec2 p) {
        return sin(p.x * 23.0 + uTime * 0.9) * 0.5 + sin(p.y * 31.0 - uTime * 0.7 + p.x * 4.0) * 0.35
          + sin((p.x + p.y) * 47.0 + uTime * 1.3) * 0.15;
      }

      void main() {
        if (vLocal.z > cutZ() || vLocal.x > uReveal) discard;
        float ground = elevation(vLocal.xz);
        float depthM = uLevel - ground;
        float edgeWidth = fwidth(depthM) * 1.2 + 0.01;
        if (depthM < -edgeWidth) discard;

        // Wind ripples, a few tens of meters long, faded out where they would
        // be smaller than a pixel.
        vec2 p = vLocal.xz;
        float e = 0.002;
        vec2 slope = vec2(ripple(p + vec2(e, 0.0)) - ripple(p - vec2(e, 0.0)), ripple(p + vec2(0.0, e)) - ripple(p - vec2(0.0, e))) / (2.0 * e);
        float detail = 1.0 - smoothstep(0.008, 0.03, length(fwidth(p)));
        vec3 n = normalize(vec3(-slope.x * 0.0018 * detail, 1.0, -slope.y * 0.0018 * detail));
        vec3 view = normalize(cameraPosition - vWorld);
        float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
        vec3 skyColor = mix(vec3(0.07, 0.08, 0.1), vec3(0.3, 0.33, 0.38), clamp(reflect(-view, n).y, 0.0, 1.0));
        float specular = pow(max(dot(reflect(-uSun, n), view), 0.0), 90.0) * 0.16;

        vec3 deep = vec3(0.025, 0.04, 0.055);
        vec3 shallow = vec3(0.11, 0.15, 0.17);
        float d = max(depthM, 0.0);
        vec3 body = mix(shallow, deep, 1.0 - exp(-d / 1.6));
        vec3 color = mix(body, skyColor, fresnel) + specular;

        // A pale hairline where sea meets ground.
        float line = 1.0 - smoothstep(0.0, edgeWidth * 1.4, abs(depthM));
        color = mix(color, vec3(0.6, 0.63, 0.64), line * 0.7);

        float alpha = clamp(1.0 - exp(-d / 0.35), 0.0, 0.96);
        alpha = max(alpha, line * 0.75) * smoothstep(-edgeWidth, edgeWidth, depthM + edgeWidth * 0.5);
        gl_FragColor = vec4(color, alpha);
      }
    `
  }));
  water.name = 'water';
  water.renderOrder = 2;

  // ---------------------------------------------------------------- cut faces
  // Each face is a vertical quad. It shows ground below the surveyed surface
  // and sea between the ground and the level; everything above is discarded.
  const faceMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${common}
      attribute float aAlong; // 0..1 along the face
      uniform float uFaceKind;
      varying vec2 vFace;     // world xz on the face line
      varying float vMeters;
      void main() {
        vec3 p = position;
        if (uFaceKind < 0.5) p.z = cutZ();               // moving south face
        else p.z = min(p.z, cutZ());                       // east and west faces end at the cut
        vFace = p.xz;
        float topM = 60.0;
        float y = mix(toY(uBase), toY(topM), p.y);
        vMeters = mix(uBase, topM, p.y);
        p.y = y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${common}
      uniform float uFaceKind;
      varying vec2 vFace;
      varying float vMeters;
      void main() {
        if (vFace.x > uReveal) discard;
        float ground = elevation(vFace);
        if (vMeters > max(ground, uLevel)) discard;
        vec3 color;
        float alpha = 1.0;
        if (vMeters <= ground) {
          // Cut plaster, with a hairline every five meters of the datum.
          float strata = abs(fract(vMeters / 5.0 - 0.5) - 0.5) / max(fwidth(vMeters / 5.0), 1e-5);
          color = vec3(0.5, 0.49, 0.47) * (1.0 - 0.25 * (1.0 - smoothstep(0.0, 1.0, strata)));
          color *= 0.72 + 0.28 * smoothstep(uBase, ground, vMeters);
          float rim = 1.0 - smoothstep(0.0, fwidth(vMeters) * 1.5, ground - vMeters);
          color = mix(color, vec3(0.82, 0.8, 0.76), rim);
        } else {
          float d = uLevel - vMeters;
          color = mix(vec3(0.12, 0.17, 0.2), vec3(0.03, 0.05, 0.07), 1.0 - exp(-d / 2.0));
          float surface = 1.0 - smoothstep(0.0, fwidth(vMeters) * 1.5, abs(uLevel - vMeters));
          color = mix(color, vec3(0.7, 0.78, 0.82), surface);
          alpha = 0.9;
        }
        gl_FragColor = vec4(color, alpha);
      }
    `
  });

  function face(kind, from, to) {
    const geometry = new THREE.BufferGeometry();
    // Subdivide along the face so the quad follows the cut and the clipping.
    const segments = 256;
    const pos = [];
    const along = [];
    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      pos.push(x, 0, z, x, 1, z);
      along.push(t, t);
    }
    const index = [];
    for (let i = 0; i < segments; i += 1) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array(along), 1));
    geometry.setIndex(index);
    const material = faceMaterial.clone();
    material.uniforms = { ...uniforms, uFaceKind: { value: kind } };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    return mesh;
  }
  const hw = width / 2;
  const hd = depth / 2;
  const faces = [
    face(0, { x: -hw, z: 0 }, { x: hw, z: 0 }),
    face(1, { x: -hw, z: -hd }, { x: -hw, z: hd }),
    face(1, { x: hw, z: -hd }, { x: hw, z: hd }),
    face(1, { x: -hw, z: -hd }, { x: hw, z: -hd })
  ];

  const group = new THREE.Group();
  group.add(ground, water, ...faces);

  return {
    object: group,
    uniforms,
    width,
    depth,
    ground,
    /** Surveyed elevation (m) at world x, z, from the CPU copy of the grid. */
    elevationAt(x, z) {
      const u = (x + hw) / width;
      const v = (z + hd) / depth;
      const i = Math.min(nx - 1, Math.max(0, Math.round(u * (nx - 1))));
      const j = Math.min(nz - 1, Math.max(0, Math.round(v * (nz - 1))));
      return terrainHeights[j * nx + i];
    },
    toY(meters) {
      return (meters * uniforms.uVert.value) / UNIT_M;
    },
    /** World x of the first point, walking east from the land, where the
     * ground along the row at world z is below the given level. */
    waterlineX(level, z) {
      const v = (z + hd) / depth;
      const j = Math.min(nz - 1, Math.max(0, Math.round(v * (nz - 1))));
      const row = j * nx;
      for (let i = 0; i < nx; i += 1) {
        if (terrainHeights[row + i] < level) {
          if (i === 0) return -hw;
          // Interpolate between the last dry and the first wet cell.
          const a = terrainHeights[row + i - 1];
          const b = terrainHeights[row + i];
          const t = (a - level) / Math.max(a - b, 1e-6);
          return -hw + ((i - 1 + t) / (nx - 1)) * width;
        }
      }
      return null;
    }
  };
}
