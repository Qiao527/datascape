/**
 * The Dimension Control, shared by every piece of the series: one continuous
 * parameter from the flat chart (0) to the hidden dimension (1). Each piece
 * decides what the parameter does to its own geometry.
 *
 * Markup: <div class="dimension" id="dimension"></div>
 */
export function createDimensionControl(container, { labels = ['2D', '3D'], caption = '', onInput = () => {} } = {}) {
  container.innerHTML = `
    <span class="dimension-end">${labels[0]}</span>
    <label class="dimension-track">
      <span class="visually-hidden">${caption || 'Dimension'}</span>
      <input type="range" min="0" max="1" step="0.001" value="0" />
      <span class="dimension-fill"></span>
      <span class="dimension-ticks" aria-hidden="true"></span>
    </label>
    <span class="dimension-end">${labels[1]}</span>
    <span class="dimension-caption"></span>`;
  const input = container.querySelector('input');
  const fill = container.querySelector('.dimension-fill');
  container.querySelector('.dimension-caption').textContent = caption;
  let dragging = false;

  const paint = (value) => {
    fill.style.transform = `scaleX(${value})`;
    container.style.setProperty('--dimension', value);
  };

  input.addEventListener('input', () => {
    dragging = true;
    const value = Number(input.value);
    paint(value);
    onInput(value);
  });
  input.addEventListener('change', () => {
    dragging = false;
  });

  return {
    /** Mirrors the scene's current value while the visitor is not dragging. */
    sync(value) {
      if (dragging) return;
      input.value = String(value);
      paint(value);
    },
    get dragging() {
      return dragging;
    },
    setCaption(text) {
      container.querySelector('.dimension-caption').textContent = text;
    }
  };
}
