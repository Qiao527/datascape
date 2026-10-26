import { FONT_MONO } from '../shared/fonts.js';

/**
 * The month as a 2D chart along the bottom of the screen. Drag it to move
 * through time.
 */
export function createTimeline(container, { observed, meta, onScrub }) {
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const hours = (observed.length - 1) * 0.1;
  const low = -4.2;
  const high = 4.4;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let current = 0;
  let active = false;
  const start = Date.parse(meta.start);

  function resize() {
    const rect = container.getBoundingClientRect();
    ratio = Math.min(window.devicePixelRatio, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    draw();
  }

  const x = (hour) => 8 + (hour / hours) * (width - 16);
  const y = (meters) => 8 + (1 - (meters - low) / (high - low)) * (height - 30);

  function draw() {
    if (!width) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Days.
    ctx.font = `400 9px ${FONT_MONO}`;
    ctx.fillStyle = 'rgba(236, 232, 225, 0.38)';
    ctx.strokeStyle = 'rgba(236, 232, 225, 0.08)';
    ctx.lineWidth = 1;
    for (let day = 0; day <= hours / 24; day += 1) {
      const px = Math.round(x(day * 24)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 6);
      ctx.lineTo(px, height - 20);
      ctx.stroke();
      const date = new Date(start + day * 86400e3);
      if (date.getUTCDate() % 5 === 0 || day === 0) {
        ctx.fillText(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), px + 3, height - 6);
      }
    }

    // Mean higher high and lower low water.
    for (const value of [meta.datums.MHHW, meta.datums.MLLW]) {
      ctx.strokeStyle = 'rgba(236, 232, 225, 0.16)';
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(8, y(value));
      ctx.lineTo(width - 8, y(value));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // The record up to now, bright; the rest, dim.
    const now = current;
    for (const [from, to, style] of [[0, now, 'rgba(241, 235, 225, 0.9)'], [now, hours, 'rgba(241, 235, 225, 0.28)']]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = Math.max(1, Math.floor(observed.length / (width * 2)));
      for (let i = Math.floor(from / 0.1); i <= Math.min(observed.length - 1, Math.ceil(to / 0.1)); i += step) {
        const px = x(i * 0.1);
        const py = y(observed[i]);
        if (i === Math.floor(from / 0.1)) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Playhead.
    const px = x(now);
    ctx.strokeStyle = '#e8b66e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px, 4);
    ctx.lineTo(px, height - 20);
    ctx.stroke();
    ctx.fillStyle = '#e8b66e';
    ctx.beginPath();
    ctx.arc(px, 4, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function scrub(event) {
    const rect = canvas.getBoundingClientRect();
    const hour = Math.min(hours, Math.max(0, ((event.clientX - rect.left - 8) / (rect.width - 16)) * hours));
    current = hour;
    onScrub(hour, active);
    draw();
  }

  canvas.addEventListener('pointerdown', (event) => {
    active = true;
    canvas.setPointerCapture(event.pointerId);
    scrub(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (active) scrub(event);
  });
  const end = () => {
    active = false;
    onScrub(current, false);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  window.addEventListener('resize', resize);
  requestAnimationFrame(resize);

  let lastDrawn = -1;
  return {
    update(hour) {
      current = hour;
      if (Math.abs(hour - lastDrawn) > hours / Math.max(width, 1) / 2) {
        lastDrawn = hour;
        draw();
      }
    },
    setVisible(visible) {
      container.classList.toggle('is-visible', visible);
      if (visible) requestAnimationFrame(resize);
    }
  };
}
