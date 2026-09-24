const cssVar = (name: string): string => getComputedStyle(document.documentElement)
  .getPropertyValue(name).trim();

/** Page colours, from the CSS variables in style.css. */
export const COLORS = {
  ink: cssVar('--ink'),
  player: cssVar('--player'),
  cpu: cssVar('--cpu'),
  ground: cssVar('--ground'),
};

/** Solo CPUs; red is always you. */
export const CPU_COLORS = ['#3a7bd5', '#2fa36b', '#c9892b', '#9a5bd6', '#e0508f', '#1f9fb0', '#7a8a2e'];

export const GHOST_COLOR = '#8d96a8';

/** The daily leader's ghost. */
export const LEADER_COLOR = '#c9a23a';
