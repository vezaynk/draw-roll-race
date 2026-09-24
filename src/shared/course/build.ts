// Turns a stage's sections into terrain: ground and ceiling heights every CFG.STEP units, plus
// water, surfaces (belts, ice, spikes, bounce pads) and zones (wind, low gravity, roof spikes).
import { CFG } from '../config';
import { cos, sin } from '../fmath';
import type {
  Course, CourseSection, Fluid, PlanStep, SectionParams, SectionType, Surface, Zone,
} from '../types';
import { SECTIONS } from './sections';
import { stageSections } from './stages';

type HeightFn = (t: number) => number;

/** Writes terrain samples left to right, keeping track of the current height and effects. */
class TerrainWriter {
  x = 0;

  y = 400;

  surf: Surface | null = null;

  fluid: Fluid | null = null;

  zone: Zone | null = null;

  readonly ground: number[] = [];

  readonly ceil: number[] = [];

  readonly fluids: (Fluid | null)[] = [];

  readonly surfs: (Surface | null)[] = [];

  readonly zones: (Zone | null)[] = [];

  /** Appends `len` world units; f(t) gives the ground height at local offset t. */
  seg(len: number, f: HeightFn, ceiling?: HeightFn): void {
    const n = Math.round(len / CFG.STEP);
    for (let i = 0; i < n; i += 1) {
      const t = i * CFG.STEP;
      this.ground.push(f(t));
      this.ceil.push(ceiling ? ceiling(t) : -Infinity);
      this.fluids.push(this.fluid);
      this.surfs.push(this.surf);
      this.zones.push(this.zone);
    }
    this.x += n * CFG.STEP;
  }

  /** Level ground at the current height. */
  flat(len: number): void {
    const y0 = this.y;
    this.seg(len, () => y0);
  }

  /** A straight slope from the current height ending `dy` lower (negative: higher). */
  slope(len: number, dy: number): void {
    const y0 = this.y;
    this.seg(len, (t) => y0 + (dy * t) / len);
    this.y += dy;
  }
}

/** Half a cosine wave from 0 up to 1 and back over `period`. */
const bump = (t: number, period: number): number => (1 - cos((2 * Math.PI * t) / period)) / 2;

/** Builds one section. May return extra facts about it (where a wall starts). */
type Builder = (writer: TerrainWriter, p: SectionParams) => Pick<CourseSection, 'wallX'> | void;

