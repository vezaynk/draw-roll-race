const cssVar = (name: string): string => getComputedStyle(document.documentElement)
  .getPropertyValue(name).trim();

/** Page colours, from the CSS variables in style.css. */
export const COLORS = {
  ink: cssVar('--ink'),
  player: cssVar('--player'),
  cpu: cssVar('--cpu'),
  ground: cssVar('--ground'),
};

export const GHOST_COLOR = '#8d96a8';
