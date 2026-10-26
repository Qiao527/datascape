// Object space of the water surface.
//   x: temperature, 200–800 K, linear
//   z: log10 pressure, 1 Pa (front, +z) to 100 MPa (back, -z)
//   y: log10 density, kg/m³ (the height of the surface)
// The same mapping draws the floor diagrams, so the shadow lines up exactly.

export const T_MIN = 200;
export const T_MAX = 800;
export const LOGP_MIN = 0;
export const LOGP_MAX = 8;
export const LOGRHO_MIN = -5.6;
export const LOGRHO_MAX = 3.05;

export const WIDTH = 24;
export const DEPTH = 16;
export const UNITS_PER_DECADE_RHO = 1;
export const HEIGHT = (LOGRHO_MAX - LOGRHO_MIN) * UNITS_PER_DECADE_RHO;

/** Height of the lowest point of the surface above the floor. */
export const BASE_Y = 3.6;

const T_MID = (T_MIN + T_MAX) / 2;
const LOGP_MID = (LOGP_MIN + LOGP_MAX) / 2;
const X_PER_K = WIDTH / (T_MAX - T_MIN);
const Z_PER_DECADE = DEPTH / (LOGP_MAX - LOGP_MIN);

export const tToX = (T) => (T - T_MID) * X_PER_K;
export const xToT = (x) => x / X_PER_K + T_MID;
export const logPToZ = (logP) => (LOGP_MID - logP) * Z_PER_DECADE;
export const zToLogP = (z) => LOGP_MID - z / Z_PER_DECADE;
export const logRhoToY = (logRho) => (logRho - LOGRHO_MIN) * UNITS_PER_DECADE_RHO;
export const yToLogRho = (y) => y / UNITS_PER_DECADE_RHO + LOGRHO_MIN;

/**
 * Pose B: the object turned onto its side (rotation of +90° about z), so that
 * temperature points up and density points to -x. Looking down, the shadow is
 * then the pressure–volume diagram with volume increasing to the right.
 */
export const POSE_B = {
  x: HEIGHT / 2,
  y: WIDTH / 2 + 2
};

/** World x of a specific volume (log10 m³/kg) under the object in pose B. */
export const logVToFloorX = (logV) => -logRhoToY(-logV) + POSE_B.x;

/** Diagram rectangles on the floor, in world units [x0, z0, x1, z1]. */
export const PT_PLOT = [-WIDTH / 2, -DEPTH / 2, WIDTH / 2, DEPTH / 2];
export const PV_PLOT = [logVToFloorX(-LOGRHO_MAX), -DEPTH / 2, logVToFloorX(-LOGRHO_MIN), DEPTH / 2];
