// Worker e⁺e⁻: generacja (TS), propagacja, histogramy, skan. Główny wątek dostaje tylko wyniki.
/// <reference lib="webworker" />

import { EEAnalysis } from '../analysis/eeAnalysis';
import { measure, sigmaConvolved } from '../analysis/scan';
import { PROCESSES, sigmaProcess } from '../physics/ee';
import { DEFAULT_DETECTOR } from '../sim/detector';
import { runEEEvent, type EESettings } from '../sim/eeRun';
import { hashSeed, Rng } from '../sim/rng';
import type { FromEE, ToEE } from './eeProtocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let settings: EESettings = { sqrtS: 10, spreadRel: 0, processes: [], runSeed: 1 };
let next = 0;
const analysis = new EEAnalysis();

function post(m: FromEE, transfer: Transferable[] = []) {
  ctx.postMessage(m, transfer);
}

function emitEvent(index: number, reroll: number, fill: boolean) {
  const r = runEEEvent(settings, index, DEFAULT_DETECTOR, reroll);
  if (!r) return false;
  if (fill) analysis.fill(r.gen, r.prop);
  const ev = r.prop.event;
  post(
    {
      type: 'event',
      index,
      reroll,
      data: ev.data,
      size: ev.size,
      meta: ev.meta,
      processLabel: r.gen.process.label,
      generated: next,
      decays: r.prop.decays.map((d) => ({
        parent: d.parent,
        daughters: d.daughters,
        vertex: d.vertex,
        P: d.P,
        angular: d.result.angular,
        axisRest: d.result.axisRest,
        dirRest: d.result.dirRest,
        toy: d.result.toy,
      })),
    },
    [ev.data.buffer],
  );
  return true;
}

function stats(ms: number) {
  const s = analysis.snapshot();
  post({ type: 'stats', ...s, generated: next, ms });
}

ctx.onmessage = ({ data: msg }: MessageEvent<ToEE>) => {
  try {
    switch (msg.type) {
      case 'settings':
        settings = msg.settings;
        next = 0;
        analysis.reset();
        stats(0);
        break;
      case 'reset':
        next = 0;
        analysis.reset();
        stats(0);
        break;
      case 'next': {
        const t0 = performance.now();
        // burst − 1 zdarzeń tylko do histogramów, ostatnie także na ekran.
        for (let k = 0; k < msg.burst - 1; k++) {
          const r = runEEEvent(settings, next++, DEFAULT_DETECTOR);
          if (r) analysis.fill(r.gen, r.prop);
        }
        const ok = emitEvent(next, 0, true);
        next++;
        if (!ok) post({ type: 'error', message: 'Brak procesu o niezerowym przekroju przy tym √s i wyborze procesów.' });
        stats(performance.now() - t0);
        break;
      }
      case 'goto':
        emitEvent(msg.index, msg.reroll, false);
        break;
      case 'sigma':
        post({
          type: 'sigma',
          sqrtS: msg.sqrtS,
          rows: PROCESSES.map((p) => ({ key: p.key, label: p.label, kind: p.kind, toy: p.toy, sigma_nb: sigmaProcess(msg.sqrtS, p) })),
        });
        break;
      case 'scanMeasure': {
        const rng = new Rng(hashSeed(settings.runSeed, 'scan', msg.point));
        post({ type: 'scanPoint', point: measure(msg.sqrtS, msg.lumi, msg.spreadRel, rng) });
        break;
      }
      case 'scanTheory': {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i < msg.n; i++) {
          const x = msg.lo * Math.pow(msg.hi / msg.lo, i / (msg.n - 1));
          xs.push(x);
          ys.push(sigmaConvolved(x, msg.spreadRel));
        }
        post({ type: 'scanTheory', xs, ys, spreadRel: msg.spreadRel });
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', message: String((e as Error)?.message ?? e) });
  }
};
