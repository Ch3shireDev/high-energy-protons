// Sprzężenia Modelu Standardowego – wartości z data/sm.json (z Pythii).

import sm from '../../data/sm.json';
import { particle } from './particles';

export const SM = sm;

/** Biegnące α_EM rzędu 1 – ten sam algorytm i progi co AlphaEM w Pythii. */
const alphaEMSteps = (() => {
  const { q2Step, bRun: bDef, mZ } = sm.alphaEMrun;
  const b = [...bDef];
  const step = new Array<number>(5);
  const mZ2 = mZ * mZ;
  step[4] = sm.alphaEMmZ / (1 + sm.alphaEMmZ * b[4] * Math.log(mZ2 / q2Step[4]));
  step[3] = step[4] / (1 - step[4] * b[3] * Math.log(q2Step[3] / q2Step[4]));
  step[0] = sm.alphaEM0;
  step[1] = step[0] / (1 - step[0] * b[0] * Math.log(q2Step[1] / q2Step[0]));
  step[2] = step[1] / (1 - step[1] * b[1] * Math.log(q2Step[2] / q2Step[1]));
  b[2] = (1 / step[3] - 1 / step[2]) / Math.log(q2Step[2] / q2Step[3]);
  return { step, b, q2Step };
})();

export function alphaEM(Q2: number): number {
  const { step, b, q2Step } = alphaEMSteps;
  for (let i = 4; i >= 0; i--) {
    if (Q2 > q2Step[i]) return step[i] / (1 - b[i] * step[i] * Math.log(Q2 / q2Step[i]));
  }
  return sm.alphaEM0;
}

/**
 * α_s rzędu 1 z progami zapachowymi na masach kwarków c, b, t z data/
 * (normalizacja: α_s(m_Z) = SigmaProcess:alphaSvalue, jak w procesach twardych Pythii).
 */
export function alphaS(Q2: number): number {
  const mZ = particle(23).m0;
  const mc = particle(4).m0;
  const mb = particle(5).m0;
  const mt = particle(6).m0;
  const b0 = (nf: number) => (33 - 2 * nf) / (12 * Math.PI);
  const run = (a: number, nf: number, from2: number, to2: number) => a / (1 + a * b0(nf) * Math.log(to2 / from2));
  const mZ2 = mZ * mZ;
  let a = sm.alphaSmZ;
  if (Q2 >= mZ2) {
    if (Q2 <= mt * mt) return run(a, 5, mZ2, Q2);
    a = run(a, 5, mZ2, mt * mt);
    return run(a, 6, mt * mt, Q2);
  }
  if (Q2 >= mb * mb) return run(a, 5, mZ2, Q2);
  a = run(a, 5, mZ2, mb * mb);
  if (Q2 >= mc * mc) return run(a, 4, mb * mb, Q2);
  a = run(a, 4, mb * mb, mc * mc);
  // Poniżej progu c: nf = 3, zamrożone przy Q² < 0.5 GeV² (nieperturbacyjnie – tylko zabawkowo).
  return run(a, 3, mc * mc, Math.max(Q2, 0.5));
}

/** Ładunek e_f, wektorowe v_f i aksjalne a_f sprzężenie do Z (konwencja CoupSM w Pythii). */
export function ef(idAbs: number): number {
  return sm.ef[idAbs] ?? 0;
}
export function af(idAbs: number): number {
  return sm.af[idAbs] ?? 0;
}
export function vf(idAbs: number): number {
  return af(idAbs) - 4 * sm.sin2thetaWbar * ef(idAbs);
}
