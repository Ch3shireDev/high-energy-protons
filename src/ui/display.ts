// Wspólny widok zdarzenia: scena, oś czasu (log), HUD, aureola, efekty, sonifikacja.
// Czyta bufor zdarzenia tylko do odczytu.

import { AudioDeck } from '../audio/deck';
import { displayName, tryParticle } from '../physics/particles';
import { C_MM_PER_NS, S_PER_NS } from '../physics/units';
import { buildAureola } from '../render/aureola';
import { CATEGORIES } from '../render/colors';
import { SceneView } from '../render/scene';
import { buildTrackView } from '../render/tracks';
import { DEFAULT_DETECTOR, type DetectorConfig } from '../sim/detector';
import { F, STRIDE, type SimEvent } from '../sim/event';
import { Trajectory } from '../sim/helix';
import { rebuildTracks } from '../sim/tracks';
import type { DecayInfo } from '../workers/eeProtocol';
import { fmtNum, sup } from './plot';

export const LOG_T_MIN = -27; // s
export const LOG_T_MAX = -8; // s
/** Odcinek przed zderzeniem: liniowo od −PRE_NS do 0 na pierwszych PRE_U osi. */
export const PRE_NS = 3;
export const PRE_U = 0.12;
const uToNs = (u: number) => {
  if (u < PRE_U) return -PRE_NS * (1 - u / PRE_U);
  const x = (u - PRE_U) / (1 - PRE_U);
  return Math.pow(10, LOG_T_MIN + (LOG_T_MAX - LOG_T_MIN) * x) / S_PER_NS;
};
const nsToU = (t: number) => {
  if (t <= 0) return PRE_U * (1 + t / PRE_NS);
  const x = (Math.log10(Math.max(t, 1e-40) * S_PER_NS) - LOG_T_MIN) / (LOG_T_MAX - LOG_T_MIN);
  return PRE_U + (1 - PRE_U) * x;
};

/**
 * Wiązki przed zderzeniem (wpisy statusu −12 z rekordu, tylko odczyt): prosta od t = −PRE_NS
 * do wierzchołka zderzenia w t = 0, z prędkością p/E·c.
 */
function addBeamTracks(ev: SimEvent, tracks: (Trajectory | null)[]): void {
  for (let i = 1; i < ev.size; i++) {
    const b = i * STRIDE;
    if (ev.data[b + F.status] !== -12 || tracks[i]) continue;
    const p: [number, number, number, number] = [ev.data[b + F.px], ev.data[b + F.py], ev.data[b + F.pz], ev.data[b + F.e]];
    const k = C_MM_PER_NS / p[3];
    const x0: [number, number, number] = [-p[0] * k * PRE_NS, -p[1] * k * PRE_NS, -p[2] * k * PRE_NS];
    tracks[i] = new Trajectory([{ t0: -PRE_NS, t1: 0, x0, p0: p, omega: 0 }], 'decay');
  }
}

export interface ShowOptions {
  title: string;
  subtitle: string;
  /** Poziom wierności pokazywany w HUD (np. „LO + przestrzeń fazowa”). */
  fidelity: string;
  autoplay: boolean;
  sweepSeconds: number;
  minPt?: number;
  maxEta?: number;
}

const $ = (id: string) => document.getElementById(id)!;

