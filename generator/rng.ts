/**
 * The single randomness source for the generator. Everything derives from a
 * seed — never Math.random or wall-clock time — so the same seed produces a
 * byte-identical corpus.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [lo, hi], both inclusive. */
  int(lo: number, hi: number): number
  pick<T>(arr: readonly T[]): T
  shuffle<T>(arr: readonly T[]): T[]
  bernoulli(p: number): boolean
  /** Normal-ish (Irwin-Hall) sample, mean 0, bounded to [-scale, scale]. */
  jitter(scale: number): number
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int(lo, hi) {
      return lo + Math.floor(next() * (hi - lo + 1))
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)]
    },
    shuffle(arr) {
      const out = arr.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const tmp = out[i]
        out[i] = out[j]
        out[j] = tmp
      }
      return out
    },
    bernoulli(p) {
      return next() < p
    },
    jitter(scale) {
      return ((next() + next() + next()) / 1.5 - 1) * scale
    },
  }
}

/** FNV-1a over the stringified parts — stable sub-seeds like hashSeed(seed, traceId, 'content'). */
export function hashSeed(...parts: ReadonlyArray<string | number>): number {
  let h = 0x811c9dc5
  for (const part of parts) {
    const s = String(part)
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    h ^= 0x1f
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
