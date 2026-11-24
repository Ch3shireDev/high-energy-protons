// Trajektorie liczone analitycznie: helisa w jednorodnym polu B ∥ z, prosta poza polem.
// Pozycja i pęd w dowolnej chwili t bez całkowania krok po kroku – scrubbing w tył
// kosztuje tyle samo, co w przód.
//
// Prędkość kątowa w polu: Ω = −q·B·κ·c / E   [rad/ns], κ = 0.2998 GeV/(T·m), c w m/ns.
// Promień: R[m] = pT[GeV] / (κ·|q|·B[T]).

import { C_MM_PER_NS, C_M_PER_NS, KAPPA_GEV_PER_T_M } from '../physics/units';
import type { P4, V3 } from '../physics/vec4';
import type { Cylinder, EndReason } from './detector';

export interface Segment {
  t0: number;
  t1: number;
  x0: V3; // mm
  p0: P4; // GeV, pęd na początku segmentu
  /** Prędkość kątowa [rad/ns]; 0 = prosta. */
  omega: number;
}

export function angularVelocity(charge: number, E: number, B_T: number): number {
  if (charge === 0 || B_T === 0) return 0;
  return (-charge * B_T * KAPPA_GEV_PER_T_M * C_M_PER_NS) / E;
}

/** Promień helisy [mm] wg ściągawki: r[m] = pT / (0.3·|q|·B). */
export function helixRadius_mm(pT: number, charge: number, B_T: number): number {
  return (pT / (KAPPA_GEV_PER_T_M * Math.abs(charge) * B_T)) * 1000;
}

export function segPosition(s: Segment, t: number, out: V3 = [0, 0, 0]): V3 {
  const tau = t - s.t0;
  const k = C_MM_PER_NS / s.p0[3]; // v = p/E · c
  const vx = s.p0[0] * k;
  const vy = s.p0[1] * k;
  const vz = s.p0[2] * k;
  const w = s.omega;
  const a = w * tau;
  if (Math.abs(a) < 1e-7) {
    // Rozwinięcie dla małego kąta (i prostej).
    out[0] = s.x0[0] + vx * tau - 0.5 * vy * w * tau * tau;
    out[1] = s.x0[1] + vy * tau + 0.5 * vx * w * tau * tau;
  } else {
    const sn = Math.sin(a);
    const cm1 = Math.cos(a) - 1;
    out[0] = s.x0[0] + (vx * sn + vy * cm1) / w;
    out[1] = s.x0[1] + (-vx * cm1 + vy * sn) / w;
  }
  out[2] = s.x0[2] + vz * tau;
  return out;
}

export function segMomentum(s: Segment, t: number): P4 {
  const a = s.omega * (t - s.t0);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return [s.p0[0] * c - s.p0[1] * sn, s.p0[0] * sn + s.p0[1] * c, s.p0[2], s.p0[3]];
}

export class Trajectory {
  constructor(
    public segments: Segment[],
    public endReason: EndReason,
  ) {}

  get tStart(): number {
    return this.segments[0].t0;
  }

  get tEnd(): number {
    return this.segments[this.segments.length - 1].t1;
  }

  private seg(t: number): Segment {
    const ss = this.segments;
    for (let i = 0; i < ss.length; i++) if (t <= ss[i].t1) return ss[i];
    return ss[ss.length - 1];
  }

  /** Pozycja [mm] w chwili t [ns] (przycięte do [tStart, tEnd]). */
  positionAt(t: number, out: V3 = [0, 0, 0]): V3 {
    const tc = Math.min(Math.max(t, this.tStart), this.tEnd);
    return segPosition(this.seg(tc), tc, out);
  }

  momentumAt(t: number): P4 {
    const tc = Math.min(Math.max(t, this.tStart), this.tEnd);
    return segMomentum(this.seg(tc), tc);
  }
}

const inside = (x: V3, c: Cylinder) => Math.hypot(x[0], x[1]) < c.r_mm && Math.abs(x[2]) < c.halfZ_mm;

