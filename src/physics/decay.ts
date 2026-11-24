// Silnik rozpadów: wybór kanału wg BR z data/, masy rezonansów-córek z Breita–Wignera,
// kinematyka z przestrzeni fazowej (lub rozkładu kątowego dla 2 ciał), boost do LAB.
// Kanały partonowe (np. J/ψ → ggg) → model zabawkowy toyFragment, z flagą toy.

import type { Rng } from '../sim/rng';
import { sampleDirection, type AngularDist } from './angular';
import { isExplicitChannel, isParton, particle, tryParticle, type Channel } from './particles';
import { phaseSpace, twoBody } from './phasespace';
import { toyFragment } from './toyjets';
import { boostFromRest, boostToRest, mass, normalize, type P4, type V3 } from './vec4';

export interface DecayHint {
  /** Oś kwantyzacji w LAB (np. wiązka e⁻); kierunek przenoszony do układu spoczynkowego. */
  axis: V3;
  /** Spin-1 poprzecznie spolaryzowany wzdłuż osi (produkcja w e⁺e⁻ → V). */
  transverseVector: true;
}

export interface DecayProduct {
  id: number;
  p: P4;
}

export interface DecayResult {
  channel: Channel;
  products: DecayProduct[];
  /** Użyto modelu zabawkowego fragmentacji. */
  toy: boolean;
  /** Rozkład kątowy użyty w rozpadzie 2-ciałowym (do aureoli). */
  angular: AngularDist | null;
  /** Oś rozkładu kątowego w układzie spoczynkowym rodzica. */
  axisRest: V3 | null;
  /** Kierunek pierwszego produktu w układzie spoczynkowym rodzica. */
  dirRest: V3 | null;
}

/** Minimalna masa produktu: rezonanse mogą być „lżejsze” do mMin. */
function minMass(id: number): number {
  if (isParton(id)) return partonMass(id);
  const p = tryParticle(id);
  if (!p) return Infinity; // nieznany produkt – kanał traktowany jako zamknięty
  return p.width > 0 && p.mMin > 0 ? Math.min(p.mMin, p.m0) : p.m0;
}

function partonMass(id: number): number {
  const a = Math.abs(id);
  if (a === 21 || a >= 81) return 0;
  return tryParticle(a)?.m0 ?? 0;
}

/** Relatywistyczny Breit–Wigner w m², obcięty do [lo, hi]. */
function sampleBW(m0: number, w: number, lo: number, hi: number, rng: Rng): number {
  if (hi <= lo) return lo;
  const a = Math.atan((lo * lo - m0 * m0) / (m0 * w));
  const b = Math.atan((hi * hi - m0 * m0) / (m0 * w));
  const m2 = m0 * m0 + m0 * w * Math.tan(a + (b - a) * rng.uniform());
  return Math.sqrt(Math.max(m2, lo * lo));
}

function productMasses(ids: number[], M: number, rng: Rng): number[] | null {
  const mins = ids.map(minMass);
  const sumMin = mins.reduce((a, b) => a + b, 0);
  if (sumMin >= M) return null;
  for (let t = 0; t < 200; t++) {
    const ms = ids.map((id, i) => {
      if (isParton(id)) return mins[i];
      const p = particle(id);
      if (!(p.width > 0)) return p.m0;
      const others = sumMin - mins[i];
      const hi = Math.min(p.mMax > 0 ? p.mMax : Infinity, M - others);
      return sampleBW(p.m0, p.width, mins[i], hi, rng);
    });
    if (ms.reduce((a, b) => a + b, 0) < M) return ms;
  }
  return null;
}

/** Rozkład kątowy dla V(1⁻⁻) poprzecznie spolaryzowanego → 2 ciała. */
export function vectorDecayAngular(products: number[]): AngularDist {
  if (products.length !== 2) return { kind: 'isotropic' };
  const s = products.map((id) => tryParticle(id)?.spinType ?? 0);
  if (s[0] === 1 && s[1] === 1) return { kind: 'sin2' }; // P P (np. φ → K⁺K⁻)
  if (s[0] === 2 && s[1] === 2) return { kind: 'onePlusCos2' }; // ℓ⁺ℓ⁻
  if ((s[0] === 1 && products[1] === 22) || (s[1] === 1 && products[0] === 22)) return { kind: 'onePlusCos2' }; // P γ
  return { kind: 'isotropic' };
}

