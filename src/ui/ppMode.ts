// Tryb pp (etap 5): Pythia 8 w puli Web Workerów, uproszczony detektor, widmo dimionowe.

import { Hist1D } from '../analysis/histogram';
import { particle } from '../physics/particles';
import { DIMUON_STREAMS, PP_PRESETS, presetByKey } from '../physics/ppPresets';
import type { FromPP, ToPP } from '../workers/ppProtocol';
import { esc, toast, type EventDisplay } from './display';
import { drawSpectrum, fmtNum } from './plot';
import { readUrl, writeUrl } from './url';

interface PWorker {
  w: Worker;
  preset: string;
  ready: boolean;
  onMsg: (m: FromPP) => void;
}

interface StreamStat {
  key: string;
  label: string;
  events: number;
  sigmaMb: number;
  hist: Hist1D;
  histTruth: Hist1D;
  workers: number;
  ready: number;
  rate: number;
}

const MARKERS = [113, 333, 443, 100443, 553, 23].map((id) => ({ id }));
const pythiaUrl = () => new URL('pythia/', document.baseURI).href;

function spawn(preset: string, runSeed: number, idx: number, onMsg: (m: FromPP) => void): PWorker {
  const w = new Worker(new URL('../workers/pp.worker.ts', import.meta.url), { type: 'module' });
  const pw: PWorker = { w, preset, ready: false, onMsg };
  w.onmessage = (e: MessageEvent<FromPP>) => {
    if (e.data.type === 'ready') pw.ready = true;
    pw.onMsg(e.data);
  };
  w.onerror = (e) => onMsg({ type: 'error', message: `worker: ${e.message || 'błąd ładowania (czy jest public/pythia/?)'}`, log: [] });
  const msg: ToPP = { type: 'init', pythiaUrl: pythiaUrl(), preset, runSeed, worker: idx };
  w.postMessage(msg);
  return pw;
}

