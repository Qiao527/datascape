import * as THREE from 'three';

export const BUILDING_WIDTH = 0.82;
const EMPTY_TILE_HEIGHT = 0.06;

/** World-space centre of a calendar cell. Weeks run along x, weekdays along z. */
export function cellPosition(week, weekday, weeks) {
  return new THREE.Vector3(week - (weeks - 1) / 2, 0, weekday - 3);
}

export function intensityFor(count, maxCount) {
  return count > 0 && maxCount > 0 ? Math.pow(count / maxCount, 0.55) : 0;
}

function heightFor(count, maxCount) {
  if (count <= 0 || maxCount <= 0) return EMPTY_TILE_HEIGHT;
  return 0.4 + Math.pow(count / maxCount, 0.6) * 9.5;
}

export function createCity(grid, palette) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.translate(0, 0.5, 0);

  const total = grid.cells.length;
  const intensity = new Float32Array(total);
  const seed = new Float32Array(total);
  const delay = new Float32Array(total);
  const index = new Float32Array(total);

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uGrowStart: { value: 0 },
      uHover: { value: -1 },
      uLightDir: { value: new THREE.Vector3(-0.4, 0.8, 0.5).normalize() },
      uBodyColor: { value: palette.body.clone() },
      uWarm: { value: palette.windowWarm.clone() },
      uCool: { value: palette.windowCool.clone() },
      uLevel0: { value: palette.levels[0].clone() },
      uLevel1: { value: palette.levels[1].clone() },
      uLevel2: { value: palette.levels[2].clone() },
      uLevel3: { value: palette.levels[3].clone() }
    }
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uGrowStart;
      uniform float uHover;
      attribute float aIntensity;
      attribute float aSeed;
      attribute float aDelay;
      attribute float aIndex;
      varying vec3 vLocal;
      varying vec3 vObjNormal;
      varying float vHeight;
      varying float vIntensity;
      varying float vSeed;
      varying float vHover;
      varying float vWorldY;
      #include <fog_pars_vertex>

      void main() {
        float height = length(instanceMatrix[1].xyz);
        float t = clamp((uTime - uGrowStart - aDelay) / 1.1, 0.0, 1.0);
        float grow = 1.0 - pow(1.0 - t, 3.0);

        // Buildings rise out of the plinth: the part below y = 0 is discarded.
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        world.y -= (height + 0.2) * (1.0 - grow);

        vLocal = position;
        vObjNormal = normal;
        vHeight = height;
        vIntensity = aIntensity;
        vSeed = aSeed;
        vHover = 1.0 - step(0.5, abs(aIndex - uHover));
        vWorldY = world.y;

        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uLightDir;
      uniform vec3 uBodyColor;
      uniform vec3 uWarm;
      uniform vec3 uCool;
      uniform vec3 uLevel0;
      uniform vec3 uLevel1;
      uniform vec3 uLevel2;
      uniform vec3 uLevel3;
      varying vec3 vLocal;
      varying vec3 vObjNormal;
      varying float vHeight;
      varying float vIntensity;
      varying float vSeed;
      varying float vHover;
      varying float vWorldY;
      #include <fog_pars_fragment>

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      vec3 levelColor(float t) {
        vec3 c = mix(uLevel0, uLevel1, smoothstep(0.0, 0.35, t));
        c = mix(c, uLevel2, smoothstep(0.35, 0.7, t));
        return mix(c, uLevel3, smoothstep(0.75, 1.0, t));
      }

      void main() {
        if (vWorldY < -0.001) discard;

        vec3 n = normalize(vObjNormal);
        vec3 accent = levelColor(vIntensity);
        float diffuse = 0.35 + 0.65 * max(dot(n, uLightDir), 0.0);
        float edge = max(abs(vLocal.x), abs(vLocal.z));
        vec3 color;

        if (vHeight < 0.1) {
          // A day without contributions: a flat dark tile with a faint outline.
          color = uBodyColor * 1.3 + vec3(0.025, 0.04, 0.06) * smoothstep(0.42, 0.48, edge);
        } else if (n.y > 0.5) {
          // Roof: glows with the day's intensity, brighter towards the rim.
          float rim = smoothstep(0.38, 0.48, edge);
          color = accent * (0.35 + 1.5 * vIntensity) * (0.6 + 0.6 * rim);
        } else {
          float worldY = vLocal.y * vHeight;
          float faceX = abs(n.x) > 0.5 ? vLocal.z * sign(n.x) : -vLocal.x * sign(n.z);
          color = uBodyColor * diffuse * (1.0 + 0.7 * (1.0 - vLocal.y));

          // Window grid: 3 columns per face, one floor every 0.32 world units.
          vec2 grid = vec2((faceX + 0.5) * 3.0, worldY / 0.32);
          vec2 cell = floor(grid);
          vec2 f = fract(grid);
          float faceId = n.x > 0.5 ? 1.0 : (n.x < -0.5 ? 2.0 : (n.z > 0.5 ? 3.0 : 4.0));
          float rnd = hash12(cell + vec2(vSeed * 173.0, faceId * 31.0));
          float lit = step(rnd, 0.12 + vIntensity * 0.62);
          float window = step(0.24, f.x) * step(f.x, 0.76) * step(0.28, f.y) * step(f.y, 0.72);
          float inBody = step(0.25, worldY) * step(worldY, vHeight - 0.22);
          float flicker = 0.82 + 0.18 * sin(uTime * (0.5 + rnd * 2.5) + rnd * 60.0);
          vec3 windowColor = mix(uWarm, uCool, step(0.72, hash12(cell + vSeed * 57.0 + faceId)));
          color += windowColor * window * lit * inBody * flicker * (0.9 + 1.4 * vIntensity);
          color += vec3(0.015, 0.022, 0.04) * window * (1.0 - lit) * inBody;

          // Glowing crown under the roof, faint corner lines and a base glow.
          float crown = smoothstep(vHeight - 0.18, vHeight - 0.02, worldY);
          float corner = smoothstep(0.42, 0.49, abs(faceX));
          color += accent * (crown * (0.5 + 1.8 * vIntensity) + corner * 0.3 * vIntensity);
          color += accent * 0.15 * vIntensity * (1.0 - smoothstep(0.0, 0.7, worldY));
        }

        color += vec3(0.55, 1.0, 0.75) * vHover * (0.45 + 0.2 * sin(uTime * 8.0));
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
      }
    `
  });

  const mesh = new THREE.InstancedMesh(geometry, material, total);
  mesh.name = 'commit-city';
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  grid.cells.forEach((cell, i) => {
    const position = cellPosition(cell.week, cell.weekday, grid.weeks);
    scale.set(BUILDING_WIDTH, heightFor(cell.count, grid.maxCount), BUILDING_WIDTH);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);

    intensity[i] = intensityFor(cell.count, grid.maxCount);
    seed[i] = (i * 0.61803398875) % 1;
    // Rises week by week from left to right, with a small ripple across weekdays.
    delay[i] = (cell.week / grid.weeks) * 1.8 + cell.weekday * 0.035;
    index[i] = i;
  });

  geometry.setAttribute('aIntensity', new THREE.InstancedBufferAttribute(intensity, 1));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  geometry.setAttribute('aDelay', new THREE.InstancedBufferAttribute(delay, 1));
  geometry.setAttribute('aIndex', new THREE.InstancedBufferAttribute(index, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();

  return {
    object: mesh,
    uniforms,
    /** Returns the hovered cell index for a raycast hit, or -1. */
    cellIndexFromHit(hit) {
      return hit.instanceId ?? -1;
    },
    setHover(cellIndex) {
      uniforms.uHover.value = cellIndex;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    }
  };
}
