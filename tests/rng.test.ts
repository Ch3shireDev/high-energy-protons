import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from '../src/sim/rng';

describe('RNG xoshiro128**', () => {
  it('ten sam seed → ta sama sekwencja', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('różne seedy → różne sekwencje', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.nextU32() === b.nextU32()) same++;
    expect(same).toBeLessThan(3);
  });

  it('uniform: średnia i wariancja', () => {
    const r = new Rng(7);
    const N = 200_000;
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < N; i++) {
      const u = r.uniform();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      s += u;
      s2 += u * u;
    }
    expect(s / N).toBeCloseTo(0.5, 2);
    expect(s2 / N - (s / N) ** 2).toBeCloseTo(1 / 12, 3);
  });

  it('poisson: średnia dla małych i dużych μ', () => {
    const r = new Rng(9);
    for (const mu of [0.7, 12, 250, 1e5]) {
      const N = 20_000;
      let s = 0;
      for (let i = 0; i < N; i++) s += r.poisson(mu);
      expect(Math.abs(s / N - mu)).toBeLessThan(5 * Math.sqrt(mu / N));
    }
  });

  it('hashSeed jest stabilny', () => {
    expect(hashSeed(1, 'a')).toBe(hashSeed(1, 'a'));
    expect(hashSeed(1, 'a')).not.toBe(hashSeed(1, 'b'));
  });
});
