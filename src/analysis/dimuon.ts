// Detekcja mionów i masy par μ⁺μ⁻: akceptancja + rozdzielczość pędu (model detektora).
//
// Wymuszone rozpady (V → μμ z BR = 1 w Pythii) kompensuje waga PARY, nie zdarzenia:
// każdy mion pochodzący z wymuszonego V „istnieje” z prawdopodobieństwem BR(V → μμ).
//   para z tego samego V:              w = BR(V)
//   miony z różnych wymuszonych V₁, V₂: w = BR(V₁)·BR(V₂)
//   mion spoza wymuszonych rozpadów:    czynnik 1
// To jest dokładne dla histogramu par (inne rozpady w zdarzeniu nie wpływają na daną parę).

import { brMuMu } from '../physics/ppPresets';
import type { DetectorConfig } from '../sim/detector';
import { F, STRIDE } from '../sim/event';
import type { Rng } from '../sim/rng';

const MU = 13;

export function makeBrTable(ids: number[]): Map<number, number> {
  return new Map(ids.map((id) => [id, brMuMu(id)]));
}

/** Przodek „rzeczywisty”: idzie w górę po kopiach tej samej cząstki (np. po emisji fotonu). */
export function rootMother(data: Float64Array, i: number): number {
  let j = i;
  for (let guard = 0; guard < 100; guard++) {
    const m = data[j * STRIDE + F.mother1];
    if (m <= 0 || data[m * STRIDE + F.id] !== data[j * STRIDE + F.id]) return m;
    j = m;
  }
  return 0;
}

export interface DimuonPair {
  m: number;
  /** Waga pary z wymuszonych rozpadów (1, gdy brak). */
  w: number;
  /** Oba miony z tego samego rozpadu rezonansu z `truthIds` (prawda MC). */
  truth: boolean;
}

/** Miony w akceptancji (po rozmyciu pędu) → pary o przeciwnych ładunkach z wagami. */
export function dimuonPairs(
  data: Float64Array,
  size: number,
  det: DetectorConfig,
  rng: Rng,
  forcedBr: Map<number, number> = new Map(),
  truthIds: Set<number> = new Set(),
): DimuonPair[] {
  const acc = det.muonAcceptance;
  const res = det.resolution;
  const mus: { q: number; p: [number, number, number, number]; root: number; f: number }[] = [];
  for (let i = 1; i < size; i++) {
    const b = i * STRIDE;
    if (Math.abs(data[b + F.id]) !== MU || data[b + F.status] <= 0) continue;
    const px = data[b + F.px];
    const py = data[b + F.py];
    const pz = data[b + F.pz];
    const pt = Math.hypot(px, py);
    const p = Math.hypot(pt, pz);
    if (pt < acc.pTMin || p < acc.pMin) continue;
    if (Math.abs(Math.asinh(pz / pt)) > acc.etaMax) continue;
    const sigma = Math.hypot(res.a, res.b * pt);
    const k = Math.max(0.05, 1 + sigma * rng.normal());
    const m = data[b + F.m];
    const q: [number, number, number, number] = [px * k, py * k, pz * k, 0];
    q[3] = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + m * m);
    const root = rootMother(data, i);
    const rootId = root > 0 ? data[root * STRIDE + F.id] : 0;
    mus.push({ q: data[b + F.id] > 0 ? -1 : 1, p: q, root, f: forcedBr.get(rootId) ?? 1 });
  }
  const out: DimuonPair[] = [];
  for (let i = 0; i < mus.length; i++)
    for (let j = i + 1; j < mus.length; j++) {
      const a = mus[i];
      const c = mus[j];
      if (a.q === c.q) continue;
      const e = a.p[3] + c.p[3];
      const m2 = e * e - (a.p[0] + c.p[0]) ** 2 - (a.p[1] + c.p[1]) ** 2 - (a.p[2] + c.p[2]) ** 2;
      const same = a.root > 0 && a.root === c.root;
      const w = same ? a.f : a.f * c.f;
      const truth = same && truthIds.has(data[a.root * STRIDE + F.id]);
      out.push({ m: Math.sqrt(Math.max(0, m2)), w, truth });
    }
  return out;
}
