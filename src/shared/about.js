/**
 * The "About the data" panel every piece of the series has: the chip opens and
 * closes it, × and Escape close it, and focus moves into the panel and back to
 * the chip. Markup: <button id="about"> and <section id="about-panel" hidden>
 * containing a <button class="about-close">.
 */
export function createAbout({ chip = '#about', panel = '#about-panel' } = {}) {
  const button = document.querySelector(chip);
  const dialog = document.querySelector(panel);

  function toggle(force) {
    const open = force ?? dialog.hidden;
    if (open === !dialog.hidden) return;
    dialog.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) dialog.querySelector('.about-close').focus();
    else if (dialog.contains(document.activeElement) || document.activeElement === document.body) button.focus();
  }

  button.addEventListener('click', () => toggle());
  dialog.querySelector('.about-close').addEventListener('click', () => toggle(false));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') toggle(false);
  });
  return { toggle };
}
