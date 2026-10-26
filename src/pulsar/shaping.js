// Turns either a synthetic pulsar pulse or an audio spectrum into one ridge row.

const SPECTRUM_START = 0.17; // fraction of the width where the spectrum begins
const SPECTRUM_SPAN = 0.66;
const MIN_FREQUENCY = 35;
const MAX_FREQUENCY = 14000;

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRowShaper(bins) {
  const random = createRandom(0x19191919);
  const pulse = new Float32Array(bins);
  const spectrum = new Float32Array(bins);
  const row = new Float32Array(bins);
  let drift = 0;

  /**
   * One synthetic pulse: a flat noisy baseline with a cluster of narrow
   * sub-pulses near the centre whose positions slowly drift from row to row,
   * like the drifting sub-pulses CP 1919 is known for.
   */
  function pulsarRow() {
    drift = (drift + 0.0035) % 0.08;
    const center = 0.5 + (random() - 0.5) * 0.02;
    const count = 2 + Math.floor(random() * 3);
    const strength = 0.25 + Math.pow(random(), 1.4) * 0.75;

    for (let i = 0; i < bins; i += 1) {
      const x = i / (bins - 1);
      const window = Math.exp(-(((x - center) / 0.075) ** 2));
      pulse[i] = (random() - 0.5) * 0.012 + window * (random() * 0.07 + (random() - 0.5) * 0.04);
    }
    for (let k = 0; k < count; k += 1) {
      const position = center - 0.07 + drift + k * 0.035 + (random() - 0.5) * 0.02;
      const width = 0.006 + random() * 0.016;
      const amplitude = strength * (0.2 + Math.pow(random(), 1.3) * 0.85);
      for (let i = 0; i < bins; i += 1) {
        const x = i / (bins - 1);
        pulse[i] += amplitude * Math.exp(-(((x - position) / width) ** 2));
      }
    }
    return pulse;
  }

  /** Log-frequency spectrum across the middle of the line, flat at the edges. */
  function spectrumRow(frequencyData, sampleRate, gain) {
    const nyquist = sampleRate / 2;
    const fftBins = frequencyData.length;
    const step = 1 / (bins - 1) / SPECTRUM_SPAN;
    const ratio = MAX_FREQUENCY / MIN_FREQUENCY;

    for (let i = 0; i < bins; i += 1) {
      const u = (i / (bins - 1) - SPECTRUM_START) / SPECTRUM_SPAN;
      if (u <= 0 || u >= 1) {
        spectrum[i] = 0;
        continue;
      }
      const lowFrequency = MIN_FREQUENCY * Math.pow(ratio, Math.max(0, u - step / 2));
      const highFrequency = MIN_FREQUENCY * Math.pow(ratio, Math.min(1, u + step / 2));
      const from = (lowFrequency / nyquist) * fftBins;
      const to = (highFrequency / nyquist) * fftBins;

      let value;
      if (to - from < 1) {
        // Narrow band (bass end): interpolate between neighbouring FFT bins.
        const position = (from + to) / 2;
        const index = Math.min(fftBins - 2, Math.floor(position));
        const t = position - index;
        value = frequencyData[index] * (1 - t) + frequencyData[index + 1] * t;
      } else {
        // Wide band (treble end): keep the loudest bin so peaks stay sharp.
        value = 0;
        for (let b = Math.floor(from); b <= Math.min(fftBins - 1, Math.ceil(to)); b += 1) {
          value = Math.max(value, frequencyData[b]);
        }
      }

      const envelope = Math.pow(Math.sin(Math.PI * u), 0.55);
      const tilt = 0.75 + 0.85 * u; // treble is quieter; lift it a little
      spectrum[i] = Math.pow(value / 255, 2.4) * tilt * envelope * 1.25 * gain;
    }
    return spectrum;
  }

  /**
   * @param frequencyData Uint8Array from the analyser, or null when silent.
   * @param audioMix 0 = pure pulsar, 1 = pure music (with a trace of pulsar texture).
   */
  function next({ frequencyData, sampleRate, gain, audioMix }) {
    const base = pulsarRow();
    const music = frequencyData ? spectrumRow(frequencyData, sampleRate, gain) : null;
    const pulsarWeight = 1 - audioMix * 0.85;
    for (let i = 0; i < bins; i += 1) {
      const noise = (random() - 0.5) * 0.01;
      row[i] = base[i] * pulsarWeight + (music ? music[i] * audioMix : 0) + noise;
    }
    return row;
  }

  return { next };
}
