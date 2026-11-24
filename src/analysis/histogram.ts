// Histogramy na typed arrays (bez obiektów per wpis).

export class Hist1D {
  readonly counts: Float64Array;
  readonly sumw2: Float64Array;
  readonly edges: Float64Array;
  entries = 0;
  underflow = 0;
  overflow = 0;

  constructor(
    readonly nBins: number,
    readonly lo: number,
    readonly hi: number,
    readonly log = false,
  ) {
    this.counts = new Float64Array(nBins);
    this.sumw2 = new Float64Array(nBins);
    this.edges = new Float64Array(nBins + 1);
    for (let i = 0; i <= nBins; i++) {
      this.edges[i] = log ? lo * Math.pow(hi / lo, i / nBins) : lo + ((hi - lo) * i) / nBins;
    }
  }

  bin(x: number): number {
    if (this.log) {
      if (x <= 0) return -1;
      return Math.floor((Math.log(x / this.lo) / Math.log(this.hi / this.lo)) * this.nBins);
    }
    return Math.floor(((x - this.lo) / (this.hi - this.lo)) * this.nBins);
  }

  fill(x: number, w = 1): void {
    this.entries++;
    const b = this.bin(x);
    if (b < 0) this.underflow += w;
    else if (b >= this.nBins) this.overflow += w;
    else {
      this.counts[b] += w;
      this.sumw2[b] += w * w;
    }
  }

  total(): number {
    let s = 0;
    for (const c of this.counts) s += c;
    return s;
  }

  reset(): void {
    this.counts.fill(0);
    this.sumw2.fill(0);
    this.entries = 0;
    this.underflow = 0;
    this.overflow = 0;
  }

  center(i: number): number {
    return this.log ? Math.sqrt(this.edges[i] * this.edges[i + 1]) : 0.5 * (this.edges[i] + this.edges[i + 1]);
  }

  width(i: number): number {
    return this.edges[i + 1] - this.edges[i];
  }
}

export class Hist2D {
  readonly counts: Float64Array;
  entries = 0;
  constructor(
    readonly nx: number,
    readonly xlo: number,
    readonly xhi: number,
    readonly ny: number,
    readonly ylo: number,
    readonly yhi: number,
  ) {
    this.counts = new Float64Array(nx * ny);
  }
  fill(x: number, y: number, w = 1): void {
    const i = Math.floor(((x - this.xlo) / (this.xhi - this.xlo)) * this.nx);
    const j = Math.floor(((y - this.ylo) / (this.yhi - this.ylo)) * this.ny);
    this.entries++;
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return;
    this.counts[j * this.nx + i] += w;
  }
  reset(): void {
    this.counts.fill(0);
    this.entries = 0;
  }
}
