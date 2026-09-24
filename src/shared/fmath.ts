// Sine, cosine and hypot built only from +, -, ×, ÷ and square root. JavaScript engines round
// those exactly the same way, but Math.sin, Math.cos and Math.hypot may differ in the last bit
// between browsers. The server replays daily runs step by step, so the physics must give the same
// numbers everywhere: shared code uses these instead of Math's.
//
// The polynomials are the fdlibm kernels (accurate to about one unit in the last place on
// [-π/4, π/4]); the argument is reduced by multiples of π/2 in two parts, which is accurate for
// the angles a race produces (well under a million radians).

const PIO2_HI = 1.57079632673412561417e+00;
const PIO2_LO = 6.07710050650619224932e-11;
const INV_PIO2 = 6.36619772367581382433e-01;

const S1 = -1.66666666666666324348e-01;
const S2 = 8.33333333332248946124e-03;
const S3 = -1.98412698298579493134e-04;
const S4 = 2.75573137070700676789e-06;
const S5 = -2.50507602534068634195e-08;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-02;
const C2 = -1.38888888888741095749e-03;
const C3 = 2.48015872894767294178e-05;
const C4 = -2.75573143513906633035e-07;
const C5 = 2.08757232129817482790e-09;
const C6 = -1.13596475577881948265e-11;

function kernelSin(x: number): number {
  const z = x * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + z * x * (S1 + z * r);
}

function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
}

/** The quadrant (0-3) of x and x reduced to [-π/4, π/4]. */
function reduce(x: number): [number, number] {
  const n = Math.round(x * INV_PIO2);
  return [n & 3, (x - n * PIO2_HI) - n * PIO2_LO];
}

export function sin(x: number): number {
  const [q, y] = reduce(x);
  if (q === 0) return kernelSin(y);
  if (q === 1) return kernelCos(y);
  if (q === 2) return -kernelSin(y);
  return -kernelCos(y);
}

export function cos(x: number): number {
  const [q, y] = reduce(x);
  if (q === 0) return kernelCos(y);
  if (q === 1) return -kernelSin(y);
  if (q === 2) return -kernelCos(y);
  return kernelSin(y);
}

/** Length of (x, y). Plain square root: fine for game-sized numbers. */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
