import * as THREE from 'three';

const TEXTURE_WIDTH = 1000;

/**
 * Uploads the Frank X, Y, Z samples (mV) into a float texture that every
 * trace samples in its vertex shader.
 */
export function createSampleTexture(xyz, count) {
  const height = Math.ceil(count / TEXTURE_WIDTH);
  const data = new Float32Array(TEXTURE_WIDTH * height * 4);
  for (let i = 0; i < count; i += 1) {
    data[i * 4] = xyz[i * 3];
    data[i * 4 + 1] = xyz[i * 3 + 1];
    data[i * 4 + 2] = xyz[i * 3 + 2];
    data[i * 4 + 3] = 1;
  }
  const texture = new THREE.DataTexture(data, TEXTURE_WIDTH, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

const vertexShader = /* glsl */ `
  uniform sampler2D uSamples;
  uniform float uCount;
  uniform float uFs;
  uniform float uDuration;
  uniform float uLead;       // 0, 1, 2: which Frank lead this strip plots
  uniform float uDim;        // 0 = flat strips on the paper, 1 = the loop in space
  uniform vec4 uStrip;       // x of t=0, units per second, baseline y, units per mV
  uniform vec3 uOrigin;      // where the vector starts (the isoelectric point)
  uniform float uScale;      // units per mV in space
  uniform vec3 uProjectMask; // replaces these coordinates of the loop...
  uniform vec3 uProjectPlane;// ...with these values (shadows on the planes)
  uniform vec2 uResolution;
  uniform float uWidth;
  attribute float aIndex;
  attribute float aSide;
  varying float vSide;
  varying float vT;
  varying float vFold;

  vec3 sampleAt(float i) {
    float k = clamp(i, 0.0, uCount - 1.0);
    vec2 uv = vec2((mod(k, ${TEXTURE_WIDTH}.0) + 0.5) / ${TEXTURE_WIDTH}.0, (floor(k / ${TEXTURE_WIDTH}.0) + 0.5) / float(textureSize(uSamples, 0).y));
    return texture2D(uSamples, uv).xyz;
  }

  vec3 place(float i) {
    vec3 v = sampleAt(i);
    float t = clamp(i, 0.0, uCount - 1.0) / uFs;
    // Viewed from the front: the subject's left is to the right, head up,
    // front toward the viewer (Frank: x left, y feet, z back).
    vec3 loop = uOrigin + uScale * vec3(v.x, -v.y, -v.z);
    loop = mix(loop, uProjectPlane, uProjectMask);
    float value = uLead < 0.5 ? v.x : (uLead < 1.5 ? v.y : v.z);
    vec3 strip = vec3(uStrip.x + t * uStrip.y, uStrip.z + value * uStrip.w, 0.015);
    // The fold sweeps from the start of the record to its end.
    float delay = 0.42 * t / uDuration;
    float fold = smoothstep(delay, delay + 0.58, uDim);
    vFold = fold;
    return mix(strip, loop, fold);
  }

  vec2 screen(vec4 clip) {
    return clip.xy / clip.w * vec2(uResolution.x / uResolution.y, 1.0);
  }

  void main() {
    mat4 mvp = projectionMatrix * modelViewMatrix;
    vec4 previous = mvp * vec4(place(aIndex - 1.0), 1.0);
    vec4 next = mvp * vec4(place(aIndex + 1.0), 1.0);
    vec4 clip = mvp * vec4(place(aIndex), 1.0);
    vec2 tangent = screen(next) - screen(previous);
    if (length(tangent) < 1e-6) tangent = vec2(1.0, 0.0);
    tangent = normalize(tangent);
    vec2 normal = vec2(-tangent.y, tangent.x);
    normal.x *= uResolution.y / uResolution.x;
    clip.xy += normal * aSide * (uWidth / uResolution.y) * clip.w;
    gl_Position = clip;
    vSide = aSide;
    vT = clamp(aIndex, 0.0, uCount - 1.0) / uFs;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;      // playhead, seconds into the record
  uniform float uDuration;
  uniform float uTrail;     // seconds of record over which the trace fades
  uniform float uFloor;     // how much of the older trace remains
  uniform float uStatic;    // 1 = printed ink, no playhead
  uniform float uOpacity;
  uniform vec3 uColor;
  uniform vec3 uHeadColor;
  varying float vSide;
  varying float vT;
  varying float vFold;

  void main() {
    float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
    float age = mod(uTime - vT, uDuration);
    float head = exp(-age / 0.035);
    float trail = mix(uFloor, 1.0, exp(-age / uTrail));
    float alpha = mix(trail, 1.0, uStatic) * edge * uOpacity;
    if (alpha < 0.003) discard;
    vec3 color = mix(uColor, uHeadColor, head * (1.0 - uStatic));
    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * A thick, screen-space line over the whole record. One instance per lead
 * strip, plus extra instances for the loop's shadows on the three planes.
 */
export function createTrace({ samples, count, fs, duration, lead, strip, origin, scale, color, headColor, width = 2 }) {
  const vertices = count * 2;
  const index = new Float32Array(vertices);
  const side = new Float32Array(vertices);
  for (let i = 0; i < count; i += 1) {
    index[i * 2] = index[i * 2 + 1] = i;
    side[i * 2] = 1;
    side[i * 2 + 1] = -1;
  }
  const triangles = [];
  for (let i = 0; i < count - 1; i += 1) {
    const a = i * 2;
    triangles.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
  geometry.setAttribute('aIndex', new THREE.BufferAttribute(index, 1));
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geometry.setIndex(triangles);

  const uniforms = {
    uSamples: { value: samples },
    uCount: { value: count },
    uFs: { value: fs },
    uDuration: { value: duration },
    uLead: { value: lead },
    uDim: { value: 0 },
    uStrip: { value: new THREE.Vector4(...strip) },
    uOrigin: { value: origin },
    uScale: { value: scale },
    uProjectMask: { value: new THREE.Vector3(0, 0, 0) },
    uProjectPlane: { value: new THREE.Vector3(0, 0, 0) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uWidth: { value: width },
    uTime: { value: 0 },
    uTrail: { value: 2.5 },
    uFloor: { value: 0.08 },
    uStatic: { value: 0 },
    uOpacity: { value: 1 },
    uColor: { value: new THREE.Color(color) },
    uHeadColor: { value: new THREE.Color(headColor) }
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
