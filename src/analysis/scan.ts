// Skan σ(√s): splot przekroju z Gaussem rozrzutu energii wiązki i „gra w skan”.

import { particle } from '../physics/particles';
import { RESONANCES, sigmaVisible } from '../physics/ee';
import type { Rng } from '../sim/rng';

/**
 * ⟨σ⟩(√s) = ∫ σ(x)·G(x; √s, spreadRel·√s) dx  [nb].
 * Gęsta siatka wokół wąskich rezonansów (±25Γ), rzadsza w kontinuum.
 */
export function sigmaConvolved(sqrtS: number, spreadRel: number, sigma: (x: number) => number = sigmaVisible): number {
  const sd = spreadRel * sqrtS;
  if (!(sd > 0)) return sigma(sqrtS);
  const lo = sqrtS - 6 * sd;
  const hi = sqrtS + 6 * sd;
  const pts: number[] = [];
  const nBase = 240;
  for (let i = 0; i <= nBase; i++) pts.push(lo + ((hi - lo) * i) / nBase);
  for (const id of RESONANCES) {
    const V = particle(id);
    const a = Math.max(lo, V.m0 - 25 * V.width);
    const b = Math.min(hi, V.m0 + 25 * V.width);
    if (b <= a) continue;
    const n = 300;
    for (let i = 0; i <= n; i++) pts.push(a + ((b - a) * i) / n);
  }
  pts.sort((x, y) => x - y);
  let acc = 0;
  let prevX = pts[0];
  let prevF = gauss(prevX, sqrtS, sd) * sigma(prevX);
  for (let i = 1; i < pts.length; i++) {
    const x = pts[i];
    if (x === prevX) continue;
    const f = gauss(x, sqrtS, sd) * sigma(x);
    acc += 0.5 * (f + prevF) * (x - prevX);
    prevX = x;
    prevF = f;
  }
  return acc;
}

function gauss(x: number, mu: number, sd: number): number {
  const z = (x - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

export interface ScanPoint {
  sqrtS: number;
  /** Scałkowana świetlność [nb⁻¹]. */
  lumi: number;
  counts: number;
}

/** Pomiar w punkcie skanu: N ~ Poisson(L·⟨σ⟩). */
export function measure(sqrtS: number, lumi_invnb: number, spreadRel: number, rng: Rng): ScanPoint {
  const mu = lumi_invnb * sigmaConvolved(sqrtS, spreadRel);
  return { sqrtS, lumi: lumi_invnb, counts: rng.poisson(mu) };
}

/** Lokalne maksima ⟨σ⟩ wyraźnie nad otoczeniem (do testu bramki etapu 2). */
export function findPeaks(xs: number[], ys: number[], minRatio = 1.15, window = 25): number[] {
  const peaks: number[] = [];
  for (let i = 1; i < ys.length - 1; i++) {
    if (!(ys[i] > ys[i - 1] && ys[i] >= ys[i + 1])) continue;
    const a = Math.max(0, i - window);
    const b = Math.min(ys.length - 1, i + window);
    const base = Math.min(ys[a], ys[b]);
    if (ys[i] > base * minRatio) peaks.push(xs[i]);
  }
  return peaks;
}
