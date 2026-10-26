import * as THREE from 'three';
import { intensityFor } from './city.js';

const MAX_HEIGHT = 6;
const SIGMA = 0.6;
const SUBDIVISIONS = 6;

/**
 * The same calendar as a smooth landscape: each day contributes a Gaussian
 * hill, so busy weeks merge into ridges and quiet stretches become valleys.
 */
export function createTerrain(grid, palette, footprint) {
  const { width, depth } = footprint;
  const geometry = new THREE.PlaneGeometry(
    width,
    depth,
    Math.round(width * SUBDIVISIONS),
    Math.round(depth * SUBDIVISIONS)
  );
  geometry.rotateX(-Math.PI / 2);

  const values = new Float32Array(grid.weeks * 7);
  for (const cell of grid.cells) {
    values[cell.week * 7 + cell.weekday] = intensityFor(cell.count, grid.maxCount);
  }

  // Normalise by the kernel mass of a fully covered interior point so a run
  // of maximal days reaches MAX_HEIGHT and the edges fall off to zero.
  const reach = Math.ceil(SIGMA * 3);
  let kernelMass = 0;
  for (let dx = -reach; dx <= reach; dx += 1) {
    for (let dz = -reach; dz <= reach; dz += 1) {
      kernelMass += Math.exp(-(dx * dx + dz * dz) / (2 * SIGMA * SIGMA));
    }
  }

  const positions = geometry.attributes.position;
  const level = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i += 1) {
    const gx = positions.getX(i) + (grid.weeks - 1) / 2;
    const gz = positions.getZ(i) + 3;
    let sum = 0;
    const minWeek = Math.max(0, Math.floor(gx) - reach);
    const maxWeek = Math.min(grid.weeks - 1, Math.ceil(gx) + reach);
    const minDay = Math.max(0, Math.floor(gz) - reach);
    const maxDay = Math.min(6, Math.ceil(gz) + reach);
    for (let week = minWeek; week <= maxWeek; week += 1) {
      for (let day = minDay; day <= maxDay; day += 1) {
        const value = values[week * 7 + day];
        if (value === 0) continue;
        const dx = gx - week;
        const dz = gz - day;
        sum += value * Math.exp(-(dx * dx + dz * dz) / (2 * SIGMA * SIGMA));
      }
    }
    const height = Math.min(1, sum / kernelMass * 1.6);
    level[i] = height;
    positions.setY(i, 0.02 + height * MAX_HEIGHT);
  }
  geometry.setAttribute('aLevel', new THREE.BufferAttribute(level, 1));
  geometry.computeVertexNormals();

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uGrowStart: { value: 0 },
      uHalfWidth: { value: width / 2 },
      uHover: { value: new THREE.Vector3(0, 0, -1) },
      uLightDir: { value: new THREE.Vector3(-0.4, 0.8, 0.5).normalize() },
      uBodyColor: { value: palette.body.clone() },
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
      uniform float uHalfWidth;
      attribute float aLevel;
      varying float vLevel;
      varying vec3 vWorld;
      varying vec3 vNormal;
      #include <fog_pars_vertex>

      void main() {
        float delay = (position.x / uHalfWidth * 0.5 + 0.5) * 1.6;
        float t = clamp((uTime - uGrowStart - delay) / 1.3, 0.0, 1.0);
        float grow = 1.0 - pow(1.0 - t, 3.0);
        vec3 p = vec3(position.x, position.y * grow, position.z);

        vLevel = aLevel * grow;
        vNormal = normal;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uHover;
      uniform vec3 uLightDir;
      uniform vec3 uBodyColor;
      uniform vec3 uLevel0;
      uniform vec3 uLevel1;
      uniform vec3 uLevel2;
      uniform vec3 uLevel3;
      varying float vLevel;
      varying vec3 vWorld;
      varying vec3 vNormal;
      #include <fog_pars_fragment>

      vec3 levelColor(float t) {
        vec3 c = mix(uLevel0, uLevel1, smoothstep(0.0, 0.35, t));
        c = mix(c, uLevel2, smoothstep(0.35, 0.7, t));
        return mix(c, uLevel3, smoothstep(0.75, 1.0, t));
      }

      float gridLine(float coordinate, float width) {
        float d = abs(fract(coordinate) - 0.5);
        return 1.0 - smoothstep(0.0, width, d / max(fwidth(coordinate), 1e-4));
      }

      void main() {
        vec3 n = normalize(vNormal);
        float diffuse = 0.3 + 0.7 * max(dot(n, uLightDir), 0.0);
        vec3 accent = levelColor(vLevel);
        vec3 color = mix(uBodyColor * 1.6, accent * 0.32, smoothstep(0.0, 0.25, vLevel)) * diffuse;

        // Contour lines every 0.3 world units, brighter on the high ground.
        float contour = gridLine(vWorld.y / 0.3 + 0.5, 1.2) * step(0.04, vWorld.y);
        color += accent * contour * (0.3 + 2.0 * vLevel);

        // Faint calendar grid on the valley floor.
        float cells = max(gridLine(vWorld.x, 0.8), gridLine(vWorld.z, 0.8));
        color += vec3(0.03, 0.06, 0.07) * cells * (1.0 - smoothstep(0.0, 0.2, vLevel));

        // Hovered day: a pulsing ring around its cell centre.
        float distanceToHover = length(vWorld.xz - uHover.xy);
        float ring = (1.0 - smoothstep(0.0, 0.06, abs(distanceToHover - 0.45))) * step(0.0, uHover.z);
        color += vec3(0.6, 1.0, 0.8) * ring * (0.9 + 0.4 * sin(uTime * 8.0));

        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'commit-terrain';

  const cellLookup = new Map(grid.cells.map((cell, i) => [`${cell.week}:${cell.weekday}`, i]));

  return {
    object: mesh,
    uniforms,
    cellIndexFromHit(hit) {
      const week = Math.round(hit.point.x + (grid.weeks - 1) / 2);
      const weekday = Math.round(hit.point.z + 3);
      return cellLookup.get(`${week}:${weekday}`) ?? -1;
    },
    setHover(cellIndex) {
      const cell = grid.cells[cellIndex];
      if (!cell) {
        uniforms.uHover.value.set(0, 0, -1);
        return;
      }
      uniforms.uHover.value.set(cell.week - (grid.weeks - 1) / 2, cell.weekday - 3, 1);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    }
  };
}
