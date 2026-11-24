// Bramka etapu 2: skan 2–100 GeV znajduje J/ψ, ψ(2S), Υ, Z na właściwych masach.
import { describe, expect, it } from 'vitest';
import { findPeaks, sigmaConvolved } from '../src/analysis/scan';
import { particle } from '../src/physics/particles';

describe('skan σ(√s) z rozrzutem wiązki', () => {
  it('piki na masach J/ψ, ψ(2S), Υ(1S), Υ(2S), Z', () => {
    const spread = 4e-4; // σ(√s)/√s
    const step = spread / 2; // krok skanu względny
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = 2; x <= 100; x *= 1 + step) {
      xs.push(x);
      ys.push(sigmaConvolved(x, spread));
    }
    const peaks = findPeaks(xs, ys, 1.15, 40);
    for (const id of [443, 100443, 553, 100553, 23]) {
      const M = particle(id).m0;
      const tol = Math.max(3 * spread * M, id === 23 ? 0.1 : 0);
      const hit = peaks.find((p) => Math.abs(p - M) < tol);
      expect(hit, `${particle(id).name} @ ${M} (piki: ${peaks.map((p) => p.toFixed(3)).join(', ')})`).toBeDefined();
    }
  });

  it('splot obniża i poszerza wąski pik J/ψ (Γ ≪ rozrzut)', () => {
    const M = particle(443).m0;
    const sharp = sigmaConvolved(M, 0);
    const smeared = sigmaConvolved(M, 4e-4);
    expect(smeared).toBeLessThan(sharp / 5);
    // Pole pod pikiem zachowane: ∫σ d√s niezależne od rozrzutu.
    const area = (spread: number) => {
      let a = 0;
      const lo = M - 0.03;
      const hi = M + 0.03;
      const n = 6000;
      for (let i = 0; i < n; i++) a += sigmaConvolved(lo + ((hi - lo) * (i + 0.5)) / n, spread) * ((hi - lo) / n);
      return a;
    };
    const a1 = area(2e-4);
    const a2 = area(8e-4);
    expect(Math.abs(a1 - a2) / a1).toBeLessThan(0.03);
  });
});
