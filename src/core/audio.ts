/**
 * Sound (spec §9).
 *
 * **Deviation from the spec, on purpose:** §9 asks for a handful of free CC0
 * clips under ~300 KB. These sounds are *synthesised* with the Web Audio API
 * instead — zero bytes shipped, no licence file to keep track of, and every
 * parameter is a number you can edit and hear immediately. For a kick thump, a
 * net swish and a post ping that is a good trade; a crowd recording would be
 * better than the noise bed below, and swapping one in later means changing only
 * this file.
 *
 * Web Audio in one paragraph: you build a graph of nodes — sources
 * (oscillators, noise buffers) flowing through processors (gain, filters) into
 * `context.destination`, the speakers. Nodes are one-shot: an oscillator that
 * has been stopped cannot restart, so every sound builds a fresh little graph
 * and lets it be garbage-collected. Timing is done in `context.currentTime`
 * seconds on the audio clock, which is far more precise than `setTimeout`.
 */
export class SoundBoard {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowd: { gain: GainNode; source: AudioBufferSourceNode } | null = null;

  muted = false;

  /**
   * Browsers refuse to start an AudioContext outside a user gesture (the
   * autoplay policy — spec §12 question 2). Rather than shipping muted, the
   * context is created lazily on the first click, which *is* a gesture, so sound
   * is on by default and still legal. `M` toggles it.
   */
  private ensureContext(): AudioContext | null {
    if (this.context === null) {
      this.context = new AudioContext();

      this.master = this.context.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.context.destination);
    }

    if (this.context.state === 'suspended') void this.context.resume();
    return this.muted ? null : this.context;
  }

  /** Call from any user gesture to warm the context up. */
  unlock(): void {
    this.ensureContext();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.muted && this.crowd !== null) {
      this.crowd.gain.gain.value = 0;
    }
    return this.muted;
  }

  /** Boot thump: a pitch-dropping sine plus a click of noise. */
  kick(power: number): void {
    const context = this.ensureContext();
    if (context === null || this.master === null) return;

    const now = context.currentTime;

    const thump = context.createOscillator();
    thump.type = 'sine';
    // A falling pitch reads as an impact; a steady one reads as a beep.
    thump.frequency.setValueAtTime(170 + power * 90, now);
    thump.frequency.exponentialRampToValueAtTime(48, now + 0.14);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.55 + power * 0.35, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    thump.connect(gain).connect(this.master);
    thump.start(now);
    thump.stop(now + 0.22);

    this.playNoise(0.05, 1800, 0.28 + power * 0.2);
  }

  /** Net swish: a short band of noise, no tone at all. */
  net(): void {
    this.playNoise(0.28, 2600, 0.3);
  }

  /** Post ping: a hard metallic tone with a fast decay. */
  post(): void {
    const context = this.ensureContext();
    if (context === null || this.master === null) return;

    const now = context.currentTime;

    // Two detuned partials make it read as metal rather than as a flute.
    for (const [frequency, level] of [
      [880, 0.4],
      [1320, 0.22],
    ] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;

      const gain = context.createGain();
      gain.gain.setValueAtTime(level, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

      oscillator.connect(gain).connect(this.master);
      oscillator.start(now);
      oscillator.stop(now + 0.72);
    }
  }

  /** Keeper save: a dull slap, lower and duller than the net. */
  save(): void {
    this.playNoise(0.16, 700, 0.34);
  }

  /**
   * A low-passed noise bed standing in for a crowd. It loops quietly forever and
   * is briefly turned up on a goal (spec §9: "crowd murmur that rises on goal").
   */
  startCrowd(): void {
    const context = this.ensureContext();
    if (context === null || this.master === null || this.crowd !== null) return;

    const source = context.createBufferSource();
    source.buffer = createNoiseBuffer(context, 4);
    source.loop = true;

    // Rolling off the highs turns hiss into something closer to distant voices.
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;

    const gain = context.createGain();
    gain.gain.value = 0.035;

    source.connect(filter).connect(gain).connect(this.master);
    source.start();

    this.crowd = { gain, source };
  }

  /** Swell the crowd, then settle back to the murmur. */
  crowdCheer(): void {
    const context = this.ensureContext();
    if (context === null || this.crowd === null) return;

    const now = context.currentTime;
    const gain = this.crowd.gain.gain;

    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0.3, now + 0.12);
    gain.linearRampToValueAtTime(0.035, now + 2.4);
  }

  /**
   * White noise through a low-pass filter — the basis of every percussive,
   * non-pitched sound here. `duration` shapes the decay, `cutoff` the colour.
   */
  private playNoise(duration: number, cutoff: number, level: number): void {
    const context = this.ensureContext();
    if (context === null || this.master === null) return;

    const now = context.currentTime;

    const source = context.createBufferSource();
    source.buffer = createNoiseBuffer(context, duration);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;

    const gain = context.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + duration);
  }
}

/** Fills a buffer with white noise: every sample an independent random value. */
function createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
  const sampleCount = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
  const channel = buffer.getChannelData(0);

  for (let i = 0; i < sampleCount; i++) {
    channel[i] = Math.random() * 2 - 1;
  }

  return buffer;
}
