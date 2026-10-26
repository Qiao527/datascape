// Self-hosted type for the whole portfolio.
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

export const FONT_SERIF = '"Instrument Serif", "Iowan Old Style", Georgia, serif';
export const FONT_SANS = '"Inter Variable", "Inter", system-ui, sans-serif';
export const FONT_MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';

/** Resolves once the faces used on canvases are ready (or after a timeout). */
export function fontsReady(timeoutMs = 3000) {
  const loads = [
    '400 32px "Instrument Serif"',
    'italic 400 32px "Instrument Serif"',
    '400 32px "Inter Variable"',
    '600 32px "Inter Variable"',
    '400 32px "JetBrains Mono"',
    '500 32px "JetBrains Mono"'
  ].map((font) => document.fonts.load(font).catch(() => null));
  const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([Promise.all(loads), timeout]);
}
