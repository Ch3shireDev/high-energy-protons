// Wspólny format zdarzenia – identyczny dla generatora TS i Pythii w WASM (wasm/wrapper.cpp).
// Płaski Float64Array, STRIDE liczb na wpis. Indeks 0 = wpis „system” (jak w Pythii).

export const STRIDE = 16;
export const F = {
  id: 0,
  status: 1,
  mother1: 2,
  mother2: 3,
  daughter1: 4,
  daughter2: 5,
  px: 6,
  py: 7,
  pz: 8,
  e: 9,
  m: 10,
  x_mm: 11,
  y_mm: 12,
  z_mm: 13,
  t_ns: 14,
  charge3: 15,
} as const;

export interface EventMeta {
  source: 'ts' | 'pythia';
  /** Model zabawkowy (jety bez Pythii) – UI musi to pokazać. */
  toy: boolean;
  process: string;
  /** √s użyte w tym zdarzeniu [GeV] (po rozrzucie wiązki). */
  sqrtS: number;
  seed: number;
  /** Waga statystyczna (np. wymuszone rozpady w pp). */
  weight: number;
  /** Indeks wpisu-rezonansu, którego rozpad pokazuje aureola. */
  focus?: number;
}

export interface SimEvent {
  data: Float64Array;
  size: number;
  meta: EventMeta;
}

/** Budowniczy zdarzenia z rosnącym buforem. */
export class EventBuilder {
  data: Float64Array;
  size = 0;

  constructor(capacity = 64) {
    this.data = new Float64Array(capacity * STRIDE);
    this.push({ id: 90, status: -11, p: [0, 0, 0, 0], m: 0 }); // wpis „system”
  }

  push(o: {
    id: number;
    status: number;
    p: [number, number, number, number];
    m: number;
    mothers?: [number, number];
    v?: [number, number, number, number];
    charge3?: number;
  }): number {
    if ((this.size + 1) * STRIDE > this.data.length) {
      const d = new Float64Array(this.data.length * 2);
      d.set(this.data);
      this.data = d;
    }
    const i = this.size++;
    const b = i * STRIDE;
    const d = this.data;
    d[b + F.id] = o.id;
    d[b + F.status] = o.status;
    d[b + F.mother1] = o.mothers?.[0] ?? 0;
    d[b + F.mother2] = o.mothers?.[1] ?? 0;
    d[b + F.daughter1] = 0;
    d[b + F.daughter2] = 0;
    d[b + F.px] = o.p[0];
    d[b + F.py] = o.p[1];
    d[b + F.pz] = o.p[2];
    d[b + F.e] = o.p[3];
    d[b + F.m] = o.m;
    d[b + F.x_mm] = o.v?.[0] ?? 0;
    d[b + F.y_mm] = o.v?.[1] ?? 0;
    d[b + F.z_mm] = o.v?.[2] ?? 0;
    d[b + F.t_ns] = o.v?.[3] ?? 0;
    d[b + F.charge3] = o.charge3 ?? 0;
    return i;
  }

  setDaughters(i: number, d1: number, d2: number): void {
    this.data[i * STRIDE + F.daughter1] = d1;
    this.data[i * STRIDE + F.daughter2] = d2;
  }

  setStatus(i: number, s: number): void {
    this.data[i * STRIDE + F.status] = s;
  }

  get(i: number, f: number): number {
    return this.data[i * STRIDE + f];
  }

  finish(meta: EventMeta): SimEvent {
    // Wpis „system”: suma czteropędu stanu początkowego = całkowity (jak w Pythii).
    return { data: this.data.slice(0, this.size * STRIDE), size: this.size, meta };
  }

  static from(ev: SimEvent): EventBuilder {
    const b = new EventBuilder(Math.max(ev.size * 2, 64));
    b.data.set(ev.data);
    b.size = ev.size;
    return b;
  }
}

export const fieldOf = (ev: SimEvent, i: number, f: number) => ev.data[i * STRIDE + f];
export const p4Of = (data: Float64Array, i: number): [number, number, number, number] => {
  const b = i * STRIDE;
  return [data[b + F.px], data[b + F.py], data[b + F.pz], data[b + F.e]];
};
export const isFinal = (data: Float64Array, i: number) => data[i * STRIDE + F.status] > 0;
