import { DEFAULT_DETECTOR } from '../src/sim/detector';
import { runEEEvent } from '../src/sim/eeRun';

/** Pełne zdarzenie e⁺e⁻: generacja + propagacja, deterministycznie z seeda (ta sama ścieżka co aplikacja). */
export function eeEvent(o: { sqrtS: number; spreadRel: number }, seed: number) {
  const r = runEEEvent({ ...o, processes: [], runSeed: seed }, 0, DEFAULT_DETECTOR);
  if (!r) throw new Error('brak procesu');
  return r;
}
