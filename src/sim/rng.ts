// Deterministyczny RNG: xoshiro128** (32-bit stan × 4), seed przez splitmix32.
// Jedyny generator losowy w fizyce. Przekazywany jawnie, nigdy globalnie.

function splitmix32(a: number): () => number {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** Haszuje dowolne części (liczby, napisy) do 32-bitowego seeda. FNV-1a + mieszanie. */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  const mix = (b: number) => {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const p of parts) {
    const s = typeof p === 'number' ? `n${p}` : `s${p}`;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      mix(c);
      mix(c >>> 8);
    }
    mix(0x1f);
  }
  return splitmix32(h)();
}

export class Rng {
  private s = new Uint32Array(4);

  constructor(seed: number) {
    const sm = splitmix32(seed >>> 0);
    for (let i = 0; i < 4; i++) this.s[i] = sm();
    if ((this.s[0] | this.s[1] | this.s[2] | this.s[3]) === 0) this.s[0] = 1;
  }

  /** Niezależny strumień potomny, wyznaczony przez stan i etykietę (nie zmienia rodzica). */
  static derive(seed: number, ...label: (number | string)[]): Rng {
    return new Rng(hashSeed(seed, ...label));
  }

  /** Następne 32 bity bez znaku. */
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** Jednorodnie w [0, 1), 53 bity. */
  uniform(): number {
    const hi = this.nextU32() >>> 5; // 27 bitów
    const lo = this.nextU32() >>> 6; // 26 bitów
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Jednorodnie w (0, 1] – bezpieczne pod logarytm. */
  uniformPos(): number {
    return 1 - this.uniform();
  }

  range(a: number, b: number): number {
    return a + (b - a) * this.uniform();
  }

  /** Rozkład wykładniczy o średniej 1. */
  exp(): number {
    return -Math.log(this.uniformPos());
  }

  /** Normalny N(0,1), Box–Muller (bez buforowania drugiej wartości – prostszy determinizm). */
  normal(): number {
    const u = this.uniformPos();
    const v = this.uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Poisson(mean). Knuth dla małych średnich, PTRS (Hörmann) dla dużych. */
  poisson(mean: number): number {
    if (!(mean > 0)) return 0;
    if (mean < 30) {
      const L = Math.exp(-mean);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= this.uniform();
      } while (p > L);
      return k - 1;
    }
    const slam = Math.sqrt(mean);
    const loglam = Math.log(mean);
    const b = 0.931 + 2.53 * slam;
    const a = -0.059 + 0.02483 * b;
    const invalpha = 1.1239 + 1.1328 / (b - 3.4);
    const vr = 0.9277 - 3.6224 / (b - 2);
    for (;;) {
      const U = this.uniform() - 0.5;
      const V = this.uniform();
      const us = 0.5 - Math.abs(U);
      const k = Math.floor(((2 * a) / us + b) * U + mean + 0.43);
      if (us >= 0.07 && V <= vr) return k;
      if (k < 0 || (us < 0.013 && V > us)) continue;
      if (
        Math.log(V) + Math.log(invalpha) - Math.log(a / (us * us) + b) <=
        -mean + k * loglam - lgamma(k + 1)
      )
        return k;
    }
  }

  /** Indeks wybrany proporcjonalnie do wag (nieujemnych). */
  pick(weights: ArrayLike<number>): number {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += weights[i];
    let r = this.uniform() * sum;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** Losowy kierunek izotropowy: [x, y, z]. */
  isotropic(): [number, number, number] {
    const c = 2 * this.uniform() - 1;
    const s = Math.sqrt(Math.max(0, 1 - c * c));
    const phi = 2 * Math.PI * this.uniform();
    return [s * Math.cos(phi), s * Math.sin(phi), c];
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

/** ln Γ(x), Lanczos (g = 7). */
export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
