// Number formatting for readouts and diagram labels.

export function formatPressure(pascal) {
  if (pascal >= 1e6) return `${trim(pascal / 1e6, 3)} MPa`;
  if (pascal >= 1e3) return `${trim(pascal / 1e3, 3)} kPa`;
  return `${trim(pascal, 3)} Pa`;
}

export function formatTemperature(kelvin) {
  const celsius = kelvin - 273.15;
  return {
    celsius: `${celsius.toFixed(Math.abs(celsius) < 100 ? 1 : 0)} °C`,
    kelvin: `${kelvin.toFixed(kelvin < 1000 ? 1 : 0)} K`
  };
}

export function formatDensity(rho) {
  if (rho >= 1) return `${trim(rho, 4)} kg/m³`;
  if (rho >= 1e-3) return `${trim(rho * 1e3, 3)} g/m³`;
  return `${trim(rho * 1e6, 3)} mg/m³`;
}

/** Significant-figure rounding without trailing zeros or exponent notation. */
export function trim(value, significant) {
  if (value === 0) return '0';
  const digits = Math.max(0, significant - 1 - Math.floor(Math.log10(Math.abs(value))));
  return Number(value.toFixed(Math.min(digits, 6))).toLocaleString('en-US', {
    maximumFractionDigits: Math.min(digits, 6)
  });
}

export function phaseName(phase) {
  return {
    ice: 'Ice',
    liquid: 'Liquid',
    vapor: 'Vapor',
    gas: 'Gas',
    supercritical: 'Supercritical fluid',
    boiling: 'Boiling',
    subliming: 'Subliming',
    melting: 'Melting'
  }[phase] ?? phase;
}

export const PRESSURE_TICKS = ['1 Pa', '10 Pa', '100 Pa', '1 kPa', '10 kPa', '100 kPa', '1 MPa', '10 MPa', '100 MPa'];
