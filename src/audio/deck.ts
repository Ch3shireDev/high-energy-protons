// Audio: plik użytkownika (nigdy dołączony do repo), analiza beatu, sonifikacja rozpadów.
// Wyłącznie warstwa prezentacji – steruje parametrami renderu, nie danymi.

export class AudioDeck {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private bins = new Uint8Array(0);
  private avg = 0;
  private lastBeat = 0;
  private pulse = 0;
  fileName = '';
  sonify = false;

  private ensure(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  async load(file: File): Promise<void> {
    const ctx = this.ensure();
    await ctx.resume();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    an.smoothingTimeConstant = 0.6;
    src.connect(an);
    an.connect(ctx.destination);
    src.start();
    this.source = src;
    this.analyser = an;
    this.bins = new Uint8Array(an.frequencyBinCount);
    this.fileName = file.name;
  }

  stop(): void {
    this.source?.stop();
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    this.fileName = '';
    this.pulse = 0;
  }

  get playing(): boolean {
    return this.source !== null;
  }

  /** Impuls beatu 0..1 (detekcja energii w paśmie basu względem średniej kroczącej). */
  beat(dt: number): number {
    this.pulse *= Math.exp(-dt * 6);
    const an = this.analyser;
    if (!an || !this.ctx) return this.pulse;
    an.getByteFrequencyData(this.bins);
    const hzPerBin = this.ctx.sampleRate / an.fftSize;
    const top = Math.max(2, Math.round(150 / hzPerBin));
    let e = 0;
    for (let i = 1; i < top; i++) e += this.bins[i] * this.bins[i];
    e /= top;
    this.avg = this.avg * 0.95 + e * 0.05;
    const now = this.ctx.currentTime;
    if (e > this.avg * 1.35 && e > 2000 && now - this.lastBeat > 0.22) {
      this.lastBeat = now;
      this.pulse = 1;
    }
    return this.pulse;
  }

  /** Krótki ton przy rozpadzie: wysokość ~ log masy rodzica, panorama ~ x wierzchołka. */
  blip(mass_GeV: number, pan: number): void {
    if (!this.sonify) return;
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const x = Math.min(1, Math.max(0, Math.log10(Math.max(mass_GeV, 0.1) / 0.1) / 3));
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1760 * Math.pow(0.0625, x); // lekkie = wysoko, ciężkie = nisko
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(g).connect(p).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.4);
  }
}
