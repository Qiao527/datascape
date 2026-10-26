import * as THREE from 'three';

/**
 * Stacked ridge lines in the style of the PSR B1919+21 plot.
 *
 * Every row is one snapshot (a pulse, or a frame of audio spectrum). Rows live
 * in a ring-buffer float texture; the vertex shaders read heights from it, so
 * pushing a new row costs one small texture upload and no geometry rebuild.
 *
 * Each row is drawn twice: a black "curtain" from the baseline up to the curve
 * that hides the rows behind it, and a screen-space thick white line on top.
 */
export function createRidges({ bins = 160, rows = 80, width = 36, spacing = 0.5, amplitude = 5 } = {}) {
  const data = new Float32Array(bins * rows);
  const texture = new THREE.DataTexture(data, bins, rows, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;

  const uniforms = {
    uHeights: { value: texture },
    uHead: { value: 0 },
    uScroll: { value: 0 },
    uBins: { value: bins },
    uRows: { value: rows },
    uWidth: { value: width },
    uSpacing: { value: spacing },
    uAmplitude: { value: amplitude },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uThickness: { value: 1.6 },
    uLineColor: { value: new THREE.Color(0xffffff) },
    uBrightness: { value: 1 }
  };

  const ridgeChunk = /* glsl */ `
    uniform sampler2D uHeights;
    uniform float uHead;
    uniform float uScroll;
    uniform float uBins;
    uniform float uRows;
    uniform float uWidth;
    uniform float uSpacing;
    uniform float uAmplitude;

    float rowAge(float row) {
      return row + uScroll;
    }

    float sampleHeight(float bin, float row) {
      float b = clamp(bin, 0.0, uBins - 1.0);
      float texRow = mod(uHead - row + uRows, uRows);
      return texture2D(uHeights, vec2((b + 0.5) / uBins, (texRow + 0.5) / uRows)).r;
    }

    vec3 ridgePoint(float bin, float row) {
      float age = rowAge(row);
      // New rows rise out of the baseline instead of popping in.
      float lift = smoothstep(0.0, 1.0, age);
      float x = (bin / (uBins - 1.0) - 0.5) * uWidth;
      float z = -age * uSpacing;
      float y = sampleHeight(bin, row) * uAmplitude * lift;
      return vec3(x, y, z);
    }

    float rowFade(float row) {
      float age = rowAge(row) / uRows;
      return smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.72, 0.98, age));
    }
  `;

  // --- Curtains (occluders) -------------------------------------------------
  const fillVertexCount = bins * 2 * rows;
  const fillBin = new Float32Array(fillVertexCount);
  const fillRow = new Float32Array(fillVertexCount);
  const fillTop = new Float32Array(fillVertexCount);
  const fillIndex = [];
  for (let row = 0; row < rows; row += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      const v = (row * bins + bin) * 2;
      fillBin[v] = fillBin[v + 1] = bin;
      fillRow[v] = fillRow[v + 1] = row;
      fillTop[v] = 1;
      fillTop[v + 1] = 0;
      if (bin < bins - 1) {
        fillIndex.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
  }
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fillVertexCount * 3), 3));
  fillGeometry.setAttribute('aBin', new THREE.BufferAttribute(fillBin, 1));
  fillGeometry.setAttribute('aRow', new THREE.BufferAttribute(fillRow, 1));
  fillGeometry.setAttribute('aTop', new THREE.BufferAttribute(fillTop, 1));
  fillGeometry.setIndex(fillIndex);

  const fillMaterial = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    vertexShader: /* glsl */ `
      ${ridgeChunk}
      attribute float aBin;
      attribute float aRow;
      attribute float aTop;
      void main() {
        vec3 p = ridgePoint(aBin, aRow);
        if (aTop < 0.5) p.y = -0.2;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      }
    `
  });
  const fills = new THREE.Mesh(fillGeometry, fillMaterial);
  fills.frustumCulled = false;
  fills.renderOrder = 0;

  // --- Lines ----------------------------------------------------------------
  const lineVertexCount = bins * 2 * rows;
  const lineBin = new Float32Array(lineVertexCount);
  const lineRow = new Float32Array(lineVertexCount);
  const lineSide = new Float32Array(lineVertexCount);
  const lineIndex = [];
  for (let row = 0; row < rows; row += 1) {
    for (let bin = 0; bin < bins; bin += 1) {
      const v = (row * bins + bin) * 2;
      lineBin[v] = lineBin[v + 1] = bin;
      lineRow[v] = lineRow[v + 1] = row;
      lineSide[v] = 1;
      lineSide[v + 1] = -1;
      if (bin < bins - 1) {
        lineIndex.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineVertexCount * 3), 3));
  lineGeometry.setAttribute('aBin', new THREE.BufferAttribute(lineBin, 1));
  lineGeometry.setAttribute('aRow', new THREE.BufferAttribute(lineRow, 1));
  lineGeometry.setAttribute('aSide', new THREE.BufferAttribute(lineSide, 1));
  lineGeometry.setIndex(lineIndex);

  const lineMaterial = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${ridgeChunk}
      uniform vec2 uResolution;
      uniform float uThickness;
      attribute float aBin;
      attribute float aRow;
      attribute float aSide;
      varying float vSide;
      varying float vFade;

      vec2 toScreen(vec4 clip) {
        return clip.xy / clip.w * vec2(uResolution.x / uResolution.y, 1.0);
      }

      void main() {
        mat4 mvp = projectionMatrix * modelViewMatrix;
        vec4 clip = mvp * vec4(ridgePoint(aBin, aRow), 1.0);
        vec4 clipPrev = mvp * vec4(ridgePoint(aBin - 1.0, aRow), 1.0);
        vec4 clipNext = mvp * vec4(ridgePoint(aBin + 1.0, aRow), 1.0);

        vec2 tangent = toScreen(clipNext) - toScreen(clipPrev);
        if (aBin < 0.5) tangent = toScreen(clipNext) - toScreen(clip);
        if (aBin > uBins - 1.5) tangent = toScreen(clip) - toScreen(clipPrev);
        tangent = normalize(tangent + vec2(1e-6, 0.0));
        vec2 normal = vec2(-tangent.y, tangent.x);
        normal.x /= uResolution.x / uResolution.y;

        // uThickness is the full line width in CSS-independent device pixels.
        clip.xy += normal * aSide * (uThickness / uResolution.y) * clip.w;
        gl_Position = clip;

        vSide = aSide;
        vFade = rowFade(aRow);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uLineColor;
      uniform float uBrightness;
      varying float vSide;
      varying float vFade;
      void main() {
        float alpha = (1.0 - smoothstep(0.35, 1.0, abs(vSide))) * vFade;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(uLineColor * uBrightness, alpha);
      }
    `
  });
  const lines = new THREE.Mesh(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  lines.renderOrder = 1;

  const group = new THREE.Group();
  group.add(fills, lines);

  let head = 0;

  return {
    object: group,
    uniforms,
    bins,
    rows,
    depth: rows * spacing,
    /** Append the newest row (length `bins`, values roughly 0..1). */
    push(row) {
      head = (head + 1) % rows;
      data.set(row, head * bins);
      texture.needsUpdate = true;
      uniforms.uHead.value = head;
    },
    setScroll(fraction) {
      uniforms.uScroll.value = fraction;
    },
    setResolution(width, height) {
      uniforms.uResolution.value.set(width, height);
    },
    dispose() {
      texture.dispose();
      fillGeometry.dispose();
      fillMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    }
  };
}
