import * as THREE from 'three';

// Shared building blocks for the Datascape pieces ("The Hidden Dimension"): eased
// values, a camera rig that flies along orbits, and the chapter card.

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const deg = THREE.MathUtils.degToRad;

/** Longest frame step; ?maxdt= raises it for slow software renderers in checks. */
export const MAX_DELTA = Number(new URLSearchParams(location.search).get('maxdt')) || 0.1;

export class Tween {
  constructor(value) {
    this.value = value;
    this.from = value;
    this.to = value;
    this.elapsed = 0;
    this.duration = 0;
  }

  set(to, duration = 1) {
    if (to === this.to && this.elapsed >= this.duration) return;
    this.from = this.value;
    this.to = to;
    this.elapsed = 0;
    this.duration = reducedMotion ? Math.min(duration, 0.3) : Math.max(duration, 1e-3);
  }

  /** Jump without animating (e.g. while a slider is dragged). */
  snap(value) {
    this.value = this.from = this.to = value;
    this.elapsed = this.duration = 0;
  }

  update(delta) {
    if (this.elapsed >= this.duration) {
      this.value = this.to;
      return this.value;
    }
    this.elapsed += delta;
    this.value = lerp(this.from, this.to, easeInOut(clamp01(this.elapsed / this.duration)));
    return this.value;
  }

  get settled() {
    return this.elapsed >= this.duration;
  }
}

/**
 * Moves the camera between framings along orbits around an interpolated
 * target, so it never cuts through the subject. A framing is
 * { target: [x, y, z], azimuth, polar, distance, fov, absolute? }.
 */
export function createCameraRig({ camera, controls, stage, offsetX = 0.11, offsetY = 0.14 }) {
  const spherical = new THREE.Spherical();
  const offset = new THREE.Vector3();
  let move = null;
  let lastInteraction = 0;
  let interacting = false;

  controls.addEventListener('start', () => {
    interacting = true;
    move = null;
    controls.enabled = true;
  });
  controls.addEventListener('end', () => {
    interacting = false;
    lastInteraction = performance.now() / 1000;
  });

  function framingScale() {
    const aspect = camera.aspect;
    return aspect >= 1.45 ? 1 : Math.pow(1.45 / aspect, 0.85);
  }

  function resolve(spec) {
    const scale = spec.absolute ? 1 : framingScale();
    return { ...spec, distance: spec.distance * scale, target: new THREE.Vector3(...spec.target) };
  }

  function current() {
    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);
    return { target: controls.target.clone(), azimuth: spherical.theta, polar: spherical.phi, distance: spherical.radius, fov: camera.fov };
  }

  function apply({ target, azimuth, polar, distance, fov }) {
    controls.target.copy(target);
    offset.setFromSphericalCoords(distance, polar, azimuth);
    camera.position.copy(target).add(offset);
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target);
  }

  return {
    framingScale,
    get moving() {
      return Boolean(move);
    },
    get interacting() {
      return interacting;
    },
    flyTo(spec, duration = 2.8) {
      const to = resolve(spec);
      const from = current();
      let azimuth = to.azimuth;
      while (azimuth - from.azimuth > Math.PI) azimuth -= Math.PI * 2;
      while (azimuth - from.azimuth < -Math.PI) azimuth += Math.PI * 2;
      move = { from, to: { ...to, azimuth }, elapsed: 0, duration: reducedMotion ? 0.01 : duration };
      controls.enabled = false;
    },
    jumpTo(spec) {
      apply(resolve(spec));
      move = null;
      controls.enabled = true;
    },
    update(delta, elapsed, { sway = true } = {}) {
      if (move) {
        move.elapsed += delta;
        const t = easeInOut(clamp01(move.elapsed / move.duration));
        const { from, to } = move;
        apply({
          target: from.target.clone().lerp(to.target, t),
          azimuth: lerp(from.azimuth, to.azimuth, t),
          polar: lerp(from.polar, to.polar, t),
          distance: Math.exp(lerp(Math.log(from.distance), Math.log(to.distance), t)),
          fov: lerp(from.fov, to.fov, t)
        });
        if (t >= 1) {
          move = null;
          controls.enabled = true;
        }
        return;
      }
      const idle = performance.now() / 1000 - lastInteraction > 2.5 && !interacting;
      if (sway && idle && !reducedMotion) {
        const angle = deg(0.9) * Math.cos(elapsed * 0.12) * delta * 0.12;
        offset.copy(camera.position).sub(controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
        camera.position.copy(controls.target).add(offset);
      }
      controls.update();
    },
    /** Keeps the subject clear of the chapter card. */
    applyViewOffset() {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (width > 900) camera.setViewOffset(width, height, -width * offsetX, 0, width, height);
      else camera.setViewOffset(width, height, 0, height * offsetY, width, height);
      camera.updateProjectionMatrix();
    }
  };
}

