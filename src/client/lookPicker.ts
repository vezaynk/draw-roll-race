// The Customize window (the 🎨 button on the start screen): a preview of your runner's head and
// a picker for each part (hair, hat, eyes, glasses). Choosing needs a player saved with a
// passkey; until then the window shows your default look (picked by your player hash) and
// offers to save.
import { LOOK_NAMES, LOOK_OPTIONS, randomLook } from '../shared/look';
import type { Look, LookPart } from '../shared/look';
import { onAccountChange, saveWithPasskey } from './account';
import { chooseLook } from './appearance';
import { byId, el } from './dom';
import drawHead from './render/look';
import { state } from './state';
import { save } from './storage';

const PARTS: [LookPart, string][] = [['hair', 'Hair'], ['hat', 'Hat'], ['eyes', 'Eyes'], ['glasses', 'Glasses']];

const panel = () => byId('look-menu');

function drawPreview(): void {
  const canvas = byId<HTMLCanvasElement>('look-preview');
  const scale = window.devicePixelRatio || 1;
  const size = canvas.clientWidth || 112;
  canvas.width = size * scale;
  canvas.height = size * scale;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  g.clearRect(0, 0, size, size);
  drawHead(g, size / 2, size * 0.62, size * 0.24, state.look);
}

/** Shows the look worn now, and locks the pickers unless the player is saved. */
function refresh(): void {
  const locked = !save.signedIn;
  PARTS.forEach(([part]) => {
    byId(`look-${part}`).textContent = LOOK_NAMES[state.look[part]] ?? state.look[part];
  });
  panel().querySelectorAll<HTMLButtonElement>('.look-picker button, #look-shuffle')
    .forEach((button) => {
      button.disabled = locked;
    });
  byId('look-locked').hidden = !locked;
  drawPreview();
}

function choose(look: Look): void {
  chooseLook(look);
  refresh();
}

/** Moves one part to the previous (-1) or next (+1) choice. */
function step(part: LookPart, by: number): void {
  const options = LOOK_OPTIONS[part] as readonly string[];
  const i = options.indexOf(state.look[part]);
  choose({ ...state.look, [part]: options[(i + by + options.length) % options.length] });
}

function arrow(label: string, text: string, onClick: () => void): HTMLElement {
  const button = el('button', '', text);
  button.setAttribute('type', 'button');
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function note(text: string, warning = false): void {
  const out = byId('look-note');
  out.textContent = text;
  out.classList.toggle('warn', warning);
}

export function openLookMenu(): void {
  if (state.racing) return;
  note('');
  panel().hidden = false;
  refresh();
}

export function closeLookMenu(): void {
  panel().hidden = true;
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
  byId('look-shuffle').addEventListener('click', () => choose(randomLook()));
  byId('look-save').addEventListener('click', () => saveWithPasskey(note));
  byId('look-close').addEventListener('click', closeLookMenu);
  byId('start-look').addEventListener('click', openLookMenu);
  // Saving (or signing in) unlocks the pickers, and may bring a look saved on another device.
  onAccountChange(() => {
    if (!panel().hidden) refresh();
  });
}
