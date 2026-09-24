// Tuning constants shared by the browser, the server and the simulation.

export const CFG = {
  /** Horizontal spacing of terrain samples (world units). */
  STEP: 2,
  /** Collision radius of every drawn line. */
  R: 4,
  /** Gravity. */
  G: 1300,
  /** Fixed physics step (seconds). */
  DT: 1 / 240,
  /** Limb torque = MOTOR × body weight × limb reach. */
  MOTOR: 2.6,
  /** Maximum limb spin (rad/s). */
  WMAX: 12,
  /** Restitution of ordinary ground. */
  REST: 0.1,
  /** Friction coefficient. */
  MU: 0.9,
  /** Horizontal air damping (1/s). */
  AIR: 0.03,
  WATER_LIFT: 1.8,
  WATER_DRAG: 4,
  MUD_LIFT: 0.6,
  MUD_DRAG: 9,
  /** Pad units → world units. */
  SCALE: 0.55,
  /** Sample spacing along strokes (pad units). */
  SPACING: 9,
  START_X: 120,
  /** Tunnel height. */
  CLEARANCE: 76,
  /** How far spikes stick up from the floor (or down from a ceiling). */
  SPIKE_H: 12,
  /** Seconds new limbs are safe from spikes after a redraw. */
  IMMUNE: 1.0,
  /** Restitution of bounce pads. */
  BOUNCE: 0.8,
} as const;

/** Drawing pad size (pad units). */
export const PAD_W = 320;
export const PAD_H = 200;

/** The stick figure template on the drawing pad. */
export const FIG = {
  head: { x: 160, y: 44, r: 15 },
  neck: { x: 160, y: 60 },
  shoulder: { x: 160, y: 68 },
  hip: { x: 160, y: 120 },
} as const;
