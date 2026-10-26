import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export const PLINTH_HEIGHT = 2;
export const PLINTH_MARGIN = 1;

export function createSky(palette) {
  const geometry = new THREE.SphereGeometry(420, 48, 24);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: palette.zenith },
      uHorizon: { value: palette.horizon },
      uGlow: { value: palette.horizonGlow }
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGlow;
      varying vec3 vDirection;
      void main() {
        float h = vDirection.y;
        vec3 color = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
        color += uGlow * pow(1.0 - abs(h), 10.0) * smoothstep(0.0, 0.06, h);
        gl_FragColor = vec4(color, 1.0);
      }
    `
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.renderOrder = -10;
  return mesh;
}

export function createStars(count = 1600) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    // Upper hemisphere only, denser towards the zenith.
    const theta = Math.random() * Math.PI * 2;
    const y = 0.08 + Math.pow(Math.random(), 0.7) * 0.92;
    const r = Math.sqrt(1 - y * y);
    positions.set([Math.cos(theta) * r * 380, y * 380, Math.sin(theta) * r * 380], i * 3);
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSeed;
      varying float vAlpha;
      void main() {
        vAlpha = (0.25 + 0.75 * aSeed) * (0.65 + 0.35 * sin(uTime * (0.6 + aSeed * 2.0) + aSeed * 90.0));
        gl_PointSize = (0.8 + aSeed * 1.8) * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * vAlpha, 1.0) * (1.0 - smoothstep(0.2, 0.5, d));
      }
    `
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'stars';
  return points;
}

/** Wet, dimly reflective ground that fades into the fog. */
export function createFloor(renderer, palette, y) {
  const group = new THREE.Group();
  group.name = 'floor';
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());

  const reflector = new Reflector(new THREE.PlaneGeometry(800, 800), {
    clipBias: 0.003,
    textureWidth: Math.round(size.x * 0.5),
    textureHeight: Math.round(size.y * 0.5),
    color: 0x7f8a99
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = y;
  group.add(reflector);

  const overlay = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: palette.fog }, uGrid: { value: palette.levels[1] } },
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uGrid;
        varying vec2 vWorld;
        void main() {
          float distance = length(vWorld * vec2(0.8, 1.0));
          float alpha = mix(0.62, 1.0, smoothstep(18.0, 150.0, distance));
          vec2 cell = abs(fract(vWorld / 4.0) - 0.5) / fwidth(vWorld / 4.0);
          float line = (1.0 - min(min(cell.x, cell.y), 1.0)) * (1.0 - smoothstep(20.0, 90.0, distance));
          vec3 color = uColor + uGrid * line * 0.12;
          gl_FragColor = vec4(color, alpha);
        }
      `
    })
  );
  overlay.rotation.x = -Math.PI / 2;
  overlay.position.y = y + 0.01;
  group.add(overlay);

  return {
    object: group,
    resize() {
      renderer.getDrawingBufferSize(size);
      reflector.getRenderTarget().setSize(Math.round(size.x * 0.5), Math.round(size.y * 0.5));
    }
  };
}

/** Slowly rising motes of light above the city. */
export function createDust(count = 520) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions.set([
      (Math.random() - 0.5) * 80,
      Math.random() * 16,
      (Math.random() - 0.5) * 30
    ], i * 3);
    seeds[i] = Math.random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uColor: { value: new THREE.Color(0x9dffc0) }
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float aSeed;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.15 + aSeed * 0.35), 16.0);
        p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.6;
        p.z += cos(uTime * 0.25 + aSeed * 30.0) * 0.6;
        float fade = smoothstep(0.0, 2.0, p.y) * (1.0 - smoothstep(11.0, 16.0, p.y));
        vAlpha = fade * (0.35 + 0.65 * aSeed) * (0.6 + 0.4 * sin(uTime * 2.0 + aSeed * 50.0));
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (1.5 + aSeed * 3.0) * uPixelRatio * (30.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float glow = exp(-d * d * 18.0);
        gl_FragColor = vec4(uColor * glow * vAlpha * 0.9, 1.0);
      }
    `
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'dust';
  points.frustumCulled = false;
  return points;
}

/**
 * The base the city stands on, with month labels and the owner's name
 * engraved on the front face.
 */
export function createPlinth(grid, { username, periodLabel, total }, renderer) {
  const width = grid.weeks + PLINTH_MARGIN * 2;
  const depth = 7 + PLINTH_MARGIN * 2;
  const group = new THREE.Group();
  group.name = 'plinth';

  const geometry = new THREE.BoxGeometry(width, PLINTH_HEIGHT, depth);
  const material = new THREE.MeshStandardMaterial({ color: 0x0b0f1c, metalness: 0.55, roughness: 0.38 });
  const block = new THREE.Mesh(geometry, material);
  block.position.y = -PLINTH_HEIGHT / 2;
  group.add(block);

  // Thin glowing edge along the top rim.
  const rimGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 0.001, depth));
  const rimMaterial = new THREE.LineBasicMaterial({ color: 0x2f7d4b, transparent: true, opacity: 0.8 });
  const rim = new THREE.LineSegments(rimGeometry, rimMaterial);
  group.add(rim);

  const texture = drawFrontLabel(grid, { username, periodLabel, total }, width, renderer);
  const labelMaterial = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(width, PLINTH_HEIGHT), labelMaterial);
  label.position.set(0, -PLINTH_HEIGHT / 2, depth / 2 + 0.002);
  group.add(label);

  return {
    object: group,
    width,
    depth,
    dispose() {
      geometry.dispose();
      material.dispose();
      rimGeometry.dispose();
      rimMaterial.dispose();
      texture.dispose();
      labelMaterial.dispose();
      label.geometry.dispose();
    }
  };
}

function drawFrontLabel(grid, { username, periodLabel, total }, width, renderer) {
  const canvasWidth = Math.min(8192, renderer.capabilities.maxTextureSize);
  const canvasHeight = Math.round(canvasWidth * PLINTH_HEIGHT / width);
  const unit = canvasWidth / width; // pixels per world unit
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  const font = '"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const mono = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

  // Month labels, aligned with the week columns above.
  ctx.fillStyle = 'rgba(150, 220, 175, 0.75)';
  ctx.font = `500 ${Math.round(unit * 0.34)}px ${font}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const label of grid.monthLabels) {
    const x = (PLINTH_MARGIN + label.week - 0.4) * unit;
    ctx.fillText(label.text, x, unit * 0.42);
  }

  // Divider line.
  ctx.fillStyle = 'rgba(80, 160, 110, 0.35)';
  ctx.fillRect(PLINTH_MARGIN * unit * 0.6, unit * 0.78, canvasWidth - PLINTH_MARGIN * unit * 1.2, Math.max(2, unit * 0.02));

  const baseline = unit * 1.36;
  ctx.shadowColor = 'rgba(120, 255, 170, 0.6)';
  ctx.shadowBlur = unit * 0.25;
  ctx.fillStyle = 'rgba(215, 255, 228, 0.95)';
  ctx.font = `600 ${Math.round(unit * 0.6)}px ${mono}`;
  ctx.textAlign = 'left';
  ctx.fillText(`@${username}`, PLINTH_MARGIN * unit, baseline);

  ctx.font = `500 ${Math.round(unit * 0.46)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.fillText(periodLabel, canvasWidth / 2, baseline);

  ctx.textAlign = 'right';
  ctx.font = `600 ${Math.round(unit * 0.5)}px ${font}`;
  ctx.fillText(`${total.toLocaleString('zh-CN')} 次贡献`, canvasWidth - PLINTH_MARGIN * unit, baseline);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}
