// Główny wątek spike'a: tylko UI i orkiestracja workerów. Fizyka – w workerach.
import { SCENARIOS, THRESHOLDS, summarize, verdict, MODE_TEXT } from './bench-core.mjs';

const $ = (id) => document.getElementById(id);
const DIST = new URL('../pythia/', import.meta.url);
const hw = navigator.hardwareConcurrency || 4;

const results = {
  env: {
    userAgent: navigator.userAgent,
    hardwareConcurrency: hw,
    deviceMemoryGB: navigator.deviceMemory ?? null,
    crossOriginIsolated: self.crossOriginIsolated,
    url: location.href,
    date: new Date().toISOString(),
  },
  build: null,
  thresholds: THRESHOLDS,
  package: null,
  scenarios: {},
};

// ---------- formatowanie ----------
const fmt = {
  ms: (v) => (v == null ? '–' : v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('pl')),
  int: (v) => (v == null ? '–' : Math.round(v).toLocaleString('pl')),
  rate: (v) => (v == null ? '–' : v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('pl')),
  bytes(v) {
    if (v == null) return '–';
    if (v < 1024) return `${Math.round(v)} B`;
    if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KiB`;
    if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(2)} MiB`;
    return `${(v / 1024 ** 3).toFixed(2)} GiB`;
  },
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const badge = (ok, text) => `<span class="badge ${ok ? 'ok' : 'bad'}">${esc(text ?? (ok ? 'TAK' : 'NIE'))}</span>`;
const table = (head, rows, numCols = []) =>
  `<table><thead><tr>${head.map((h, i) => `<th class="${numCols.includes(i) ? 'num' : ''}">${h}</th>`).join('')}</tr></thead>` +
  `<tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numCols.includes(i) ? 'num' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function log(s) {
  const el = $('log');
  const t = (performance.now() / 1000).toFixed(1).padStart(6);
  el.textContent += `[${t} s] ${s}\n`;
  el.scrollTop = el.scrollHeight;
}
function status(s) {
  $('status').textContent = s;
}

// ---------- środowisko ----------
function renderEnv() {
  const e = results.env;
  const rows = [
    ['wątki CPU', e.hardwareConcurrency],
    ['pamięć urządzenia', e.deviceMemoryGB ? `≥ ${e.deviceMemoryGB} GB` : 'nieznana'],
    ['crossOriginIsolated', `${e.crossOriginIsolated} ${e.crossOriginIsolated ? '' : '(brak SharedArrayBuffer → bez pthreads, jak na Pages)'}`],
    ['przeglądarka', e.userAgent],
  ];
  $('env').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
}

function renderScenarioPicker() {
  $('scenarios').innerHTML = Object.entries(SCENARIOS)
    .map(
      ([k, s]) =>
        `<label><input type="checkbox" name="sc" value="${k}" checked> ${esc(s.label)} <small>– ${esc(s.use)}</small></label>`,
    )
    .join('');
  $('maxWorkers').value = Math.min(hw, 8);
}

// ---------- workery ----------
function spawn(id) {
  const w = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module', name: `pythia-${id}` });
  let pending = null;
  w.onmessage = ({ data }) => {
    if (!pending) return;
    const p = pending;
    pending = null;
    if (data.type === 'error') {
      const err = new Error(data.message);
      err.log = data.log;
      p.reject(err);
    } else p.resolve(data);
  };
  w.onerror = (e) => {
    if (pending) {
      pending.reject(new Error(`worker ${id}: ${e.message || 'błąd ładowania'}`));
      pending = null;
    }
  };
  return {
    id,
    call(msg, transfer) {
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        w.postMessage(msg, transfer ?? []);
      });
    },
    terminate: () => w.terminate(),
  };
}

function poolSizes(max) {
  const s = new Set([1]);
  for (let k = 2; k < max; k *= 2) s.add(k);
  s.add(max);
  return [...s].sort((a, b) => a - b);
}

async function runScenario(key, { durationMs, maxWorkers, seed }) {
  const sc = SCENARIOS[key];
  const out = { key, label: sc.label, settings: sc.settings };
  results.scenarios[key] = out;

  // 1) Pierwszy worker sam – czysty pomiar startu.
  status(`${key}: start pierwszego workera…`);
  log(`${key}: init workera 0`);
  const workers = [spawn(0)];
  try {
    const t0 = performance.now();
    const r0 = await workers[0].call({ type: 'init', scenario: key, seed });
    out.firstWorker = { ...r0.timings, wallMs: performance.now() - t0, heapBytes: r0.heapBytes };
    if (!results.package) {
      results.package = { resources: r0.resources, moduleMs: r0.timings.moduleMs, ctorMs: r0.timings.ctorMs };
      renderPackage();
    }
    log(`${key}: moduł ${fmt.ms(r0.timings.moduleMs)} ms, konstruktor ${fmt.ms(r0.timings.ctorMs)} ms, init ${fmt.ms(r0.timings.initMs)} ms`);

    // 2) Pojedynczy worker – szczegółowy rozkład kosztu zdarzenia.
    status(`${key}: pomiar 1 workera (${durationMs / 1000} s)…`);
    const single = await workers[0].call({ type: 'run', durationMs, sampleForSize: 300 });
    out.single = {
      ...summarize(single.times),
      evPerSec: (single.n / single.elapsedMs) * 1000,
      failed: single.failed,
      size: single.size,
      sigmaGenMb: single.sigmaGenMb,
      problems: single.problems,
      times: Array.from(single.times),
    };
    log(`${key}: 1 worker → ${fmt.rate(out.single.evPerSec)} zdarzeń/s, mediana ${fmt.ms(out.single.median)} ms, p95 ${fmt.ms(out.single.p95)} ms`);

    // 3) Reszta puli – init równolegle (tak by wyglądał start aplikacji).
    const k = maxWorkers;
    if (k > 1) {
      status(`${key}: start ${k - 1} kolejnych workerów równolegle…`);
      const t1 = performance.now();
      for (let i = 1; i < k; i++) workers.push(spawn(i));
      const inits = await Promise.all(workers.slice(1).map((w) => w.call({ type: 'init', scenario: key, seed })));
      out.poolInit = {
        workers: k - 1,
        wallMs: performance.now() - t1,
        initMsMax: Math.max(...inits.map((r) => r.timings.initMs)),
        heapBytesEach: inits[0].heapBytes,
      };
      out.det = { all: [r0.det, ...inits.map((r) => r.det)] };
      log(`${key}: ${k - 1} workerów gotowych w ${fmt.ms(out.poolInit.wallMs)} ms (ściana)`);
    } else {
      out.det = { all: [r0.det] };
    }
    const d = out.det.all;
    out.det.streamSame = d.every((x) => x.stream === d[0].stream);
    out.det.reseedOk = d.every((x) => x.reseedOk);
    out.det.reseedSameAcrossWorkers = d.every((x) => x.reseedA === d[0].reseedA);

    // 4) Skalowanie puli.
    out.pool = [{ k: 1, evPerSec: out.single.evPerSec, events: single.n }];
    for (const kk of poolSizes(k).filter((x) => x > 1)) {
      status(`${key}: pula ${kk} workerów (${durationMs / 1000} s)…`);
      const t2 = performance.now();
      const rs = await Promise.all(workers.slice(0, kk).map((w) => w.call({ type: 'run', durationMs })));
      const wall = performance.now() - t2;
      const events = rs.reduce((a, r) => a + r.n, 0);
      // Przepustowość liczona z czasów workerów (bez narzutu postMessage).
      const evPerSec = rs.reduce((a, r) => a + (r.n / r.elapsedMs) * 1000, 0);
      out.pool.push({ k: kk, evPerSec, events, wallMs: wall });
      log(`${key}: pula ${kk} → ${fmt.rate(evPerSec)} zdarzeń/s`);
    }
    const best = out.pool.reduce((a, b) => (b.evPerSec > a.evPerSec ? b : a));
    out.bestPool = best;
    out.verdict = verdict({ initMs: out.firstWorker.initMs, single: out.single, poolEvPerSec: best.evPerSec });
  } catch (e) {
    out.error = { message: e.message, log: e.log };
    log(`${key}: BŁĄD ${e.message}`);
  } finally {
    workers.forEach((w) => w.terminate());
  }
  renderScenario(out);
  renderSummary();
}

// ---------- render wyników ----------
function renderPackage() {
  const b = results.build?.files ?? {};
  const res = Object.fromEntries((results.package?.resources ?? []).map((r) => [r.name, r]));
  const names = ['pythia.mjs', 'pythia.wasm', 'pythia.data'];
  let sumRaw = 0;
  let sumGz = 0;
  const rows = names.map((n) => {
    sumRaw += b[n]?.raw ?? 0;
    sumGz += b[n]?.gzip ?? 0;
    const r = res[n];
    // transferSize < encodedBodySize → odpowiedź z cache HTTP (0 lub same nagłówki 304).
    const wire = !r ? '–' : r.transferSize >= r.encodedBodySize && r.transferSize > 0 ? fmt.bytes(r.transferSize) : `z cache (${fmt.bytes(r.encodedBodySize)})`;
    return [n, fmt.bytes(b[n]?.raw), fmt.bytes(b[n]?.gzip), wire, r ? fmt.ms(r.durationMs) : '–'];
  });
  rows.push(['<b>razem</b>', `<b>${fmt.bytes(sumRaw)}</b>`, `<b>${fmt.bytes(sumGz)}</b>`, '', '']);
  const p = results.package;
  $('packageBody').innerHTML =
    table(['plik', 'surowy', 'gzip -9 (build)', 'przesłane (zmierzone)', 'pobieranie [ms]'], rows, [1, 2, 3, 4]) +
    (p
      ? `<p>Załadowanie i kompilacja modułu w pierwszym workerze: <b>${fmt.ms(p.moduleMs)} ms</b>; ` +
        `konstruktor <code>Pythia</code> (parsowanie xmldoc): <b>${fmt.ms(p.ctorMs)} ms</b>.</p>`
      : '') +
    (results.build ? `<p class="caption">Pythia ${esc(results.build.pythiaVersion)}, emsdk ${esc(results.build.emsdkVersion)}, build ${esc(results.build.builtAt)}.</p>` : '');
  $('package').hidden = false;
}

function drawHist(canvas, times) {
  const dpr = devicePixelRatio || 1;
  const W = canvas.clientWidth * dpr;
  const H = canvas.clientHeight * dpr;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const lo = -2; // 10 µs
  const hi = 3; // 1 s
  const nb = 60;
  const bins = new Array(nb).fill(0);
  for (const t of times) {
    const x = Math.log10(Math.max(t, 1e-3));
    const b = Math.min(nb - 1, Math.max(0, Math.floor(((x - lo) / (hi - lo)) * nb)));
    bins[b]++;
  }
  const max = Math.max(...bins);
  const pad = 18 * dpr;
  const bw = W / nb;
  ctx.fillStyle = css.getPropertyValue('--accent');
  bins.forEach((c, i) => {
    if (!c) return;
    const h = ((H - pad) * c) / max;
    ctx.fillRect(i * bw + 1, H - pad - h, Math.max(1, bw - 2), h);
  });
  ctx.fillStyle = css.getPropertyValue('--muted');
  ctx.font = `${11 * dpr}px ui-monospace, monospace`;
  ['0.01', '0.1', '1', '10', '100', '1000'].forEach((lab, i) => {
    const x = (i / (hi - lo)) * W;
    ctx.fillRect(x, H - pad, 1, 4 * dpr);
    ctx.fillText(`${lab}`, Math.min(x + 2 * dpr, W - 30 * dpr), H - 4 * dpr);
  });
}

function renderScenario(out) {
  let el = document.getElementById(`sc-${out.key}`);
  if (!el) {
    el = document.createElement('section');
    el.className = 'panel';
    el.id = `sc-${out.key}`;
    $('results').appendChild(el);
  }
  if (out.error) {
    el.innerHTML = `<h2>${esc(out.label)}</h2><p class="err">${esc(out.error.message)}</p>` +
      (out.error.log?.length ? `<pre class="log">${esc(out.error.log.join('\n'))}</pre>` : '');
    return;
  }
  const s = out.single;
  const sz = s.size;
  const fw = out.firstWorker;
  const v = out.verdict;
  const det = out.det;
  const best = out.bestPool;

  const timing = table(
    ['', 'wartość'],
    [
      ['init (Pythia::init)', `${fmt.ms(fw.initMs)} ms`],
      ['średnio / zdarzenie', `${fmt.ms(s.mean)} ms`],
      ['mediana', `${fmt.ms(s.median)} ms`],
      ['p95 / p99', `${fmt.ms(s.p95)} / ${fmt.ms(s.p99)} ms`],
      ['maks.', `${fmt.ms(s.max)} ms`],
      ['1 worker', `${fmt.rate(s.evPerSec)} zdarzeń/s (n = ${fmt.int(s.n)})`],
      ['pamięć WASM / worker', fmt.bytes(fw.heapBytes)],
    ],
    [1],
  );
  const size = sz
    ? table(
        ['na zdarzenie (śr. z ' + sz.sampled + ')', 'wartość'],
        [
          ['wpisy w rekordzie', fmt.int(sz.particlesAll)],
          ['cząstki stanu końcowego', fmt.int(sz.particlesFinal)],
          ['naładowane, stan końcowy', fmt.int(sz.chargedFinal)],
          ['pełny rekord (float64)', `${fmt.bytes(sz.bytesFull)} → gzip ${fmt.bytes(sz.bytesFullGz)}`],
          ['kompakt (stan końcowy)', `${fmt.bytes(sz.bytesCompact)} → gzip ${fmt.bytes(sz.bytesCompactGz)}`],
          ['cache 10⁴ zdarzeń (kompakt, gzip)', fmt.bytes(sz.bytesCompactGz * 1e4)],
        ],
        [1],
      )
    : '';
  const poolRows = out.pool.map((p) => [
    p.k,
    fmt.rate(p.evPerSec),
    `${(p.evPerSec / out.pool[0].evPerSec).toFixed(2)}×`,
    `${fmt.rate(THRESHOLDS.histogramEvents / p.evPerSec)} s`,
  ]);
  const pool =
    table(['workery', 'zdarzeń/s', 'przyspieszenie', `czas do ${THRESHOLDS.histogramEvents.toLocaleString('pl')}`], poolRows, [0, 1, 2, 3]) +
    (out.poolInit
      ? `<p class="caption">Start ${out.poolInit.workers} kolejnych workerów równolegle: ${fmt.ms(out.poolInit.wallMs)} ms ściany ` +
        `(najwolniejszy init ${fmt.ms(out.poolInit.initMsMax)} ms). Pamięć puli ≈ ${fmt.bytes(out.poolInit.heapBytesEach * (out.poolInit.workers + 1))}.</p>`
      : '');
  const detRows = [
    ['pierwsze zdarzenie po init(seed) identyczne w ' + det.all.length + ' workerach', badge(det.streamSame)],
    ['nextWithSeed(s): to samo zdarzenie przed i po innych', badge(det.reseedOk)],
    ['nextWithSeed(s): to samo we wszystkich workerach', badge(det.reseedSameAcrossWorkers)],
  ];
  const verdictRows = v.checks.map((c) => [esc(c.label), c.value, badge(c.ok)]);

  el.innerHTML = `
    <h2>${esc(out.label)}</h2>
    <p class="caption"><code>${out.settings.map(esc).join('</code> · <code>')}</code></p>
    <p class="verdict"><span class="badge mode-${v.mode}">${v.mode}</span> ${esc(MODE_TEXT[v.mode])}</p>
    ${table(['kryterium', 'zmierzone', 'spełnione'], verdictRows, [1])}
    <div class="grid2">
      <div><h3>Koszt</h3>${timing}</div>
      <div><h3>Rozmiar zdarzenia</h3>${size}</div>
    </div>
    <h3>Rozkład czasu jednego zdarzenia [ms, skala log]</h3>
    <canvas class="hist"></canvas>
    <div class="grid2">
      <div><h3>Pula workerów (najlepiej: ${best.k} → ${fmt.rate(best.evPerSec)} zdarzeń/s)</h3>${pool}</div>
      <div><h3>Determinizm</h3>${table(['test', ''], detRows)}</div>
    </div>
    ${s.problems?.length ? `<h3>Komunikaty Pythii</h3><pre class="log">${esc(s.problems.join('\n'))}</pre>` : ''}
  `;
  drawHist(el.querySelector('canvas'), s.times);
}

function summaryRows() {
  return Object.values(results.scenarios)
    .filter((o) => !o.error && o.verdict)
    .map((o) => ({
      label: o.label,
      init: o.firstWorker.initMs,
      median: o.single.median,
      p95: o.single.p95,
      ev1: o.single.evPerSec,
      evPool: o.bestPool.evPerSec,
      k: o.bestPool.k,
      final: o.single.size?.particlesFinal,
      cache1e4: o.single.size ? o.single.size.bytesCompactGz * 1e4 : null,
      det: o.det.streamSame && o.det.reseedOk && o.det.reseedSameAcrossWorkers,
      mode: o.verdict.mode,
    }));
}

function renderSummary() {
  const rows = summaryRows();
  if (!rows.length) return;
  $('summaryBody').innerHTML = '<div class="scroll">' + table(
    ['scenariusz', 'init [ms]', 'mediana [ms]', 'p95 [ms]', '1 worker [/s]', 'pula [/s]', 'cząstki (stan końc.)', 'cache 10⁴', 'determinizm', 'werdykt'],
    rows.map((r) => [
      esc(r.label),
      fmt.ms(r.init),
      fmt.ms(r.median),
      fmt.ms(r.p95),
      fmt.rate(r.ev1),
      `${fmt.rate(r.evPool)} (${r.k}×)`,
      fmt.int(r.final),
      fmt.bytes(r.cache1e4),
      badge(r.det),
      `<span class="badge mode-${r.mode}">${r.mode}</span>`,
    ]),
    [1, 2, 3, 4, 5, 6, 7],
  ) + '</div>';
  $('summary').hidden = false;
}

function markdown() {
  const e = results.env;
  const b = results.build;
  const lines = [];
  lines.push(`### Pomiar ${e.date.slice(0, 10)}`, '');
  lines.push(`- Przeglądarka: \`${e.userAgent}\``);
  lines.push(`- Wątki CPU: ${e.hardwareConcurrency}, crossOriginIsolated: ${e.crossOriginIsolated}`);
  if (b) {
    lines.push(`- Pythia ${b.pythiaVersion}, emsdk ${b.emsdkVersion}`);
    for (const [n, f] of Object.entries(b.files)) lines.push(`- \`${n}\`: ${fmt.bytes(f.raw)} (gzip ${fmt.bytes(f.gzip)})`);
  }
  if (results.package) {
    lines.push(`- Ładowanie + kompilacja modułu: ${fmt.ms(results.package.moduleMs)} ms, konstruktor Pythii: ${fmt.ms(results.package.ctorMs)} ms`);
  }
  lines.push('', '| scenariusz | init [ms] | mediana [ms] | p95 [ms] | 1 worker [/s] | pula [/s] | cząstki końc. | cache 10⁴ (gzip) | determinizm | werdykt |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const r of summaryRows()) {
    lines.push(
      `| ${r.label} | ${fmt.ms(r.init)} | ${fmt.ms(r.median)} | ${fmt.ms(r.p95)} | ${fmt.rate(r.ev1)} | ${fmt.rate(r.evPool)} (${r.k}×) | ${fmt.int(r.final)} | ${fmt.bytes(r.cache1e4)} | ${r.det ? 'tak' : 'NIE'} | ${r.mode} |`,
    );
  }
  return lines.join('\n');
}

