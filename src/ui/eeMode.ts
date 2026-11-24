// Tryb e⁺e⁻ (etap 2): suwak √s, procesy z przekrojami, zdarzenia, histogramy z teorią, gra w skan.

import type { DalitzSnapshot, HistSnapshot } from '../analysis/eeAnalysis';
import type { ScanPoint } from '../analysis/scan';
import { RESONANCES } from '../physics/ee';
import { particle } from '../physics/particles';
import type { EESettings } from '../sim/eeRun';
import type { EventMsg, FromEE, ProcessRow, ToEE } from '../workers/eeProtocol';
import { esc, toast, type EventDisplay } from './display';
import { drawDalitz, drawHist, drawScan, fmtNum } from './plot';
import { readUrl, writeUrl } from './url';

const SQRT_MIN = 0.5;
const SQRT_MAX = 250;
const toSlider = (x: number) => Math.round((Math.log(x / SQRT_MIN) / Math.log(SQRT_MAX / SQRT_MIN)) * 1000);
const fromSlider = (v: number) => SQRT_MIN * Math.pow(SQRT_MAX / SQRT_MIN, v / 1000);
const SPREADS = [0, 1e-4, 5e-4, 1e-3, 3e-3];
const SCAN_BUDGET = 2000; // nb⁻¹
const LUMIS = [0.5, 2, 10, 50];

export class EEMode {
  private worker: Worker;
  private settings: EESettings;
  private index = 0;
  private reroll = 0;
  private rows: ProcessRow[] = [];
  private enabled = new Set<string>();
  private auto = 0;
  private autoTimer = 0;
  private hists: HistSnapshot[] = [];
  private dalitz: DalitzSnapshot | null = null;
  private tab = 'cosMu';
  private scan: ScanPoint[] = [];
  private scanTheory: { xs: number[]; ys: number[]; spreadRel: number } | null = null;
  private showTheory = false;
  private lumi = 2;
  private pending = false;
  private sigmaTimer = 0;

