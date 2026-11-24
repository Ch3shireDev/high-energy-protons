// Stałe uniwersalne i konwersje jednostek. Żadnych stałych cząstek – te są w data/.
// Wewnętrznie: GeV, mm, ns, T.

/** Prędkość światła [mm/ns]. */
export const C_MM_PER_NS = 299.792458;
/** Prędkość światła [m/ns]. */
export const C_M_PER_NS = 0.299792458;
/** ħc [GeV·mm] – do zamiany szerokości Γ na cτ. */
export const HBARC_GEV_MM = 1.973269804e-13;
/** (ħc)² [nb·GeV²] – zamiana GeV⁻² na nb. */
export const GEV2_TO_NB = 389379.3721;
/** Stała w r[m] = pT[GeV] / (KAPPA · |q| · B[T]). */
export const KAPPA_GEV_PER_T_M = 0.299792458;
/** Sekundy na ns. */
export const S_PER_NS = 1e-9;
