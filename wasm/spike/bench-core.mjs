// Rdzeń pomiarów spike'a Pythia/WASM. Używany przez worker (przeglądarka)
// i przez node-bench.mjs (lokalnie), więc bez DOM i bez zależności.

export const STRIDE = 16; // patrz wasm/wrapper.cpp
const F = { id: 0, status: 1, charge3: 15 };

// Ustawienia wspólne. limitTau0: Pythia rozpada tylko krótko żyjące stany
// (cτ < 10 mm), K⁰S, Λ, π±, μ± zostają dla własnego silnika rozpadów/helis.
export const COMMON_SETTINGS = [
  'Beams:idA = 2212',
  'Beams:idB = 2212',
  'Beams:eCM = 13600.',
  'ParticleDecays:limitTau0 = on',
  'ParticleDecays:tau0Max = 10.',
  'Print:quiet = on',
];

export const SCENARIOS = {
  minbias: {
    label: 'pp 13.6 TeV – minimum bias (SoftQCD:inelastic)',
    use: 'tło, „zwykłe” zdarzenia, pokaz ciągły',
    settings: ['SoftQCD:inelastic = on'],
  },
  hardqcd: {
    label: 'pp 13.6 TeV – twarde QCD, p̂T > 20 GeV',
    use: 'jety',
    settings: ['HardQCD:all = on', 'PhaseSpace:pTHatMin = 20.'],
  },
  zmumu: {
    label: 'pp → Z/γ* → μ⁺μ⁻, m̂ > 60 GeV',
    use: 'widmo dimionowe (etap 5)',
    settings: [
      'WeakSingleBoson:ffbar2gmZ = on',
      '23:onMode = off',
      '23:onIfAny = 13',
      'PhaseSpace:mHatMin = 60.',
    ],
  },
  ttbar: {
    label: 'pp → tt̄',
    use: 'najcięższe zdarzenia (górna granica kosztu)',
    settings: ['Top:all = on'],
  },
};

// Progi decyzji „na żywo czy cache”. Jawne, żeby dało się je kwestionować.
export const THRESHOLDS = {
  clickLatencyP95Ms: 100, // zdarzenie na klik bez odczuwalnego czekania
  streamEvPerSec: 10, // ciągły pokaz z jednego workera
  histogramEvents: 10_000, // histogram, który „zbiega” do teorii...
  histogramSeconds: 30, // ...w tyle sekund, z całą pulą
  initMs: 3000, // akceptowalny start sesji
};

export function now() {
  return globalThis.performance.now();
}

