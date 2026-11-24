// Bramka etapu 1: cos θ zgodny z teorią (χ², ≥ 10⁵ zdarzeń).
import { describe, expect, it } from 'vitest';
import { chi2Test } from '../src/analysis/stats';
import { cdf } from '../src/physics/angular';
import { decay } from '../src/physics/decay';
import { afb, generateEE, gmZ } from '../src/physics/ee';
import { particle } from '../src/physics/particles';
import { boostToRest, cosTheta, type P4 } from '../src/physics/vec4';
import { F, p4Of, STRIDE } from '../src/sim/event';
import { Rng } from '../src/sim/rng';

const N = 100_000;
const NB = 40;
const edges = Array.from({ length: NB + 1 }, (_, i) => -1 + (2 * i) / NB);

function hist(values: Float64Array): Float64Array {
  const h = new Float64Array(NB);
  for (const c of values) h[Math.min(NB - 1, Math.floor(((c + 1) / 2) * NB))]++;
  return h;
}

function muonCos(sqrtS: number, seed: number): Float64Array {
  const rng = new Rng(seed);
  const out = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const g = generateEE({ sqrtS, spreadRel: 0, seed, filter: (p) => p.key === 'ff:13' }, rng)!;
    const d = g.event.data;
    for (let i = 0; i < g.event.size; i++) {
      if (d[i * STRIDE + F.id] === 13) out[n] = cosTheta(p4Of(d, i));
    }
  }
  return out;
}

describe('rozkłady kątowe', () => {
  it('e⁺e⁻ → μ⁺μ⁻ daleko od Z (√s = 10 GeV): 1 + cos²θ', () => {
    const h = hist(muonCos(10, 101));
    const t = gmZ(10, 13);
    // Daleko od Z wkład interferencji jest mały, ale niezerowy – porównujemy z czystym 1+cos²θ
    // i sprawdzamy, że |A_FB| jest pomijalne na poziomie statystyki.
    expect(Math.abs(afb(t))).toBeLessThan(0.01);
    const r = chi2Test(h, edges, (c) => cdf({ kind: 'tla', tla: { T: 1, L: 0, A: 0 } }, c));
    expect(r.p).toBeGreaterThan(1e-3);
  });

  it('e⁺e⁻ → μ⁺μ⁻ przy Z: 1 + cos²θ + (8/3)·A_FB·cosθ; A_FB < 0 poniżej, > 0 powyżej piku', () => {
    const mZ = particle(23).m0;
    for (const [sqrtS, sign] of [
      [mZ - 3, -1],
      [mZ + 3, 1],
    ] as const) {
      const t = gmZ(sqrtS, 13);
      const A = afb(t);
      expect(Math.sign(A)).toBe(sign);
      const vals = muonCos(sqrtS, 200 + sign);
      const r = chi2Test(hist(vals), edges, (c) => cdf({ kind: 'tla', tla: t }, c));
      expect(r.p).toBeGreaterThan(1e-3);
      // A_FB zmierzone = teoria w granicach błędu.
      let F_ = 0;
      for (const c of vals) if (c > 0) F_++;
      const Ameas = (2 * F_ - N) / N;
      expect(Math.abs(Ameas - A)).toBeLessThan(4 / Math.sqrt(N));
      // Wzór z CLAUDE.md: dσ/dcos ∝ 1 + cos² + (8/3)·A_FB·cos (dla L ≈ 0).
      const r2 = chi2Test(hist(vals), edges, (c) => cdf({ kind: 'tla', tla: { T: 1, L: 0, A: (4 / 3) * A } }, c));
      expect(r2.p).toBeGreaterThan(1e-3);
    }
  });

  it('e⁺e⁻ → φ → K⁺K⁻: sin²θ', () => {
    const rng = new Rng(303);
    const phi = particle(333);
    const ch = phi.channels.find((c) => c.products.includes(321) && c.products.includes(-321))!;
    const out = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      // φ w spoczynku, poprzecznie spolaryzowany wzdłuż wiązki (jak z e⁺e⁻).
      const P: P4 = [0, 0, 0, phi.m0];
      const r = decay(333, P, rng, { axis: [0, 0, 1], transverseVector: true }, ch)!;
      const kp = r.products.find((x) => x.id === 321)!;
      out[n] = cosTheta(boostToRest(kp.p, P));
    }
    const r = chi2Test(hist(out), edges, (c) => cdf({ kind: 'sin2' }, c));
    expect(r.p).toBeGreaterThan(1e-3);
    // I wyraźnie NIE izotropowy.
    const iso = chi2Test(hist(out), edges, (c) => cdf({ kind: 'isotropic' }, c));
    expect(iso.p).toBeLessThan(1e-10);
  });
});
