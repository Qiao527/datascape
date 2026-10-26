// Beam geometry of a weather radar with the standard 4/3-Earth model: a beam
// leaving the antenna at elevation angle el bends less than the Earth curves,
// so it climbs away from the ground with range.

export const EARTH_R = (6371 * 4) / 3; // km
const RAD = Math.PI / 180;

/** Height of the beam centre above the antenna at slant range r (km). */
export function beamHeight(r, elDeg) {
  const el = elDeg * RAD;
  const q = r * r + 2 * r * EARTH_R * Math.sin(el);
  return q / (Math.sqrt(q + EARTH_R * EARTH_R) + EARTH_R);
}

/** Distance along the ground under the beam at slant range r (km). */
export function groundRange(r, elDeg) {
  const h = beamHeight(r, elDeg);
  return EARTH_R * Math.asin((r * Math.cos(elDeg * RAD)) / (EARTH_R + h));
}

/** Slant range at which the beam is over ground range s. */
export function slantForGround(s, elDeg) {
  let r = s / Math.cos(elDeg * RAD);
  for (let i = 0; i < 4; i += 1) r *= s / Math.max(groundRange(r, elDeg), 1e-9);
  return r;
}

/** The same two functions for shaders. el is in radians. */
export const BEAM_GLSL = /* glsl */ `
  const float EARTH_R = ${EARTH_R.toFixed(4)};
  float beamHeight(float r, float el) {
    float q = r * r + 2.0 * r * EARTH_R * sin(el);
    return q / (sqrt(q + EARTH_R * EARTH_R) + EARTH_R);
  }
  float groundRange(float r, float el, float h) {
    return EARTH_R * asin(clamp(r * cos(el) / (EARTH_R + h), -1.0, 1.0));
  }
`;
