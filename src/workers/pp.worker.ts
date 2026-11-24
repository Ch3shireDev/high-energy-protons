// Worker z jedną instancją Pythii 8 (WASM, bez pthreads). Generacja + propagacja + widmo dimionowe.
/// <reference lib="webworker" />

import { dimuonPairs, makeBrTable } from '../analysis/dimuon';
import { PP_COMMON, presetByKey } from '../physics/ppPresets';
import { DEFAULT_DETECTOR } from '../sim/detector';
import type { SimEvent } from '../sim/event';
import { propagate } from '../sim/propagate';
import { hashSeed, Rng } from '../sim/rng';
import type { FromPP, ToPP } from './ppProtocol';

interface Generator {
  readString(s: string): boolean;
  init(seed: number): boolean;
  next(): boolean;
  nextWithSeed(seed: number): boolean;
  view(): Float64Array;
  size(): number;
  sigmaGenMb(): number;
}
interface PythiaModule {
  Generator: new () => Generator;
  HEAP8: Int8Array;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let gen: Generator | null = null;
let preset = '';
let runSeed = 1;
let workerIdx = 0;
let streaming = false;
let smearRng = new Rng(1);
const log: string[] = [];
const post = (m: FromPP, t: Transferable[] = []) => ctx.postMessage(m, t);
const PYTHIA_SEED_MAX = 900000000;

async function init(m: Extract<ToPP, { type: 'init' }>) {
  const t0 = performance.now();
  const base = new URL(m.pythiaUrl);
  const mod = (await import(/* @vite-ignore */ new URL('pythia.mjs', base).href)) as { default: (o: object) => Promise<PythiaModule> };
  const M = await mod.default({
    locateFile: (p: string) => new URL(p, base).href,
    print: (s: string) => (log.push(s), log.length > 200 && log.shift()),
    printErr: (s: string) => (log.push(s), log.length > 200 && log.shift()),
  });
  const t1 = performance.now();
  const g = new M.Generator();
  const p = presetByKey(m.preset);
  for (const s of [...PP_COMMON, ...p.settings]) if (!g.readString(s)) throw new Error(`Pythia odrzuciła ustawienie: ${s}`);
  runSeed = m.runSeed;
  workerIdx = m.worker;
  if (!g.init(hashSeed(runSeed, m.preset, 'init', workerIdx) % PYTHIA_SEED_MAX)) {
    throw new Error(`Pythia::init() nie powiodło się\n${log.filter((l) => /error|abort/i.test(l)).slice(-5).join('\n')}`);
  }
  gen = g;
  preset = m.preset;
  smearRng = Rng.derive(runSeed, 'smear', m.preset, workerIdx);
  post({ type: 'ready', preset, moduleMs: t1 - t0, initMs: performance.now() - t1, heapBytes: M.HEAP8.length });
}

function eventAt(index: number) {
  const t0 = performance.now();
  const seed = hashSeed(runSeed, preset, 'event', index) % PYTHIA_SEED_MAX;
  if (!gen!.nextWithSeed(seed)) throw new Error('Pythia::next() zwróciło false');
  const data = gen!.view().slice();
  const ev: SimEvent = { data, size: gen!.size(), meta: { source: 'pythia', toy: false, process: preset, sqrtS: 13600, seed, weight: 1 } };
  const prop = propagate(ev, { det: DEFAULT_DETECTOR, rng: Rng.derive(seed, 'prop') });
  const out = prop.event;
  post(
    {
      type: 'event',
      index,
      data: out.data,
      size: out.size,
      meta: out.meta,
      genMs: performance.now() - t0,
      decays: prop.decays.map((d) => ({ parent: d.parent, daughters: d.daughters, vertex: d.vertex, P: d.P, angular: d.result.angular, axisRest: d.result.axisRest, dirRest: d.result.dirRest, toy: d.result.toy })),
    },
    [out.data.buffer],
  );
}

function streamLoop() {
  if (!streaming || !gen) return;
  const p = presetByKey(preset);
  const br = makeBrTable(p.forcedMuMu);
  const truthIds = new Set([...p.forcedMuMu, 23]);
  const masses: number[] = [];
  const weights: number[] = [];
  const truth: number[] = [];
  const t0 = performance.now();
  let n = 0;
  while (performance.now() - t0 < 250) {
    if (!gen.next()) continue;
    n++;
    const d = gen.view();
    const size = gen.size();
    const pairs = dimuonPairs(d, size, DEFAULT_DETECTOR, smearRng, br, truthIds);
    for (const pr of pairs) {
      masses.push(pr.m);
      weights.push(pr.w);
      truth.push(pr.truth ? 1 : 0);
    }
  }
  const mA = Float32Array.from(masses);
  const wA = Float32Array.from(weights);
  const tA = Uint8Array.from(truth);
  post({ type: 'batch', preset, events: n, sigmaGenMb: gen.sigmaGenMb(), masses: mA, weights: wA, truth: tA, ms: performance.now() - t0 }, [mA.buffer, wA.buffer, tA.buffer]);
  setTimeout(streamLoop, 0);
}

ctx.onmessage = async ({ data: m }: MessageEvent<ToPP>) => {
  try {
    if (m.type === 'init') await init(m);
    else if (m.type === 'event') eventAt(m.index);
    else if (m.type === 'stream') {
      const was = streaming;
      streaming = m.on;
      if (m.on && !was) streamLoop();
    }
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.message ?? e), log: log.slice(-20) });
  }
};