// ---------- start ----------
async function loadBuildInfo() {
  try {
    const r = await fetch(new URL('build-info.json', DIST));
    if (r.ok) results.build = await r.json();
    $('buildInfo').textContent = results.build ? ` Pythia ${results.build.pythiaVersion}.` : '';
  } catch {
    /* brak build-info nie blokuje pomiaru */
  }
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const keys = [...document.querySelectorAll('input[name=sc]:checked')].map((i) => i.value);
  if (!keys.length) return status('Wybierz co najmniej jeden scenariusz.');
  const opts = {
    durationMs: Math.max(1, +$('duration').value) * 1000,
    maxWorkers: Math.max(1, Math.min(64, +$('maxWorkers').value | 0)),
    seed: Math.max(0, Math.min(900000000, +$('seed').value | 0)),
  };
  $('run').disabled = true;
  $('results').innerHTML = '';
  results.scenarios = {};
  results.package = null;
  results.options = opts;
  log(`start: ${keys.join(', ')}; ${opts.durationMs / 1000} s/krok, do ${opts.maxWorkers} workerów, seed ${opts.seed}`);
  for (const k of keys) await runScenario(k, opts);
  status('Gotowe.');
  log('koniec');
  $('run').disabled = false;
});

$('copyMd').addEventListener('click', async () => {
  await navigator.clipboard.writeText(markdown());
  status('Skopiowano Markdown.');
});
$('saveJson').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(results, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pythia-spike-${results.env.date.slice(0, 19).replace(/:/g, '')}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

renderEnv();
renderScenarioPicker();
await loadBuildInfo();

// ?auto=1 – uruchom od razu (z ?sc=minbias,zmumu&d=3&w=4)
const q = new URLSearchParams(location.search);
if (q.get('sc')) document.querySelectorAll('input[name=sc]').forEach((i) => (i.checked = q.get('sc').split(',').includes(i.value)));
if (q.get('d')) $('duration').value = q.get('d');
if (q.get('w')) $('maxWorkers').value = q.get('w');
if (q.get('auto') === '1') $('form').requestSubmit();
window.__spike = results; // do odczytu z konsoli
