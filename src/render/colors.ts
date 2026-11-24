// Kolor zawsze coś koduje: odcień = rodzaj cząstki (i znak ładunku dla hadronów),
// jasność = energia (log). Żadnej palety dekoracyjnej.

export interface Category {
  key: string;
  label: string;
  rgb: [number, number, number];
}

export const CATEGORIES: Category[] = [
  { key: 'e', label: 'e±', rgb: [1.0, 0.85, 0.3] },
  { key: 'mu', label: 'μ±', rgb: [0.24, 1.0, 0.56] },
  { key: 'gamma', label: 'γ', rgb: [0.5, 0.83, 1.0] },
  { key: 'hplus', label: 'hadron +', rgb: [1.0, 0.54, 0.24] },
  { key: 'hminus', label: 'hadron −', rgb: [0.78, 0.49, 1.0] },
  { key: 'h0', label: 'hadron neutralny', rgb: [0.62, 0.66, 0.74] },
  { key: 'nu', label: 'ν (niewidoczne)', rgb: [0.35, 0.38, 0.45] },
  { key: 'res', label: 'rezonans / τ', rgb: [1.0, 0.3, 0.43] },
];
const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

export function categoryOf(id: number, charge: number, ctau_mm: number): Category {
  const a = Math.abs(id);
  if (a === 11) return BY_KEY.e;
  if (a === 13) return BY_KEY.mu;
  if (a === 22) return BY_KEY.gamma;
  if (a === 12 || a === 14 || a === 16) return BY_KEY.nu;
  if (a === 15 || ctau_mm < 1e-3) return BY_KEY.res;
  if (charge > 0) return BY_KEY.hplus;
  if (charge < 0) return BY_KEY.hminus;
  return BY_KEY.h0;
}

/** Jasność z energii: 0.35 przy 100 MeV … 1 przy ≥ 100 GeV (skala log). */
export function energyBrightness(E: number): number {
  const x = Math.log10(Math.max(E, 0.1) / 0.1) / 3;
  return 0.35 + 0.65 * Math.min(1, Math.max(0, x));
}
