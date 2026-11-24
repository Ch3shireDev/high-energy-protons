// Procesy e⁺e⁻ na poziomie LO:
//   e⁺e⁻ → γ*/Z → f f̄  (μ, τ, kwarki u d s c b) – wzory jak Sigma2ffbar2ffbarsgmZ w Pythii,
//   e⁺e⁻ → V (ρ, ω, φ, J/ψ, ψ(2S), Υ…) – relatywistyczny Breit–Wigner z Γee = Γ·BR(e⁺e⁻) z data/.
// Kwarki → jety wyłącznie jako jawny model zabawkowy (toy: true).
// Pominięte (jawnie): ISR, interferencja rezonans–kontinuum, Bhabha (kanał t), e⁺e⁻ → νν̄.

import type { DecayHint } from './decay';
import { alphaEM, alphaS, af, ef, SM, vf } from './couplings';
import { sampleCos, type AngularDist, type AngularTLA } from './angular';
import { allIds, particle, tryParticle } from './particles';
import { twoBody } from './phasespace';
import { toyFragment } from './toyjets';
import { GEV2_TO_NB } from './units';
import { alignToAxis, type P4, type V3 } from './vec4';
import { EventBuilder, type SimEvent } from '../sim/event';
import type { Rng } from '../sim/rng';

export type ProcessKind = 'lepton' | 'quark' | 'resonance';

export interface ProcessInfo {
  key: string;
  label: string;
  kind: ProcessKind;
  /** Kod PDG: fermion f (dla f f̄) lub rezonans V. */
  id: number;
  /** Model zabawkowy jetów. */
  toy: boolean;
}

/** Fermiony f f̄ w kanale s (bez e – Bhabha ma kanał t; bez ν – niewidoczne). */
const FERMIONS = [13, 15, 1, 2, 3, 4, 5];

/** Rezonanse wektorowe sprzęgające się do e⁺e⁻: z danych (spin 1, neutralne, BR(e⁺e⁻) > 0), bez Z. */
export const RESONANCES: number[] = allIds()
  .filter((id) => {
    if (id === 23) return false;
    const p = tryParticle(id);
    return Boolean(p && p.spinType === 3 && p.charge === 0 && p.colType === 0 && p.width > 0 && bEE(id) > 0);
  })
  .sort((a, b) => particle(a).m0 - particle(b).m0);

/** BR(V → e⁺e⁻) – tylko kanał dokładnie 2-ciałowy. */
export function bEE(id: number): number {
  const p = tryParticle(id);
  if (!p) return 0;
  return p.channels
    .filter((c) => c.products.length === 2 && c.products.includes(11) && c.products.includes(-11))
    .reduce((s, c) => s + c.br, 0);
}

export const PROCESSES: ProcessInfo[] = [
  ...FERMIONS.map((id) => ({
    key: `ff:${id}`,
    label: id > 10 ? `${particle(id).name.replace('-', '')}⁺${particle(id).name.replace('-', '')}⁻` : `${particle(id).name} ${particle(-id).name}`,
    kind: (id > 10 ? 'lepton' : 'quark') as ProcessKind,
    id,
    toy: id < 10,
  })),
  ...RESONANCES.map((id) => ({ key: `res:${id}`, label: particle(id).name, kind: 'resonance' as ProcessKind, id, toy: false })),
];

// ------------------------------------------------------------------ γ*/Z → f f̄

export interface GmZTerms extends AngularTLA {
  /** Całkowity przekrój [nb]. */
  sigma_nb: number;
}

/**
 * Współczynniki dσ/dcosθ = (s/2)·[T(1+c²) + L(1−c²) + 2A·c] dla e⁺e⁻ → f f̄,
 * θ = kąt f względem e⁻. Normalizacja i propagatory jak w Pythii (szerokość Z zależna od s).
 */
