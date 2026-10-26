// A small post-punk loop synthesised with Web Audio, so the scene has music to
// react to without shipping or uploading any audio file.
// 124 BPM, D minor: Dm – B♭ – F – C.

const BPM = 124;
const STEPS_PER_BAR = 16;
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;

const BARS = [
  { bass: 38, chord: [62, 65, 69] }, // Dm
  { bass: 34, chord: [58, 62, 65] }, // B♭
  { bass: 41, chord: [57, 60, 65] }, // F
  { bass: 36, chord: [55, 60, 64] }  // C
];
const BASS_PATTERN = [0, 0, 12, 0, 0, 12, 7, 0];
const ARP_PATTERN = [0, 1, 2, 1, 0, 2, 1, 2];

const midiToFrequency = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export function createDemoSynth(context) {
  const output = context.createGain();
  output.gain.value = 0.9;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.ratio.value = 4;
  compressor.connect(output);
  const bus = context.createGain();
  bus.gain.value = 0.7;
  bus.connect(compressor);

  const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const channel = noise.getChannelData(0);
  for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1;

  const stepDuration = 60 / BPM / 4;
  let step = 0;
  let nextTime = 0;
  let intervalId = null;

  function envelope(gainNode, time, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, time);
    gainNode.gain.exponentialRampToValueAtTime(peak, time + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  }

  function kick(time) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.setValueAtTime(160, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
    envelope(gain, time, 1, 0.003, 0.38);
    osc.connect(gain).connect(bus);
    osc.start(time);
    osc.stop(time + 0.45);
  }

  function noiseHit(time, { type, frequency, q = 1, peak, decay }) {
    const source = context.createBufferSource();
    source.buffer = noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    envelope(gain, time, peak, 0.002, decay);
    source.connect(filter).connect(gain).connect(bus);
    source.start(time, Math.random() * 0.5);
    source.stop(time + decay + 0.05);
  }

  function snare(time) {
    noiseHit(time, { type: 'bandpass', frequency: 1900, q: 0.7, peak: 0.55, decay: 0.2 });
    const body = context.createOscillator();
    const gain = context.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(210, time);
    body.frequency.exponentialRampToValueAtTime(140, time + 0.08);
    envelope(gain, time, 0.35, 0.002, 0.1);
    body.connect(gain).connect(bus);
    body.start(time);
    body.stop(time + 0.15);
  }

  function bass(time, midi) {
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFrequency(midi);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(1400, time);
    filter.frequency.exponentialRampToValueAtTime(260, time + 0.2);
    const gain = context.createGain();
    envelope(gain, time, 0.34, 0.005, 0.24);
    osc.connect(filter).connect(gain).connect(bus);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  function pad(time, notes, duration) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1700;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.06, time + 0.4);
    gain.gain.setValueAtTime(0.06, time + duration - 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    filter.connect(gain).connect(bus);
    for (const midi of notes) {
      for (const detune of [-8, 8]) {
        const osc = context.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = midiToFrequency(midi);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    }
  }

  function pluck(time, midi) {
    const osc = context.createOscillator();
    osc.type = 'square';
    osc.frequency.value = midiToFrequency(midi);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5200, time);
    filter.frequency.exponentialRampToValueAtTime(900, time + 0.12);
    const gain = context.createGain();
    envelope(gain, time, 0.07, 0.003, 0.14);
    osc.connect(filter).connect(gain).connect(bus);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  function schedule(stepIndex, time) {
    const position = stepIndex % STEPS_PER_BAR;
    const barIndex = Math.floor(stepIndex / STEPS_PER_BAR);
    const bar = BARS[barIndex % BARS.length];
    const phrase = Math.floor(barIndex / BARS.length);

    if (position % 4 === 0 || (position === 14 && barIndex % 2 === 1)) kick(time);
    if (position === 4 || position === 12) snare(time);
    if (position % 2 === 1) {
      noiseHit(time, { type: 'highpass', frequency: 8000, peak: 0.06, decay: 0.04 });
    }
    if (position === 2 || position === 10) {
      noiseHit(time, { type: 'highpass', frequency: 6500, peak: 0.12, decay: position === 10 ? 0.22 : 0.06 });
    }
    if (position % 2 === 0) bass(time, bar.bass + BASS_PATTERN[position / 2]);
    if (position === 0) pad(time, bar.chord, STEPS_PER_BAR * stepDuration);
    // The arpeggio joins from the second time round the progression.
    if (phrase % 2 === 1) {
      pluck(time, bar.chord[ARP_PATTERN[position % ARP_PATTERN.length]] + 12);
    }
  }

  function tick() {
    while (nextTime < context.currentTime + LOOKAHEAD_SECONDS) {
      schedule(step, nextTime);
      nextTime += stepDuration;
      step += 1;
    }
  }

  return {
    output,
    start() {
      step = 0;
      nextTime = context.currentTime + 0.05;
      tick();
      intervalId = setInterval(tick, SCHEDULER_INTERVAL_MS);
    },
    stop() {
      clearInterval(intervalId);
      intervalId = null;
      output.gain.setTargetAtTime(0, context.currentTime, 0.03);
      setTimeout(() => output.disconnect(), 300);
    }
  };
}
