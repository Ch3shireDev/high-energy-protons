// Ustawienia Pythii dla trybu pp. Wymuszone rozpady (V → μ⁺μ⁻) są kompensowane wagą
// = iloczyn BR z data/ (te same liczby, których używa Pythia).

import { particle } from './particles';

export const PP_COMMON = [
  'Beams:idA = 2212',
  'Beams:idB = 2212',
  'Beams:eCM = 13600.',
  // Pythia rozpada tylko krótko żyjące (cτ < 10 mm); K⁰S, Λ, π±, K± itd. rozpada nasz silnik
  // w detektorze (te same dane), z wierzchołkami na helisach.
  'ParticleDecays:limitTau0 = on',
  'ParticleDecays:tau0Max = 10.',
  'Print:quiet = on',
];

export interface PPPreset {
  key: string;
  label: string;
  note: string;
  settings: string[];
  /** Cząstki z wymuszonym kanałem μ⁺μ⁻ – waga zdarzenia = Π BR. */
  forcedMuMu: number[];
}

const force = (ids: number[]) => ids.flatMap((id) => [`${id}:onMode = off`, `${id}:onIfMatch = 13 -13`]);

export const PP_PRESETS: PPPreset[] = [
  { key: 'minbias', label: 'Minimum bias (SoftQCD:inelastic)', note: 'Typowe zderzenie – głównie miękkie hadrony.', settings: ['SoftQCD:inelastic = on'], forcedMuMu: [] },
  { key: 'hardqcd', label: 'Jety QCD, p̂T > 30 GeV', note: 'Dwa (lub więcej) jety z twardego rozpraszania partonów.', settings: ['HardQCD:all = on', 'PhaseSpace:pTHatMin = 30.'], forcedMuMu: [] },
  { key: 'zmumu', label: 'Z/γ* → μ⁺μ⁻', note: 'Drell–Yan; dwa twarde miony do komór mionowych.', settings: ['WeakSingleBoson:ffbar2gmZ = on', '23:onMode = off', '23:onIfAny = 13', 'PhaseSpace:mHatMin = 60.'], forcedMuMu: [] },
  { key: 'ttbar', label: 'tt̄', note: 't → W b; leptony, jety b, odsunięte wierzchołki.', settings: ['Top:all = on'], forcedMuMu: [] },
  { key: 'hgg', label: 'H → γγ (gg → H)', note: 'Higgs rozpadający się na dwa fotony (wymuszony kanał).', settings: ['HiggsSM:gg2H = on', '25:onMode = off', '25:onIfMatch = 22 22'], forcedMuMu: [] },
  { key: 'onia', label: 'Kwarkonia → μ⁺μ⁻', note: 'Prompt J/ψ, ψ(2S), Υ z wymuszonym rozpadem na miony.', settings: ['Charmonium:all = on', 'Bottomonium:all = on', 'PhaseSpace:pTHatMin = 2.', ...force([443, 100443, 553, 100553, 200553])], forcedMuMu: [443, 100443, 553, 100553, 200553] },
];

/** Strumienie widma dimionowego (etap 5). Każdy w osobnym workerze, łączone wagą σ/N. */
export const DIMUON_STREAMS: PPPreset[] = [
  { key: 'mu-soft', label: 'miękkie QCD: ρ, ω, φ → μμ', note: '', settings: ['SoftQCD:nonDiffractive = on', ...force([113, 223, 333])], forcedMuMu: [113, 223, 333] },
  { key: 'mu-charm', label: 'charmonium: J/ψ, ψ(2S) → μμ', note: '', settings: ['Charmonium:all = on', 'PhaseSpace:pTHatMin = 2.', ...force([443, 100443])], forcedMuMu: [443, 100443] },
  { key: 'mu-bottom', label: 'bottomonium: Υ(nS) → μμ', note: '', settings: ['Bottomonium:all = on', 'PhaseSpace:pTHatMin = 2.', ...force([553, 100553, 200553])], forcedMuMu: [553, 100553, 200553] },
  { key: 'mu-dy', label: 'Drell–Yan γ*/Z → μμ, m > 12 GeV', note: '', settings: ['WeakSingleBoson:ffbar2gmZ = on', '23:onMode = off', '23:onIfAny = 13', 'PhaseSpace:mHatMin = 12.'], forcedMuMu: [] },
];

export function presetByKey(key: string): PPPreset {
  const p = [...PP_PRESETS, ...DIMUON_STREAMS].find((x) => x.key === key);
  if (!p) throw new Error(`nieznany preset ${key}`);
  return p;
}

/** BR(id → μ⁺μ⁻) z data/. */
export function brMuMu(id: number): number {
  return particle(id)
    .channels.filter((c) => c.products.length === 2 && c.products.includes(13) && c.products.includes(-13))
    .reduce((s, c) => s + c.br, 0);
}