export class EventDisplay {
  scene: SceneView;
  det: DetectorConfig = DEFAULT_DETECTOR;
  deck = new AudioDeck();
  u = 1;
  playing = false;
  sweep = 6;
  private ev: SimEvent | null = null;
  private decays: DecayInfo[] = [];
  private lastT = 0;
  private fpsAcc = { n: 0, t: 0, fps: 0 };
  onFps: (fps: number) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new SceneView(canvas);
    this.scene.buildDetector(this.det);
    const slider = $('time') as HTMLInputElement;
    slider.addEventListener('input', () => {
      this.playing = false;
      this.u = Number(slider.value) / 1000;
      this.updatePlayButton();
    });
    $('play').addEventListener('click', () => {
      if (!this.playing && this.u >= 0.999) this.u = 0;
      this.playing = !this.playing;
      this.updatePlayButton();
    });
    $('science').addEventListener('change', (e) => {
      const on = (e.target as HTMLInputElement).checked;
      this.scene.fx.science = on;
      document.body.classList.toggle('science', on);
    });
    const bright = $('brightness') as HTMLInputElement;
    const saved = Number(localStorage.getItem('hep.brightness'));
    if (saved > 0) bright.value = String(saved);
    this.scene.fx.brightness = Number(bright.value);
    bright.addEventListener('input', () => {
      this.scene.fx.brightness = Number(bright.value);
      localStorage.setItem('hep.brightness', bright.value);
    });
    $('sonify').addEventListener('change', (e) => (this.deck.sonify = (e.target as HTMLInputElement).checked));
    ($('audioFile') as HTMLInputElement).addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (!f) return;
      try {
        await this.deck.load(f);
        $('audioLabel').textContent = `♪ ${f.name}`;
      } catch (err) {
        toast(`Nie udało się odczytać pliku audio: ${(err as Error).message}`);
      }
    });
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.tick(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private updatePlayButton() {
    $('play').textContent = this.playing ? '❚❚' : '▶';
  }

  show(ev: SimEvent, decays: DecayInfo[], o: ShowOptions): void {
    this.ev = ev;
    this.decays = decays;
    const tracks = rebuildTracks(ev, this.det);
    addBeamTracks(ev, tracks);
    this.scene.setTracks(buildTrackView(ev, tracks, o.minPt ?? 0, o.maxEta ?? Infinity));

    // Aureola: rozpad rezonansu z procesu (focus) albo pierwszy 2-ciałowy z rozkładem kątowym.
    const focus =
      decays.find((d) => d.parent === ev.meta.focus && d.angular && d.axisRest) ??
      decays.find((d) => d.angular && d.angular.kind !== 'isotropic' && d.axisRest);
    if (focus && focus.angular && focus.axisRest) {
      this.scene.setAureola(buildAureola(focus.angular, focus.axisRest, focus.dirRest), [focus.vertex[0], focus.vertex[1], focus.vertex[2]]);
    } else this.scene.setAureola(null);

    // Znaczniki rozpadów na osi czasu.
    const ticks = $('ticks');
    ticks.innerHTML = '';
    for (const d of decays) {
      const u = nsToU(d.vertex[3]);
      if (u < 0 || u > 1) continue;
      const i = document.createElement('i');
      i.style.left = `${u * 100}%`;
      i.title = `${displayName(ev.data[d.parent * STRIDE + F.id])}: ${fmtTime(d.vertex[3])}`;
      ticks.appendChild(i);
    }
    this.renderHud(ev, decays, o, focus ?? null);
    this.sweep = o.sweepSeconds;
    if (o.autoplay) {
      // Start przed zderzeniem – błysk odpala się w tick() przy przejściu przez t = 0.
      this.u = 0;
      this.playing = true;
    } else {
      this.u = 1;
      this.playing = false;
      this.scene.fx.flash = 1;
    }
    this.lastT = uToNs(this.u);
    this.updatePlayButton();
  }

  private renderHud(ev: SimEvent, decays: DecayInfo[], o: ShowOptions, focus: DecayInfo | null) {
    let nFinal = 0;
    let nCharged = 0;
    for (let i = 1; i < ev.size; i++) {
      if (ev.data[i * STRIDE + F.status] > 0) {
        nFinal++;
        if (ev.data[i * STRIDE + F.charge3] !== 0) nCharged++;
      }
    }
    let focusLine = '';
    if (focus) {
      const id = ev.data[focus.parent * STRIDE + F.id];
      const m = Math.sqrt(Math.max(0, focus.P[3] ** 2 - focus.P[0] ** 2 - focus.P[1] ** 2 - focus.P[2] ** 2));
      const gamma = m > 0 ? focus.P[3] / m : 1;
      const t0 = ev.data[focus.parent * STRIDE + F.t_ns];
      const tLab = focus.vertex[3] - t0;
      focusLine = `<div class="decay">${esc(displayName(id))} → ${esc(
        Array.from({ length: focus.daughters[1] - focus.daughters[0] + 1 }, (_, k) => displayName(ev.data[(focus.daughters[0] + k) * STRIDE + F.id])).join(' '),
      )} · t<sub>lab</sub> = ${fmtTime(tLab)}, τ<sub>własny</sub> = ${fmtTime(tLab / gamma)}, γ = ${fmtNum(gamma, 3)}</div>`;
    }
    const longLived = decays.filter((d) => {
      const p = tryParticle(ev.data[d.parent * STRIDE + F.id]);
      return p && p.ctau_mm > 1;
    }).length;
    $('hud').innerHTML = `
      <div class="title">${esc(o.title)}</div>
      <div class="sub">${o.subtitle} · ${nFinal} cząstek w stanie końcowym (${nCharged} naładowanych) · ${decays.length} rozpadów${longLived ? `, w tym ${longLived} z odsuniętym wierzchołkiem` : ''}</div>
      <div class="sub"><span class="badge lvl">${esc(o.fidelity)}</span></div>
      ${ev.meta.toy ? '<div class="toybar"><span class="badge toy">MODEL ZABAWKOWY</span> jety bez hadronizacji Pythii – zachowują czteropęd i ładunek, ale skład i krotności są orientacyjne.</div>' : ''}
      ${focusLine}
      <div class="sub" id="fps"></div>`;
  }

  legendHtml(): string {
    return `<div class="legend">${CATEGORIES.map(
      (c) => `<span><i style="background: rgb(${c.rgb.map((x) => Math.round(x * 255)).join(',')})"></i>${c.label}</span>`,
    ).join('')}</div><p class="note">Odcień = rodzaj cząstki i znak ładunku, jasność = energia (skala log). Biała kropka = wierzchołek rozpadu.</p>`;
  }

  tick(dt: number): void {
    if (this.playing) {
      this.u = Math.min(1, this.u + dt / this.sweep);
      if (this.u >= 1) {
        this.playing = false;
        this.updatePlayButton();
      }
      ($('time') as HTMLInputElement).value = String(Math.round(this.u * 1000));
    }
    const t = uToNs(this.u);
    $('tLabel').textContent = t < 0 ? `t = −${fmtNum(-t, 2)} ns (przed zderzeniem)` : `t = ${fmtTime(t)}`;
    // Błysk zderzenia (tylko prezentacja) w chwili przejścia przez t = 0.
    if (this.lastT < 0 && t >= 0) this.scene.fx.flash = 1;
    // Sonifikacja: rozpady, których czas właśnie minął.
    if (this.ev && t > this.lastT) {
      for (const d of this.decays) {
        if (d.vertex[3] > this.lastT && d.vertex[3] <= t) {
          const m = Math.sqrt(Math.max(0, d.P[3] ** 2 - d.P[0] ** 2 - d.P[1] ** 2 - d.P[2] ** 2));
          this.deck.blip(m, d.vertex[0] / 1000);
        }
      }
    }
    this.lastT = t;
    const fx = this.scene.fx;
    fx.beat = this.deck.beat(dt);
    fx.flash *= Math.exp(-dt * 2.5);
    this.scene.frame(t);
    const f = this.fpsAcc;
    f.n++;
    f.t += dt;
    if (f.t > 1) {
      f.fps = f.n / f.t;
      f.n = 0;
      f.t = 0;
      const el = document.getElementById('fps');
      if (el) el.textContent = `${Math.round(f.fps)} fps${fx.science ? ' · Science mode' : ''}`;
      this.onFps(f.fps);
    }
  }
}

export function fmtTime(t_ns: number): string {
  const s = t_ns * S_PER_NS;
  if (s === 0) return '0 s';
  if (s < 0) return `−${fmtNum(-t_ns, 2)} ns`;
  const e = Math.floor(Math.log10(s));
  return `${(s / 10 ** e).toFixed(1)}·10${sup(e)} s`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

let toastTimer = 0;
export function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}
