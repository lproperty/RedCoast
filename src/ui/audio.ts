/**
 * Console sounds, synthesised with Web Audio (no audio files). Browsers only allow
 * sound after a tap, so `unlock()` is called from the sound toggle.
 */
export type SfxName = 'contact' | 'view' | 'special' | 'alarm' | 'lock';

export class Sfx {
  private ctx: AudioContext | undefined;
  private out: GainNode | undefined;
  private lastPlayed = new Map<SfxName, number>();
  enabled = false;
  volume = 0.6;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.out = this.ctx.createGain();
      this.out.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  play(name: SfxName): void {
    if (!this.enabled || !this.ctx || !this.out) return;
    // Don't machine-gun: each sound at most every 1.5 s.
    const now = performance.now();
    if (now - (this.lastPlayed.get(name) ?? 0) < 1500) return;
    this.lastPlayed.set(name, now);
    this.out.gain.value = this.volume * 0.5;
    const t = this.ctx.currentTime + 0.01;
    switch (name) {
      case 'contact': // sonar-style ping with a faint echo
        this.tone(1180, t, 0.9, { type: 'sine', slide: 1040, level: 0.5 });
        this.tone(1180, t + 0.22, 0.6, { type: 'sine', slide: 1040, level: 0.12 });
        break;
      case 'view':
        this.tone(880, t, 0.14, { type: 'triangle', level: 0.45 });
        this.tone(1320, t + 0.16, 0.22, { type: 'triangle', level: 0.45 });
        break;
      case 'special':
        this.tone(988, t, 0.2, { type: 'triangle', level: 0.4 });
        this.tone(1319, t + 0.18, 0.2, { type: 'triangle', level: 0.4 });
        this.tone(1760, t + 0.36, 0.45, { type: 'triangle', level: 0.4 });
        break;
      case 'alarm':
        for (let i = 0; i < 4; i++) this.tone(i % 2 ? 620 : 930, t + i * 0.22, 0.2, { type: 'square', level: 0.18 });
        break;
      case 'lock':
        this.tone(1600, t, 0.05, { type: 'square', level: 0.12 });
        this.tone(2100, t + 0.07, 0.06, { type: 'square', level: 0.12 });
        break;
    }
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    o: { type: OscillatorType; slide?: number; level: number },
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = o.type;
    osc.frequency.setValueAtTime(freq, start);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, start + dur);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(o.level, start + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(env).connect(this.out!);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
}
