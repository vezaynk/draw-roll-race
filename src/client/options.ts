// The Options panel (⚙): your player, sound, vibration, ghost and drawing-pad size.
import { byId } from './dom';
import { showLookPicker } from './lookPicker';
import { resize } from './render/scene';
import { state } from './state';
import { persist, save } from './storage';
import type { PadSize, SaveData } from './storage';

const PAD_SIZES: readonly PadSize[] = ['small', 'normal', 'large'];

export function applySettings(): void {
  document.body.classList.toggle('pad-small', save.pad === 'small');
  document.body.classList.toggle('pad-large', save.pad === 'large');
}

function panel(): HTMLElement {
  return byId('options');
}

export function closeOptions(): void {
  panel().hidden = true;
}

function openOptions(): void {
  if (state.racing) return;
  byId<HTMLInputElement>('opt-sound').checked = save.sound;
  byId<HTMLInputElement>('opt-vibrate').checked = save.vibrate;
  byId<HTMLInputElement>('opt-ghost').checked = save.ghost;
  byId<HTMLSelectElement>('opt-pad').value = save.pad;
  panel().hidden = false;
  showLookPicker();
}

type Toggle = 'sound' | 'vibrate' | 'ghost';

/** Saves a checkbox option when it changes. */
function bindToggle(id: string, key: Toggle): void {
  byId<HTMLInputElement>(id).addEventListener('change', (e) => {
    save[key] = (e.target as HTMLInputElement).checked;
    persist();
  });
}

/** Saves a select option when it changes. */
function bindSelect(id: string, apply: (value: string, data: SaveData) => void): void {
  byId<HTMLSelectElement>(id).addEventListener('change', (e) => {
    apply((e.target as HTMLSelectElement).value, save);
    persist();
  });
}

export default function initOptions(): void {
  byId('menu-btn').addEventListener('click', () => (panel().hidden ? openOptions() : closeOptions()));
  byId('options-close').addEventListener('click', closeOptions);
  bindSelect('opt-pad', (v) => {
    save.pad = PAD_SIZES.find((size) => size === v) ?? 'normal';
    applySettings();
    resize();
  });
  bindToggle('opt-sound', 'sound');
  bindToggle('opt-vibrate', 'vibrate');
  bindToggle('opt-ghost', 'ghost');
  applySettings();
}
