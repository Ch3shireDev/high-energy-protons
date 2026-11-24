// Proste wykresy na canvasie (histogramy z teorią, skan, Dalitz). Bez zależności.
import type { DalitzSnapshot, HistSnapshot } from '../analysis/eeAnalysis';
import type { ScanPoint } from '../analysis/scan';

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function setup(canvas: HTMLCanvasElement) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ui-monospace, monospace';
  return { ctx, w, h };
}

export function fmtNum(v: number, digits = 3): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-2) {
    const e = Math.floor(Math.log10(a));
    return `${(v / 10 ** e).toFixed(digits - 1)}·10${sup(e)}`;
  }
  return v.toPrecision(digits).replace(/\.?0+$/, '');
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
export const sup = (n: number) => String(n).split('').map((c) => SUP[c] ?? c).join('');

export function drawHist(canvas: HTMLCanvasElement, s: HistSnapshot): void {
  const { ctx, w, h } = setup(canvas);
  const L = 40;
  const R = 8;
  const T = 8;
  const B = 22;
  const lo = s.edges[0];
  const hi = s.edges[s.edges.length - 1];
  let ymax = 1;
  s.counts.forEach((c) => (ymax = Math.max(ymax, c + Math.sqrt(c))));
  s.theory?.forEach(([, y]) => (ymax = Math.max(ymax, y)));
  ymax *= 1.15;
  const X = (x: number) => L + ((x - lo) / (hi - lo)) * (w - L - R);
  const Y = (y: number) => h - B - (y / ymax) * (h - T - B);
  // Osie.
  ctx.strokeStyle = css('--line');
  ctx.fillStyle = css('--muted');
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();
  ctx.textAlign = 'center';
  for (let k = 0; k <= 4; k++) {
    const x = lo + ((hi - lo) * k) / 4;
    ctx.fillText(fmtNum(x, 2), X(x), h - 6);
  }
  ctx.textAlign = 'right';
  for (let k = 0; k <= 3; k++) {
    const y = (ymax * k) / 3;
    ctx.fillText(fmtNum(y, 2), L - 4, Y(y) + 4);
  }
  // Dane: punkty z błędami √N.
  ctx.strokeStyle = css('--data');
  ctx.fillStyle = css('--data');
  s.counts.forEach((c, i) => {
    const xc = X(0.5 * (s.edges[i] + s.edges[i + 1]));
    const e = Math.sqrt(c);
    ctx.beginPath();
    ctx.moveTo(xc, Y(c - e));
    ctx.lineTo(xc, Y(c + e));
    ctx.moveTo(X(s.edges[i]) + 1, Y(c));
    ctx.lineTo(X(s.edges[i + 1]) - 1, Y(c));
    ctx.stroke();
  });
  // Teoria.
  if (s.theory) {
    ctx.strokeStyle = css('--theory');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    s.theory.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

export function drawScan(
  canvas: HTMLCanvasElement,
  pts: ScanPoint[],
  theory: { xs: number[]; ys: number[] } | null,
  range: { lo: number; hi: number },
  current: number,
): void {
  const { ctx, w, h } = setup(canvas);
  const L = 46;
  const R = 8;
  const T = 8;
  const B = 22;
  const lx = (x: number) => Math.log(x);
  const X = (x: number) => L + ((lx(x) - lx(range.lo)) / (lx(range.hi) - lx(range.lo))) * (w - L - R);
  const vals = pts.map((p) => ({ x: p.sqrtS, y: p.counts / p.lumi, e: Math.sqrt(Math.max(p.counts, 1)) / p.lumi }));
  let ymin = Infinity;
  let ymax = 0;
  for (const v of vals) {
    if (v.y > 0) ymin = Math.min(ymin, v.y);
    ymax = Math.max(ymax, v.y + v.e);
  }
  if (theory) theory.ys.forEach((y, i) => theory.xs[i] >= range.lo && theory.xs[i] <= range.hi && ((ymax = Math.max(ymax, y)), y > 0 && (ymin = Math.min(ymin, y))));
  if (!Number.isFinite(ymin)) ymin = 0.01;
  ymin = Math.max(ymin * 0.5, 1e-4);
  ymax = Math.max(ymax * 2, ymin * 10);
  const Y = (y: number) => h - B - ((Math.log(Math.max(y, ymin)) - Math.log(ymin)) / (Math.log(ymax) - Math.log(ymin))) * (h - T - B);
  ctx.strokeStyle = css('--line');
  ctx.fillStyle = css('--muted');
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();
  ctx.textAlign = 'center';
  for (const x of [1, 2, 3, 5, 10, 20, 50, 100, 200]) if (x >= range.lo && x <= range.hi) ctx.fillText(String(x), X(x), h - 6);
  ctx.textAlign = 'right';
  for (let e = Math.ceil(Math.log10(ymin)); e <= Math.log10(ymax); e++) ctx.fillText(`10${sup(e)}`, L - 4, Y(10 ** e) + 4);
  if (theory) {
    ctx.strokeStyle = css('--theory');
    ctx.beginPath();
    theory.xs.forEach((x, i) => (i ? ctx.lineTo(X(x), Y(theory.ys[i])) : ctx.moveTo(X(x), Y(theory.ys[i]))));
    ctx.stroke();
  }
  ctx.strokeStyle = css('--data');
  ctx.fillStyle = css('--data');
  for (const v of vals) {
    const x = X(v.x);
    ctx.beginPath();
    ctx.moveTo(x, Y(Math.max(v.y - v.e, ymin)));
    ctx.lineTo(x, Y(v.y + v.e));
    ctx.stroke();
    ctx.fillRect(x - 1.5, Y(v.y) - 1.5, 3, 3);
  }
  ctx.strokeStyle = css('--accent');
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(X(current), T);
  ctx.lineTo(X(current), h - B);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawDalitz(canvas: HTMLCanvasElement, d: DalitzSnapshot): void {
  const { ctx, w, h } = setup(canvas);
  const L = 40;
  const B = 22;
  const size = Math.min(w - L - 8, h - B - 8);
  let max = 0;
  for (const c of d.counts) max = Math.max(max, c);
  const cw = size / d.nx;
  const ch = size / d.ny;
  for (let j = 0; j < d.ny; j++)
    for (let i = 0; i < d.nx; i++) {
      const c = d.counts[j * d.nx + i];
      if (!c) continue;
      const a = Math.sqrt(c / max);
      ctx.fillStyle = `rgba(124,196,255,${0.15 + 0.85 * a})`;
      ctx.fillRect(L + i * cw, h - B - (j + 1) * ch, cw + 0.5, ch + 0.5);
    }
  ctx.strokeStyle = css('--line');
  ctx.strokeRect(L, h - B - size, size, size);
  ctx.fillStyle = css('--muted');
  ctx.textAlign = 'center';
  ctx.fillText(`m²(π⁺π⁰) [GeV²] · 0…${fmtNum(d.xhi, 2)}`, L + size / 2, h - 6);
  ctx.save();
  ctx.translate(12, h - B - size / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('m²(π⁻π⁰)', 0, 0);
  ctx.restore();
}

export interface SpectrumMarker {
  m: number;
  label: string;
}

/** Widmo log–log z błędami i znacznikami mas rezonansów (z data/). */
export function drawSpectrum(
  canvas: HTMLCanvasElement,
  edges: number[],
  y: number[],
  err: number[],
  markers: SpectrumMarker[],
  yLabel: string,
): void {
  const { ctx, w, h } = setup(canvas);
  const L = 50;
  const R = 8;
  const T = 18;
  const B = 22;
  const lo = edges[0];
  const hi = edges[edges.length - 1];
  const X = (x: number) => L + (Math.log(x / lo) / Math.log(hi / lo)) * (w - L - R);
  let ymin = Infinity;
  let ymax = 0;
  y.forEach((v) => {
    if (v > 0) {
      ymin = Math.min(ymin, v);
      ymax = Math.max(ymax, v);
    }
  });
  if (!(ymax > 0)) {
    ymin = 1;
    ymax = 10;
  }
  ymin /= 2;
  ymax *= 3;
  const Y = (v: number) => h - B - ((Math.log(Math.max(v, ymin)) - Math.log(ymin)) / (Math.log(ymax) - Math.log(ymin))) * (h - T - B);
  ctx.strokeStyle = css('--line');
  ctx.fillStyle = css('--muted');
  ctx.beginPath();
  ctx.moveTo(L, T);
  ctx.lineTo(L, h - B);
  ctx.lineTo(w - R, h - B);
  ctx.stroke();
  ctx.textAlign = 'center';
  for (const x of [0.3, 0.5, 1, 2, 3, 5, 10, 20, 30, 50, 100]) if (x >= lo && x <= hi) ctx.fillText(String(x), X(x), h - 6);
  ctx.textAlign = 'right';
  for (let e = Math.ceil(Math.log10(ymin)); e <= Math.log10(ymax); e++) ctx.fillText(`10${sup(e)}`, L - 4, Y(10 ** e) + 4);
  ctx.save();
  ctx.translate(10, T + 4);
  ctx.textAlign = 'left';
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
  // Znaczniki mas.
  ctx.textAlign = 'center';
  for (const mk of markers) {
    if (mk.m < lo || mk.m > hi) continue;
    ctx.strokeStyle = css('--theory');
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(X(mk.m), T);
    ctx.lineTo(X(mk.m), h - B);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = css('--theory');
    ctx.fillText(mk.label, X(mk.m), T - 6);
  }
  // Dane: schodki z błędami.
  ctx.strokeStyle = css('--data');
  ctx.beginPath();
  y.forEach((v, i) => {
    if (!(v > 0)) return;
    const x0 = X(edges[i]);
    const x1 = X(edges[i + 1]);
    ctx.moveTo(x0, Y(v));
    ctx.lineTo(x1, Y(v));
    const xc = 0.5 * (x0 + x1);
    ctx.moveTo(xc, Y(Math.max(v - err[i], ymin)));
    ctx.lineTo(xc, Y(v + err[i]));
  });
  ctx.stroke();
}
