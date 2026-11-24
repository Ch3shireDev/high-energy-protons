// Statystyka: χ² histogramu względem rozkładu teoretycznego, p-wartość.

import { lgamma } from '../sim/rng';

/** Regularyzowana dolna funkcja gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 1000; n++) {
      del *= x / (a + n);
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - gammaQcf(a, x);
}

function gammaQcf(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** P(χ² ≥ chi2 | ndf). */
export function chi2PValue(chi2: number, ndf: number): number {
  if (ndf <= 0) return NaN;
  return 1 - gammaP(ndf / 2, chi2 / 2);
}

export interface Chi2Result {
  chi2: number;
  ndf: number;
  p: number;
}

/**
 * χ² Pearsona: obserwowane zliczenia vs oczekiwane N·p_i, p_i = ∫_bin f (z dystrybuanty).
 * Biny z oczekiwaną < 5 są łączone z sąsiadem. ndf = liczba binów − 1 (normalizacja z danych).
 */
export function chi2Test(counts: ArrayLike<number>, edges: ArrayLike<number>, cdf: (x: number) => number): Chi2Result {
  let N = 0;
  for (let i = 0; i < counts.length; i++) N += counts[i];
  const F0 = cdf(edges[0]);
  const Ftot = cdf(edges[edges.length - 1]) - F0;
  let chi2 = 0;
  let bins = 0;
  let accO = 0;
  let accE = 0;
  for (let i = 0; i < counts.length; i++) {
    accO += counts[i];
    accE += (N * (cdf(edges[i + 1]) - cdf(edges[i]))) / Ftot;
    if (accE >= 5 || i === counts.length - 1) {
      if (accE > 0) {
        chi2 += (accO - accE) ** 2 / accE;
        bins++;
      }
      accO = 0;
      accE = 0;
    }
  }
  const ndf = bins - 1;
  return { chi2, ndf, p: chi2PValue(chi2, ndf) };
}