const BUILDERS: Record<SectionType, Builder> = {
  rolling(writer, p) {
    const y0 = writer.y;
    const L = p.len;
    const h = (t: number) => p.amp * (28 * sin(t / 170) + 13 * sin(t / 73 + 0.7)
      + 6 * sin(t / 37 + 2.4));
    writer.seg(L, (t) => y0 + sin((Math.PI * t) / L) * h(t));
  },
  bumps(writer, p) {
    const y0 = writer.y;
    writer.seg(p.len, (t) => y0 - p.amp * bump(t, p.period));
  },
  stairs(writer, p) {
    for (let k = 0; k < p.n; k += 1) {
      writer.y -= p.h;
      writer.flat(p.tread);
    }
    const down = p.n * p.h;
    writer.slope(Math.max(200, down * 2.6), down);
  },
  trenches(writer, p) {
    const y0 = writer.y;
    for (let k = 0; k < p.n; k += 1) {
      writer.seg(p.gap, () => y0);
      writer.seg(p.w, () => y0 + p.d);
    }
    writer.seg(p.gap, () => y0);
  },
  chasm(writer, p) {
    const y0 = writer.y;
    writer.seg(80, () => y0);
    writer.seg(p.w, () => y0 + p.d);
    writer.seg(80, () => y0);
  },
  swell(writer, p) {
    const y0 = writer.y;
    writer.seg(p.len, (t) => y0 - p.dh * bump(t, p.len));
  },
  ramps(writer, p) {
    for (let k = 0; k < p.n; k += 1) {
      const y0 = writer.y;
      writer.seg(p.len, (t) => y0 - (p.h * t) / p.len);
    }
  },
  tunnel(writer, p) {
    const y0 = writer.y;
    writer.flat(60);
    writer.seg(p.len, () => y0, () => y0 - CFG.CLEARANCE);
    writer.flat(60);
  },
  hurdles(writer, p) {
    const y0 = writer.y;
    for (let k = 0; k < p.n; k += 1) {
      writer.seg(p.gap, () => y0);
      writer.seg(12, () => y0 - p.h);
    }
    writer.seg(p.gap, () => y0);
  },
  drop(writer, p) {
    writer.flat(40);
    writer.y += p.dh;
    writer.flat(40);
  },
  incline(writer, p) {
    writer.slope(p.len, -p.rise);
  },
  pool(writer, p) {
    const y0 = writer.y;
    const { d } = p;
    writer.fluid = { level: y0, kind: 'water' };
    writer.seg(60, (t) => y0 + (d * t) / 60);
    writer.seg(p.len - 360, () => y0 + d);
    writer.seg(300, (t) => y0 + d * (1 - t / 300));
    writer.fluid = null;
  },
  ledge(writer, p) {
    writer.flat(60);
    writer.y -= p.h;
    writer.flat(170);
    writer.slope(Math.max(240, p.h * 3.4), p.h);
  },
  crawl(writer, p) {
    const y0 = writer.y;
    writer.flat(60);
    writer.seg(p.tunnel, () => y0, () => y0 - CFG.CLEARANCE);
    writer.flat(180);
    const wallX = writer.x;
    writer.y -= p.h;
    writer.flat(170);
    writer.slope(Math.max(240, p.h * 3.75), p.h);
    return { wallX };
  },
  conveyor(writer, p) {
    writer.surf = { belt: -p.belt };
    writer.flat(p.len);
    writer.surf = null;
  },
  ice(writer, p) {
    writer.surf = { mu: 0.3 };
    writer.slope(p.len, -p.rise);
    writer.surf = null;
  },
  mud(writer, p) {
    const y0 = writer.y;
    const { d } = p;
    writer.fluid = { level: y0, kind: 'mud' };
    writer.seg(60, (t) => y0 + (d * t) / 60);
    writer.seg(p.len - 180, () => y0 + d);
    writer.seg(120, (t) => y0 + d * (1 - t / 120));
    writer.fluid = null;
  },
  spikepit(writer, p) {
    const y0 = writer.y;
    writer.flat(80);
    writer.seg(10, (t) => y0 + (p.d * t) / 10);
    writer.surf = { spikes: true };
    writer.seg(p.w, () => y0 + p.d);
    writer.surf = null;
    writer.seg(10, (t) => y0 + p.d * (1 - t / 10));
    writer.flat(80);
  },
  spikeroof(writer, p) {
    const y0 = writer.y;
    writer.flat(60);
    writer.zone = { roofSpikes: true };
    writer.seg(p.len, (t) => y0 - 4 * bump(t, 60), () => y0 - p.clear);
    writer.zone = null;
    writer.flat(60);
  },
  wind(writer, p) {
    writer.zone = { wind: -p.force };
    writer.flat(p.len);
    writer.zone = null;
  },
  lowgrav(writer, p) {
    const y0 = writer.y;
    writer.zone = { grav: p.grav };
    writer.seg(p.len, (t) => y0 + p.dh * bump(t, p.len));
    writer.zone = null;
  },
  bounce(writer, p) {
    const y0 = writer.y;
    writer.surf = { bounce: CFG.BOUNCE };
    writer.seg(p.len, (t) => y0 - p.amp * bump(t, 90));
    writer.surf = null;
  },
};

/** Where a CPU should change shape around a section. */
function planFor(sec: CourseSection): PlanStep[] {
  if (sec.type === 'crawl' && sec.wallX !== undefined) {
    return [
      { x: sec.from - 70, pose: 'mini' },
      { x: sec.wallX - 110, pose: 'climber' },
      { x: sec.to + 20, pose: 'wheel' },
    ];
  }
  const { pose } = SECTIONS[sec.type];
  return pose ? [{ x: sec.from - 70, pose }, { x: sec.to + 20, pose: 'wheel' }] : [];
}

export default function buildCourse(stage: number): Course {
  const w = new TerrainWriter();
  const sections: CourseSection[] = [];
  const plan: PlanStep[] = [{ x: -Infinity, pose: 'wheel' }];

  w.flat(300);
  stageSections(stage).forEach(({ type, p }) => {
    const from = w.x;
    const extra = BUILDERS[type](w, p);
    const sec: CourseSection = {
      type, label: SECTIONS[type].label, from, to: w.x, ...extra,
    };
    sections.push(sec);
    plan.push(...planFor(sec));
    w.flat(90);
  });
  w.flat(60);
  const finishX = w.x;
  w.flat(1000);

  return {
    ground: w.ground,
    ceil: w.ceil,
    ceilLine: w.ceil.map((v) => (v === -Infinity ? -5000 : v)),
    fluid: w.fluids,
    surf: w.surfs,
    zone: w.zones,
    sections,
    plan,
    finishX,
    startX: CFG.START_X,
    length: w.x,
  };
}
