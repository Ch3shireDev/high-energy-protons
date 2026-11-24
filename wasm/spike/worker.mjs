// Web Worker z jedną instancją Pythii. Bez pthreads – równoległość = wiele workerów.
import { setup, determinism, measure } from './bench-core.mjs';

const DIST = new URL('../pythia/', import.meta.url);
let state = null;

function resources() {
  if (!self.performance?.getEntriesByType) return [];
  return performance
    .getEntriesByType('resource')
    .filter((e) => /pythia\.(wasm|data|mjs)/.test(e.name))
    .map((e) => ({
      name: e.name.split('/').pop().split('?')[0],
      transferSize: e.transferSize,
      encodedBodySize: e.encodedBodySize,
      decodedBodySize: e.decodedBodySize,
      durationMs: e.duration,
    }));
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'init') {
      const { default: createPythia } = await import(new URL('pythia.mjs', DIST).href);
      const s = await setup(createPythia, {
        scenario: msg.scenario,
        seed: msg.seed,
        locateFile: (p) => new URL(p, DIST).href,
      });
      state = s;
      const det = determinism(s.gen, msg.seed);
      self.postMessage({
        type: 'ready',
        timings: s.timings,
        det,
        heapBytes: s.M.HEAP8.length,
        resources: resources(),
        stride: s.gen.stride(),
      });
    } else if (msg.type === 'run') {
      const r = await measure(state.gen, {
        durationMs: msg.durationMs,
        sampleForSize: msg.sampleForSize ?? 0,
      });
      self.postMessage(
        {
          type: 'done',
          ...r,
          heapBytes: state.M.HEAP8.length,
          sigmaGenMb: state.gen.sigmaGenMb(),
          nTried: state.gen.nTried(),
          nAccepted: state.gen.nAccepted(),
          problems: state.lines.filter((l) => /error|abort/i.test(l)).slice(-10),
        },
        [r.times.buffer],
      );
    } else if (msg.type === 'event') {
      // Jedno zdarzenie adresowane seedem – do podglądu / testu linku.
      state.gen.nextWithSeed(msg.seed);
      const ev = state.gen.view().slice();
      self.postMessage({ type: 'event', ev }, [ev.buffer]);
    }
  } catch (e) {
    self.postMessage({
      type: 'error',
      message: String(e?.message ?? e),
      log: state?.lines?.slice(-20) ?? [],
    });
  }
};
