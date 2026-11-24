import { describe, expect, it } from 'vitest';
import { dimuonPairs, makeBrTable, rootMother } from '../src/analysis/dimuon';
import { decay } from '../src/physics/decay';
import { particle } from '../src/physics/particles';
import { brMuMu } from '../src/physics/ppPresets';
import { DEFAULT_DETECTOR } from '../src/sim/detector';
import { EventBuilder } from '../src/sim/event';
import { Rng } from '../src/sim/rng';

const det = { ...DEFAULT_DETECTOR, resolution: { a: 0, b: 0 } };

function eventWithForced(ids: number[], rng: Rng) {
  const b = new EventBuilder(64);
  for (const id of ids) {
    const m = particle(id).m0;
    const p: [number, number, number, number] = [rng.range(-3, 3), rng.range(-3, 3), rng.range(-8, 8), 0];
    p[3] = Math.sqrt(p[0] ** 2 + p[1] ** 2 + p[2] ** 2 + m * m);
    const v = b.push({ id, status: -91, p, m });
    const ch = particle(id).channels.find((c) => c.products.length === 2 && c.products.includes(13) && c.products.includes(-13))!;
    const r = decay(id, p, rng, undefined, ch)!;
    const first = b.size;
    for (const d of r.products) b.push({ id: d.id, status: 1, p: d.p, m: particle(d.id).m0, mothers: [v, v], charge3: d.id > 0 ? -3 : 3 });
    b.setDaughters(v, first, b.size - 1);
  }
  return b.finish({ source: 'pythia', toy: false, process: 'test', sqrtS: 13600, seed: 0, weight: 1 });
}

describe('pary dimionowe i wagi wymuszonych rozpadów', () => {
  it('waga pary z tego samego V = BR(V→μμ); para mieszana = iloczyn BR', () => {
    const rng = new Rng(8);
    const ids = [223, 333];
    const br = makeBrTable(ids);
    for (let k = 0; k < 200; k++) {
      const ev = eventWithForced(ids, rng);
      const pairs = dimuonPairs(ev.data, ev.size, { ...det, muonAcceptance: { etaMax: 99, pMin: 0, pTMin: 0 } }, rng, br, new Set(ids));
      expect(pairs.length).toBe(4); // 2 pary „prawdziwe” + 2 mieszane
      const truth = pairs.filter((p) => p.truth);
      expect(truth.length).toBe(2);
      for (const p of truth) {
        const id = Math.abs(p.m - particle(223).m0) < Math.abs(p.m - particle(333).m0) ? 223 : 333;
        expect(p.w).toBeCloseTo(brMuMu(id), 12);
      }
      for (const p of pairs.filter((x) => !x.truth)) expect(p.w).toBeCloseTo(brMuMu(223) * brMuMu(333), 15);
    }
  });

  it('masa pary prawdziwej = masa rodzica (bez rozmycia)', () => {
    const rng = new Rng(9);
    const ev = eventWithForced([443], rng);
    const pairs = dimuonPairs(ev.data, ev.size, { ...det, muonAcceptance: { etaMax: 99, pMin: 0, pTMin: 0 } }, rng);
    expect(pairs[0].m).toBeCloseTo(Math.sqrt(ev.data[1 * 16 + 9] ** 2 - ev.data[1 * 16 + 6] ** 2 - ev.data[1 * 16 + 7] ** 2 - ev.data[1 * 16 + 8] ** 2), 8);
  });

  it('rootMother przechodzi przez kopie tej samej cząstki', () => {
    const b = new EventBuilder(8);
    const z = b.push({ id: 23, status: -22, p: [0, 0, 0, 91], m: 91 });
    const mu1 = b.push({ id: 13, status: -23, p: [0, 0, 45, 45], m: 0.1, mothers: [z, z] });
    const mu2 = b.push({ id: 13, status: 1, p: [0, 0, 44, 44], m: 0.1, mothers: [mu1, mu1] });
    const ev = b.finish({ source: 'pythia', toy: false, process: 't', sqrtS: 0, seed: 0, weight: 1 });
    expect(rootMother(ev.data, mu2)).toBe(z);
  });
});
