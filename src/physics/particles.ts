// Tablica cząstek z data/particles.json (generowane z ParticleData.xml Pythii).
// Antycząstki (id < 0) są wyprowadzane: ładunek i produkty kanałów sprzężone.

import raw from '../../data/particles.json';
import { HBARC_GEV_MM } from './units';

export interface Channel {
  br: number;
  products: number[];
  meMode?: number;
  onMode?: number;
}

interface RawParticle {
  id: number;
  name: string;
  antiName?: string;
  spinType: number;
  chargeType: number;
  colType: number;
  m0: number;
  mWidth?: number;
  mMin?: number;
  mMax?: number;
  tau0_mm?: number;
  channels?: Channel[];
}

export interface ParticleInfo {
  id: number;
  name: string;
  /** 2s+1 (Pythia spinType); 0 = nieokreślony. */
  spinType: number;
  /** Ładunek w jednostkach e. */
  charge: number;
  colType: number;
  m0: number;
  width: number;
  mMin: number;
  mMax: number;
  /** cτ w mm; Infinity = stabilna. */
  ctau_mm: number;
  hasAnti: boolean;
  /** Kanały włączone dla tej (anty)cząstki, produkty już sprzężone. */
  channels: Channel[];
}

const RAW = (raw as unknown as { particles: Record<string, RawParticle> }).particles;
export const DATA_SOURCE = (raw as unknown as { source: { pythiaVersion: string } }).source;

const cache = new Map<number, ParticleInfo | null>();

/** Kod PDG partonu lub pseudo-cząstki Pythii (kwarki, gluon, kody 81–99). */
export function isParton(id: number): boolean {
  const a = Math.abs(id);
  return (a >= 1 && a <= 8) || a === 21 || (a >= 81 && a <= 99);
}

export function hasAntiparticle(id: number): boolean {
  return Boolean(RAW[Math.abs(id)]?.antiName);
}

export function conjugate(id: number): number {
  return hasAntiparticle(id) ? -id : id;
}

export function particle(id: number): ParticleInfo {
  const p = tryParticle(id);
  if (!p) throw new Error(`brak cząstki ${id} w data/particles.json`);
  return p;
}

export function tryParticle(id: number): ParticleInfo | null {
  if (cache.has(id)) return cache.get(id)!;
  const r = RAW[Math.abs(id)];
  let info: ParticleInfo | null = null;
  if (r && (id > 0 || r.antiName)) {
    const anti = id < 0;
    const width = r.mWidth ?? 0;
    let ctau = Infinity;
    if (r.tau0_mm !== undefined && r.tau0_mm > 0) ctau = r.tau0_mm;
    else if (width > 0) ctau = HBARC_GEV_MM / width;
    const channels = (r.channels ?? [])
      .filter((c) => {
        const on = c.onMode ?? 1;
        // Pythia: 0 = wył., 1 = wł., 2 = tylko cząstka, 3 = tylko antycząstka.
        return on === 1 || (on === 2 && !anti) || (on === 3 && anti);
      })
      .filter((c) => c.br > 0)
      .map((c) => (anti ? { ...c, products: c.products.map(conjugate) } : c));
    info = {
      id,
      name: anti ? r.antiName! : r.name,
      spinType: r.spinType,
      charge: ((anti ? -1 : 1) * r.chargeType) / 3,
      colType: anti ? -r.colType : r.colType,
      m0: r.m0,
      width,
      mMin: r.mMin ?? 0,
      mMax: r.mMax ?? 0,
      ctau_mm: ctau,
      hasAnti: Boolean(r.antiName),
      channels,
    };
  }
  cache.set(id, info);
  return info;
}

/** Cząstka rozpada się (ma skończone cτ i kanały rozpadu). */
export function isUnstable(id: number): boolean {
  const p = tryParticle(id);
  return Boolean(p && Number.isFinite(p.ctau_mm) && p.channels.length > 0);
}

/** Kanał bez partonów – da się go rozpaść bez hadronizacji. */
export function isExplicitChannel(c: Channel): boolean {
  return c.products.every((id) => !isParton(id) && tryParticle(id) !== null);
}

export function allIds(): number[] {
  return Object.keys(RAW).map(Number);
}

export function displayName(id: number): string {
  return tryParticle(id)?.name ?? String(id);
}
