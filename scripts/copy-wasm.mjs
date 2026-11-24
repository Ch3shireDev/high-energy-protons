#!/usr/bin/env node
// Kopiuje build Pythii (wasm/dist) i stronę spike'a (wasm/spike) do public/,
// skąd Vite serwuje je w dev i kopiuje do dist/ przy buildzie.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(ROOT, 'wasm/dist');
const dst = join(ROOT, 'public/pythia');
const files = ['pythia.mjs', 'pythia.wasm', 'pythia.data', 'build-info.json'];

if (!files.every((f) => existsSync(join(src, f)))) {
  console.warn('⚠ Brak wasm/dist – tryb pp nie zadziała. Zbuduj Pythię: ./wasm/build.sh');
} else {
  mkdirSync(dst, { recursive: true });
  for (const f of files) copyFileSync(join(src, f), join(dst, f));
  console.log(`Pythia WASM → public/pythia/ (${files.length} plików)`);
}

const spikeSrc = join(ROOT, 'wasm/spike');
const spikeDst = join(ROOT, 'public/spike');
mkdirSync(spikeDst, { recursive: true });
for (const f of readdirSync(spikeSrc)) {
  if (f === 'node-bench.mjs') continue;
  copyFileSync(join(spikeSrc, f), join(spikeDst, f));
}
console.log('spike → public/spike/');
