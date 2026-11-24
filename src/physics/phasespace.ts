// Jednorodna n-ciałowa przestrzeń fazowa (algorytm Raubolda–Lyncha / GENBOD,
// jak TGenPhaseSpace w ROOT) z akceptacją–odrzuceniem → zdarzenia bez wag.

import type { Rng } from '../sim/rng';
import { twoBodyMomentum, type P4, type V3 } from './vec4';

/** Rozkład 2-ciałowy w układzie spoczynkowym M wzdłuż kierunku `dir` (pierwsza cząstka). */
export function twoBody(M: number, m1: number, m2: number, dir: V3): [P4, P4] {
  const p = twoBodyMomentum(M, m1, m2);
  return [
    [dir[0] * p, dir[1] * p, dir[2] * p, Math.sqrt(p * p + m1 * m1)],
    [-dir[0] * p, -dir[1] * p, -dir[2] * p, Math.sqrt(p * p + m2 * m2)],
  ];
}

/**
 * Generuje pędy n cząstek o masach `masses` w układzie spoczynkowym masy M,
 * jednorodnie w n-ciałowej przestrzeni fazowej. Zwraca null, gdy kinematycznie zamknięte.
 * `weighted = true` pomija akceptację–odrzucenie (rozkład NIE jest jednorodny) – tylko dla
 * modelu zabawkowego przy dużych krotnościach, gdzie akceptacja GENBOD spada wykładniczo.
 */
export function phaseSpace(M: number, masses: number[], rng: Rng, weighted = false): P4[] | null {
  const n = masses.length;
  let msum = 0;
  for (const m of masses) msum += m;
  const T = M - msum;
  if (T <= 0 || n < 1) return null;
  if (n === 1) return [[0, 0, 0, M]];
  if (n === 2) return twoBody(M, masses[0], masses[1], rng.isotropic());

  // Maksymalna waga (ROOT: TGenPhaseSpace::SetDecay).
  let emmax = T + masses[0];
  let emmin = 0;
  let wtMax = 1;
  for (let i = 1; i < n; i++) {
    emmin += masses[i - 1];
    emmax += masses[i];
    wtMax *= twoBodyMomentum(emmax, emmin, masses[i]);
  }

  const rno = new Float64Array(n);
  const invMas = new Float64Array(n);
  const pd = new Float64Array(n);
  for (let attempt = 0; attempt < 100000; attempt++) {
    rno[0] = 0;
    rno[n - 1] = 1;
    for (let i = 1; i < n - 1; i++) rno[i] = rng.uniform();
    rno.subarray(1, n - 1).sort();
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += masses[i];
      invMas[i] = rno[i] * T + s;
    }
    let wt = 1;
    for (let i = 0; i < n - 1; i++) {
      pd[i] = twoBodyMomentum(invMas[i + 1], invMas[i], masses[i + 1]);
      wt *= pd[i];
    }
    if (!weighted && wt < rng.uniform() * wtMax) continue;
    return build(n, masses, pd, invMas, rng);
  }
  throw new Error('phaseSpace: brak akceptacji po 1e5 próbach');
}

function build(n: number, masses: number[], pd: Float64Array, invMas: Float64Array, rng: Rng): P4[] {
  const v: P4[] = [];
  v[0] = [0, pd[0], 0, Math.hypot(pd[0], masses[0])];
  let i = 1;
  for (;;) {
    v[i] = [0, -pd[i - 1], 0, Math.hypot(pd[i - 1], masses[i])];
    const cZ = 2 * rng.uniform() - 1;
    const sZ = Math.sqrt(Math.max(0, 1 - cZ * cZ));
    const angY = 2 * Math.PI * rng.uniform();
    const cY = Math.cos(angY);
    const sY = Math.sin(angY);
    for (let j = 0; j <= i; j++) {
      const w = v[j];
      let x = w[0];
      const y = w[1];
      w[0] = cZ * x - sZ * y;
      w[1] = sZ * x + cZ * y;
      x = w[0];
      const z = w[2];
      w[0] = cY * x - sY * z;
      w[2] = sY * x + cY * z;
    }
    if (i === n - 1) break;
    const beta = pd[i] / Math.hypot(pd[i], invMas[i]);
    const gamma = 1 / Math.sqrt(1 - beta * beta);
    for (let j = 0; j <= i; j++) {
      const w = v[j];
      const py = w[1];
      const e = w[3];
      w[1] = gamma * (py + beta * e);
      w[3] = gamma * (e + beta * py);
    }
    i++;
  }
  return v;
}
