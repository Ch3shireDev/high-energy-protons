// Ślady jako jedna geometria LineSegments z atrybutem czasu na wierzchołek.
// Przewijanie osi czasu = zmiana uniformu uTime; shader odrzuca fragmenty z przyszłości.

import * as THREE from 'three';
import { tryParticle } from '../physics/particles';
import { F, STRIDE, type SimEvent } from '../sim/event';
import type { Trajectory } from '../sim/helix';
import type { V3 } from '../physics/vec4';
import { categoryOf, energyBrightness } from './colors';

const MM = 1 / 1000; // mm → m (jednostka sceny)

const trackVert = /* glsl */ `
  attribute float aTime;
  attribute vec3 aColor;
  varying float vTime;
  varying vec3 vColor;
  void main() {
    vTime = aTime;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const trackFrag = /* glsl */ `
  uniform float uTime;
  uniform float uGlow;
  uniform float uBright;
  varying float vTime;
  varying vec3 vColor;
  void main() {
    if (vTime > uTime) discard;
    // Świeżość w skali log czasu: najnowszy odcinek jaśniejszy (tylko prezentacja).
    // Przed zderzeniem (t < 0) skala liniowa [ns], po – logarytmiczna.
    float fresh = (uTime > 0.0 && vTime > 0.0)
      ? exp(-2.0 * max(0.0, log(uTime / vTime)))
      : exp(-max(0.0, uTime - vTime) / 0.4);
    gl_FragColor = vec4(vColor * uBright * (1.0 + uGlow * 1.5 * fresh), 1.0);
  }
`;
const pointVert = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aTime;
  uniform float uTime;
  uniform float uPixel;
  varying vec3 vColor;
  varying float vHide;
  void main() {
    vColor = aColor;
    vHide = aTime > uTime ? 1.0 : 0.0;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * uPixel / max(0.2, -mv.z), 1.5, 9.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const pointFrag = /* glsl */ `
  uniform float uBright;
  varying vec3 vColor;
  varying float vHide;
  void main() {
    if (vHide > 0.5) discard;
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    float a = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vColor * 1.2 * uBright, a * min(1.0, uBright));
  }
