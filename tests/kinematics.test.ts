import { describe, expect, it } from 'vitest';
import { phaseSpace } from '../src/physics/phasespace';
import { boost, boostFromRest, boostToRest, mass, sum, twoBodyMomentum, type P4 } from '../src/physics/vec4';
import { Rng } from '../src/sim/rng';

const close = (a: P4, b: P4, tol = 1e-9) => a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(tol * Math.max(1, Math.abs(b[i]))));

describe('czterowektory i boosty', () => {
  it('boost zachowuje masę i jest odwracalny', () => {
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      const v: P4 = [r.range(-5, 5), r.range(-5, 5), r.range(-5, 5), 0];
      v[3] = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2 + 0.3 ** 2);
      const b: [number, number, number] = [r.range(-0.5, 0.5), r.range(-0.5, 0.5), r.range(-0.5, 0.5)];
      const w = boost(v, b);
      expect(mass(w)).toBeCloseTo(0.3, 9);
      close(boost(w, [-b[0], -b[1], -b[2]]), v);
    }
  });

  it('boost do spoczynku daje (0,0,0,M)', () => {
    const P: P4 = [1, 2, 3, Math.sqrt(14 + 9)];
    close(boostToRest(P, P), [0, 0, 0, 3]);
    close(boostFromRest([0, 0, 0, 3], P), P);
  });

  it('pęd 2-ciałowy (Källén)', () => {
    expect(twoBodyMomentum(1, 0, 0)).toBeCloseTo(0.5, 12);
    expect(twoBodyMomentum(1, 0.6, 0.5)).toBe(0);
  });

  it('przestrzeń fazowa: masy na powłoce i zachowanie czteropędu', () => {
    const r = new Rng(11);
    const ms = [0.13957, 0.13957, 0.13498, 0.493677];
    for (let i = 0; i < 2000; i++) {
      const ps = phaseSpace(2.0, ms, r)!;
      ps.forEach((p, k) => expect(mass(p)).toBeCloseTo(ms[k], 8));
      close(sum(ps), [0, 0, 0, 2.0]);
    }
  });

  it('3-ciałowa przestrzeń fazowa: płaski Dalitz (rzut m²₁₂ zgodny z analitycznym)', () => {
    // Dla jednorodnej PS gęstość m²₁₂ ∝ długość pasma Dalitza w m²₂₃.
    const r = new Rng(12);
    const M = 1.0;
    const m = [0.1, 0.1, 0.1];
    const N = 100_000;
    const nb = 20;
    const lo = (m[0] + m[1]) ** 2;
    const hi = (M - m[2]) ** 2;
    const h = new Float64Array(nb);
    for (let i = 0; i < N; i++) {
      const p = phaseSpace(M, m, r)!;
      const m12 = mass(sum([p[0], p[1]])) ** 2;
      h[Math.min(nb - 1, Math.floor(((m12 - lo) / (hi - lo)) * nb))]++;
    }
    const band = (s12: number) => {
      const E2 = (s12 - m[0] ** 2 + m[1] ** 2) / (2 * Math.sqrt(s12));
      const E3 = (M * M - s12 - m[2] ** 2) / (2 * Math.sqrt(s12));
      const p2 = Math.sqrt(Math.max(0, E2 * E2 - m[1] ** 2));
      const p3 = Math.sqrt(Math.max(0, E3 * E3 - m[2] ** 2));
      return 4 * p2 * p3;
    };
    const exp: number[] = [];
    for (let i = 0; i < nb; i++) {
      let s = 0;
      for (let k = 0; k < 50; k++) s += band(lo + ((i + (k + 0.5) / 50) / nb) * (hi - lo));
      exp.push(s);
    }
    const tot = exp.reduce((a, b) => a + b, 0);
    let chi2 = 0;
    for (let i = 0; i < nb; i++) {
      const e = (exp[i] / tot) * N;
      chi2 += (h[i] - e) ** 2 / e;
    }
    expect(chi2 / (nb - 1)).toBeLessThan(2.5);
  });
});
