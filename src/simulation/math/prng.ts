/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seeded deterministic PRNG using Mulberry32 & splitmix32.
 * High quality distribution, 32-bit state, deterministic across platforms.
 */
export class PRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x6d2b79f5;
    }
  }

  /**
   * Returns a float in [0, 1)
   */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a float in [min, max)
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Returns an integer in [min, max] inclusive
   */
  rangeInt(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Returns true with given probability [0, 1]
   */
  chance(p: number): number extends boolean ? boolean : boolean {
    return this.next() < p;
  }

  /**
   * Returns Gaussian (normal) distributed value using Box-Muller transform
   */
  gaussian(mean = 0, stdDev = 1): number {
    let u1 = this.next();
    let u2 = this.next();
    while (u1 <= 1e-7) u1 = this.next();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return z0 * stdDev + mean;
  }

  /**
   * Pick random element from array
   */
  pick<T>(arr: readonly T[]): T {
    const idx = Math.floor(this.next() * arr.length);
    return arr[Math.min(idx, arr.length - 1)];
  }

  /**
   * Fork PRNG state deterministically
   */
  fork(): PRNG {
    return new PRNG((this.next() * 0xffffffff) >>> 0);
  }

  getSeed(): number {
    return this.state;
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/**
 * 2D Value & Simplex-style Gradient Noise with Octaves (Fractal Brownian Motion).
 * Produces smooth organic landscapes, climate maps, and natural formations.
 */
export class SimplexNoise2D {
  private perm: Uint8Array = new Uint8Array(512);

  constructor(prng: PRNG) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates shuffle
    for (let i = 255; i > 0; i--) {
      const j = prng.rangeInt(0, i);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(t: number, a: number, b: number): number {
    return a + t * (b - a);
  }

  private grad(hash: number, x: number, y: number): number {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  /**
   * Sample 2D gradient noise in range [-1, 1]
   */
  noise2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this.fade(xf);
    const v = this.fade(yf);

    const A = this.perm[X] + Y;
    const B = this.perm[X + 1] + Y;

    const g00 = this.grad(this.perm[A], xf, yf);
    const g10 = this.grad(this.perm[B], xf - 1, yf);
    const g01 = this.grad(this.perm[A + 1], xf, yf - 1);
    const g11 = this.grad(this.perm[B + 1], xf - 1, yf - 1);

    const x1 = this.lerp(u, g00, g10);
    const x2 = this.lerp(u, g01, g11);
    return this.lerp(v, x1, x2);
  }

  /**
   * Fractal Brownian Motion (octave layered noise) normalized to [0, 1]
   */
  fbm(x: number, y: number, octaves = 4, persistence = 0.5, lacunarity = 2.0): number {
    let total = 0;
    let frequency = 1;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.noise2D(x * frequency, y * frequency) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    // Normalize from [-maxValue, maxValue] to [0, 1]
    return Math.max(0, Math.min(1, (total / maxValue + 1) * 0.5));
  }
}
