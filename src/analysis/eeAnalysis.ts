// Analiza na żywo dla e⁺e⁻: histogramy z nakładką teorii i χ². Działa w workerze.

import { cdf, density, integral, type AngularDist } from '../physics/angular';
import type { GeneratedEE } from '../physics/ee';
import { particle } from '../physics/particles';
import { cosTheta, dot3, pAbs, type P4 } from '../physics/vec4';
import { F, p4Of, STRIDE } from '../sim/event';
import type { PropagatedEvent } from '../sim/propagate';
import { Hist1D, Hist2D } from './histogram';
import { chi2Test, type Chi2Result } from './stats';

export interface HistSnapshot {
  key: string;
  title: string;
  xLabel: string;
  note: string;
  edges: number[];
  counts: number[];
  entries: number;
  /** Krzywa teorii w jednostkach „zliczenia na bin”: pary [x, y]. */
  theory: [number, number][] | null;
  chi2: Chi2Result | null;
}

export interface DalitzSnapshot {
  nx: number;
  ny: number;
  xlo: number;
  xhi: number;
  ylo: number;
  yhi: number;
  counts: number[];
  entries: number;
  parent: string;
}

const K0S = 310;
const TRACKER_R_MM = 1100;

export class EEAnalysis {
  cosMu = new Hist1D(40, -1, 1);
  cosPP = new Hist1D(40, -1, 1);
  cosLL = new Hist1D(40, -1, 1);
  kLen: Hist1D;
  dalitz = new Hist2D(60, 0, 1, 60, 0, 1);
  dalitzParent = 0;
  // Średnia (unormowana) teoria μμ przy rozrzucie √s: mieszanka TLA zdarzenie po zdarzeniu.
  private tla = { T: 0, L: 0, A: 0, n: 0 };
  private ctauK: number;

  constructor() {
    this.ctauK = particle(K0S).ctau_mm;
    this.kLen = new Hist1D(30, 0, 5 * this.ctauK);
  }

  reset(): void {
    this.cosMu.reset();
    this.cosPP.reset();
    this.cosLL.reset();
    this.kLen.reset();
    this.dalitz.reset();
    this.dalitzParent = 0;
    this.tla = { T: 0, L: 0, A: 0, n: 0 };
  }

  fill(gen: GeneratedEE, prop: PropagatedEvent): void {
    const d = prop.event.data;
    const g = (i: number, f: number) => d[i * STRIDE + f];

    // 1) cosθ μ⁻ względem e⁻ w e⁺e⁻ → μ⁺μ⁻.
    if (gen.process.key === 'ff:13' && gen.angular?.kind === 'tla') {
      for (let i = 3; i < prop.event.size; i++) {
        if (g(i, F.id) === 13 && g(i, F.mother1) === 1) {
          this.cosMu.fill(cosTheta(p4Of(d, i)));
          const t = gen.angular.tla;
          const I = integral(gen.angular);
          this.tla.T += t.T / I;
          this.tla.L += t.L / I;
          this.tla.A += t.A / I;
          this.tla.n++;
          break;
        }
      }
    }

    for (const rec of prop.decays) {
      const pid = g(rec.parent, F.id);
      // 2) Rozpad rezonansu V → 2 ciała względem osi wiązki (układ spoczynkowy V).
      if (rec.parent === prop.event.meta.focus && rec.result.dirRest && rec.result.axisRest && rec.result.angular) {
        const c = dot3(rec.result.dirRest, rec.result.axisRest);
        if (rec.result.angular.kind === 'sin2') this.cosPP.fill(c);
        else if (rec.result.angular.kind === 'onePlusCos2' && rec.result.products.every((x) => Math.abs(x.id) === 11 || Math.abs(x.id) === 13)) this.cosLL.fill(c);
      }
      // 3) Własna droga rozpadu K⁰S (tylko βγ, dla których 5cτ mieści się w trackerze – bez obcięcia).
      if (pid === K0S) {
        const P = rec.P;
        const m = particle(K0S).m0;
        const bg = pAbs(P) / m;
        const v0: [number, number, number] = [g(rec.parent, F.x_mm), g(rec.parent, F.y_mm), g(rec.parent, F.z_mm)];
        const r0 = Math.hypot(v0[0], v0[1], v0[2]);
        if (bg * 5 * this.ctauK < TRACKER_R_MM - r0) {
          const L = Math.hypot(rec.vertex[0] - v0[0], rec.vertex[1] - v0[1], rec.vertex[2] - v0[2]);
          this.kLen.fill(L / bg);
        }
      }
      // 4) Dalitz: V → π⁺π⁻π⁰ (ω, φ, J/ψ…).
      if (rec.daughters[1] - rec.daughters[0] === 2) {
        const ids = [0, 1, 2].map((k) => g(rec.daughters[0] + k, F.id));
        if (ids.includes(211) && ids.includes(-211) && ids.includes(111) && (pid === 223 || pid === 333)) {
          const pp = p4Of(d, rec.daughters[0] + ids.indexOf(211));
          const pm = p4Of(d, rec.daughters[0] + ids.indexOf(-211));
          const p0 = p4Of(d, rec.daughters[0] + ids.indexOf(111));
          const M = particle(pid).m0;
          if (this.dalitzParent !== pid) {
            this.dalitz.reset();
            this.dalitzParent = pid;
            const hi = (M + 0.1) ** 2;
            Object.assign(this.dalitz, { xhi: hi, yhi: hi });
          }
          this.dalitz.fill(m2sum(pp, p0), m2sum(pm, p0));
        }
      }
    }
  }