/** Kanały otwarte kinematycznie dla masy M (z wagami BR). */
export function openChannels(id: number, M: number): Channel[] {
  return particle(id).channels.filter((c) => c.products.map(minMass).reduce((a, b) => a + b, 0) < M);
}

/**
 * Rozpada cząstkę `id` o czteropędzie P (LAB). Zwraca produkty w LAB.
 * `channel` – wymuszenie kanału (np. aureola / re-roll); domyślnie losowany wg BR.
 */
export function decay(id: number, P: P4, rng: Rng, hint?: DecayHint, channel?: Channel): DecayResult | null {
  const M = mass(P);
  const chans = channel ? [channel] : openChannels(id, M);
  if (!chans.length) return null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const ch = chans[rng.pick(chans.map((c) => c.br))];
    const r = decayChannel(id, P, M, ch, rng, hint);
    if (r) return r;
  }
  return null;
}

function decayChannel(id: number, P: P4, M: number, ch: Channel, rng: Rng, hint?: DecayHint): DecayResult | null {
  const ids = ch.products.map(resolvePseudo(rng));
  const ms = productMasses(ids, M, rng);
  if (!ms) return null;

  let axisRest: V3 | null = null;
  let angular: AngularDist | null = null;
  let dirRest: V3 | null = null;
  let rest: P4[] | null;
  if (ids.length === 2) {
    angular = { kind: 'isotropic' };
    let axis: V3 = [0, 0, 1];
    if (hint && particle(id).spinType === 3) {
      const a = boostToRest([hint.axis[0], hint.axis[1], hint.axis[2], 1], P);
      axis = normalize([a[0], a[1], a[2]]);
      angular = vectorDecayAngular(ids);
    }
    axisRest = axis;
    dirRest = sampleDirection(angular, axis, rng);
    rest = twoBody(M, ms[0], ms[1], dirRest);
  } else {
    rest = phaseSpace(M, ms, rng);
  }
  if (!rest) return null;

  const explicit = isExplicitChannel({ ...ch, products: ids });
  let products: DecayProduct[];
  let toy = false;
  if (explicit) {
    products = rest.map((q, i) => ({ id: ids[i], p: boostFromRest(q, P) }));
  } else {
    // Partony → model zabawkowy (w układzie spoczynkowym rodzica), fotony i leptony bez zmian.
    toy = true;
    const partonIdx = ids.map((x, i) => (isParton(x) ? i : -1)).filter((i) => i >= 0);
    const other = ids.map((x, i) => (isParton(x) ? -1 : i)).filter((i) => i >= 0);
    // Fragmentacja w układzie CM samych partonów, żeby Σp = 0.
    const Pp = partonIdx.reduce<P4>((s, i) => [s[0] + rest![i][0], s[1] + rest![i][1], s[2] + rest![i][2], s[3] + rest![i][3]], [0, 0, 0, 0]);
    const inCM = partonIdx.map((i) => boostToRest(rest![i], Pp));
    const hadrons = toyFragment(inCM, rng).map((h) => ({ id: h.id, p: boostFromRest(boostFromRest(h.p, Pp), P) }));
    products = [...other.map((i) => ({ id: ids[i], p: boostFromRest(rest![i], P) })), ...hadrons];
  }
  return { channel: ch, products, toy, angular, axisRest, dirRest };
}

/** Pseudo-kody Pythii: 83/−83 = losowy zapach lekkiego kwarka, 81 = „remnant” (traktowany jak diquark ~ gluon). */
function resolvePseudo(rng: Rng): (id: number) => number {
  let flav = 0;
  return (id: number) => {
    const a = Math.abs(id);
    if (a === 83) {
      if (!flav) flav = 1 + Math.floor(rng.uniform() * 3);
      return Math.sign(id) * flav;
    }
    if (a === 81 || a === 82) return 21;
    return id;
  };
}
