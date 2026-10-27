import * as THREE from 'three';

/**
 * The room: a matte floor lit by a single overhead lamp, the visible beam,
 * and dust drifting through it. The floor shows the object's shadow as one of
 * two diagram textures, crossfaded with uDiagramMix.
 */
export function createStage({ pt, pv, fog }) {
  const uniforms = {
    uPT: { value: pt.texture },
    uPV: { value: pv.texture },
    uPTBounds: { value: new THREE.Vector4(...pt.bounds) },
    uPVBounds: { value: new THREE.Vector4(...pv.bounds) },
    uDiagramMix: { value: 0 },
    uDiagramOpacity: { value: 1 },
    uLight: { value: 1 },
    uPoolRadius: { value: 19 },
    uFloor: { value: new THREE.Color(0x8a867f) },
    uFogColor: { value: fog.color },
    uFogDensity: { value: fog.density },
    uMarker: { value: new THREE.Vector3(0, 0, -1) }
  };

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPT;
        uniform sampler2D uPV;
        uniform vec4 uPTBounds;
        uniform vec4 uPVBounds;
        uniform float uDiagramMix;
        uniform float uDiagramOpacity;
        uniform float uLight;
        uniform float uPoolRadius;
        uniform vec3 uFloor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform vec3 uMarker;
        varying vec3 vWorld;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        vec4 sampleDiagram(sampler2D map, vec4 bounds, vec2 p) {
          vec2 uv = (p - bounds.xy) / (bounds.zw - bounds.xy);
          if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
          return texture2D(map, vec2(uv.x, 1.0 - uv.y));
        }

        void main() {
          vec2 p = vWorld.xz;
          float r = length(p * vec2(0.82, 1.0));
          float pool = exp(-pow(r / uPoolRadius, 2.2));
          float light = uLight * (0.02 + 0.98 * pool);
          float grain = (hash(floor(p * 90.0)) - 0.5) * 0.035;

          vec3 color = uFloor * (1.0 + grain);
          vec4 a = sampleDiagram(uPT, uPTBounds, p);
          vec4 b = sampleDiagram(uPV, uPVBounds, p);
          vec4 diagram = mix(a, b, uDiagramMix) * uDiagramOpacity;
          color = mix(color, diagram.rgb / max(diagram.a, 1e-4), diagram.a);

          // The state's shadow: a soft dark spot with a warm core.
          if (uMarker.z > 0.0) {
            float d = length(p - uMarker.xy);
            color *= 1.0 - 0.7 * exp(-d * d / 0.02) * uMarker.z;
            color += vec3(0.95, 0.62, 0.28) * exp(-d * d / 0.0035) * uMarker.z * 0.9;
          }

          color *= light;
          float distance = length(vWorld - cameraPosition);
          float fogAmount = 1.0 - exp(-pow(uFogDensity * distance, 2.0));
          gl_FragColor = vec4(mix(color, uFogColor, fogAmount), 1.0);
        }
      `
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.name = 'floor';

  // The lamp's beam: an open cone, brightest along its axis.
  const beamHeight = 46;
  const beamGeometry = new THREE.CylinderGeometry(3.2, 21, beamHeight, 96, 1, true);
  beamGeometry.translate(0, beamHeight / 2, 0);
  const beam = new THREE.Mesh(
    beamGeometry,
    new THREE.ShaderMaterial({
      uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec3 view = normalize(cameraPosition - vWorld);
          float facing = abs(dot(normalize(vNormal), view));
          float height = vWorld.y / 46.0;
          float alpha = pow(facing, 2.4) * smoothstep(0.0, 0.25, height) * (1.0 - smoothstep(0.55, 1.0, height));
          // Looking straight down the beam it would only wash out the floor.
          alpha *= 1.0 - smoothstep(0.55, 0.9, abs(view.y));
          alpha *= 0.85 + 0.15 * sin(vWorld.y * 0.35 - uTime * 0.2);
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.86) * alpha * 0.028 * uIntensity, 1.0);
        }
      `
    })
  );
  beam.name = 'beam';
  beam.renderOrder = 5;

  // Dust in the light.
  const count = 900;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const height = Math.random();
    const radius = (3 + height * -2 + 17 * (1 - height)) * Math.sqrt(Math.random()) * 0.9;
    const angle = Math.random() * Math.PI * 2;
    positions.set([Math.cos(angle) * radius, 0.5 + height * 30, Math.sin(angle) * radius], i * 3);
    seeds[i] = Math.random();
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dustGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uPixelRatio;
        attribute float aSeed;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float t = uTime * (0.04 + aSeed * 0.05);
          p.y = mod(p.y - t * 3.0, 30.0) + 0.5;
          p.x += sin(uTime * 0.11 + aSeed * 40.0) * 0.8;
          p.z += cos(uTime * 0.09 + aSeed * 23.0) * 0.8;
          float radius = length(p.xz);
          float cone = 3.2 + (21.0 - 3.2) * (1.0 - p.y / 46.0);
          vAlpha = (1.0 - smoothstep(cone * 0.6, cone, radius)) * (0.3 + 0.7 * aSeed)
            * (0.55 + 0.45 * sin(uTime * (0.6 + aSeed) + aSeed * 90.0));
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.0 + aSeed * 2.2) * uPixelRatio * (34.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uIntensity;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float glow = exp(-d * d * 16.0);
          gl_FragColor = vec4(vec3(1.0, 0.94, 0.84) * glow * vAlpha * 0.5 * uIntensity, 1.0);
        }
      `
    })
  );
  dust.frustumCulled = false;
  dust.name = 'dust';
  dust.renderOrder = 6;

  const group = new THREE.Group();
  group.add(floor, beam, dust);

  return {
    object: group,
    uniforms,
    beam,
    dust,
    update(elapsed) {
      beam.material.uniforms.uTime.value = elapsed;
      dust.material.uniforms.uTime.value = elapsed;
    },
    setBeam(intensity) {
      beam.material.uniforms.uIntensity.value = intensity;
      dust.material.uniforms.uIntensity.value = intensity;
    }
  };
}