export class PPMode {
  private display: PWorker | null = null;
  private preset = 'zmumu';
  private runSeed = 2012;
  private index = 0;
  private minPt = 0.3;
  private auto = 0;
  private autoTimer = 0;
  private busy = false;
  private pool: PWorker[] = [];
  private streams = new Map<string, StreamStat>();
  private running = false;
  private withBackground = false;
  private renderTimer = 0;
  private poolSize = Math.max(4, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));

  constructor(
    private view: EventDisplay,
    private left: HTMLElement,
    private right: HTMLElement,
  ) {
    const u = readUrl();
    if (u.pr && PP_PRESETS.some((p) => p.key === u.pr)) this.preset = u.pr;
    if (u.seed !== undefined) this.runSeed = u.seed;
    if (u.ev !== undefined) this.index = u.ev;
  }

  mount(): void {
    this.left.innerHTML = `
      <h2>Zderzenia pp · √s = 13.6 TeV</h2>
      <p class="note">Generator: <b>Pythia 8</b> skompilowana do WebAssembly, w Web Workerze (bez pthreads). Kaskady partonów i hadronizacja – model zgodny z danymi, nie z pierwszych zasad. Długo żyjące cząstki (K⁰S, Λ, π±…) rozpada nasz silnik w detektorze, z tych samych danych.</p>
      <div class="row"><select id="preset">${PP_PRESETS.map((p) => `<option value="${p.key}" ${p.key === this.preset ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
      <p class="note" id="presetNote"></p>
      <div class="row">
        <button class="primary" id="fire" disabled>Zderz</button>
        <label>auto <select id="auto"><option value="0">wył.</option><option value="0.5">0.5/s</option><option value="2">2/s</option></select></label>
      </div>
      <div class="row"><label>seed <input type="number" id="seed" min="0" value="${this.runSeed}"></label></div>
      <div class="row"><label>próg p<sub>T</sub> rysowania <input type="range" id="minPt" min="0" max="3" step="0.05" value="${this.minPt}"></label> <span class="mono" id="minPtVal"></span></div>
      <p class="note" id="ppStatus">Ładowanie Pythii…</p>
      <h2>Detektor</h2>
      <p class="note">Solenoid B = ${this.view.det.B_T} T (helisy), tracker r &lt; ${this.view.det.tracker.r_mm / 1000} m, kalorymetry (tu kończą się e±, γ i hadrony), komory mionowe do r = ${this.view.det.muon.outer.r_mm / 1000} m. Bez strat energii i rozpraszania wielokrotnego.</p>
      <div class="row"><button id="zoomTracker">tracker</button><button id="zoomAll">cały detektor</button></div>
      <h2>Kolory</h2>
      ${this.view.legendHtml()}`;
    this.right.innerHTML = `
      <h2>Widmo mas μ⁺μ⁻</h2>
      <p class="note">Pula ${this.poolSize} workerów Pythii generuje równolegle strumienie: miękkie QCD (ρ, ω, φ → μμ), charmonium, bottomonium i Drell–Yan. Rozpady V → μμ są wymuszone, a zdarzenie dostaje wagę Π BR (z data/). Histogramy strumieni łączone wagą σ/N z Pythii.</p>
      <div class="row"><button class="primary" id="streamBtn">Start puli</button><button id="streamReset">Wyczyść</button></div>
      <div class="row"><label class="toggle"><input type="checkbox" id="withBkg"> z tłem kombinatorycznym</label></div>
      <p class="note" id="bkgNote"></p>
      <canvas class="plot tall" id="spec"></canvas>
      <div class="plotkey">x: m(μ⁺μ⁻) [GeV, log] · y: dσ/dm [pb/GeV] w akceptancji (|η| &lt; ${this.view.det.muonAcceptance.etaMax}, p &gt; ${this.view.det.muonAcceptance.pMin} GeV, σ(p<sub>T</sub>)/p<sub>T</sub> = ${this.view.det.resolution.a * 100}% ⊕ ${this.view.det.resolution.b * 100}%·p<sub>T</sub>) · <b style="color:var(--theory)">masy z data/</b></div>
      <table class="procs" id="streamTable"></table>
      <p class="note">Bramka etapu 5: piki od ω do Z widoczne w widmie. Statystyka rośnie z czasem – zostaw pulę na minutę.</p>`;
    this.bind();
    this.startDisplayWorker();
    this.renderSpectrum();
  }

  unmount(): void {
    clearInterval(this.autoTimer);
    clearInterval(this.renderTimer);
    this.display?.w.terminate();
    this.pool.forEach((p) => p.w.terminate());
    this.pool = [];
    this.running = false;
  }

  private bind(): void {
    const $ = <T extends HTMLElement>(s: string) => this.left.querySelector(s) as T;
    const preset = $<HTMLSelectElement>('#preset');
    preset.addEventListener('change', () => {
      this.preset = preset.value;
      this.index = 0;
      this.startDisplayWorker();
    });
    $<HTMLInputElement>('#seed').addEventListener('change', (e) => {
      this.runSeed = Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value)));
      this.index = 0;
      this.startDisplayWorker();
    });
    $('#fire').addEventListener('click', () => this.request(this.index + (this.busy ? 0 : 1)));
    $<HTMLSelectElement>('#auto').addEventListener('change', (e) => {
      this.auto = Number((e.target as HTMLSelectElement).value);
      clearInterval(this.autoTimer);
      if (this.auto) this.autoTimer = window.setInterval(() => !this.busy && this.request(this.index + 1), 1000 / this.auto);
    });
    const mp = $<HTMLInputElement>('#minPt');
    const upd = () => ($('#minPtVal').textContent = `${Number(mp.value).toFixed(2)} GeV`);
    upd();
    mp.addEventListener('input', upd);
    mp.addEventListener('change', () => {
      this.minPt = Number(mp.value);
      this.request(this.index);
    });
    $('#zoomTracker').addEventListener('click', () => this.view.scene.zoomTo(1.3));
    $('#zoomAll').addEventListener('click', () => this.view.scene.zoomTo(6));
    document.getElementById('prev')!.onclick = () => this.request(Math.max(0, this.index - 1));
    document.getElementById('next')!.onclick = () => this.request(this.index + 1);
    document.getElementById('reroll')!.onclick = () => toast('Re-roll działa w trybie e⁺e⁻; w pp każde zdarzenie wyznacza seed.');
    document.getElementById('share')!.onclick = () => {
      this.updateUrl();
      void navigator.clipboard?.writeText(location.href).then(() => toast('Link do zdarzenia skopiowany.'));
    };
    this.right.querySelector('#streamBtn')!.addEventListener('click', () => this.toggleStreams());
    const bkg = this.right.querySelector('#withBkg') as HTMLInputElement;
    const bkgNote = () =>
      (this.right.querySelector('#bkgNote')!.innerHTML = this.withBackground
        ? '<span class="warn">Wszystkie pary μ⁺μ⁻ w akceptancji. Tło (np. z rozpadów półleptonowych c, b) ma wagę 1, a sygnał wymuszony – wagę ~10⁻⁴, więc przy minutach generacji tło jest zdominowane przez kilka zdarzeń o dużej wadze. Uczciwe, ale bardzo zaszumione.</span>'
        : 'Pary μ⁺μ⁻ z tego samego rozpadu rezonansu lub γ*/Z (prawda MC), bez tła kombinatorycznego. Drell–Yan dopiero od m &gt; 12 GeV.');
    bkgNote();
    bkg.addEventListener('change', () => {
      this.withBackground = bkg.checked;
      bkgNote();
      this.renderSpectrum();
    });
    this.right.querySelector('#streamReset')!.addEventListener('click', () => {
      this.streams.forEach((s) => {
        s.hist.reset();
        s.histTruth.reset();
        s.events = 0;
      });
      this.renderSpectrum();
    });
  }

  private status(html: string) {
    const el = this.left.querySelector('#ppStatus');
    if (el) el.innerHTML = html;
  }

  private startDisplayWorker(): void {
    this.display?.w.terminate();
    const p = presetByKey(this.preset);
    this.left.querySelector('#presetNote')!.textContent = p.note;
    (this.left.querySelector('#fire') as HTMLButtonElement).disabled = true;
    this.status(`Inicjalizacja Pythii: <code>${esc(p.label)}</code>… (minimum bias ~4 s)`);
    const t0 = performance.now();
    this.display = spawn(this.preset, this.runSeed, 0, (m) => {
      if (m.type === 'ready') {
        (this.left.querySelector('#fire') as HTMLButtonElement).disabled = false;
        this.status(`Pythia gotowa: moduł ${Math.round(m.moduleMs)} ms, init ${Math.round(m.initMs)} ms (ściana ${Math.round(performance.now() - t0)} ms), pamięć ${Math.round(m.heapBytes / 2 ** 20)} MiB.`);
        this.request(this.index);
      } else if (m.type === 'event') {
        this.busy = false;
        this.index = m.index;
        document.getElementById('evIndex')!.textContent = `#${m.index}`;
        this.updateUrl();
        this.view.show({ data: m.data, size: m.size, meta: m.meta }, m.decays, {
          title: `pp → ${presetByKey(this.preset).label}`,
          subtitle: `√s = 13.6 TeV · Pythia ${fmtNum(m.genMs, 3)} ms`,
          fidelity: 'Pythia 8 (hadronizacja: model zgodny z danymi) + rozpady w detektorze (TS)',
          autoplay: !this.auto,
          sweepSeconds: 5,
          minPt: this.minPt,
          maxEta: 3,
        });
      } else if (m.type === 'error') {
        this.busy = false;
        this.status(`<span class="err">${esc(m.message)}\n${esc(m.log.slice(-5).join('\n'))}</span>`);
      }
    });
  }

  private request(index: number): void {
    if (!this.display?.ready) return;
    this.busy = true;
    const msg: ToPP = { type: 'event', index };
    this.display.w.postMessage(msg);
  }

  private updateUrl(): void {
    writeUrl({ m: 'pp', pr: this.preset, seed: this.runSeed, ev: this.index });
  }

  // ------------------------------------------------------------ widmo dimionowe
  private toggleStreams(): void {
    const btn = this.right.querySelector('#streamBtn') as HTMLButtonElement;
    if (this.running) {
      this.running = false;
      this.pool.forEach((p) => p.w.postMessage({ type: 'stream', on: false } satisfies ToPP));
      btn.textContent = 'Wznów pulę';
      return;
    }
    this.running = true;
    btn.textContent = 'Zatrzymaj pulę';
    if (!this.pool.length) {
      // Każdy strumień co najmniej jeden worker; nadmiarowe dla najrzadszych (miękkie QCD, charmonium).
      const order = [...DIMUON_STREAMS.map((s) => s.key)];
      const extra = ['mu-soft', 'mu-charm', 'mu-soft', 'mu-bottom'];
      while (order.length < this.poolSize) order.push(extra[(order.length - DIMUON_STREAMS.length) % extra.length]);
      for (const s of DIMUON_STREAMS) {
        if (!this.streams.has(s.key)) this.streams.set(s.key, { key: s.key, label: s.label, events: 0, sigmaMb: 0, hist: new Hist1D(320, 0.2, 150, true), histTruth: new Hist1D(320, 0.2, 150, true), workers: 0, ready: 0, rate: 0 });
      }
      order.forEach((key, i) => {
        this.streams.get(key)!.workers++;
        const pw = spawn(key, this.runSeed, i + 1, (m) => this.onStream(pw, m));
        this.pool.push(pw);
      });
    } else {
      this.pool.forEach((p) => p.ready && p.w.postMessage({ type: 'stream', on: true } satisfies ToPP));
    }
    clearInterval(this.renderTimer);
    this.renderTimer = window.setInterval(() => this.renderSpectrum(), 700);
  }

  private onStream(pw: PWorker, m: FromPP): void {
    const s = this.streams.get(pw.preset)!;
    if (m.type === 'ready') {
      s.ready++;
      if (this.running) pw.w.postMessage({ type: 'stream', on: true } satisfies ToPP);
    } else if (m.type === 'batch') {
      s.events += m.events;
      // σ z Pythii: średnia po workerach strumienia (estymatory niezależne).
      s.sigmaMb = s.sigmaMb ? 0.9 * s.sigmaMb + 0.1 * m.sigmaGenMb : m.sigmaGenMb;
      s.rate = 0.7 * s.rate + 0.3 * ((m.events / m.ms) * 1000);
      for (let i = 0; i < m.masses.length; i++) {
        s.hist.fill(m.masses[i], m.weights[i]);
        if (m.truth[i]) s.histTruth.fill(m.masses[i], m.weights[i]);
      }
    } else if (m.type === 'error') {
      toast(`Pythia (${pw.preset}): ${m.message}`);
    }
  }

  private renderSpectrum(): void {
    const canvas = this.right.querySelector('#spec') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ref = new Hist1D(320, 0.2, 150, true);
    const y = new Array(ref.nBins).fill(0);
    const e2 = new Array(ref.nBins).fill(0);
    for (const s of this.streams.values()) {
      if (!s.events) continue;
      const norm = (s.sigmaMb * 1e9) / s.events; // pb na zdarzenie
      const h = this.withBackground ? s.hist : s.histTruth;
      for (let i = 0; i < ref.nBins; i++) {
        const w = ref.width(i);
        y[i] += (h.counts[i] * norm) / w;
        e2[i] += (h.sumw2[i] * norm * norm) / (w * w);
      }
    }
    if (import.meta.env.DEV) (globalThis as unknown as { __spectrum: unknown }).__spectrum = { edges: Array.from(ref.edges), y, e: e2.map(Math.sqrt) };
    drawSpectrum(
      canvas,
      Array.from(ref.edges),
      y,
      e2.map(Math.sqrt),
      MARKERS.map(({ id }) => ({ m: particle(id).m0, label: particle(id).name.replace('Upsilon', 'Υ').replace('J/psi', 'J/ψ').replace('psi(2S)', 'ψ(2S)').replace('rho0', 'ρ/ω').replace('phi', 'φ').replace('Z0', 'Z') })),
      'dσ/dm [pb/GeV]',
    );
    const tbl = this.right.querySelector('#streamTable');
    if (tbl)
      tbl.innerHTML =
        '<tr><td>strumień</td><td class="num">workery</td><td class="num">zdarzeń</td><td class="num">/s</td><td class="num">σ [mb]</td></tr>' +
        [...this.streams.values()]
          .map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${s.ready}/${s.workers}</td><td class="num">${s.events.toLocaleString('pl')}</td><td class="num">${Math.round(s.rate * s.ready)}</td><td class="num">${s.sigmaMb ? fmtNum(s.sigmaMb, 3) : '–'}</td></tr>`)
          .join('');
  }
}