/**
 * The chapter card: kicker, title, body, optional extras, previous / next and
 * dots. Calls onEnter(chapter, index, { instant }) on every change and fires
 * chapter.events [{ at: seconds, ... }] through onEvent. A chapter with
 * autoAdvance moves on by itself unless the visitor has interacted.
 */
export function createStory({ chapters, onEnter, onEvent = () => {}, extraFor = () => [] }) {
  const ui = {
    card: document.querySelector('#chapter'),
    kicker: document.querySelector('#chapter-kicker'),
    title: document.querySelector('#chapter-title'),
    body: document.querySelector('#chapter-body'),
    extra: document.querySelector('#chapter-extra'),
    prev: document.querySelector('#prev'),
    next: document.querySelector('#next'),
    dots: document.querySelector('#dots')
  };
  const numbered = chapters.filter((chapter) => /^\d+$/.test(chapter.kicker)).length;
  let index = -1;
  let time = 0;
  let fired = new Set();
  let touched = false;

  ui.dots.replaceChildren(...chapters.map((chapter, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dot';
    button.setAttribute('aria-label', chapter.title);
    button.addEventListener('click', () => {
      touched = true;
      goTo(i);
    });
    return button;
  }));
  ui.next.addEventListener('click', () => {
    touched = true;
    goTo(index === chapters.length - 1 ? 0 : index + 1);
  });
  ui.prev.addEventListener('click', () => {
    touched = true;
    goTo(index - 1);
  });
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.type !== 'range') return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') goTo(index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp') goTo(index - 1);
    else return;
    touched = true;
    event.preventDefault();
  });
  // A hash typed into the address bar, or a link to #chapter, moves the story.
  // goTo itself uses replaceState, which does not fire hashchange.
  window.addEventListener('hashchange', () => {
    const i = chapters.findIndex((chapter) => `#${chapter.key}` === location.hash);
    if (i < 0) return;
    touched = true;
    goTo(i);
  });
  for (const type of ['pointerdown', 'wheel']) {
    window.addEventListener(type, () => {
      touched = true;
    }, { passive: true });
  }

  function render(chapter, i) {
    ui.card.classList.add('is-changing');
    setTimeout(() => {
      ui.kicker.textContent = /^\d+$/.test(chapter.kicker)
        ? `${chapter.kicker} / ${String(numbered).padStart(2, '0')}`
        : chapter.kicker;
      ui.title.textContent = chapter.title;
      ui.body.textContent = chapter.body;
      ui.extra.replaceChildren(...extraFor(chapter, i));
      ui.next.textContent = chapter.next ?? (i === chapters.length - 1 ? 'Restart' : 'Next');
      ui.prev.hidden = i === 0;
      [...ui.dots.children].forEach((dot, d) => dot.setAttribute('aria-current', String(d === i)));
      ui.card.dataset.chapter = chapter.key;
      ui.card.classList.remove('is-changing');
    }, 260);
  }

  function goTo(i, { instant = false } = {}) {
    i = Math.max(0, Math.min(chapters.length - 1, i));
    if (i === index) return;
    index = i;
    time = 0;
    fired = new Set();
    const chapter = chapters[i];
    onEnter(chapter, i, { instant });
    render(chapter, i);
    history.replaceState(null, '', `${location.search}#${chapter.key}`);
  }

  return {
    goTo,
    get index() {
      return index;
    },
    get chapter() {
      return chapters[index];
    },
    get time() {
      return time;
    },
    /** Starts at the chapter named in the URL hash, or the first. */
    start() {
      const fromHash = chapters.findIndex((chapter) => `#${chapter.key}` === location.hash);
      if (fromHash > 0) touched = true;
      goTo(Math.max(0, fromHash), { instant: true });
    },
    rerender() {
      render(chapters[index], index);
    },
    update(delta) {
      if (index < 0) return;
      time += delta;
      const chapter = chapters[index];
      for (const [i, event] of (chapter.events ?? []).entries()) {
        if (fired.has(i) || time < event.at) continue;
        fired.add(i);
        onEvent(event, chapter);
      }
      if (chapter.autoAdvance && !touched && time >= chapter.autoAdvance) goTo(index + 1);
    }
  };
}

/**
 * HTML labels pinned to points in the scene. `avoid` lists selectors of fixed
 * interface panels the label text should not sit under.
 */