export function gmZ(sqrtS: number, fId: number): GmZTerms {
  const s = sqrtS * sqrtS;
  const mf = particle(fId).m0;
  if (sqrtS <= 2 * mf) return { T: 0, L: 0, A: 0, sigma_nb: 0 };
  const Z = particle(23);
  const mZ2 = Z.m0 * Z.m0;
  const gamMRat = Z.width / Z.m0;
  const thetaWRat = 1 / (16 * SM.sin2thetaW * (1 - SM.sin2thetaW));
  const alpEM = alphaEM(s);

  const gamProp = (Math.PI * alpEM * alpEM) / (s * s);
  const den = (s - mZ2) ** 2 + (s * gamMRat) ** 2;
  const intProp = (gamProp * 2 * thetaWRat * s * (s - mZ2)) / den;
  const resProp = (gamProp * (thetaWRat * s) ** 2) / den;

  const mr = (mf / sqrtS) ** 2;
  const beta = Math.sqrt(Math.max(0, 1 - 4 * mr));
  const colQ = fId < 10 ? 3 * (1 + alphaS(s) / Math.PI) : 1;
  const e_f = ef(fId);
  const v_f = vf(fId);
  const a_f = af(fId);
  const gamT = colQ * e_f * e_f * beta;
  const gamL = gamT * 4 * mr;
  const intT = colQ * e_f * v_f * beta;
  const intL = intT * 4 * mr;
  const intA = colQ * e_f * a_f * beta;
  const resT = colQ * (v_f * v_f * beta + a_f * a_f * beta ** 3);
  const resL = colQ * v_f * v_f * beta * 4 * mr;
  const resA = colQ * v_f * a_f * beta * 4;

  // Sprzężenia elektronu (stan początkowy).
  const ei = ef(11);
  const vi = vf(11);
  const ai = af(11);
  const T = ei * ei * gamProp * gamT + ei * vi * intProp * intT + (vi * vi + ai * ai) * resProp * resT;
  const L = ei * ei * gamProp * gamL + ei * vi * intProp * intL + (vi * vi + ai * ai) * resProp * resL;
  const A = ei * ai * intProp * intA + vi * ai * resProp * resA;
  const sigma = (s / 2) * ((8 / 3) * T + (4 / 3) * L);
  return { T, L, A, sigma_nb: sigma * GEV2_TO_NB };
}

/** Asymetria przód–tył A_FB = (σ_F − σ_B)/(σ_F + σ_B). */
export function afb(t: AngularTLA): number {
  return (2 * t.A) / ((8 / 3) * t.T + (4 / 3) * t.L);
}

// ------------------------------------------------------------------ rezonanse

/**
 * σ(e⁺e⁻ → V → wszystko) [nb], wzór z CLAUDE.md:
 * σ(s) = (12π/M²)·(Γee·Γ/Γ²)·sΓ²/((s−M²)² + M²Γ²)
 */
export function sigmaResonance(sqrtS: number, id: number): number {
  const V = particle(id);
  const M = V.m0;
  const G = V.width;
  const s = sqrtS * sqrtS;
  const M2 = M * M;
  return ((12 * Math.PI) / M2) * bEE(id) * ((s * G * G) / ((s - M2) ** 2 + M2 * G * G)) * GEV2_TO_NB;
}

// ------------------------------------------------------------------ suma

export function sigmaProcess(sqrtS: number, p: ProcessInfo): number {
  return p.kind === 'resonance' ? sigmaResonance(sqrtS, p.id) : gmZ(sqrtS, p.id).sigma_nb;
}

export function sigmaAll(sqrtS: number, filter?: (p: ProcessInfo) => boolean): number {
  let s = 0;
  for (const p of PROCESSES) if (!filter || filter(p)) s += sigmaProcess(sqrtS, p);
  return s;
}

/** Przekrój widoczny w detektorze = wszystkie procesy (wszystkie mają widoczny stan końcowy). */
export const sigmaVisible = (sqrtS: number) => sigmaAll(sqrtS);

// ------------------------------------------------------------------ generator

export interface EEOptions {
  /** Nominalne √s [GeV]. */
  sqrtS: number;
  /** Względny rozrzut √s wiązki (σ/√s). */
  spreadRel: number;
  seed: number;
  /** Ograniczenie do wybranych procesów (losowanie wg σ wewnątrz wyboru). */
  filter?: (p: ProcessInfo) => boolean;
}

