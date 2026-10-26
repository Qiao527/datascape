/**
 * A quiet room tone: a low sine chord and soft air. While water boils or
 * sublimes, filtered noise rises like a kettle.
 */
export function createSound() {
  let context = null;
  let master = null;
  let hiss = null;
  let hissFilter = null;
  let enabled = false;

  function build() {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const reverbLike = context.createBiquadFilter();
    reverbLike.type = 'lowpass';
    reverbLike.frequency.value = 900;
    reverbLike.connect(master);

    for (const [frequency, level] of [[55, 0.05], [82.41, 0.035], [123.47, 0.018], [164.81, 0.01]]) {
      const osc = context.createOscillator();
      osc.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = level;
      const lfo = context.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.07;
      const depth = context.createGain();
      depth.gain.value = level * 0.6;
      lfo.connect(depth).connect(gain.gain);
      osc.connect(gain).connect(reverbLike);
      osc.start();
      lfo.start();
    }

    const noise = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const channel = noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < channel.length; i += 1) {
      brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      channel[i] = brown * 3.2;
    }
    const air = context.createBufferSource();
    air.buffer = noise;
    air.loop = true;
    const airGain = context.createGain();
    airGain.gain.value = 0.05;
    air.connect(airGain).connect(reverbLike);
    air.start();

    const white = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = white.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const hissSource = context.createBufferSource();
    hissSource.buffer = white;
    hissSource.loop = true;
    hissFilter = context.createBiquadFilter();
    hissFilter.type = 'bandpass';
    hissFilter.frequency.value = 2400;
    hissFilter.Q.value = 0.8;
    hiss = context.createGain();
    hiss.gain.value = 0;
    hissSource.connect(hissFilter).connect(hiss).connect(master);
    hissSource.start();
  }

  return {
    get enabled() {
      return enabled;
    },
    async toggle() {
      if (!context) build();
      enabled = !enabled;
      if (enabled) await context.resume();
      master.gain.setTargetAtTime(enabled ? 0.9 : 0, context.currentTime, 0.4);
      return enabled;
    },
    /** boiling: 0..1 progress through a phase change, or null when not boiling. */
    setBoiling(boiling) {
      if (!context || !enabled) return;
      const level = boiling == null ? 0 : 0.035 * Math.sin(Math.PI * Math.min(1, boiling)) + 0.01;
      hiss.gain.setTargetAtTime(level, context.currentTime, 0.25);
      if (boiling != null) hissFilter.frequency.setTargetAtTime(1800 + boiling * 2600, context.currentTime, 0.3);
    }
  };
}
