// The home page runs no WebGL: everything on it is a frame or a film captured
// from the pieces themselves by scripts/media/capture.mjs.
import './shared/base.css';
import './shared/fonts.js';
import './home.css';
import { createHero } from './home/hero.js';
import { createPreviews } from './home/previews.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = Boolean(navigator.connection?.saveData);

createHero({ reducedMotion, saveData });
createPreviews({ reducedMotion, saveData });