  snapshot(): { hists: HistSnapshot[]; dalitz: DalitzSnapshot } {
    const n = this.tla.n || 1;
    const muDist: AngularDist = { kind: 'tla', tla: { T: this.tla.T / n, L: this.tla.L / n, A: this.tla.A / n } };
    const kDist = (x: number) => Math.exp(-x / this.ctauK) / this.ctauK;
    const kCdf = (x: number) => 1 - Math.exp(-x / this.ctauK);
    const hists = [
      snap('cosMu', 'e⁺e⁻ → μ⁺μ⁻: cos θ(μ⁻, e⁻)', 'cos θ', 'Teoria: LO γ*/Z, dσ/dcosθ ∝ T(1+cos²θ) + L(1−cos²θ) + 2A cosθ (uśredniona po rozrzucie √s).', this.cosMu, this.tla.n ? (c) => cdf(muDist, c) : null, this.tla.n ? (c) => density(muDist, c) / integral(muDist) : null),
      snap('cosPP', 'V → P P (np. φ → K⁺K⁻): cos θ*', 'cos θ* (układ spoczynkowy V, oś wiązki)', 'Teoria: spin 1 poprzecznie spolaryzowany → dwa spiny 0: sin²θ.', this.cosPP, (c) => cdf({ kind: 'sin2' }, c), (c) => density({ kind: 'sin2' }, c) / integral({ kind: 'sin2' })),
      snap('cosLL', 'V → ℓ⁺ℓ⁻ (J/ψ, Υ…): cos θ*', 'cos θ* (układ spoczynkowy V, oś wiązki)', 'Teoria: 1 + cos²θ (granica bezmasowa).', this.cosLL, (c) => cdf({ kind: 'onePlusCos2' }, c), (c) => density({ kind: 'onePlusCos2' }, c) / integral({ kind: 'onePlusCos2' })),
      snap('kLen', 'K⁰S: własna droga rozpadu L/(βγ)', 'L/(βγ) [mm]', `Teoria: exp(−x/cτ), cτ = ${this.ctauK.toFixed(2)} mm (data/). Tylko K⁰S, dla których 5cτ·βγ mieści się w trackerze.`, this.kLen, kCdf, kDist),
    ];
    const z = this.dalitz;
    return {
      hists,
      dalitz: { nx: z.nx, ny: z.ny, xlo: z.xlo, xhi: z.xhi, ylo: z.ylo, yhi: z.yhi, counts: Array.from(z.counts), entries: z.entries, parent: this.dalitzParent ? particle(this.dalitzParent).name : '' },
    };
  }
}

function m2sum(a: P4, b: P4): number {
  const e = a[3] + b[3];
  return e * e - (a[0] + b[0]) ** 2 - (a[1] + b[1]) ** 2 - (a[2] + b[2]) ** 2;
}

function snap(
  key: string,
  title: string,
  xLabel: string,
  note: string,
  h: Hist1D,
  cdfFn: ((x: number) => number) | null,
  pdf: ((x: number) => number) | null,
): HistSnapshot {
  const N = h.total();
  let theory: [number, number][] | null = null;
  let chi2: Chi2Result | null = null;
  if (cdfFn && pdf && N > 0) {
    const Ftot = cdfFn(h.hi) - cdfFn(h.lo);
    const w = (h.hi - h.lo) / h.nBins;
    theory = [];
    for (let k = 0; k <= 120; k++) {
      const x = h.lo + ((h.hi - h.lo) * k) / 120;
      theory.push([x, (N * w * pdf(x)) / Ftot]);
    }
    if (N >= 50) chi2 = chi2Test(h.counts, h.edges, cdfFn);
  }
  return { key, title, xLabel, note, edges: Array.from(h.edges), counts: Array.from(h.counts), entries: N, theory, chi2 };
}