/** Pierwsza chwila w (s.t0, tMax], w której segment opuszcza cylinder; Infinity jeśli nie opuszcza. */
export function exitTime(s: Segment, c: Cylinder, tMax: number): number {
  const x = s.x0;
  if (!inside(x, c)) return s.t0;
  const k = C_MM_PER_NS / s.p0[3];
  const vz = s.p0[2] * k;
  // Wyjście przez denka – liniowo w z.
  let tz = Infinity;
  if (vz > 0) tz = s.t0 + (c.halfZ_mm - x[2]) / vz;
  else if (vz < 0) tz = s.t0 + (-c.halfZ_mm - x[2]) / vz;
  const tLim = Math.min(tz, tMax);

  const vx = s.p0[0] * k;
  const vy = s.p0[1] * k;
  let tr = Infinity;
  if (s.omega === 0) {
    // Prosta: |x0 + v τ|_T = r.
    const a = vx * vx + vy * vy;
    if (a > 0) {
      const b = 2 * (x[0] * vx + x[1] * vy);
      const cc = x[0] * x[0] + x[1] * x[1] - c.r_mm * c.r_mm;
      const disc = b * b - 4 * a * cc;
      if (disc >= 0) tr = s.t0 + (-b + Math.sqrt(disc)) / (2 * a);
    }
  } else {
    // Helisa: środek okręgu i promień; jeśli okrąg nie sięga r – brak wyjścia bokiem.
    const w = s.omega;
    const R = Math.hypot(vx, vy) / Math.abs(w);
    const xc = x[0] - vy / w;
    const yc = x[1] + vx / w;
    const d = Math.hypot(xc, yc);
    if (d + R >= c.r_mm) {
      const period = (2 * Math.PI) / Math.abs(w);
      const tSearch = Math.min(tLim, s.t0 + period);
      const n = 256;
      const dt = (tSearch - s.t0) / n;
      const p: V3 = [0, 0, 0];
      const r2 = (t: number) => {
        segPosition(s, t, p);
        return p[0] * p[0] + p[1] * p[1] - c.r_mm * c.r_mm;
      };
      let tPrev = s.t0;
      for (let i = 1; i <= n; i++) {
        const t = s.t0 + i * dt;
        if (r2(t) >= 0) {
          let lo = tPrev;
          let hi = t;
          for (let j = 0; j < 60; j++) {
            const mid = 0.5 * (lo + hi);
            if (r2(mid) >= 0) hi = mid;
            else lo = mid;
          }
          tr = hi;
          break;
        }
        tPrev = t;
      }
    }
  }
  const t = Math.min(tr, tz);
  return t <= tMax ? t : Infinity;
}

export interface TrajectoryInput {
  p: P4;
  charge: number;
  vertex: [number, number, number, number]; // x, y, z [mm], t [ns]
  B_T: number;
  field: Cylinder;
  stop: Cylinder;
  stopReason: EndReason;
  /** Chwila rozpadu w LAB [ns] (Infinity = stabilna). */
  tDecay: number;
  /** Maksymalny czas śledzenia (pętle w polu). */
  tCap: number;
}

/** Buduje trajektorię: segment w polu (helisa), potem prosta poza polem, do rozpadu/zatrzymania. */
export function buildTrajectory(o: TrajectoryInput): Trajectory {
  const t0 = o.vertex[3];
  const x0: V3 = [o.vertex[0], o.vertex[1], o.vertex[2]];
  const tLimit = Math.min(o.tDecay, t0 + o.tCap);
  const segs: Segment[] = [];

  const inField = inside(x0, o.field) && o.B_T !== 0 && o.charge !== 0;
  let seg: Segment = { t0, t1: Infinity, x0, p0: o.p, omega: inField ? angularVelocity(o.charge, o.p[3], o.B_T) : 0 };

  const tStop = exitTime(seg, o.stop, tLimit);
  if (inField) {
    const tField = exitTime(seg, o.field, tLimit);
    if (tField < tStop) {
      // Opuszcza pole przed zatrzymaniem – dalej prosto.
      seg.t1 = tField;
      segs.push(seg);
      const xf = segPosition(seg, tField);
      const pf = segMomentum(seg, tField);
      seg = { t0: tField, t1: Infinity, x0: xf, p0: pf, omega: 0 };
      const t2 = exitTime(seg, o.stop, tLimit);
      return finish(segs, seg, t2, tLimit, o);
    }
  }
  return finish(segs, seg, tStop, tLimit, o);
}

function finish(segs: Segment[], seg: Segment, tStop: number, tLimit: number, o: TrajectoryInput): Trajectory {
  let reason: EndReason;
  if (tStop <= tLimit && tStop < Infinity) {
    seg.t1 = tStop;
    reason = o.stopReason;
  } else if (o.tDecay <= tLimit) {
    seg.t1 = o.tDecay;
    reason = 'decay';
  } else {
    seg.t1 = tLimit;
    reason = 'loop';
  }
  segs.push(seg);
  return new Trajectory(segs, reason);
}
