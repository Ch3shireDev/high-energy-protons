// Rozkłady kątowe 2-ciałowe: dP/dcosθ względem osi (wiązki / spinu).
// Ta sama funkcja zasila generator i „aureolę prawdopodobieństwa” w renderze.

import type { Rng } from '../sim/rng';
import type { V3 } from './vec4';
import { alignToAxis } from './vec4';

/** dσ/dcosθ ∝ T·(1+c²) + L·(1−c²) + 2A·c   (konwencja Pythii, Sigma2ffbar2ffbarsgmZ). */
export interface AngularTLA {
  T: number;
  L: number;
  A: number;
}

export type AngularDist =
  | { kind: 'isotropic' }
  | { kind: 'sin2' } // spin 1 (poprzecznie spolaryzowany) → 2 × spin 0
  | { kind: 'onePlusCos2' } // spin 1 → para fermionów (granica bezmasowa), P γ
  | { kind: 'tla'; tla: AngularTLA };

export function density(d: AngularDist, c: number): number {
  switch (d.kind) {
    case 'isotropic':
      return 1;
    case 'sin2':
      return 1 - c * c;
    case 'onePlusCos2':
      return 1 + c * c;
    case 'tla':
      return d.tla.T * (1 + c * c) + d.tla.L * (1 - c * c) + 2 * d.tla.A * c;
  }
}

/** Unormowana gęstość na [-1, 1]. */
export function normalizedDensity(d: AngularDist, c: number): number {
  return density(d, c) / integral(d);
}

export function integral(d: AngularDist): number {
  switch (d.kind) {
    case 'isotropic':
      return 2;
    case 'sin2':
      return 4 / 3;
    case 'onePlusCos2':
      return 8 / 3;
    case 'tla':
      return (8 / 3) * d.tla.T + (4 / 3) * d.tla.L;
  }
}

/** Analityczna dystrybuanta F(c) = ∫_{-1}^{c} density / integral – do χ² w binach. */
export function cdf(d: AngularDist, c: number): number {
  const x = Math.max(-1, Math.min(1, c));
  let F: number;
  switch (d.kind) {
    case 'isotropic':
      F = x + 1;
      break;
    case 'sin2':
      F = x - (x * x * x) / 3 + 2 / 3;
      break;
    case 'onePlusCos2':
      F = x + (x * x * x) / 3 + 4 / 3;
      break;
    case 'tla': {
      const { T, L, A } = d.tla;
      F = T * (x + (x * x * x) / 3 + 4 / 3) + L * (x - (x * x * x) / 3 + 2 / 3) + A * (x * x - 1);
      break;
    }
  }
  return F / integral(d);
}

function maxDensity(d: AngularDist): number {
  switch (d.kind) {
    case 'isotropic':
    case 'sin2':
      return 1;
    case 'onePlusCos2':
      return 2;
    case 'tla':
      return Math.max(density(d, -1), density(d, 1), density(d, 0)) * 1.0001 + 2 * Math.abs(d.tla.A);
  }
}

/** Losuje cosθ z rozkładu (akceptacja–odrzucenie). */
export function sampleCos(d: AngularDist, rng: Rng): number {
  if (d.kind === 'isotropic') return 2 * rng.uniform() - 1;
  const fmax = maxDensity(d);
  for (;;) {
    const c = 2 * rng.uniform() - 1;
    if (rng.uniform() * fmax <= density(d, c)) return c;
  }
}

/** Kierunek z rozkładu względem osi. */
export function sampleDirection(d: AngularDist, axis: V3, rng: Rng): V3 {
  const c = sampleCos(d, rng);
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  const phi = 2 * Math.PI * rng.uniform();
  return alignToAxis([s * Math.cos(phi), s * Math.sin(phi), c], axis);
}
