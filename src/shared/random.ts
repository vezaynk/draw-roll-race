// Seeded random numbers, so every browser and the server build the same courses.
// xorshift and FNV hashing are bit operations by definition.

export type Rand = () => number;

/** xorshift32: a small, fast generator of numbers in [0, 1). */
export function rng(seed: number): Rand {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** A 32-bit seed from any value (FNV-1a over its string form). */
export function hashSeed(value: unknown): number {
  const str = String(value);
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randNum(r: Rand, min: number, max: number): number {
  return min + (max - min) * r();
}

export function randInt(r: Rand, min: number, max: number): number {
  return Math.round(randNum(r, min, max));
}

/** A random number in [range[0], range[1]). */
export function pick(r: Rand, [min, max]: readonly [number, number]): number {
  return randNum(r, min, max);
}
