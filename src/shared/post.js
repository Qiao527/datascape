import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Render pipeline shared by both scenes: MSAA scene pass -> optional bloom ->
 * tone mapping / sRGB output. Pass `bloom: null` to skip the bloom pass.
 */
export function createComposer(renderer, scene, camera, bloom) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  let bloomPass = null;
  if (bloom) {
    bloomPass = new UnrealBloomPass(size.clone(), bloom.strength, bloom.radius, bloom.threshold);
    composer.addPass(bloomPass);
  }
  composer.addPass(new OutputPass());

  function resize(width, height) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);
  }

  return { composer, bloomPass, resize };
}

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  return renderer;
}
