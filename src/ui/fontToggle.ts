// Phase 1 only: switch the heading typeface to compare Fraunces and Bricolage Grotesque.

import { FONTS, type FontId } from '../config';
import { h } from './dom';

const STORAGE_KEY = 'tw-font';

function stored(): FontId | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return FONTS.some((f) => f.id === value) ? (value as FontId) : null;
  } catch {
    return null;
  }
}

function apply(font: FontId) {
  document.documentElement.dataset.font = font;
  try {
    localStorage.setItem(STORAGE_KEY, font);
  } catch {
    // Storage can be unavailable (private browsing); the choice just won't be remembered.
  }
}

export function setupFontToggle(container: HTMLElement) {
  const current = stored() ?? (document.documentElement.dataset.font as FontId | undefined) ?? FONTS[0].id;
  document.documentElement.dataset.font = current;

  container.replaceChildren(
    h(
      'fieldset',
      { class: 'segmented segmented--small' },
      h('legend', null, 'Heading font (for comparing)'),
      FONTS.map((f) =>
        h(
          'label',
          null,
          h('input', {
            type: 'radio',
            name: 'font',
            value: f.id,
            checked: f.id === current,
            onchange: () => apply(f.id),
          }),
          h('span', null, f.label),
        ),
      ),
    ),
  );
}
