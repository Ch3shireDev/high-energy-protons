// MODEL ZABAWKOWY fragmentacji partonów. Nie jest hadronizacją (tę robi tylko Pythia).
// Zachowuje dokładnie czteropęd i ładunek całkowity; skład i krotności są orientacyjne.
// Zdarzenia z tego modułu są oznaczane `toy: true`, a UI wyświetla etykietę.

import type { Rng } from '../sim/rng';
import { particle } from './particles';
import { phaseSpace } from './phasespace';
import { boostFromRest, pAbs, type P4 } from './vec4';

export interface Hadron {
  id: number;
  p: P4;
}

// Skład klastra: pary neutralne ładunkowo. Wybór kodów PDG, masy zawsze z data/.
const SPECIES: { ids: number[]; w: number }[] = [
  { ids: [211, -211], w: 0.55 },
  { ids: [111], w: 0.25 },
  { ids: [321, -321], w: 0.08 },
  { ids: [310, 130], w: 0.05 },
  { ids: [221], w: 0.04 },
  { ids: [2212, -2212], w: 0.03 },
];

function pickHadrons(E: number, rng: Rng): number[] {
  // Krotność ~ logarytmiczna w energii (jakościowo jak w danych e⁺e⁻).
  const nMean = 1 + 2.2 * Math.log(1 + E / 1.2);
  const target = Math.max(1, Math.round(nMean + rng.normal() * Math.sqrt(nMean) * 0.6));
  const ids: number[] = [];
  const w = SPECIES.map((s) => s.w);
  while (ids.length < target) ids.push(...SPECIES[rng.pick(w)].ids);
  return ids;
}

const massOf = (id: number) => particle(id).m0;

/**
 * Fragmentuje układ partonów (pędy w układzie CM układu, suma pędów ≈ 0) na hadrony.
 * Zwraca hadrony w tym samym układzie. Kierunki jetów = kierunki partonów.
 */
export function toyFragment(partons: P4[], rng: Rng): Hadron[] {
  const W = partons.reduce((s, p) => s + p[3], 0);
  const jets = partons.map((p) => {
    const ids = pickHadrons(p[3], rng);
    return { dir: p, ids };
  });

  // Masy klastrów: suma mas hadronów + energia „wewnętrzna” ~ 10–25% energii partonu.
  const clusterMass = (j: { dir: P4; ids: number[] }, scale: number) => {
    const ms = j.ids.reduce((s, id) => s + massOf(id), 0);
    return j.ids.length === 1 ? ms : ms + Math.max(0.005, scale * (0.1 + 0.15 * rng.uniform()) * j.dir[3]);
  };
  let masses: number[] = [];
  for (let tries = 0; tries < 200; tries++) {
    masses = jets.map((j) => clusterMass(j, 1));
    if (masses.reduce((a, b) => a + b, 0) < W * 0.98) break;
    // Za ciężko: usuń hadrony z najcięższego klastra (zachowując neutralność ładunkową).
    const k = masses.indexOf(Math.max(...masses));
    const ids = jets[k].ids;
    if (ids.length <= 1) {
      // Nie usuwamy klastra (zepsułoby to bilans pędu) – zamieniamy na najlżejszy hadron.
      if (ids[0] === 111) throw new Error('toyFragment: za mało energii na hadrony');
      jets[k].ids = [111];
      continue;
    }
    const last = ids[ids.length - 1];
    const pair = particle(last).charge !== 0 || last === 130 ? 2 : 1;
    if (ids.length - pair < 1) {
      jets[k].ids = [111];
      continue;
    }
    ids.splice(ids.length - pair, pair);
  }

  // Skala pędów klastrów: Σ √(k²|p_j|² + m_j²) = W, kierunki partonów zachowane.
  const pj = jets.map((j) => pAbs(j.dir));
  const f = (k: number) => pj.reduce((s, p, i) => s + Math.hypot(k * p, masses[i]), 0) - W;
  let lo = 0;
  let hi = 1;
  while (f(hi) < 0) hi *= 2;
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  const k = 0.5 * (lo + hi);

  const out: Hadron[] = [];
  jets.forEach((j, i) => {
    const pv = j.dir;
    const P: P4 = [k * pv[0], k * pv[1], k * pv[2], Math.hypot(k * pj[i], masses[i])];
    const hm = j.ids.map(massOf);
    const rest = j.ids.length === 1 ? [[0, 0, 0, hm[0]] as P4] : phaseSpace(masses[i], hm, rng, true);
    if (!rest) throw new Error('toyFragment: klaster kinematycznie zamknięty');
    rest.forEach((q, n) => out.push({ id: j.ids[n], p: boostFromRest(q, P) }));
  });
  return out;
}
