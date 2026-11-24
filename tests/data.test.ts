// Dane cząstek pochodzą z ParticleData.xml (Pythia). Ten test porównuje je z wartościami
// orientacyjnymi z literatury (PDG) – weryfikacja, nie źródło stałych w kodzie.
import { describe, expect, it } from 'vitest';
import { bEE, RESONANCES } from '../src/physics/ee';
import { DATA_SOURCE, particle } from '../src/physics/particles';
import { HBARC_GEV_MM } from '../src/physics/units';

describe('data/particles.json', () => {
  it('pochodzi z generatora i znanej wersji Pythii', () => {
    expect(DATA_SOURCE.pythiaVersion).toMatch(/^83\d\d$/);
  });

  it.each([
    [113, 0.775, 0.149],
    [223, 0.783, 0.0087],
    [333, 1.019, 0.0042],
    [443, 3.097, 93e-6],
    [100443, 3.686, 0.29e-3],
    [553, 9.46, 54e-6],
    [23, 91.19, 2.5],
  ])('masa i szerokość %i zgodne z PDG (orientacyjnie)', (id, m, w) => {
    const p = particle(id);
    expect(p.m0).toBeCloseTo(m, 2);
    // Pythia zaokrągla szerokości do 1e-5 GeV – tolerancja 15%.
    expect(Math.abs(p.width - w) / w).toBeLessThan(0.15);
  });

  it('cτ z szerokości: ħc/Γ', () => {
    const z = particle(23);
    expect(z.ctau_mm).toBeCloseTo(HBARC_GEV_MM / z.width, 25);
  });

  it('cτ długo żyjących z tau0 (mm)', () => {
    expect(particle(310).ctau_mm).toBeCloseTo(26.84, 1);
    expect(particle(211).ctau_mm).toBeCloseTo(7804.5, 0);
    expect(particle(-211).ctau_mm).toBe(particle(211).ctau_mm);
  });

  it('antycząstki: ładunek i produkty sprzężone', () => {
    expect(particle(211).charge).toBe(1);
    expect(particle(-211).charge).toBe(-1);
    // π⁺ → μ⁺ ν_μ, więc π⁻ → μ⁻ ν̄_μ.
    expect(particle(211).channels[0].products).toEqual([-13, 14]);
    expect(particle(-211).channels[0].products).toEqual([13, -14]);
  });

  it('suma BR ≈ 1 dla rezonansów e⁺e⁻', () => {
    for (const id of RESONANCES) {
      const s = particle(id).channels.reduce((a, c) => a + c.br, 0);
      expect(Math.abs(s - 1)).toBeLessThan(0.02);
    }
  });

  it('rezonanse e⁺e⁻ wyznaczone z danych zawierają J/ψ, ψ(2S), Υ, φ', () => {
    for (const id of [333, 443, 100443, 553]) expect(RESONANCES).toContain(id);
    expect(RESONANCES).not.toContain(23);
    expect(bEE(443)).toBeCloseTo(0.0594, 4);
  });
});
