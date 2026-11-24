// Odtworzenie trajektorii z gotowego zdarzenia (np. przesłanego z workera) – bez RNG.
// Czas rozpadu = czas wierzchołka córek; reszta jak w propagacji. Wynik identyczny z propagate().

import { tryParticle } from '../physics/particles';
import type { V3 } from '../physics/vec4';
import { stopSurface, type DetectorConfig } from './detector';
import { F, p4Of, STRIDE, type SimEvent } from './event';
import { buildTrajectory, Trajectory, type Segment } from './helix';

export function rebuildTracks(ev: SimEvent, det: DetectorConfig, tCap = 40): (Trajectory | null)[] {
  const d = ev.data;
  const g = (i: number, f: number) => d[i * STRIDE + f];
  const tracks: (Trajectory | null)[] = new Array(ev.size).fill(null);
  for (let i = 1; i < ev.size; i++) {
    const status = g(i, F.status);
    const d1 = g(i, F.daughter1);
    const vertex: [number, number, number, number] = [g(i, F.x_mm), g(i, F.y_mm), g(i, F.z_mm), g(i, F.t_ns)];
    const p = p4Of(d, i);
    const id = g(i, F.id);
    if (status > 0 || status === -2) {
      // Cząstka śledzona przez propagację (końcowa lub rozpadnięta w detektorze).
      const charge = g(i, F.charge3) / 3;
      const stop = stopSurface(id, charge, det);
      const tDecay = status === -2 && d1 > 0 ? g(d1, F.t_ns) : Infinity;
      tracks[i] = buildTrajectory({ p, charge, vertex, B_T: det.B_T, field: det.solenoid, stop: stop.c, stopReason: stop.reason, tDecay, tCap });
    } else if (d1 > 0 && status < 0 && !isBeamOrParton(id, status)) {
      const t1 = g(d1, F.t_ns);
      if (t1 > vertex[3]) {
        const seg: Segment = { t0: vertex[3], t1, x0: [vertex[0], vertex[1], vertex[2]] as V3, p0: p, omega: 0 };
        tracks[i] = new Trajectory([seg], 'decay');
      }
    }
  }
  return tracks;
}

function isBeamOrParton(id: number, status: number): boolean {
  return status === -12 || status === -11 || !tryParticle(id) || Math.abs(id) <= 8 || id === 21;
}
