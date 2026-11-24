// Propagacja zdarzenia przez detektor: trajektorie analityczne + rozpady wg cτ z data/.
// Działa tak samo na zdarzeniach z generatora TS i z Pythii (wspólny format).

import { decay, type DecayHint, type DecayResult } from '../physics/decay';
import { tryParticle } from '../physics/particles';
import { C_MM_PER_NS } from '../physics/units';
import type { P4, V3 } from '../physics/vec4';
import type { DetectorConfig } from './detector';
import { stopSurface } from './detector';
import { EventBuilder, F, STRIDE, p4Of, type SimEvent } from './event';
import { buildTrajectory, Segment, Trajectory } from './helix';
import type { Rng } from './rng';

export interface DecayRecord {
  parent: number;
  daughters: [number, number];
  vertex: [number, number, number, number];
  /** Czteropęd rodzica w chwili rozpadu (LAB). */
  P: P4;
  result: DecayResult;
}

export interface PropagatedEvent {
  event: SimEvent;
  /** Trajektoria dla każdego wpisu (null = brak, np. wpis „system” lub wiązki). */
  tracks: (Trajectory | null)[];
  decays: DecayRecord[];
  /** Najwcześniejszy i najpóźniejszy czas zdarzenia [ns] – do osi czasu. */
  tMin: number;
  tMax: number;
}

export interface PropagateOptions {
  det: DetectorConfig;
  rng: Rng;
  hints?: Map<number, DecayHint>;
  /** Maks. czas śledzenia pętli w polu [ns]. */
  tCap_ns?: number;
}

export function propagate(ev: SimEvent, o: PropagateOptions): PropagatedEvent {
  const b = EventBuilder.from(ev);
  const tracks: (Trajectory | null)[] = [];
  const decays: DecayRecord[] = [];
  let toy = ev.meta.toy;
  const tCap = o.tCap_ns ?? 40;

  const queue: number[] = [];
  for (let i = 1; i < b.size; i++) {
    if (b.get(i, F.status) > 0) queue.push(i);
  }

  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    const id = b.get(i, F.id);
    const p = p4Of(b.data, i);
    const m = b.get(i, F.m);
    const charge = b.get(i, F.charge3) / 3;
    const vertex: [number, number, number, number] = [
      b.get(i, F.x_mm),
      b.get(i, F.y_mm),
      b.get(i, F.z_mm),
      b.get(i, F.t_ns),
    ];
    const info = tryParticle(id);
    let tDecay = Infinity;
    if (info && Number.isFinite(info.ctau_mm) && info.channels.length && m > 0) {
      const properLen_mm = info.ctau_mm * o.rng.exp();
      tDecay = vertex[3] + ((p[3] / m) * properLen_mm) / C_MM_PER_NS; // γ · τ
    }
    const stop = stopSurface(id, charge, o.det);
    const traj = buildTrajectory({
      p,
      charge,
      vertex,
      B_T: o.det.B_T,
      field: o.det.solenoid,
      stop: stop.c,
      stopReason: stop.reason,
      tDecay,
      tCap,
    });
    tracks[i] = traj;
    if (traj.endReason !== 'decay') continue;

    const P = traj.momentumAt(tDecay);
    // Energia z masy – pęd obrócony w polu, |p| bez zmian.
    const x = traj.positionAt(tDecay);
    const res = decay(id, P, o.rng, o.hints?.get(i));
    if (!res) {
      // Brak otwartego kanału przy tej masie – zostaje stabilna do końca.
      tracks[i] = buildTrajectory({ p, charge, vertex, B_T: o.det.B_T, field: o.det.solenoid, stop: stop.c, stopReason: stop.reason, tDecay: Infinity, tCap });
      continue;
    }
    toy ||= res.toy;
    const v: [number, number, number, number] = [x[0], x[1], x[2], tDecay];
    const first = b.size;
    for (const d of res.products) {
      const di = tryParticle(d.id);
      const j = b.push({
        id: d.id,
        status: 1,
        p: d.p,
        m: massOf(d.p),
        mothers: [i, i],
        v,
        charge3: Math.round((di?.charge ?? 0) * 3),
      });
      queue.push(j);
    }
    b.setStatus(i, -2);
    b.setDaughters(i, first, b.size - 1);
    decays.push({ parent: i, daughters: [first, b.size - 1], vertex: v, P, result: res });
  }

  // Wpisy już rozpadnięte w generatorze (np. przez Pythię): odcinek do wierzchołka córek.
  for (let i = 1; i < b.size; i++) {
    if (tracks[i] || b.get(i, F.status) > 0) continue;
    const d1 = b.get(i, F.daughter1);
    if (d1 <= 0) continue;
    const t0 = b.get(i, F.t_ns);
    const t1 = b.get(d1, F.t_ns);
    if (!(t1 > t0)) continue;
    const seg: Segment = {
      t0,
      t1,
      x0: [b.get(i, F.x_mm), b.get(i, F.y_mm), b.get(i, F.z_mm)] as V3,
      p0: p4Of(b.data, i),
      omega: 0,
    };
    tracks[i] = new Trajectory([seg], 'decay');
  }

  let tMin = Infinity;
  let tMax = 0;
  for (const t of tracks) {
    if (!t) continue;
    tMax = Math.max(tMax, t.tEnd);
    if (t.tEnd > t.tStart) tMin = Math.min(tMin, t.tEnd - t.tStart);
  }
  const event = b.finish({ ...ev.meta, toy });
  return { event, tracks, decays, tMin: Number.isFinite(tMin) ? tMin : 1e-18, tMax };
}

function massOf(p: P4): number {
  const q = p[3] * p[3] - p[0] * p[0] - p[1] * p[1] - p[2] * p[2];
  return q > 0 ? Math.sqrt(q) : 0;
}

export { STRIDE };
