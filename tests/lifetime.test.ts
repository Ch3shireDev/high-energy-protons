// Bramka etapu 1: średnia droga rozpadu = βγcτ w granicach błędu statystycznego.
import { describe, expect, it } from 'vitest';
import { particle } from '../src/physics/particles';
import { type DetectorConfig, DEFAULT_DETECTOR } from '../src/sim/detector';
import { EventBuilder } from '../src/sim/event';
import { propagate } from '../src/sim/propagate';
import { Rng } from '../src/sim/rng';

// Detektor „nieskończony”, żeby nic nie zatrzymało cząstki przed rozpadem.
const BIG: DetectorConfig = {
  ...DEFAULT_DETECTOR,
  B_T: 0,
  ecal: { r_mm: 1e12, halfZ_mm: 1e12 },
  hcal: { r_mm: 1e12, halfZ_mm: 1e12 },
  world: { r_mm: 1e12, halfZ_mm: 1e12 },
  muon: { inner: { r_mm: 1e12, halfZ_mm: 1e12 }, outer: { r_mm: 1e12, halfZ_mm: 1e12 } },
};

describe('droga rozpadu', () => {
  it.each([
    [310, 2.0],
    [3122, 5.0],
    [-211, 1.0],
  ])('średnia droga %i przy p = %f GeV = βγcτ', (id, p) => {
    const info = particle(id);
    const m = info.m0;
    const E = Math.hypot(p, m);
    const expected = (p / m) * info.ctau_mm; // βγcτ
    const N = 100_000;
    const rng = new Rng(77 + id);
    let sum = 0;
    let n = 0;
    for (let k = 0; k < N; k++) {
      const b = new EventBuilder(8);
      b.push({ id, status: 1, p: [p, 0, 0, E], m, charge3: Math.round(info.charge * 3) });
      const pe = propagate(b.finish({ source: 'ts', toy: false, process: 'test', sqrtS: E, seed: k, weight: 1 }), {
        det: BIG,
        rng,
        tCap_ns: 1e9,
      });
      const d = pe.decays.find((x) => x.parent === 1);
      if (!d) continue;
      sum += Math.hypot(d.vertex[0], d.vertex[1], d.vertex[2]);
      n++;
    }
    expect(n).toBe(N);
    const mean = sum / n;
    const err = expected / Math.sqrt(n); // σ rozkładu wykładniczego = średnia
    expect(Math.abs(mean - expected)).toBeLessThan(4 * err);
  });
});
