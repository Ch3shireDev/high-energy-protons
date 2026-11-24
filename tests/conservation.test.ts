// Bramka etapu 1: zachowanie E i p w każdym zdarzeniu.
// Proces twardy: Σ produktów = (0,0,0,√s). Każdy wierzchołek rozpadu: Σ córek = rodzic w chwili rozpadu.
import { describe, expect, it } from 'vitest';
import { decay } from '../src/physics/decay';
import { particle } from '../src/physics/particles';
import { sum, type P4 } from '../src/physics/vec4';
import { F, p4Of, STRIDE } from '../src/sim/event';
import { Rng } from '../src/sim/rng';
import { eeEvent } from './helpers';

const TOL = 1e-8;
function expectClose(a: P4, b: P4, scale: number) {
  for (let k = 0; k < 4; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(TOL * Math.max(1, scale));
}

describe('zachowanie czteropędu', () => {
  for (const sqrtS of [1.02, 3.097, 3.686, 10.58, 9.46, 91.19, 200]) {
    it(`e⁺e⁻ przy √s = ${sqrtS} GeV: proces twardy i każdy wierzchołek`, () => {
      for (let seed = 1; seed <= 150; seed++) {
        const { gen, prop } = eeEvent({ sqrtS, spreadRel: 0 }, seed);
        // Proces twardy (przed propagacją): bezpośrednie córki wiązek.
        const g = gen.event;
        const hard: P4[] = [];
        for (let i = 3; i < g.size; i++) {
          const m1 = g.data[i * STRIDE + F.mother1];
          const st = g.data[i * STRIDE + F.status];
          // Bezpośredni produkt wiązek, który nie jest partonem przed fragmentacją.
          if (m1 === 1 && st !== -23) hard.push(p4Of(g.data, i));
          if (st > 0 && m1 !== 1) hard.push(p4Of(g.data, i)); // hadrony z modelu zabawkowego
        }
        expectClose(sum(hard), [0, 0, 0, sqrtS], sqrtS);
        // Wierzchołki rozpadów.
        for (const d of prop.decays) {
          const ps: P4[] = [];
          for (let j = d.daughters[0]; j <= d.daughters[1]; j++) ps.push(p4Of(prop.event.data, j));
          expectClose(sum(ps), d.P, d.P[3]);
        }
      }
    });
  }

  it('rozpady wszystkich niestabilnych cząstek z danych, które mają kanały jawne', () => {
    const r = new Rng(5);
    for (const id of [111, 221, 310, 130, 211, 321, 3122, 15, -15, 113, 223, 333, 443, 553, 100443]) {
      const m = particle(id).m0;
      for (let k = 0; k < 300; k++) {
        const P: P4 = [r.range(-3, 3), r.range(-3, 3), r.range(-3, 3), 0];
        P[3] = Math.sqrt(P[0] ** 2 + P[1] ** 2 + P[2] ** 2 + m * m);
        const res = decay(id, P, r);
        expect(res, `rozpad ${id}`).not.toBeNull();
        expectClose(sum(res!.products.map((x) => x.p)), P, P[3]);
        // Ładunek zachowany.
        const q = res!.products.reduce((s, x) => s + particle(x.id).charge, 0);
        expect(q).toBeCloseTo(particle(id).charge, 9);
      }
    }
  });
});
