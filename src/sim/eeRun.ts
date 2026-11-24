// Jedno zdarzenie e⁺e⁻ adresowane (seed przebiegu, numer zdarzenia, re-roll).
// To jest „link do zdarzenia”: te same ustawienia + seed + indeks → to samo zdarzenie.

import { generateEE, PROCESSES, type GeneratedEE, type ProcessInfo } from '../physics/ee';
import type { DetectorConfig } from './detector';
import { propagate, type PropagatedEvent } from './propagate';
import { hashSeed, Rng } from './rng';

export interface EESettings {
  sqrtS: number;
  spreadRel: number;
  /** Klucze procesów (PROCESSES[].key); puste = wszystkie. */
  processes: string[];
  runSeed: number;
}

export function processFilter(keys: string[]): ((p: ProcessInfo) => boolean) | undefined {
  if (!keys.length || keys.length === PROCESSES.length) return undefined;
  const set = new Set(keys);
  return (p) => set.has(p.key);
}

export function eventSeed(runSeed: number, index: number): number {
  return hashSeed(runSeed, 'ee-event', index);
}

export function runEEEvent(
  s: EESettings,
  index: number,
  det: DetectorConfig,
  reroll = 0,
): { gen: GeneratedEE; prop: PropagatedEvent } | null {
  const seed = eventSeed(s.runSeed, index);
  const gen = generateEE({ sqrtS: s.sqrtS, spreadRel: s.spreadRel, seed, filter: processFilter(s.processes) }, Rng.derive(seed, 'gen'));
  if (!gen) return null;
  const prop = propagate(gen.event, { det, rng: Rng.derive(seed, 'prop', reroll), hints: gen.hints });
  return { gen, prop };
}