// FNV-1a 32-bit po bajtach – szybki odcisk zdarzenia do testu determinizmu.
export function hashF64(arr) {
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function countParticles(ev) {
  let fin = 0;
  let chFin = 0;
  const n = ev.length / STRIDE;
  for (let i = 1; i < n; i++) {
    const o = i * STRIDE;
    if (ev[o + F.status] > 0) {
      fin++;
      if (ev[o + F.charge3] !== 0) chFin++;
    }
  }
  return { all: n - 1, final: fin, chargedFinal: chFin };
}

// Kompaktowy format do cache'u: tylko stan końcowy,
// int32 id + float32 (px,py,pz, x,y,z,t) = 32 B/cząstkę.
export function compactFinal(ev) {
  const n = ev.length / STRIDE;
  const out = [];
  for (let i = 1; i < n; i++) {
    const o = i * STRIDE;
    if (ev[o + 1] > 0) out.push(i);
  }
  const buf = new ArrayBuffer(out.length * 32);
  const dv = new DataView(buf);
  out.forEach((i, k) => {
    const o = i * STRIDE;
    const b = k * 32;
    dv.setInt32(b, ev[o], true);
    dv.setFloat32(b + 4, ev[o + 6], true);
    dv.setFloat32(b + 8, ev[o + 7], true);
    dv.setFloat32(b + 12, ev[o + 8], true);
    dv.setFloat32(b + 16, ev[o + 11], true);
    dv.setFloat32(b + 20, ev[o + 12], true);
    dv.setFloat32(b + 24, ev[o + 13], true);
    dv.setFloat32(b + 28, ev[o + 14], true);
  });
  return new Uint8Array(buf);
}

export async function gzipSize(chunks) {
  if (typeof CompressionStream === 'undefined') return null;
  const blob = new Blob(chunks);
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  const out = await new Response(stream).arrayBuffer();
  return out.byteLength;
}

// Ładuje moduł, tworzy generator, inicjalizuje scenariusz.
export async function setup(createPythia, { scenario, seed, locateFile, log }) {
  const sc = SCENARIOS[scenario];
  if (!sc) throw new Error(`nieznany scenariusz ${scenario}`);
  const lines = [];
  const sink = (s) => {
    lines.push(s);
    if (lines.length > 400) lines.shift();
    if (log) log(s);
  };
  const t0 = now();
  const M = await createPythia({ print: sink, printErr: sink, locateFile });
  const t1 = now();
  const gen = new M.Generator();
  const t2 = now();
  for (const s of [...COMMON_SETTINGS, ...sc.settings]) {
    if (!gen.readString(s)) throw new Error(`Pythia odrzuciła: ${s}`);
  }
  const ok = gen.init(seed);
  const t3 = now();
  if (!ok) {
    const tail = lines.filter((l) => /error|abort/i.test(l)).slice(-5).join('\n');
    throw new Error(`Pythia::init() nie powiodło się\n${tail}`);
  }
  return {
    M,
    gen,
    lines,
    timings: { moduleMs: t1 - t0, ctorMs: t2 - t1, initMs: t3 - t2 },
  };
}

function grab(gen) {
  return gen.view().slice(); // kopia – widok jest ważny tylko do next()
}

// Determinizm:
//  stream    – pierwsze zdarzenie po init(seed); porównywane między workerami,
//  reseed    – nextWithSeed(s) daje to samo przed i po innych zdarzeniach.
export function determinism(gen, seed) {
  if (!gen.next()) throw new Error('next() zwróciło false');
  const stream = hashF64(grab(gen));
  const s = (seed * 7919 + 17) % 900000000;
  gen.nextWithSeed(s);
  const a = hashF64(grab(gen));
  for (let i = 0; i < 5; i++) gen.next();
  gen.nextWithSeed(s);
  const b = hashF64(grab(gen));
  return { stream, reseedA: a, reseedB: b, reseedOk: a === b };
}

// Pętla pomiarowa: generuje przez durationMs (min. minEvents).
export async function measure(gen, { durationMs, minEvents = 5, warmup = 5, sampleForSize = 0 }) {
  for (let i = 0; i < warmup; i++) gen.next();
  const times = [];
  let failed = 0;
  let sumAll = 0;
  let sumFinal = 0;
  let sumCh = 0;
  let sumBytes = 0;
  const fullChunks = [];
  const compactChunks = [];
  let compactBytes = 0;
  const tStart = now();
  let t = tStart;
  while (t - tStart < durationMs || times.length < minEvents) {
    const ok = gen.next();
    const t2 = now();
    times.push(t2 - t);
    t = t2;
    if (!ok) {
      failed++;
      continue;
    }
    if (times.length <= sampleForSize || sampleForSize < 0) {
      const ev = grab(gen);
      const c = countParticles(ev);
      sumAll += c.all;
      sumFinal += c.final;
      sumCh += c.chargedFinal;
      sumBytes += ev.byteLength;
      fullChunks.push(new Uint8Array(ev.buffer));
      const cmp = compactFinal(ev);
      compactChunks.push(cmp);
      compactBytes += cmp.byteLength;
      t = now(); // koszt analizy poza pomiarem
    }
  }
  const elapsed = t - tStart;
  const nSized = fullChunks.length;
  let size = null;
  if (nSized > 0) {
    const [gzFull, gzCompact] = await Promise.all([
      gzipSize(fullChunks),
      gzipSize(compactChunks),
    ]);
    size = {
      sampled: nSized,
      particlesAll: sumAll / nSized,
      particlesFinal: sumFinal / nSized,
      chargedFinal: sumCh / nSized,
      bytesFull: sumBytes / nSized,
      bytesFullGz: gzFull == null ? null : gzFull / nSized,
      bytesCompact: compactBytes / nSized,
      bytesCompactGz: gzCompact == null ? null : gzCompact / nSized,
    };
  }
  return { n: times.length, failed, elapsedMs: elapsed, times: Float64Array.from(times), size };
}

export function summarize(times) {
  const s = Float64Array.from(times).sort();
  const n = s.length;
  const q = (p) => s[Math.min(n - 1, Math.floor(p * (n - 1)))];
  let sum = 0;
  for (const v of s) sum += v;
  return { n, mean: sum / n, median: q(0.5), p95: q(0.95), p99: q(0.99), max: s[n - 1], min: s[0] };
}

// Werdykt dla scenariusza na podstawie zmierzonych liczb.
export function verdict({ initMs, single, poolEvPerSec }) {
  const T = THRESHOLDS;
  const histSeconds = T.histogramEvents / poolEvPerSec;
  const checks = [
    {
      key: 'click',
      label: `Zdarzenie na klik (p95 < ${T.clickLatencyP95Ms} ms)`,
      value: `${single.p95.toFixed(1)} ms`,
      ok: single.p95 < T.clickLatencyP95Ms,
    },
    {
      key: 'stream',
      label: `Pokaz ciągły, 1 worker (≥ ${T.streamEvPerSec} zdarzeń/s)`,
      value: `${(1000 / single.mean).toFixed(1)} /s`,
      ok: 1000 / single.mean >= T.streamEvPerSec,
    },
    {
      key: 'hist',
      label: `Histogram: ${T.histogramEvents.toLocaleString('pl')} zdarzeń w < ${T.histogramSeconds} s (pula)`,
      value: `${histSeconds.toFixed(1)} s`,
      ok: histSeconds < T.histogramSeconds,
    },
    {
      key: 'init',
      label: `Start sesji: Pythia::init() < ${T.initMs / 1000} s`,
      value: `${(initMs / 1000).toFixed(2)} s`,
      ok: initMs < T.initMs,
    },
  ];
  const live = checks.filter((c) => c.key !== 'init').every((c) => c.ok);
  const liveSome = checks.find((c) => c.key === 'click').ok;
  const initOk = checks.find((c) => c.key === 'init').ok;
  let mode;
  if (live && initOk) mode = 'live';
  else if (live) mode = 'live-init-cache';
  else if (liveSome) mode = 'hybrid';
  else mode = 'cache';
  return { checks, mode };
}

export const MODE_TEXT = {
  live: 'Na żywo. Generacja w workerach wystarcza do wszystkich zastosowań.',
  'live-init-cache':
    'Na żywo, ale start za wolny: cache\'ować inicjalizację (np. MultipartonInteractions:reuseInit) albo startować od zdarzeń z cache\'u, dopóki workery się rozgrzewają.',
  hybrid:
    'Hybryda: pojedyncze zdarzenia na żywo, histogramy z cache\'u (dociąganego z puli w tle).',
  cache: 'Cache: zdarzenia generowane offline i serwowane jako statyczne pliki.',
};
