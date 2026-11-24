import { describe, expect, it } from 'vitest';
import { pT, type P4 } from '../src/physics/vec4';
import { DEFAULT_DETECTOR } from '../src/sim/detector';
import { angularVelocity, buildTrajectory, helixRadius_mm } from '../src/sim/helix';
import { Rng } from '../src/sim/rng';

const det = DEFAULT_DETECTOR;
function traj(p: P4, charge: number, tDecay = Infinity) {
  return buildTrajectory({
    p,
    charge,
    vertex: [0, 0, 0, 0],
    B_T: det.B_T,
    field: det.solenoid,
    stop: det.hcal,
    stopReason: 'hcal',
    tDecay,
    tCap: 100,
  });
}

describe('helisy', () => {
  it('promień krzywizny = pT / (0.3·|q|·B)', () => {
    const p: P4 = [0.5, 0, 0.2, Math.hypot(0.5, 0.2, 0.13957)];
    const R = helixRadius_mm(pT(p), 1, det.B_T);
    expect(R).toBeCloseTo((0.5 / (0.299792458 * 3.8)) * 1000, 6);
    const t = traj(p, 1);
    // Punkty helisy w rzucie xy leżą na okręgu o promieniu R.
    const w = angularVelocity(1, p[3], det.B_T);
    const vx = (p[0] / p[3]) * 299.792458;
    const xc = 0;
    const yc = vx / w;
    for (let k = 1; k <= 20; k++) {
      const x = t.positionAt((k / 20) * t.tEnd);
      expect(Math.hypot(x[0] - xc, x[1] - yc)).toBeCloseTo(R, 6);
    }
  });

  it('dodatni ładunek w B ∥ +z skręca zgodnie z ruchem wskazówek zegara', () => {
    const t = traj([1, 0, 0, Math.hypot(1, 0.13957)], 1);
    const x = t.positionAt(1);
    expect(x[1]).toBeLessThan(0);
    const tm = traj([1, 0, 0, Math.hypot(1, 0.13957)], -1);
    expect(tm.positionAt(1)[1]).toBeGreaterThan(0);
  });

  it('|p| zachowane, pęd styczny do toru', () => {
    const r = new Rng(4);
    for (let k = 0; k < 200; k++) {
      const p: P4 = [r.range(-2, 2), r.range(-2, 2), r.range(-2, 2), 0];
      p[3] = Math.hypot(p[0], p[1], p[2], 0.10566);
      const t = traj(p, k % 2 ? 1 : -1);
      const tt = t.tEnd * r.uniform();
      const q = t.momentumAt(tt);
      expect(Math.hypot(q[0], q[1], q[2])).toBeCloseTo(Math.hypot(p[0], p[1], p[2]), 10);
      const h = 1e-6;
      const a = t.positionAt(tt - h);
      const b = t.positionAt(tt + h);
      const v = [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h), (b[2] - a[2]) / (2 * h)];
      for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo((q[i] / q[3]) * 299.792458, 3);
    }
  });

  it('scrubbing: pozycja w chwili t nie zależy od historii zapytań', () => {
    const t = traj([0.8, 0.3, 1.1, Math.hypot(0.8, 0.3, 1.1, 0.493677)], 1);
    const a = t.positionAt(2.5);
    t.positionAt(0.1);
    t.positionAt(4.9);
    const b = t.positionAt(2.5);
    expect(b).toEqual(a);
  });

  it('tor kończy się na powierzchni kalorymetru', () => {
    const t = traj([5, 0, 0, Math.hypot(5, 0.13957)], 1);
    expect(t.endReason).toBe('hcal');
    const x = t.positionAt(t.tEnd);
    expect(Math.hypot(x[0], x[1])).toBeCloseTo(det.hcal.r_mm, 3);
  });

  it('mion opuszcza pole i leci prosto do komór mionowych', () => {
    const t = buildTrajectory({
      p: [20, 0, 0, Math.hypot(20, 0.10566)],
      charge: -1,
      vertex: [0, 0, 0, 0],
      B_T: det.B_T,
      field: det.solenoid,
      stop: det.muon.outer,
      stopReason: 'muon',
      tDecay: Infinity,
      tCap: 100,
    });
    expect(t.segments.length).toBe(2);
    expect(t.segments[1].omega).toBe(0);
    const x = t.positionAt(t.tEnd);
    expect(Math.hypot(x[0], x[1])).toBeCloseTo(det.muon.outer.r_mm, 3);
  });
});
