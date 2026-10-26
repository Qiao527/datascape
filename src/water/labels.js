import * as THREE from 'three';

/** HTML labels pinned to points in the scene. */
export function createLabels(container, camera) {
  const items = [];
  const projected = new THREE.Vector3();

  function add(key, { title, detail = '', anchor, side = 'right' }) {
    const element = document.createElement('div');
    element.className = `scene-label scene-label-${side}`;
    element.innerHTML = '<span class="scene-label-dot"></span><span class="scene-label-text"><em></em><small></small></span>';
    element.querySelector('em').textContent = title;
    element.querySelector('small').textContent = detail;
    container.appendChild(element);
    const item = { key, element, anchor, opacity: 0, target: 0 };
    items.push(item);
    return item;
  }

  function show(keys) {
    const set = new Set(keys);
    for (const item of items) item.target = set.has(item.key) ? 1 : 0;
  }

  function update(delta, width, height) {
    for (const item of items) {
      item.opacity += (item.target - item.opacity) * Math.min(1, delta * 3);
      if (item.opacity < 0.01) {
        item.element.style.opacity = '0';
        item.element.style.visibility = 'hidden';
        continue;
      }
      const anchor = typeof item.anchor === 'function' ? item.anchor() : item.anchor;
      projected.copy(anchor).project(camera);
      const behind = projected.z > 1;
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      item.element.style.visibility = behind ? 'hidden' : 'visible';
      item.element.style.opacity = String(item.opacity);
      item.element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  return { add, show, update };
}
