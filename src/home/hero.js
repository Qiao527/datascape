// The first screen: Storm Chamber's own transformation, as a stack of rendered
// frames under the series' Dimension Control. The still in the HTML is complete
// on its own; the frames load after it, only if the visitor's connection allows.

const STOPS = [
  { upTo: 0.04, step: 0, name: 'Radar map, as published: one sweep, drawn flat' },
  { upTo: 0.63, step: 1, name: 'Lifting each sweep onto its true beam' },
  { upTo: 0.66, step: 1, name: 'Fourteen cones, as measured' },
  { upTo: 0.97, step: 2, name: 'Filling the gaps between the cones' },
  { upTo: 1.01, step: 2, name: 'Interpolated volume: a box of sky' }
];

const AUTO = [
  { to: 0, seconds: 2.2 },
  { to: 0, seconds: 0.7 },
  { to: 1, seconds: 5.6 },
  { to: 1, seconds: 0.9 }
];

const ease = (t) => t * t * (3 - 2 * t);

export function createHero({ reducedMotion, saveData }) {
  const hero = document.querySelector('#hero');
  const control = document.querySelector('#hero-control');
  const range = document.querySelector('#hero-range');
  const fill = document.querySelector('#hero-fill');
  const ticks = document.querySelector('#hero-ticks');
  const stop = document.querySelector('#hero-stop');
  const a = document.querySelector('#hero-a');
  const b = document.querySelector('#hero-b');
  const steps = [...document.querySelectorAll('#hero-steps li')];
  const size = window.innerWidth <= 900 ? 900 : 1600;
  let frames = [];
  let images = [];
  let rest = 0;
  let touched = false;

  function show(value) {
    const position = value * (frames.length - 1);
    const i = Math.min(frames.length - 2, Math.floor(position));
    const mix = position - i;
    if (images[i]?.complete) a.src = images[i].src;
    if (images[i + 1]?.complete) {
      b.src = images[i + 1].src;
      b.hidden = false;
      b.style.opacity = String(mix);
    }
    a.removeAttribute('srcset');
    fill.style.transform = `scaleX(${value})`;
    hero.style.setProperty('--dimension', value);
    const dimension = frames[Math.round(position)].dimension;
    const current = STOPS.find((item) => dimension <= item.upTo);
    if (stop.textContent !== current.name) {
      stop.textContent = current.name;
      range.setAttribute('aria-valuetext', current.name);
      steps.forEach((item, s) => item.classList.toggle('is-current', s === current.step));
    }
  }

  function set(value) {
    range.value = String(value);
    show(value);
  }

  /** Once only, unless the visitor takes over: fold back to the chart, then open it. */
  function playOnce() {
    const start = Number(range.value);
    const legs = [...AUTO, { to: start, seconds: 2.4 }];
    let leg = 0;
    let from = start;
    let begun = performance.now();
    const visible = () => hero.getBoundingClientRect().bottom > window.innerHeight * 0.4;
    function tick(now) {
      if (touched || leg >= legs.length || !visible() || document.hidden) return;
      const t = Math.min(1, (now - begun) / (legs[leg].seconds * 1000));
      set(from + (legs[leg].to - from) * ease(t));
      if (t >= 1) {
        from = legs[leg].to;
        leg += 1;
        begun = now;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function take(value) {
    touched = true;
    set(value);
  }

  function animateTo(value) {
    touched = true;
    if (reducedMotion) {
      set(value);
      return;
    }
    const from = Number(range.value);
    const begun = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - begun) / 1200);
      set(from + (value - from) * ease(t));
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  async function start() {
    const manifest = await (await fetch('/media/hero/frames.json')).json();
    frames = manifest.frames;
    rest = manifest.rest / (frames.length - 1);
    await Promise.all(frames.map((frame, i) => new Promise((resolve) => {
      const image = new Image();
      image.onload = image.onerror = resolve;
      image.src = `/media/hero/${frame.name}-${size}.webp`;
      images[i] = image;
    })));
    for (const value of [0, manifest.rest / (frames.length - 1), 1]) {
      const tick = document.createElement('span');
      tick.style.left = `${value * 100}%`;
      ticks.appendChild(tick);
    }
    control.hidden = false;
    hero.classList.add('has-control');
    set(rest);
    range.addEventListener('input', () => take(Number(range.value)));
    range.addEventListener('keydown', (event) => {
      const by = { ArrowRight: 0.02, ArrowUp: 0.02, ArrowLeft: -0.02, ArrowDown: -0.02, PageUp: 0.1, PageDown: -0.1 }[event.key];
      if (by === undefined) return;
      event.preventDefault();
      take(Math.min(1, Math.max(0, Number(range.value) + by)));
    });
    control.querySelectorAll('.hero-end').forEach((end) => end.addEventListener('click', () => animateTo(Number(end.dataset.to))));
    for (const type of ['wheel', 'touchstart', 'keydown']) {
      window.addEventListener(type, () => {
        touched = true;
      }, { once: true, passive: true });
    }
    if (!reducedMotion) setTimeout(playOnce, 1400);
  }

  // Frames are worth having only after the page itself has arrived.
  if (saveData) return;
  const begin = () => start().catch((error) => console.warn('Hero frames not available', error));
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(begin, { timeout: 2000 }) : setTimeout(begin, 300));
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}
