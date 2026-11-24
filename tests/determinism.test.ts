// Bramka etapu 1: ten sam seed → identyczne zdarzenie.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { F, STRIDE } from '../src/sim/event';
import { eeEvent } from './helpers';

describe('determinizm', () => {
  for (const sqrtS of [3.097, 10, 91.19]) {
    it(`√s = ${sqrtS}: ten sam seed → identyczny bufor`, () => {
      for (let seed = 1; seed < 50; seed++) {
        const a = eeEvent({ sqrtS, spreadRel: 1e-3 }, seed).prop.event;
        const b = eeEvent({ sqrtS, spreadRel: 1e-3 }, seed).prop.event;
        expect(b.size).toBe(a.size);
        expect(Array.from(b.data)).toEqual(Array.from(a.data));
        expect(b.meta).toEqual(a.meta);
      }
    });
  }

  it('różne seedy → różne zdarzenia', () => {
    const a = eeEvent({ sqrtS: 10, spreadRel: 0 }, 1).prop.event;
    const b = eeEvent({ sqrtS: 10, spreadRel: 0 }, 2).prop.event;
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data));
  });

  it('format zdarzenia TS = format wrappera Pythii (wasm/wrapper.cpp)', () => {
    const cpp = readFileSync(new URL('../wasm/wrapper.cpp', import.meta.url), 'utf8');
    expect(cpp).toMatch(new RegExp(`constexpr int STRIDE = ${STRIDE};`));
    const order = ['id()', 'status()', 'mother1()', 'mother2()', 'daughter1()', 'daughter2()', 'px()', 'py()', 'pz()', 'e()', 'm()', 'xProd()', 'yProd()', 'zProd()', 'tProd()', 'chargeType()'];
    const fields = [F.id, F.status, F.mother1, F.mother2, F.daughter1, F.daughter2, F.px, F.py, F.pz, F.e, F.m, F.x_mm, F.y_mm, F.z_mm, F.t_ns, F.charge3];
    order.forEach((call, k) => {
      const re = new RegExp(`p\\[${fields[k]}\\] = q\\.${call.replace(/[()]/g, '\\$&')}`);
      expect(cpp, call).toMatch(re);
    });
  });
});

import { DEFAULT_DETECTOR } from '../src/sim/detector';
import { rebuildTracks } from '../src/sim/tracks';

describe('odtworzenie trajektorii z bufora (worker → render)', () => {
  it('rebuildTracks daje te same trajektorie co propagate', () => {
    for (const sqrtS of [3.097, 10, 91.19]) {
      for (let seed = 1; seed < 40; seed++) {
        const { prop } = eeEvent({ sqrtS, spreadRel: 0 }, seed);
        const re = rebuildTracks(prop.event, DEFAULT_DETECTOR);
        prop.tracks.forEach((t, i) => {
          if (!t) return;
          const r = re[i]!;
          expect(r, `wpis ${i}`).toBeTruthy();
          expect(r.endReason).toBe(t.endReason);
          expect(r.tEnd).toBeCloseTo(t.tEnd, 9);
          const a = t.positionAt(0.5 * (t.tStart + t.tEnd));
          const b = r.positionAt(0.5 * (t.tStart + t.tEnd));
          for (let k = 0; k < 3; k++) expect(b[k]).toBeCloseTo(a[k], 6);
        });
      }
    }
  });
});
