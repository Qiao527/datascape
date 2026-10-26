import { createDemoSynth } from './demoSynth.js';

/**
 * One analyser, three possible sources: the built-in synth, an uploaded file
 * or the microphone. Only one source is connected at a time.
 */
export class AudioEngine {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.context = null;
    this.analyser = null;
    this.frequencyData = null;
    this.mode = null; // 'demo' | 'file' | 'mic' | null
    this.label = '';
    this.paused = false;

    this.demo = null;
    this.mediaElement = null;
    this.mediaSource = null;
    this.objectUrl = null;
    this.micStream = null;
    this.micSource = null;
  }

  get active() {
    return this.mode !== null && !this.paused;
  }

  get sampleRate() {
    return this.context?.sampleRate ?? 48000;
  }

  async playDemo() {
    const context = await this.prepare();
    this.demo = createDemoSynth(context);
    this.demo.output.connect(this.analyser);
    this.demo.output.connect(context.destination);
    this.demo.start();
    this.setMode('demo', '内置演示 · 合成节拍 124 BPM');
  }

  async playFile(file) {
    const context = await this.prepare();
    if (!this.mediaElement) {
      this.mediaElement = new Audio();
      this.mediaElement.loop = true;
      this.mediaSource = context.createMediaElementSource(this.mediaElement);
    }
    this.mediaSource.connect(this.analyser);
    this.mediaSource.connect(context.destination);
    this.objectUrl = URL.createObjectURL(file);
    this.mediaElement.src = this.objectUrl;
    try {
      await this.mediaElement.play();
    } catch (error) {
      this.stop();
      throw new Error('这个文件无法播放，换一个音频格式试试');
    }
    this.setMode('file', file.name.replace(/\.[^.]+$/, ''));
  }

  async useMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风输入');
    }
    const context = await this.prepare();
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    } catch {
      throw new Error('没有获得麦克风权限');
    }
    // Microphone goes to the analyser only, never to the speakers (no feedback).
    this.micSource = context.createMediaStreamSource(this.micStream);
    this.micSource.connect(this.analyser);
    this.setMode('mic', '麦克风输入');
  }

  async togglePause() {
    if (!this.mode) return;
    this.paused = !this.paused;
    if (this.mode === 'file') {
      if (this.paused) this.mediaElement.pause();
      else await this.mediaElement.play();
    } else if (this.paused) {
      await this.context.suspend();
    } else {
      await this.context.resume();
    }
    this.onChange(this);
  }

  stop() {
    if (this.demo) {
      this.demo.stop();
      this.demo = null;
    }
    if (this.mediaElement) {
      this.mediaElement.pause();
      this.mediaSource.disconnect();
      this.mediaElement.removeAttribute('src');
      this.mediaElement.load();
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micSource.disconnect();
      this.micStream = null;
      this.micSource = null;
    }
    this.setMode(null, '');
  }

  /** Byte spectrum (0–255 per FFT bin), or null when nothing is playing. */
  getFrequencyData() {
    if (!this.active) return null;
    this.analyser.getByteFrequencyData(this.frequencyData);
    return this.frequencyData;
  }

  async prepare() {
    this.stop();
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.5;
      this.analyser.minDecibels = -92;
      this.analyser.maxDecibels = -18;
      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    }
    if (this.context.state !== 'running') await this.context.resume();
    return this.context;
  }

  setMode(mode, label) {
    this.mode = mode;
    this.label = label;
    this.paused = false;
    this.onChange(this);
  }
}
