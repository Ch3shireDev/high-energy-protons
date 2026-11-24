// Uproszczony detektor cylindryczny (geometria w mm, pole w T). Model, nie dane cząstek.
// Solenoid z jednorodnym polem B wzdłuż z wewnątrz r < solenoid.r_mm, poza nim B = 0.

export interface Cylinder {
  r_mm: number;
  halfZ_mm: number;
}

export interface DetectorConfig {
  B_T: number;
  /** Obszar pola (wnętrze solenoidu). */
  solenoid: Cylinder;
  tracker: Cylinder;
  ecal: Cylinder; // powierzchnia wejściowa – tu kończą e±, γ
  hcal: Cylinder; // tu kończą hadrony
  muon: { inner: Cylinder; outer: Cylinder }; // komory mionowe
  world: Cylinder; // tu kończą neutrina
  /** Rozdzielczość pędu toru: σ(pT)/pT = a ⊕ b·pT[GeV]. */
  resolution: { a: number; b: number };
  /** Akceptacja mionów: |η| < etaMax, p > pMin [GeV]. */
  muonAcceptance: { etaMax: number; pMin: number; pTMin: number };
}

/** Domyślna geometria – proporcje w stylu dużego detektora LHC (CMS-podobnego). */
export const DEFAULT_DETECTOR: DetectorConfig = {
  B_T: 3.8,
  solenoid: { r_mm: 2950, halfZ_mm: 6000 },
  tracker: { r_mm: 1100, halfZ_mm: 2700 },
  ecal: { r_mm: 1290, halfZ_mm: 3150 },
  hcal: { r_mm: 1800, halfZ_mm: 3900 },
  muon: { inner: { r_mm: 4000, halfZ_mm: 6600 }, outer: { r_mm: 7400, halfZ_mm: 10500 } },
  world: { r_mm: 7500, halfZ_mm: 11000 },
  resolution: { a: 0.01, b: 0.00015 },
  muonAcceptance: { etaMax: 2.4, pMin: 3, pTMin: 0.5 },
};

export type EndReason = 'decay' | 'ecal' | 'hcal' | 'muon' | 'world' | 'loop';

/** Gdzie kończy się tor danego typu cząstki (bez strat energii – model warstwowy). */
export function stopSurface(id: number, charge: number, det: DetectorConfig): { c: Cylinder; reason: EndReason } {
  const a = Math.abs(id);
  if (a === 12 || a === 14 || a === 16) return { c: det.world, reason: 'world' };
  if (a === 13) return { c: det.muon.outer, reason: 'muon' };
  if (a === 11 || a === 22) return { c: det.ecal, reason: 'ecal' };
  void charge;
  return { c: det.hcal, reason: 'hcal' };
}
