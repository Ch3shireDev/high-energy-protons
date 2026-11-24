// Lokalny pomiar w Node (ten sam V8 co Chrome) – jeden wątek, bez puli.
// Użycie: node wasm/spike/node-bench.mjs [scenariusz…] [--d=3] [--seed=12345]
import { fileURLToPath } from 'node:url';
import { SCENARIOS, setup, determinism, measure, summarize, verdict } from './bench-core.mjs';

const DIST = new URL('../dist/', import.meta.url);
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const keys = args.filter((a) => !a.startsWith('--'));
const durationMs = (+opt.d || 3) * 1000;
const seed = +opt.seed || 12345;
const { default: createPythia } = await import(new URL('pythia.mjs', DIST).href);

const f = (v, d = 2) => (v == null ? '–' : v.toFixed(d));
console.log('| scenariusz | moduł [ms] | init [ms] | mediana [ms] | p95 [ms] | /s | cząstki końc. | kompakt gzip [B/zd.] | determinizm | werdykt (1 wątek) |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
for (const key of keys.length ? keys : Object.keys(SCENARIOS)) {
  const s = await setup(createPythia, { scenario: key, seed, locateFile: (p) => fileURLToPath(new URL(p, DIST)) });
  const det = determinism(s.gen, seed);
  const r = await measure(s.gen, { durationMs, sampleForSize: 300 });
  const st = summarize(r.times);
  const evs = (r.n / r.elapsedMs) * 1000;
  const v = verdict({ initMs: s.timings.initMs, single: st, poolEvPerSec: evs });
  console.log(
    `| ${key} | ${f(s.timings.moduleMs, 0)} | ${f(s.timings.initMs, 0)} | ${f(st.median)} | ${f(st.p95)} | ${f(evs, 1)} | ${f(r.size.particlesFinal, 0)} | ${f(r.size.bytesCompactGz, 0)} | ${det.reseedOk ? 'tak' : 'NIE'} | ${v.mode} |`,
  );
}
