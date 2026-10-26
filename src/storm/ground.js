import * as THREE from 'three';

// The ground under the radar: a dark plain with the radar's range rings and
// bearings, and, once the chamber is lit, the storm's shadow.

export function createGround({ background, shadow }) {
  const uniforms = {
    uBackground: { value: background.clone() },
    uScope: { value: 1 },
    uShadow: { value: shadow.texture },
    uShadowRect: { value: shadow.rect },
    uShadowAmount: { value: 0 }
  };
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(340, 192),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vGround; // km east, km north
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vGround = vec2(world.x, -world.z);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBackground;
        uniform float uScope;
        uniform sampler2D uShadow;
        uniform vec4 uShadowRect;
        uniform float uShadowAmount;
        varying vec2 vGround;

        float ring(float s, float spacing, float width) {
          float d = abs(fract(s / spacing - 0.5) - 0.5) * spacing / max(fwidth(s), 1e-4);
          return 1.0 - smoothstep(0.0, width, d);
        }

        void main() {
          float s = length(vGround);
          float az = degrees(atan(vGround.x, vGround.y));
          float fw = max(fwidth(s), 1e-4);
          float inside = 1.0 - smoothstep(150.0, 150.0 + fw * 1.5, s);

          vec3 color = mix(vec3(0.052, 0.053, 0.058), vec3(0.036, 0.037, 0.041), smoothstep(0.0, 170.0, s));

          // Range rings: 50 km strong, 25 km faint.
          float rings = max(ring(s, 50.0, 1.0) * 0.6, ring(s, 25.0, 0.9) * 0.22) * (1.0 - smoothstep(150.0 + fw, 151.0 + fw * 2.0, s));
          // Bearings every 30 degrees, measured as a distance across the line in km.
          float spoke = abs(fract(az / 30.0 - 0.5) - 0.5) * 30.0;
          float across = radians(spoke) * s / fw;
          float spokes = (1.0 - smoothstep(0.0, 0.9, across)) * 0.16 * inside * smoothstep(4.0, 12.0, s);
          // Ticks every 10 degrees just outside the last ring.
          float tick = abs(fract(az / 10.0 - 0.5) - 0.5) * 10.0;
          float ticks = (1.0 - smoothstep(0.0, 0.9, radians(tick) * s / fw)) * step(150.0, s) * (1.0 - step(154.0, s)) * 0.5;
          color += vec3(0.86, 0.84, 0.8) * (rings + spokes + ticks) * 0.32 * uScope;

          // The storm's shadow, from the chamber's light.
          vec2 uv = (vGround - uShadowRect.xy) / (uShadowRect.zw - uShadowRect.xy);
          float lit = 1.0;
          if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) lit = texture2D(uShadow, uv).r;
          color *= mix(1.0, 0.45 + 0.55 * lit, uShadowAmount);
          color += vec3(0.03, 0.02, 0.01) * lit * uShadowAmount * (1.0 - smoothstep(60.0, 200.0, s));

          color = mix(color, uBackground, smoothstep(175.0, 330.0, s));
          gl_FragColor = vec4(color, 1.0);
        }
      `
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 0;
  mesh.name = 'ground';
  return { mesh, uniforms };
}
