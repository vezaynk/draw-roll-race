// The Look block in Options: a preview of your runner's head and a picker for each part (hair,
// hat, eyes, glasses). Changes are saved at once, shown on the pad and sent to your room.
import { LOOK_NAMES, LOOK_OPTIONS } from '../shared/look';
import type { Look, LookPart } from '../shared/look';
import { byId, el } from './dom';
import { renderPad } from './pad';
import drawHead from './render/look';
import { hooks } from './state';
import { persist, save } from './storage';

const PARTS: [LookPart, string][] = [['hair', 'Hair'], ['hat', 'Hat'], ['eyes', 'Eyes'], ['glasses', 'Glasses']];

function drawPreview(): void {
  const canvas = byId<HTMLCanvasElement>('look-preview');
  const scale = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 112;
  canvas.width = size * scale;
  canvas.height = size * scale;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.clearRect(0, 0, size, size);
  drawHead(g, size / 2, size * 0.62, size * 0.24, save.look);
}

function refresh(): void {
  PARTS.forEach(([part]) => {
    byId(`look-${part}`).textContent = LOOK_NAMES[save.look[part]] ?? save.look[part];
  });
  drawPreview();
}

function setLook(look: Look): void {
  save.look = look;
  persist();
  refresh();
  renderPad();
  hooks.onLook?.();
}

/** Moves one part to the previous (-1) or next (+1) choice. */
function step(part: LookPart, by: number): void {
  const options = LOOK_OPTIONS[part] as readonly string[];
  const i = options.indexOf(save.look[part]);
  const next = options[(i + by + options.length) % options.length];
  setLook({ ...save.look, [part]: next });
}

function shuffle(): void {
  const any = (part: LookPart) => {
    const options = LOOK_OPTIONS[part] as readonly string[];
    return options[Math.floor(Math.random() * options.length)];
  };
  setLook({
    hair: any('hair'), hat: any('hat'), eyes: any('eyes'), glasses: any('glasses'),
  } as Look);
}

function arrow(label: string, text: string, onClick: () => void): HTMLElement {
  const button = el('button', '', text);
  button.setAttribute('type', 'button');
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

/** Redraws the preview (the panel may have been hidden when the look last changed). */
export function showLookPicker(): void {
  refresh();
}

export default function initLookPicker(): void {
  byId('look-pickers').replaceChildren(...PARTS.map(([part, name]) => {
    const row = el('div', 'look-picker');
    const value = el('span', 'value');
    value.id = `look-${part}`;
    value.setAttribute('aria-live', 'polite');
    row.append(
      el('span', '', name),
      arrow(`Previous ${name.toLowerCase()}`, '◀', () => step(part, -1)),
      value,
      arrow(`Next ${name.toLowerCase()}`, '▶', () => step(part, 1)),
    );
    return row;
  }));
  byId('look-shuffle').addEventListener('click', shuffle);
  refresh();
}