  constructor(
    private display: EventDisplay,
    private left: HTMLElement,
    private right: HTMLElement,
  ) {
    const u = readUrl();
    this.settings = {
      sqrtS: u.rs ?? particle(443).m0,
      spreadRel: u.sp ?? 5e-4,
      processes: [],
      runSeed: u.seed ?? 1974,
    };
    this.index = u.ev ?? 0;
    this.worker = new Worker(new URL('../workers/ee.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromEE>) => this.onMessage(e.data);
  }

  private send(m: ToEE) {
    this.worker.postMessage(m);
  }

  mount(): void {
    this.left.innerHTML = this.leftHtml();
    this.right.innerHTML = this.rightHtml();
    this.bind();
    this.applySettings(false);
    const u = readUrl();
    if (u.ev !== undefined) this.send({ type: 'goto', index: u.ev, reroll: u.rr ?? 0 });
    else this.fire(1);
  }

  unmount(): void {
    this.setAuto(0);
  }

  // ------------------------------------------------------------ HTML
  private leftHtml(): string {
    const marks = [113, 333, 443, 100443, 553, 100553, 23]
      .map((id) => `<button data-goto="${particle(id).m0}" title="${particle(id).name}: ${particle(id).m0} GeV">${esc(particle(id).name)}</button>`)
      .join('');
    return `
      <h2>Energia zderzenia √s</h2>
      <div class="big" id="sqrtSBig"></div>
      <input type="range" class="slider" id="sqrtS" min="0" max="1000" step="1">
      <div class="row"><input type="number" id="sqrtSNum" step="0.0001" min="${SQRT_MIN}" max="${SQRT_MAX}"> GeV
        <label>rozrzut σ/√s <select id="spread">${SPREADS.map((s) => `<option value="${s}">${s ? fmtNum(s, 1) : 'brak'}</option>`).join('')}</select></label></div>
      <div class="row">${marks}<button data-goto="200">200 GeV</button></div>
      <p class="note" id="spreadNote"></p>

      <h2>Procesy przy tym √s</h2>
      <table class="procs" id="procs"></table>
      <p class="note">σ na poziomie LO, bez ISR i bez interferencji rezonans–kontinuum. Proces w zdarzeniu losowany proporcjonalnie do σ (spośród zaznaczonych).</p>

      <h2>Generacja</h2>
      <div class="row">
        <button class="primary" id="fire">Zderz</button>
        <label>auto <select id="auto"><option value="0">wył.</option><option value="0.5">0.5/s</option><option value="2">2/s</option><option value="10">10/s</option></select></label>
        <button id="burst" title="Wygeneruj 10 000 zdarzeń do histogramów (w workerze)">+10⁴ do histogramów</button>
      </div>
      <div class="row"><label>seed przebiegu <input type="number" id="seed" min="0" step="1"></label> <span class="mono" id="genCount"></span></div>

      <h2>Wierność</h2>
      <p class="note">Kinematyka, boosty, helisy: <b>dokładne</b>. Procesy twarde e⁺e⁻: <b>LO</b>. Rozpady: BR i cτ z Pythii (data/), kinematyka z przestrzeni fazowej, rozkłady kątowe V → 2 ciała. Jety q q̄: <span class="badge toy">MODEL ZABAWKOWY</span>. Detektor: uproszczony, B = ${this.display.det.B_T} T, bez strat energii.</p>

      <h2>Kolory</h2>
      ${this.display.legendHtml()}`;
  }

  private rightHtml(): string {
    const tabs: [string, string][] = [
      ['cosMu', 'cos θ μμ'],
      ['cosPP', 'V→PP'],
      ['cosLL', 'V→ℓℓ'],
      ['kLen', 'K⁰S cτ'],
      ['dalitz', 'Dalitz'],
      ['scan', 'Skan σ(√s)'],
    ];
    return `
      <div class="tabs" id="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="tabBody"></div>`;
  }

  // ------------------------------------------------------------ zdarzenia UI
  private bind(): void {
    const s = this.left.querySelector('#sqrtS') as HTMLInputElement;
    const n = this.left.querySelector('#sqrtSNum') as HTMLInputElement;
    s.addEventListener('input', () => this.setSqrtS(fromSlider(Number(s.value)), true));
    s.addEventListener('change', () => this.applySettings(true));
    n.addEventListener('change', () => {
      this.setSqrtS(Math.min(SQRT_MAX, Math.max(SQRT_MIN, Number(n.value))), false);
      this.applySettings(true);
    });
    this.left.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((b) =>
      b.addEventListener('click', () => {
        this.setSqrtS(Number(b.dataset.goto), false);
        this.applySettings(true);
      }),
    );
    const sp = this.left.querySelector('#spread') as HTMLSelectElement;
    sp.value = String(this.settings.spreadRel);
    sp.addEventListener('change', () => {
      this.settings.spreadRel = Number(sp.value);
      this.scanTheory = null;
      this.applySettings(true);
    });
    const seed = this.left.querySelector('#seed') as HTMLInputElement;
    seed.value = String(this.settings.runSeed);
    seed.addEventListener('change', () => {
      this.settings.runSeed = Math.max(0, Math.floor(Number(seed.value)));
      this.applySettings(true);
    });
    this.left.querySelector('#fire')!.addEventListener('click', () => this.fire(1));
    this.left.querySelector('#burst')!.addEventListener('click', () => this.fire(10_000));
    (this.left.querySelector('#auto') as HTMLSelectElement).addEventListener('change', (e) => this.setAuto(Number((e.target as HTMLSelectElement).value)));
    this.right.querySelector('#tabs')!.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).dataset.tab;
      if (k) {
        this.tab = k;
        this.renderTab();
      }
    });
    document.getElementById('prev')!.onclick = () => this.goto(Math.max(0, this.index - 1), 0);
    document.getElementById('next')!.onclick = () => this.goto(this.index + 1, 0);
    document.getElementById('reroll')!.onclick = () => this.goto(this.index, this.reroll + 1);
    document.getElementById('share')!.onclick = () => this.share();
    this.setSqrtS(this.settings.sqrtS, false);
    this.renderTab();
  }

  private setSqrtS(x: number, fromSliderInput: boolean): void {
    this.settings.sqrtS = x;
    const s = this.left.querySelector('#sqrtS') as HTMLInputElement;
    const n = this.left.querySelector('#sqrtSNum') as HTMLInputElement;
    if (!fromSliderInput) s.value = String(toSlider(x));
    n.value = x.toFixed(x < 10 ? 4 : 2);
    this.left.querySelector('#sqrtSBig')!.innerHTML = `${x < 10 ? x.toFixed(4) : x.toFixed(2)} <small>GeV</small>`;
    const sd = this.settings.spreadRel * x;
    const narrow = RESONANCES.map((id) => particle(id)).find((p) => Math.abs(p.m0 - x) < 0.05 * p.m0 && p.width < sd);
    this.left.querySelector('#spreadNote')!.innerHTML = sd
      ? `Rozrzut wiązki: σ(√s) = ${fmtNum(sd * 1000, 3)} MeV.${narrow ? ` ${esc(narrow.name)} ma Γ = ${fmtNum(narrow.width * 1e6, 3)} keV ≪ rozrzut – mierzony pik jest niższy i szerszy niż Breit–Wigner.` : ''}`
      : 'Wiązka monoenergetyczna (idealizacja).';
    // Tabela σ odświeżana z workera (z ograniczeniem częstości).
    clearTimeout(this.sigmaTimer);
    this.sigmaTimer = window.setTimeout(() => this.send({ type: 'sigma', sqrtS: x }), fromSliderInput ? 40 : 0);
  }

  private applySettings(fireAfter: boolean): void {
    this.settings.processes = [...this.enabled];
    this.send({ type: 'settings', settings: { ...this.settings } });
    this.index = 0;
    if (fireAfter) this.fire(1);
    this.updateUrl();
  }

  private fire(burst: number): void {
    if (this.pending && burst === 1 && this.auto) return;
    this.pending = true;
    if (burst > 1) {
      (this.left.querySelector('#burst') as HTMLButtonElement).disabled = true;
      toast(`Generuję ${burst.toLocaleString('pl')} zdarzeń w workerze…`);
    }
    this.send({ type: 'next', burst });
  }

  private goto(index: number, reroll: number): void {
    this.index = index;
    this.reroll = reroll;
    this.send({ type: 'goto', index, reroll });
  }

  private setAuto(rate: number): void {
    this.auto = rate;
    clearInterval(this.autoTimer);
    if (rate > 0) this.autoTimer = window.setInterval(() => this.fire(1), 1000 / rate);
  }

  private share(): void {
    this.updateUrl();
    void navigator.clipboard?.writeText(location.href).then(
      () => toast('Link do zdarzenia skopiowany (ustawienia + seed + numer).'),
      () => toast(location.href),
    );
  }

  private updateUrl(): void {
    writeUrl({ m: 'ee', rs: this.settings.sqrtS, sp: this.settings.spreadRel, seed: this.settings.runSeed, ev: this.index, rr: this.reroll || undefined });
  }

  // ------------------------------------------------------------ wiadomości z workera
  private onMessage(m: FromEE): void {
    switch (m.type) {
      case 'event':
        this.pending = false;
        this.showEvent(m);
        break;
      case 'stats':
        this.hists = m.hists;
        this.dalitz = m.dalitz;
        (this.left.querySelector('#burst') as HTMLButtonElement).disabled = false;
        this.left.querySelector('#genCount')!.textContent = `wygenerowano: ${m.generated.toLocaleString('pl')}`;
        if (this.tab !== 'scan') this.renderTab();
        break;
      case 'sigma':
        this.rows = m.rows;
        if (!this.enabled.size) m.rows.forEach((r) => this.enabled.add(r.key));
        this.renderProcs();
        break;
      case 'scanPoint':
        this.scan.push(m.point);
        this.renderTab();
        break;
      case 'scanTheory':
        this.scanTheory = m;
        this.renderTab();
        break;
      case 'error':
        this.pending = false;
        toast(m.message);
        break;
    }
  }

  private showEvent(m: EventMsg): void {
    this.index = m.index;
    this.reroll = m.reroll;
    document.getElementById('evIndex')!.textContent = `#${m.index}${m.reroll ? ` ⟲${m.reroll}` : ''}`;
    this.updateUrl();
    const ev = { data: m.data, size: m.size, meta: m.meta };
    const sweep = this.auto ? Math.min(5, 0.85 / this.auto) : 5;
    this.display.show(ev, m.decays, {
      title: `e⁺e⁻ → ${m.processLabel}`,
      subtitle: `√s = ${m.meta.sqrtS.toFixed(m.meta.sqrtS < 10 ? 4 : 3)} GeV`,
      fidelity: m.meta.toy ? 'LO + model zabawkowy jetów' : 'LO + rozpady z danych Pythii',
      autoplay: !this.auto || this.auto <= 2,
      sweepSeconds: sweep,
    });
  }

  private renderProcs(): void {
    const total = this.rows.reduce((s, r) => s + (this.enabled.has(r.key) ? r.sigma_nb : 0), 0);
    const visible = this.rows.filter((r) => r.sigma_nb > total * 1e-6 || r.kind !== 'resonance');
    const el = this.left.querySelector('#procs')!;
    el.innerHTML =
      '<tr><td></td><td>proces</td><td class="num">σ [nb]</td><td style="width:70px"></td></tr>' +
      visible
        .map((r) => {
          const on = this.enabled.has(r.key);
          const frac = total > 0 && on ? r.sigma_nb / total : 0;
          return `<tr class="${r.sigma_nb > 0 ? '' : 'off'}"><td><input type="checkbox" data-proc="${r.key}" ${on ? 'checked' : ''}></td>
            <td>${esc(r.kind === 'resonance' ? `${r.label} (rezonans)` : r.label)} ${r.toy ? '<span class="badge toy">toy</span>' : ''}</td>
            <td class="num">${r.sigma_nb > 0 ? fmtNum(r.sigma_nb, 3) : '–'}</td>
            <td><div class="bar" style="width:${Math.round(frac * 100)}%"></div></td></tr>`;
        })
        .join('') +
      `<tr><td></td><td><b>razem (zaznaczone)</b></td><td class="num"><b>${fmtNum(total, 3)}</b></td><td></td></tr>`;
    el.querySelectorAll<HTMLInputElement>('[data-proc]').forEach((c) =>
      c.addEventListener('change', () => {
        if (c.checked) this.enabled.add(c.dataset.proc!);
        else this.enabled.delete(c.dataset.proc!);
        this.renderProcs();
        this.applySettings(true);
      }),
    );
  }

  // ------------------------------------------------------------ zakładki analizy
  private renderTab(): void {
    this.right.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === this.tab));
    const body = this.right.querySelector('#tabBody') as HTMLElement;
    if (this.tab === 'scan') return this.renderScan(body);
    if (this.tab === 'dalitz') {
      const d = this.dalitz;
      body.innerHTML = `<h2>Wykres Dalitza ${d?.parent ? `(${esc(d.parent)} → π⁺π⁻π⁰)` : ''}</h2>
        <canvas class="plot tall" id="plot"></canvas>
        <p class="note">${d?.entries ?? 0} rozpadów. Model: jednorodna przestrzeń fazowa – bez elementu macierzowego (prawdziwy ω → 3π ma P-falę i zero w środku brzegu). Ustaw √s na ω lub φ.</p>`;
      if (d) drawDalitz(body.querySelector('#plot')!, d);
      return;
    }
    const h = this.hists.find((x) => x.key === this.tab);
    if (!h) {
      body.innerHTML = '<p class="note">Brak danych.</p>';
      return;
    }
    const chi = h.chi2
      ? `χ²/ndf = ${h.chi2.chi2.toFixed(1)}/${h.chi2.ndf}, p = ${fmtNum(h.chi2.p, 2)} <span class="badge ${h.chi2.p > 0.01 ? 'ok' : 'bad'}">${h.chi2.p > 0.01 ? 'zgodne z teorią' : 'niezgodne'}</span>`
      : h.entries > 0
        ? 'χ²: za mało zdarzeń (≥ 50)'
        : '';
    const hint: Record<string, string> = {
      cosMu: 'Ustaw √s poza rezonansami (np. 10 GeV → symetryczne 1+cos²θ, przy Z → asymetria A_FB) i dodaj 10⁴ zdarzeń.',
      cosPP: 'Ustaw √s na φ (1.019 GeV) – φ → K⁺K⁻ daje sin²θ.',
      cosLL: 'Ustaw √s na J/ψ lub Υ – V → ℓ⁺ℓ⁻ daje 1 + cos²θ.',
      kLen: 'K⁰S pojawiają się w jetach (toy) i rozpadach rezonansów, np. φ → K⁰S K⁰L.',
    };
    body.innerHTML = `<h2>${esc(h.title)}</h2>
      <canvas class="plot" id="plot"></canvas>
      <div class="plotkey">oś x: ${esc(h.xLabel)} · <b style="color:var(--data)">dane ± √N</b> · <b style="color:var(--theory)">teoria</b></div>
      <div class="chi2">${h.entries.toLocaleString('pl')} wpisów. ${chi}</div>
      <p class="note">${esc(h.note)}</p>
      <p class="note">${hint[h.key] ?? ''}</p>`;
    drawHist(body.querySelector('#plot')!, h);
  }

  private renderScan(body: HTMLElement): void {
    const used = this.scan.reduce((s, p) => s + p.lumi, 0);
    const left = SCAN_BUDGET - used;
    const range = { lo: 2, hi: 120 };
    body.innerHTML = `<h2>Gra w skan: szukaj rezonansów</h2>
      <p class="note">Masz ${SCAN_BUDGET} nb⁻¹ czasu wiązki. W każdym punkcie √s zbierasz L·⟨σ⟩ zdarzeń (Poisson), gdzie ⟨σ⟩ to przekrój spleciony z rozrzutem wiązki. Wąskie rezonanse (J/ψ: Γ = 93 keV) łatwo przeskoczyć – tak jak w 1974 r.</p>
      <div class="progress"><div style="width:${(used / SCAN_BUDGET) * 100}%"></div></div>
      <div class="row mono">zużyte ${fmtNum(used, 3)} / ${SCAN_BUDGET} nb⁻¹ · punktów: ${this.scan.length}</div>
      <div class="row">
        <label>L na punkt <select id="lumi">${LUMIS.map((l) => `<option value="${l}" ${l === this.lumi ? 'selected' : ''}>${l} nb⁻¹</option>`).join('')}</select></label>
        <button class="primary" id="measure" ${left < this.lumi ? 'disabled' : ''}>Zmierz przy √s = ${fmtNum(this.settings.sqrtS, 5)} GeV</button>
      </div>
      <canvas class="plot tall" id="plot"></canvas>
      <div class="plotkey">x: √s [GeV, log] · y: N/L [nb, log] · <b style="color:var(--data)">pomiary ± √N/L</b>${this.showTheory ? ' · <b style="color:var(--theory)">teoria ⟨σ⟩</b>' : ''}</div>
      <div class="row">
        <label class="toggle"><input type="checkbox" id="showTheory" ${this.showTheory ? 'checked' : ''}> pokaż teorię (spoiler)</label>
        <button id="scanReset">Od nowa</button>
      </div>
      <p class="note">Wskazówka: kliknij wykres, żeby ustawić √s. Rozrzut wiązki zmienisz po lewej.</p>`;
    const canvas = body.querySelector('#plot') as HTMLCanvasElement;
    if (this.showTheory && (!this.scanTheory || this.scanTheory.spreadRel !== this.settings.spreadRel)) {
      this.send({ type: 'scanTheory', lo: range.lo, hi: range.hi, n: 6000, spreadRel: this.settings.spreadRel });
    }
    drawScan(canvas, this.scan, this.showTheory ? this.scanTheory : null, range, this.settings.sqrtS);
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const fx = (e.clientX - r.left - 46) / (r.width - 54);
      if (fx < 0 || fx > 1) return;
      this.setSqrtS(range.lo * Math.pow(range.hi / range.lo, fx), false);
      this.applySettings(false);
      this.renderTab();
    });
    (body.querySelector('#lumi') as HTMLSelectElement).addEventListener('change', (e) => {
      this.lumi = Number((e.target as HTMLSelectElement).value);
      this.renderTab();
    });
    body.querySelector('#measure')!.addEventListener('click', () => {
      this.send({ type: 'scanMeasure', sqrtS: this.settings.sqrtS, lumi: this.lumi, spreadRel: this.settings.spreadRel, point: this.scan.length });
    });
    (body.querySelector('#showTheory') as HTMLInputElement).addEventListener('change', (e) => {
      this.showTheory = (e.target as HTMLInputElement).checked;
      this.renderTab();
    });
    body.querySelector('#scanReset')!.addEventListener('click', () => {
      this.scan = [];
      this.renderTab();
    });
  }
}
