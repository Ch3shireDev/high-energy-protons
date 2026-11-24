// Stan w URL: link = tryb + ustawienia + seed + numer zdarzenia (+ re-roll).

export interface UrlState {
  m?: 'ee' | 'pp';
  rs?: number; // √s e⁺e⁻ [GeV]
  sp?: number; // rozrzut względny
  seed?: number;
  ev?: number;
  rr?: number;
  pr?: string; // preset pp
}

export function readUrl(): UrlState {
  const q = new URLSearchParams(location.search);
  const num = (k: string) => (q.has(k) && q.get(k) !== '' && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const m = q.get('m');
  return {
    m: m === 'pp' || m === 'ee' ? m : undefined,
    rs: num('rs'),
    sp: num('sp'),
    seed: num('seed'),
    ev: num('ev'),
    rr: num('rr'),
    pr: q.get('pr') ?? undefined,
  };
}

export function writeUrl(s: UrlState): void {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null) q.set(k, String(v));
  history.replaceState(null, '', `${location.pathname}?${q}`);
}
