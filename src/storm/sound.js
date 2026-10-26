// The storm, heard through the beam: filtered noise that swells as the
// antenna sweeps across strong echo, over a low rumble.

export function createSound() {
  let context = null;
  let nodes = null;
  let on = false;

  function build() {
    context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);

    const length = context.sampleRate * 5;
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const data = buffer.getChannelData(c);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.16;
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const rainFilter = context.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 1200;
    rainFilter.Q.value = 0.55;
    const rain = context.createGain();
    rain.gain.value = 0;

    const rumbleFilter = context.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 110;
    const rumble = context.createGain();
    rumble.gain.value = 0.55;

    source.connect(rainFilter).connect(rain).connect(master);
    source.connect(rumbleFilter).connect(rumble).connect(master);
    source.start();
    nodes = { master, rain, rainFilter, rumble };
  }

  return {
    get on() {
      return on;
    },
    async toggle() {
      if (!context) build();
      on = !on;
      if (on) await context.resume();
      nodes.master.gain.setTargetAtTime(on ? 0.7 : 0, context.currentTime, 0.35);
      return on;
    },
    /** intensity 0..1: how strong the echo under the beam is. */
    update(intensity) {
      if (!on) return;
      const t = context.currentTime;
      nodes.rain.gain.setTargetAtTime(0.04 + 0.85 * intensity, t, 0.07);
      nodes.rainFilter.frequency.setTargetAtTime(800 + 1900 * intensity, t, 0.15);
      nodes.rumble.gain.setTargetAtTime(0.35 + 0.4 * intensity, t, 0.6);
    }
  };
}
