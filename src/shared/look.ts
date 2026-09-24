// How a player's runner looks: hair, hat, eyes and glasses. Purely cosmetic (the physics never
// sees it). Shared so rooms can check what players send and pass it on to everyone else.

export const HAIR = ['none', 'spiky', 'bob', 'long', 'mohawk', 'afro', 'ponytail'] as const;
export const HATS = ['none', 'cap', 'tophat', 'beanie', 'crown', 'party'] as const;
export const EYES = ['dot', 'big', 'sleepy', 'happy', 'angry', 'star'] as const;
export const GLASSES = ['none', 'round', 'square', 'shades', 'monocle', 'goggles'] as const;

export interface Look {
  hair: typeof HAIR[number];
  hat: typeof HATS[number];
  eyes: typeof EYES[number];
  glasses: typeof GLASSES[number];
}

export type LookPart = keyof Look;

/** Each part's choices, in the order the pickers cycle through them. */
export const LOOK_OPTIONS: { [K in LookPart]: readonly Look[K][] } = {
  hair: HAIR, hat: HATS, eyes: EYES, glasses: GLASSES,
};

/** Names shown in the pickers. */
export const LOOK_NAMES: Record<string, string> = {
  none: 'None',
  spiky: 'Spiky',
  bob: 'Bob',
  long: 'Long',
  mohawk: 'Mohawk',
  afro: 'Afro',
  ponytail: 'Ponytail',
  cap: 'Cap',
  tophat: 'Top hat',
  beanie: 'Beanie',
  crown: 'Crown',
  party: 'Party hat',
  dot: 'Dot',
  big: 'Big',
  sleepy: 'Sleepy',
  happy: 'Happy',
  angry: 'Angry',
  star: 'Starry',
  round: 'Round',
  square: 'Square',
  shades: 'Shades',
  monocle: 'Monocle',
  goggles: 'Goggles',
};

export const DEFAULT_LOOK: Look = {
  hair: 'none', hat: 'none', eyes: 'dot', glasses: 'none',
};

/** A look from untrusted data: unknown parts fall back to the default. */
export function sanitizeLook(value: unknown): Look {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const pick = <K extends LookPart>(part: K): Look[K] => {
    const choice = input[part];
    return (LOOK_OPTIONS[part] as readonly unknown[]).includes(choice)
      ? choice as Look[K]
      : DEFAULT_LOOK[part];
  };
  return {
    hair: pick('hair'), hat: pick('hat'), eyes: pick('eyes'), glasses: pick('glasses'),
  };
}