`;

export interface TrackView {
  group: THREE.Group;
  /** brightness: mnożnik jasności (tylko prezentacja; proporcje kolorów bez zmian). */
  setTime(t_ns: number, glow: number, brightness: number): void;
  dispose(): void;
  /** Czasy wszystkich wierzchołków rozpadów [ns] – znaczniki na osi czasu. */
  vertexTimes: number[];
}

export function buildTrackView(ev: SimEvent, tracks: (Trajectory | null)[], minPt = 0, maxEta = Infinity): TrackView {
  const pos: number[] = [];
  const col: number[] = [];
  const tim: number[] = [];
  const heads: { i: number; t: Trajectory; color: [number, number, number] }[] = [];
  const d = ev.data;
  const tmp: V3 = [0, 0, 0];

  for (let i = 1; i < ev.size; i++) {
    const tr = tracks[i];
    if (!tr) continue;
    const b = i * STRIDE;
    const id = d[b + F.id];
    const px = d[b + F.px];
    const py = d[b + F.py];
    const pt = Math.hypot(px, py);
    const beam = d[b + F.status] === -12;
    if (d[b + F.status] > 0 && pt < minPt) continue;
    // Cząstki lecące w rurę wiązki (poza pokryciem detektora) – opcjonalnie pomijane; wiązki zostają.
    if (!beam && Number.isFinite(maxEta) && (pt === 0 || Math.abs(Math.asinh(d[b + F.pz] / pt)) > maxEta)) continue;
    const info = tryParticle(id);
    const cat = categoryOf(id, d[b + F.charge3] / 3, info?.ctau_mm ?? Infinity);
    const k = energyBrightness(d[b + F.e]) * (cat.key === 'nu' ? 0.5 : 1);
    const c: [number, number, number] = [cat.rgb[0] * k, cat.rgb[1] * k, cat.rgb[2] * k];
    for (const s of tr.segments) {
      const dur = s.t1 - s.t0;
      if (!(dur > 0)) continue;
      const n = s.omega === 0 ? 1 : Math.min(800, Math.max(4, Math.ceil((Math.abs(s.omega) * dur) / 0.06)));
      let prevT = s.t0;
      tr.positionAt(prevT, tmp);
      let prev: V3 = [tmp[0] * MM, tmp[1] * MM, tmp[2] * MM];
      for (let j = 1; j <= n; j++) {
        const t = s.t0 + (dur * j) / n;
        tr.positionAt(t, tmp);
        const cur: V3 = [tmp[0] * MM, tmp[1] * MM, tmp[2] * MM];
        pos.push(...prev, ...cur);
        col.push(...c, ...c);
        tim.push(prevT, t);
        prev = cur;
        prevT = t;
      }
    }
    if (tr.tEnd > tr.tStart) heads.push({ i, t: tr, color: c });
  }

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lineGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  lineGeo.setAttribute('aTime', new THREE.Float32BufferAttribute(tim, 1));
  const lineMat = new THREE.ShaderMaterial({
    vertexShader: trackVert,
    fragmentShader: trackFrag,
    uniforms: { uTime: { value: 0 }, uGlow: { value: 1 }, uBright: { value: 1 } },
    transparent: false,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;

  // Głowy cząstek (aktualna pozycja) – aktualizowane analitycznie co klatkę.
  const hp = new Float32Array(heads.length * 3);
  const hc = new Float32Array(heads.length * 3);
  const hs = new Float32Array(heads.length);
  const ht = new Float32Array(heads.length);
  heads.forEach((h, k) => {
    hc.set(h.color, k * 3);
    hs[k] = 0.6;
  });
  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.BufferAttribute(hp, 3));
  headGeo.setAttribute('aColor', new THREE.BufferAttribute(hc, 3));
  headGeo.setAttribute('aSize', new THREE.BufferAttribute(hs, 1));
  headGeo.setAttribute('aTime', new THREE.BufferAttribute(ht, 1));
  const pointMat = new THREE.ShaderMaterial({
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    uniforms: { uTime: { value: 0 }, uPixel: { value: 60 }, uBright: { value: 1 } },
    transparent: true,
    depthWrite: false,
    // Zwykłe mieszanie: setki głów w jednym wierzchołku nie sumują się do białej plamy.
    blending: THREE.NormalBlending,
  });
  const headPts = new THREE.Points(headGeo, pointMat);
  headPts.frustumCulled = false;

  // Wierzchołki rozpadów – pojawiają się w chwili rozpadu.
  const vtx: number[] = [];
  const vtxT: number[] = [];
  for (let i = 1; i < ev.size; i++) {
    const d1 = d[i * STRIDE + F.daughter1];
    if (d1 <= 0 || d[i * STRIDE + F.status] >= 0) continue;
    if (!tracks[i]) continue;
    const vb = d1 * STRIDE;
    vtx.push(d[vb + F.x_mm] * MM, d[vb + F.y_mm] * MM, d[vb + F.z_mm] * MM);
    vtxT.push(d[vb + F.t_ns]);
  }
  const vGeo = new THREE.BufferGeometry();
  vGeo.setAttribute('position', new THREE.Float32BufferAttribute(vtx, 3));
  vGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(vtx.map(() => 0.9), 3));
  vGeo.setAttribute('aSize', new THREE.Float32BufferAttribute(vtxT.map(() => 0.9), 1));
  vGeo.setAttribute('aTime', new THREE.Float32BufferAttribute(vtxT, 1));
  const vMat = pointMat.clone();
  const vPts = new THREE.Points(vGeo, vMat);
  vPts.frustumCulled = false;

  const group = new THREE.Group();
  group.add(lines, headPts, vPts);
  const tmp2: V3 = [0, 0, 0];

  return {
    group,
    vertexTimes: vtxT,
    setTime(t: number, glow: number, brightness: number) {
      lineMat.uniforms.uTime.value = t;
      lineMat.uniforms.uGlow.value = glow;
      lineMat.uniforms.uBright.value = brightness;
      pointMat.uniforms.uBright.value = brightness;
      vMat.uniforms.uBright.value = brightness;
      vMat.uniforms.uTime.value = t;
      pointMat.uniforms.uTime.value = t;
      heads.forEach((h, k) => {
        // Głowa widoczna tylko w trakcie lotu.
        const alive = t >= h.t.tStart && t < h.t.tEnd;
        ht[k] = alive ? -1 : 1e30;
        if (!alive) return;
        h.t.positionAt(t, tmp2);
        hp[k * 3] = tmp2[0] * MM;
        hp[k * 3 + 1] = tmp2[1] * MM;
        hp[k * 3 + 2] = tmp2[2] * MM;
      });
      headGeo.attributes.position.needsUpdate = true;
      headGeo.attributes.aTime.needsUpdate = true;
    },
    dispose() {
      lineGeo.dispose();
      lineMat.dispose();
      headGeo.dispose();
      pointMat.dispose();
      vGeo.dispose();
      vMat.dispose();
    },
  };
}
