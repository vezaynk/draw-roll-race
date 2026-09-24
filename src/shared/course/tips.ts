import type { SectionType } from '../types';

/**
 * What to draw for each obstacle: shown before it in the tutorial, and elsewhere the first time
 * you meet it.
 */
const TIPS: Record<SectionType, string> = {
  rolling: 'Hills: a big wheel from the hip rolls fastest.',
  bumps: 'Draw a half circle from the hip. It becomes a wheel.',
  stairs: 'Steps: draw a straight line down from the hip. It becomes spinning spokes that climb.',
  trenches: 'Trenches: long spokes step over the gaps.',
  chasm: 'Chasm: long spokes reach across. A wheel falls in.',
  swell: 'Big wave: a big wheel carries you over.',
  ramps: 'Sawtooth: a big wheel rolls over the teeth.',
  tunnel: 'Low tunnel: draw a small wheel so you fit.',
  hurdles: 'Hurdles: long spokes step over them.',
  drop: 'Drop ahead: any shape survives the fall.',
  incline: 'Steep climb: a big wheel grips best.',
  pool: 'Water: long spokes paddle through it.',
  ledge: 'Wall: draw a long line from the shoulder. The spinning arm pulls you up.',
  crawl: 'Low tunnel, then a wall: small wheel first, then a long arm.',
  conveyor: 'The belt pushes you back: a big fast wheel wins.',
  ice: 'Ice: a big wheel keeps its grip.',
  mud: 'Mud: long spokes wade through it.',
  spikepit: 'Spikes break any limb that touches them. Vault the pit with long spokes.',
  spikeroof: 'Spiked ceiling: keep your arms short or they shatter.',
  wind: 'Headwind: a big wheel pushes through.',
  lowgrav: 'Low gravity: you float, so keep rolling.',
  bounce: 'Bounce pads: hold on, you will bounce.',
  blocks: 'Hanging blocks over spikes: an arm with a hook can swing you across.',
};

export default TIPS;
