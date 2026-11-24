#!/usr/bin/env node
// Generator katalogu data/ – jedyne źródło stałych fizycznych w kodzie TS.
//
// Źródło prawdy: Pythia 8 (ta sama wersja, co build WASM, wasm/pythia-version.env):
//   share/Pythia8/xmldoc/ParticleData.xml  → data/particles.json
//   share/Pythia8/xmldoc/*.xml (parametry)  → data/sm.json
//   src/StandardModel.cc (AlphaEM, CoupSM) → data/sm.json
// Dzięki temu silnik rozpadów w TS i Pythia w WASM używają identycznych danych.
//
// Użycie: npm run data   (PYTHIA_DIR=/ścieżka/do/pythia8xxx – opcjonalnie)
// Bez PYTHIA_DIR: szuka wasm/.cache/pythia<ver>, a jeśli nie ma – pobiera tarball
// z pythia.org i sprawdza SHA-256.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(ROOT, 'wasm/pythia-version.env'), 'utf8')
    .split('\n')
    .filter((l) => /^\w+=/.test(l))
    .map((l) => l.split('=')),
);
const VERSION = env.PYTHIA_VERSION;
const SHA = env.PYTHIA_SHA256;

function pythiaDir() {
  if (process.env.PYTHIA_DIR) return process.env.PYTHIA_DIR;
  const cache = join(ROOT, 'wasm/.cache');
  const dir = join(cache, `pythia${VERSION}`);
  if (existsSync(join(dir, 'share/Pythia8/xmldoc/ParticleData.xml'))) return dir;
  mkdirSync(cache, { recursive: true });
  const tgz = join(cache, `pythia${VERSION}.tgz`);
  if (!existsSync(tgz)) {
    const url = `https://pythia.org/releases/pythia83/pythia${VERSION}.tgz`;
    console.log(`pobieram ${url}`);
    execFileSync('curl', ['-fsSL', '-o', tgz, url], { stdio: 'inherit' });
  }
  const got = createHash('sha256').update(readFileSync(tgz)).digest('hex');
  if (got !== SHA) throw new Error(`zła suma SHA-256 ${tgz}: ${got}`);
  execFileSync('tar', ['xzf', tgz, '-C', cache], { stdio: 'inherit' });
  return dir;
}

const DIR = pythiaDir();
const XMLDOC = join(DIR, 'share/Pythia8/xmldoc');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// ---------------------------------------------------------------- cząstki
const attrs = (s) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const num = (v, d = 0) => (v === undefined ? d : Number(v));

const pdXml = readFileSync(join(XMLDOC, 'ParticleData.xml'), 'utf8');
const particles = {};
for (const m of pdXml.matchAll(/<particle\s([\s\S]*?)>([\s\S]*?)<\/particle>/g)) {
  const a = attrs(m[1]);
  const id = Number(a.id);
  // Model Standardowy i hadrony (w tym kody 9xxxxxx, np. f0(980) = 9010221);
  // bez SUSY, wzbudzonych fermionów, technikoloru, dodatkowych wymiarów, hidden valley.
  if (id >= 1000000 && id < 9000000) continue;
  const channels = [...m[2].matchAll(/<channel\s([\s\S]*?)\/>/g)].map((c) => {
    const ca = attrs(c[1]);
    const ch = {
      br: num(ca.bRatio),
      products: ca.products.trim().split(/\s+/).map(Number),
    };
    if (ca.meMode) ch.meMode = Number(ca.meMode);
    if (ca.onMode && ca.onMode !== '1') ch.onMode = Number(ca.onMode);
    return ch;
  });
  const p = {
    id,
    name: a.name,
    spinType: num(a.spinType),
    chargeType: num(a.chargeType),
    colType: num(a.colType),
    m0: num(a.m0),
  };
  if (a.antiName) p.antiName = a.antiName;
  if (a.mWidth) p.mWidth = num(a.mWidth);
  if (a.mMin) p.mMin = num(a.mMin);
  if (a.mMax) p.mMax = num(a.mMax);
  if (a.tau0) p.tau0_mm = num(a.tau0); // Pythia: tau0 w mm/c, czyli cτ w mm
  if (channels.length) p.channels = channels;
  particles[id] = p;
}

// ---------------------------------------------------------------- parametry SM
function parm(file, name) {
  const xml = readFileSync(join(XMLDOC, file), 'utf8');
  const re = new RegExp(`<(?:parm|mode|modepick)\\s+name="${name.replace(/[.:]/g, '\\$&')}"\\s+default="([^"]+)"`);
  const m = xml.match(re);
  if (!m) throw new Error(`brak ${name} w ${file}`);
  return Number(m[1]);
}

const smCc = readFileSync(join(DIR, 'src/StandardModel.cc'), 'utf8');
function cArray(name) {
  const m = smCc.match(new RegExp(`${name.replace(/[:[\]]/g, '\\$&')}\\[\\d+\\]\\s*=\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`brak ${name} w StandardModel.cc`);
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const f = s.match(/^(-?[\d.]+)\s*\/\s*([\d.]+)$/);
      return f ? Number(f[1]) / Number(f[2]) : Number(s);
    });
}
function cScalar(name) {
  const m = smCc.match(new RegExp(`${name.replace(/[:]/g, '\\$&')}\\s*=\\s*([\\d.eE+-]+);`));
  if (!m) throw new Error(`brak ${name} w StandardModel.cc`);
  return Number(m[1]);
}

const sm = {
  alphaEM0: parm('StandardModelParameters.xml', 'StandardModel:alphaEM0'),
  alphaEMmZ: parm('StandardModelParameters.xml', 'StandardModel:alphaEMmZ'),
  sin2thetaW: parm('StandardModelParameters.xml', 'StandardModel:sin2thetaW'),
  sin2thetaWbar: parm('StandardModelParameters.xml', 'StandardModel:sin2thetaWbar'),
  GF: parm('StandardModelParameters.xml', 'StandardModel:GF'),
  alphaSmZ: parm('CouplingsAndScales.xml', 'SigmaProcess:alphaSvalue'),
  alphaSorder: parm('CouplingsAndScales.xml', 'SigmaProcess:alphaSorder'),
  // Biegnące alpha_EM rzędu 1, dokładnie jak Pythia (AlphaEM w StandardModel.cc).
  alphaEMrun: {
    mZ: cScalar('const double AlphaEM::MZ'),
    q2Step: cArray('const double AlphaEM::Q2STEP'),
    bRun: cArray('const double AlphaEM::BRUNDEF'),
  },
  // Ładunek e_f i 2·T3 (a_f) dla |id| = 0..19 (CoupSM w StandardModel.cc).
  ef: cArray('const double CoupSM::efSave'),
  af: cArray('const double CoupSM::afSave'),
};

// ---------------------------------------------------------------- zapis
const source = {
  generator: 'scripts/gen-data.mjs',
  pythiaVersion: VERSION,
  files: {
    'ParticleData.xml': sha256(pdXml),
    'StandardModel.cc': sha256(smCc),
  },
};
const out = join(ROOT, 'data');
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'particles.json'),
  JSON.stringify({ source, units: { mass: 'GeV', width: 'GeV', tau0: 'mm (c·τ)' }, particles }, null, 0) + '\n',
);
writeFileSync(join(out, 'sm.json'), JSON.stringify({ source, ...sm }, null, 2) + '\n');
console.log(`data/particles.json: ${Object.keys(particles).length} cząstek; data/sm.json zapisane (Pythia ${VERSION}).`);
