/**
 * The Dimension Control, shared by every piece of the series: one continuous
 * parameter from the flat chart (0) to the hidden dimension (1). Each piece
 * decides what the parameter does to its own geometry.
 *
 * `stops` names what the parameter means along the way, as [[value, name, marked]]:
 * the name under the track and the slider's spoken value; a tick on the track
 * unless `marked` is false.
 * `onInput(value, jump)` is told when the value moved too far to follow
 * directly (a click on the track, an end label), so the piece can ease there.
 *
 * Markup: <div class="dimension" id="dimension"></div>
 */
const ARROW_STEP = 0.02;
const PAGE_STEP = 0.1;
const JUMP = 0.06;

export function createDimensionControl(container, { labels = ['2D', '3D'], caption = '', stops = [], onInput = () => {} } = {}) {
  container.innerHTML = `
    <button type="button" class="dimension-end" data-to="0"></button>
    <label class="dimension-track">
      <span class="visually-hidden"></span>
      <input type="range" min="0" max="1" step="0.001" value="0" />
      <span class="dimension-fill"></span>
      <span class="dimension-ticks" aria-hidden="true"></span>
    </label>
    <button type="button" class="dimension-end" data-to="1"></button>
    <span class="dimension-caption"></span>
    <span class="dimension-stop" aria-hidden="true"></span>`;
  const input = container.querySelector('input');
  const fill = container.querySelector('.dimension-fill');
  const ticks = container.querySelector('.dimension-ticks');
  const stopElement = container.querySelector('.dimension-stop');
  container.querySelector('.dimension-caption').textContent = caption;
  const ends = container.querySelectorAll('.dimension-end');
  container.querySelector('.visually-hidden').textContent = caption || 'Dimension';
  ends.forEach((end, i) => {
    end.textContent = labels[i];
    end.setAttribute('aria-label', `${labels[i]}: go to ${stops.at(i === 0 ? 0 : -1)?.[1] ?? 'this end'}`);
  });
  for (const [value, , marked = true] of stops) {
    if (!marked) continue;
    const tick = document.createElement('span');
    tick.style.left = `${value * 100}%`;
    ticks.appendChild(tick);
  }

  let dragging = false;
  let shown = 0;
  let spoken = null;

  const stopAt = (value) => stops.reduce((best, stop) => (stop[0] <= value + 0.02 ? stop : best), stops[0]);

  const paint = (value) => {
    shown = value;
    fill.style.transform = `scaleX(${value})`;
    container.style.setProperty('--dimension', value);
    const name = stops.length ? stopAt(value)[1] : null;
    if (name === spoken) return;
    spoken = name;
    stopElement.textContent = name ?? '';
    if (name) input.setAttribute('aria-valuetext', `${value.toFixed(2)}, ${name}`);
  };

  /** Moves as the visitor asked, easing when the step is too long to follow. */
  const move = (value) => {
    const jump = Math.abs(value - shown) > JUMP;
    input.value = String(value);
    paint(value);
    onInput(value, jump);
  };

  input.addEventListener('input', () => {
    dragging = true;
    move(Number(input.value));
  });
  input.addEventListener('change', () => {
    dragging = false;
  });
  // The browser's own step is one thousandth, too small to feel by keyboard.
  input.addEventListener('keydown', (event) => {
    const step = { ArrowRight: ARROW_STEP, ArrowUp: ARROW_STEP, ArrowLeft: -ARROW_STEP, ArrowDown: -ARROW_STEP, PageUp: PAGE_STEP, PageDown: -PAGE_STEP }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    move(Math.min(1, Math.max(0, shown + step)));
  });
  ends.forEach((end) => end.addEventListener('click', () => move(Number(end.dataset.to))));
  paint(0);

  return {
    /** Mirrors the scene's current value while the visitor is not dragging. */
    sync(value) {
      if (dragging) return;
      input.value = String(value);
      paint(value);
    },
    get dragging() {
      return dragging;
    }
  };
}
