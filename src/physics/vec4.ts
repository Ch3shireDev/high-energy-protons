// Czterowektory [px, py, pz, E] w GeV. Funkcje czyste, bez alokacji na gorącej ścieżce tam, gdzie się da.

export type P4 = [number, number, number, number];
export type V3 = [number, number, number];

export const p4 = (px: number, py: number, pz: number, e: number): P4 => [px, py, pz, e];
export const add = (a: P4, b: P4): P4 => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
export const sum = (list: P4[]): P4 => list.reduce<P4>((s, v) => add(s, v), [0, 0, 0, 0]);
export const pAbs = (a: P4 | V3): number => Math.hypot(a[0], a[1], a[2]);
export const pT = (a: P4): number => Math.hypot(a[0], a[1]);
export const m2 = (a: P4): number => a[3] * a[3] - a[0] * a[0] - a[1] * a[1] - a[2] * a[2];
/** Masa niezmiennicza; dla m² < 0 (numerycznie) zwraca −√|m²|. */
export const mass = (a: P4): number => {
  const q = m2(a);
  return q >= 0 ? Math.sqrt(q) : -Math.sqrt(-q);
};
export const cosTheta = (a: P4 | V3): number => {
  const p = pAbs(a);
  return p > 0 ? a[2] / p : 0;
};
export const eta = (a: P4): number => {
  const pt = pT(a);
  if (pt === 0) return a[2] >= 0 ? Infinity : -Infinity;
  return Math.asinh(a[2] / pt);
};
export const fromMassMomentum = (m: number, dir: V3, p: number): P4 => [
  dir[0] * p,
  dir[1] * p,
  dir[2] * p,
  Math.sqrt(m * m + p * p),
];

/** Boost czterowektora v o prędkość beta (układ, w którym v jest dany, porusza się z +beta). */
export function boost(v: P4, b: V3): P4 {
  const b2 = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
  if (b2 <= 0) return [v[0], v[1], v[2], v[3]];
  if (b2 >= 1) throw new Error(`boost: |beta| ≥ 1 (${Math.sqrt(b2)})`);
  const gamma = 1 / Math.sqrt(1 - b2);
  const bp = b[0] * v[0] + b[1] * v[1] + b[2] * v[2];
  const g2 = (gamma - 1) / b2;
  const k = g2 * bp + gamma * v[3];
  return [v[0] + k * b[0], v[1] + k * b[1], v[2] + k * b[2], gamma * (v[3] + bp)];
}

/** Prędkość układu spoczynkowego P. */
export const betaOf = (P: P4): V3 => [P[0] / P[3], P[1] / P[3], P[2] / P[3]];

/** Boost z układu spoczynkowego P do układu, w którym P ma dany pęd. */
export const boostFromRest = (v: P4, P: P4): P4 => boost(v, betaOf(P));
/** Boost do układu spoczynkowego P. */
export const boostToRest = (v: P4, P: P4): P4 => {
  const b = betaOf(P);
  return boost(v, [-b[0], -b[1], -b[2]]);
};

/** Pęd w układzie spoczynkowym rozpadu 2-ciałowego M → m1 m2 (funkcja Källéna). */
export function twoBodyMomentum(M: number, m1: number, m2v: number): number {
  const a = (M * M - (m1 + m2v) ** 2) * (M * M - (m1 - m2v) ** 2);
  return a > 0 ? Math.sqrt(a) / (2 * M) : 0;
}

/**
 * Obraca wektor kierunku d, zadany względem osi z, tak by oś z przeszła w `axis`.
 * Używane do rozkładów kątowych względem dowolnej osi (np. wiązki lub spinu).
 */
export function alignToAxis(d: V3, axis: V3): V3 {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  const ax: V3 = [axis[0] / n, axis[1] / n, axis[2] / n];
  // Baza ortonormalna (u, v, ax).
  const t: V3 = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(t, ax));
  const v = cross(ax, u);
  return [
    d[0] * u[0] + d[1] * v[0] + d[2] * ax[0],
    d[0] * u[1] + d[1] * v[1] + d[2] * ax[1],
    d[0] * u[2] + d[1] * v[2] + d[2] * ax[2],
  ];
}

export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function normalize(a: V3): V3 {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 1];
}
