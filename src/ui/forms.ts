// "Send a photo of the taps" and "Suggest a beer" (SPEC sections 6.4 and 6.5).

import { sendPhotoReport, sendSuggestion } from '../api';
import type { Catalogue } from '../catalogue';
import { preparePhoto } from '../photo';
import { normalise } from '../search';
import type { Beer, Dispense } from '../types';
import { h } from './dom';

const NOTE_MAX = 280;
let formCount = 0;

function statusLine() {
  return h('p', { class: 'form-status', role: 'status' });
}

function busy(button: HTMLButtonElement, text: string | null) {
  button.disabled = text !== null;
  if (text !== null) {
    button.dataset.label ??= button.textContent ?? '';
    button.textContent = text;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
}

function thanks(form: HTMLElement, message: string) {
  const done = h('p', { class: 'form-done', tabindex: '-1' }, message);
  form.replaceWith(done);
  done.focus();
}

export function photoForm(o: { pubId: string; pubName: string; honeypot: () => string }): HTMLElement {
  const id = `photo-form-${++formCount}`;
  let photo: Blob | null = null;
  let previewUrl: string | null = null;

  const status = statusLine();
  const preview = h('img', { class: 'photo-preview', alt: `Your photo of the taps at ${o.pubName}`, hidden: true });
  const fileInput = h('input', { type: 'file', accept: 'image/*', id: `${id}-file`, class: 'visually-hidden' });
  const note = h('textarea', { id: `${id}-note`, rows: 2, maxlength: NOTE_MAX });
  const count = h('p', { class: 'form-hint', 'aria-live': 'polite' }, `0 of ${NOTE_MAX} characters`);
  const submit = h('button', { type: 'submit', class: 'button button--primary' }, 'Send photo');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    status.textContent = 'Getting the photo ready…';
    try {
      photo = await preparePhoto(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(photo);
      preview.src = previewUrl;
      preview.hidden = false;
      status.textContent = '';
    } catch {
      photo = null;
      preview.hidden = true;
      status.textContent = "That file couldn't be used as a photo. Please try another.";
    }
  });

  note.addEventListener('input', () => {
    count.textContent = `${note.value.length} of ${NOTE_MAX} characters`;
  });

  const form = h(
    'form',
    { class: 'panel-form', 'aria-labelledby': `${id}-title`, novalidate: true },
    h('h3', { id: `${id}-title` }, 'Send a photo of the taps'),
    h(
      'p',
      { class: 'form-help' },
      'Photograph the taps, not people. A person checks each photo to update the list, then deletes it. ' +
        'Location details are removed from the photo before it is sent.',
    ),
    fileInput,
    h('label', { for: `${id}-file`, class: 'button file-button' }, 'Take or choose a photo'),
    preview,
    h('label', { for: `${id}-note` }, 'Note (optional)'),
    note,
    count,
    submit,
    status,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!photo) {
      status.textContent = 'Choose or take a photo first.';
      return;
    }
    busy(submit, 'Sending…');
    status.textContent = '';
    const result = await sendPhotoReport(o.pubId, photo, note.value.trim(), o.honeypot());
    if (result.ok) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      thanks(form, "Thanks! We'll check it and update the list.");
    } else {
      busy(submit, null);
      status.textContent = result.message;
    }
  });

  return form;
}

function findBeer(beers: Beer[], typed: string): Beer | undefined {
  const wanted = normalise(typed);
  if (!wanted) return undefined;
  return beers.find((b) => normalise(b.name) === wanted || b.aliases.some((a) => normalise(a) === wanted));
}

export function suggestForm(o: {
  catalogue: Catalogue;
  honeypot: () => string;
  /** The pub the suggestion is for. Without one, the form asks. */
  pubId?: string;
  beerName?: string;
}): HTMLElement {
  const id = `suggest-form-${++formCount}`;
  const beers = o.catalogue.beers();
  const status = statusLine();

  const pubSelect = o.pubId
    ? null
    : h(
        'select',
        { id: `${id}-pub` },
        h('option', { value: '' }, 'Choose a pub'),
        o.catalogue.pubsByName().map((p) => h('option', { value: p.id }, p.name)),
      );

  const beerInput = h('input', {
    id: `${id}-beer`,
    type: 'text',
    list: `${id}-beers`,
    maxlength: 80,
    autocomplete: 'off',
    value: o.beerName ?? '',
  });
  const dispense = h(
    'fieldset',
    { class: 'segmented' },
    h('legend', { class: 'visually-hidden' }, 'Cask or keg'),
    (['cask', 'keg'] as const).map((d) =>
      h('label', null, h('input', { type: 'radio', name: `${id}-dispense`, value: d }), h('span', null, d === 'cask' ? 'Cask' : 'Keg')),
    ),
  );
  const submit = h('button', { type: 'submit', class: 'button button--primary' }, 'Send suggestion');

  const form = h(
    'form',
    { class: 'panel-form', 'aria-labelledby': `${id}-title`, novalidate: true },
    h('h3', { id: `${id}-title` }, 'Suggest a beer'),
    h('p', { class: 'form-help' }, 'Only beers served on draught, and only regulars, not one-off guest beers.'),
    pubSelect ? [h('label', { for: `${id}-pub` }, 'Which pub?'), pubSelect] : null,
    h('label', { for: `${id}-beer` }, 'Which beer?'),
    beerInput,
    h('datalist', { id: `${id}-beers` }, beers.map((b) => h('option', { value: b.name }))),
    h('p', { class: 'form-label', id: `${id}-dispense-label` }, 'Cask or keg?'),
    dispense,
    submit,
    status,
  );
  dispense.setAttribute('aria-labelledby', `${id}-dispense-label`);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pubId = o.pubId ?? pubSelect?.value ?? '';
    const typed = beerInput.value.trim();
    const chosen = form.querySelector<HTMLInputElement>(`input[name="${id}-dispense"]:checked`)?.value as Dispense | undefined;

    const problem = !pubId ? 'Choose the pub.' : !typed ? 'Type the name of the beer.' : !chosen ? 'Choose cask or keg.' : null;
    if (problem) {
      status.textContent = problem;
      return;
    }

    const beer = findBeer(beers, typed);
    busy(submit, 'Sending…');
    status.textContent = '';
    const result = await sendSuggestion(
      { pubId, beerId: beer?.id ?? null, proposedName: beer ? null : typed, dispense: chosen ?? null },
      o.honeypot(),
    );
    if (result.ok) {
      thanks(form, `Thanks! We'll check ${beer?.name ?? typed} and add it to the list.`);
    } else {
      busy(submit, null);
      status.textContent = result.message;
    }
  });

  return form;
}