export function createLabels(container, camera, { avoid = [] } = {}) {
  const items = [];
  const projected = new THREE.Vector3();
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

  function panels() {
    const rects = [];
    for (const selector of avoid) {
      for (const element of document.querySelectorAll(selector)) {
        const r = element.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) rects.push({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom });
      }
    }
    return rects;
  }

  /** The smallest vertical offset that keeps a text box clear of `taken`, or null. */
  function clearOffset(box, taken, height) {
    const candidates = [0];
    for (const r of taken) {
      if (box.x0 >= r.x1 || box.x1 <= r.x0) continue;
      candidates.push(r.y1 + 2 - box.y0, r.y0 - 2 - box.y1);
    }
    candidates.sort((a, b) => Math.abs(a) - Math.abs(b));
    for (const dy of candidates) {
      const moved = { x0: box.x0, x1: box.x1, y0: box.y0 + dy, y1: box.y1 + dy };
      if (moved.y0 < 0 || moved.y1 > height) continue;
      if (!taken.some((r) => overlaps(moved, r))) return dy;
    }
    return null;
  }

  return {
    add(key, { title, detail = '', anchor, side = 'right', className = '' }) {
      const element = document.createElement('div');
      element.className = `scene-label scene-label-${side} ${className}`.trim();
      element.innerHTML = '<span class="scene-label-dot"></span><span class="scene-label-text"><em></em><small></small></span>';
      element.querySelector('em').textContent = title;
      element.querySelector('small').textContent = detail;
      container.appendChild(element);
      const text = element.querySelector('.scene-label-text');
      text.style.position = 'relative';
      items.push({ key, element, text, anchor, side, width: 0, height: 0, opacity: 0, target: 0, rank: Infinity, dx: 0, dy: 0 });
    },
    /** Changes a label's text; untouched fields keep theirs. */
    setText(key, { title, detail } = {}) {
      const item = items.find((entry) => entry.key === key);
      if (!item) return;
      const em = item.element.querySelector('em');
      const small = item.element.querySelector('small');
      if (title !== undefined && em.textContent !== title) {
        em.textContent = title;
        item.width = item.height = 0;
      }
      if (detail !== undefined && small.textContent !== detail) {
        small.textContent = detail;
        item.width = item.height = 0;
      }
    },
    /** Shows these labels; earlier keys keep their place when labels collide. */
    show(keys) {
      for (const item of items) {
        const rank = keys.indexOf(item.key);
        item.target = rank < 0 ? 0 : 1;
        item.rank = rank < 0 ? Infinity : rank;
      }
    },
    update(delta, width, height) {
      const margin = 8;
      // Read the panels before writing any styles, so this costs no extra layout.
      const interface_ = avoid.length ? panels() : [];
      const visible = [];
      for (const item of items) {
        item.opacity += (item.target - item.opacity) * Math.min(1, delta * 3);
        if (item.opacity < 0.01) {
          item.element.style.visibility = 'hidden';
          continue;
        }
        const anchor = typeof item.anchor === 'function' ? item.anchor() : item.anchor;
        projected.copy(anchor).project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        // Behind the camera, or pointing at something off screen or under the interface.
        const behind = projected.z > 1 || x < 0 || y < 0 || x > width || y > height
          || interface_.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
        item.element.style.visibility = behind ? 'hidden' : 'visible';
        item.element.style.opacity = String(item.opacity);
        item.element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        if (!behind) visible.push({ item, x, y });
      }

      // Place text in rank order: flip toward the side with room, slide along
      // when neither side has enough, then take the smallest step up or down
      // that clears the interface and the labels already placed. A label with
      // no room at all stays hidden this frame.
      visible.sort((a, b) => a.item.rank - b.item.rank);
      const taken = [...interface_];
      for (const { item, x, y } of visible) {
        item.width ||= item.element.offsetWidth;
        item.height ||= item.text.offsetHeight;
        const flip = item.side === 'right' ? x + item.width > width - 12 : x - item.width < 12;
        const left = item.side === 'right' ? flip : !flip;
        item.element.classList.toggle('scene-label-left', left);
        const dx = left ? Math.max(0, margin - (x - item.width)) : Math.min(0, width - margin - (x + item.width));
        const x0 = (left ? x - item.width : x) + dx;
        const top = item.element.classList.contains('scene-label-up') ? y - item.height - 6 : y - item.height / 2;
        const box = { x0, x1: x0 + item.width, y0: top, y1: top + item.height };
        const dy = clearOffset(box, taken, height);
        if (dy === null) {
          item.element.style.visibility = 'hidden';
          continue;
        }
        taken.push({ ...box, y0: box.y0 + dy, y1: box.y1 + dy });
        // dx follows the anchor continuously; dy can jump when labels start to
        // overlap, so it eases.
        const easedDy = item.dy + (dy - item.dy) * Math.min(1, delta * 10);
        if (Math.abs(dx - item.dx) > 0.25 || Math.abs(dy - item.dy) > 0.25) {
          item.dx = dx;
          item.dy = Math.abs(dy - easedDy) < 0.25 ? dy : easedDy;
          item.text.style.left = `${item.dx.toFixed(1)}px`;
          item.text.style.top = `${item.dy.toFixed(1)}px`;
        }
      }
    }
  };
}
