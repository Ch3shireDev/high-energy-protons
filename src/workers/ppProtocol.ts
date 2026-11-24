import type { EventMeta } from '../sim/event';
import type { DecayInfo } from './eeProtocol';

export type ToPP =
  | { type: 'init'; pythiaUrl: string; preset: string; runSeed: number; worker: number }
  | { type: 'event'; index: number }
  | { type: 'stream'; on: boolean };

export type FromPP =
  | { type: 'ready'; preset: string; moduleMs: number; initMs: number; heapBytes: number }
  | { type: 'event'; index: number; data: Float64Array; size: number; meta: EventMeta; decays: DecayInfo[]; genMs: number }
  | { type: 'batch'; preset: string; events: number; sigmaGenMb: number; masses: Float32Array; weights: Float32Array; truth: Uint8Array; ms: number }
  | { type: 'error'; message: string; log: string[] };