export interface GeneratedEE {
  event: SimEvent;
  process: ProcessInfo;
  /** Podpowiedzi polaryzacji dla rozpadu rezonansu (indeks wpisu → oś). */
  hints: Map<number, DecayHint>;
  /** Rozkład kątowy procesu twardego (f względem e⁻) – do nakładki teorii. */
  angular: AngularDist | null;
}

const BEAM_AXIS: V3 = [0, 0, 1]; // e⁻ leci w +z

export function generateEE(o: EEOptions, rng: Rng): GeneratedEE | null {
  const sqrtS = o.spreadRel > 0 ? o.sqrtS * (1 + o.spreadRel * rng.normal()) : o.sqrtS;
  const procs = PROCESSES.filter((p) => !o.filter || o.filter(p));
  const sig = procs.map((p) => sigmaProcess(sqrtS, p));
  if (!(sig.reduce((a, b) => a + b, 0) > 0)) return null;
  const proc = procs[rng.pick(sig)];

  const b = new EventBuilder(64);
  const me = particle(11).m0;
  const pb = Math.sqrt(Math.max(0, (sqrtS / 2) ** 2 - me * me));
  b.push({ id: 11, status: -12, p: [0, 0, pb, sqrtS / 2], m: me, charge3: -3 });
  b.push({ id: -11, status: -12, p: [0, 0, -pb, sqrtS / 2], m: me, charge3: 3 });
  const hints = new Map<number, DecayHint>();
  let toy = false;
  let angular: AngularDist | null = null;
  let focus: number | undefined;

  if (proc.kind === 'resonance') {
    const i = b.push({ id: proc.id, status: 1, p: [0, 0, 0, sqrtS], m: sqrtS, mothers: [1, 2], charge3: 0 });
    hints.set(i, { axis: BEAM_AXIS, transverseVector: true });
    focus = i;
  } else {
    const t = gmZ(sqrtS, proc.id);
    angular = { kind: 'tla', tla: { T: t.T, L: t.L, A: t.A } };
    const c = sampleCos(angular, rng);
    const sn = Math.sqrt(1 - c * c);
    const phi = 2 * Math.PI * rng.uniform();
    const dir = alignToAxis([sn * Math.cos(phi), sn * Math.sin(phi), c], BEAM_AXIS);
    const f = particle(proc.id);
    const [pf, pfb] = twoBody(sqrtS, f.m0, f.m0, dir);
    if (proc.kind === 'lepton') {
      b.push({ id: proc.id, status: 1, p: pf, m: f.m0, mothers: [1, 2], charge3: Math.round(f.charge * 3) });
      b.push({ id: -proc.id, status: 1, p: pfb, m: f.m0, mothers: [1, 2], charge3: -Math.round(f.charge * 3) });
    } else {
      // q q̄ jako partony (status ujemny – nie są śledzone), potem MODEL ZABAWKOWY jetów.
      toy = true;
      const iq = b.push({ id: proc.id, status: -23, p: pf, m: f.m0, mothers: [1, 2], charge3: Math.round(f.charge * 3) });
      const iqb = b.push({ id: -proc.id, status: -23, p: pfb, m: f.m0, mothers: [1, 2], charge3: -Math.round(f.charge * 3) });
      const hadrons = toyFragment([pf, pfb] as P4[], rng);
      const first = b.size;
      for (const h of hadrons) {
        const hp = particle(h.id);
        b.push({ id: h.id, status: 1, p: h.p, m: hp.m0, mothers: [iq, iqb], charge3: Math.round(hp.charge * 3) });
      }
      b.setDaughters(iq, first, b.size - 1);
      b.setDaughters(iqb, first, b.size - 1);
    }
  }
  const event = b.finish({ source: 'ts', toy, process: proc.key, sqrtS, seed: o.seed, weight: 1, focus });
  return { event, process: proc, hints, angular };
}
