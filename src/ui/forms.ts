// "Send a photo of the taps" (up to 4 photos) and "Suggest a beer" (SPEC sections 6.4 and 6.5).

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
    delete button.dataset.label;
  }
}

/** Replaces a sent form with a thank-you, plus a button to open a fresh copy of the form. */
function thanks(form: HTMLElement, message: string, again: { label: string; make: () => HTMLElement }) {
  const button = h('button', { type: 'button', class: 'button' }, again.label);
  const done = h('div', { class: 'form-sent' }, h('p', { class: 'form-done', tabindex: '-1' }, message), button);
  button.addEventListener('click', () => {
    const fresh = again.make();
    done.replaceWith(fresh);
    const title = fresh.querySelector<HTMLElement>('h3');
    title?.setAttribute('tabindex', '-1');
    title?.focus();
  });
  form.replaceWith(done);
  done.querySelector<HTMLElement>('.form-done')?.focus();
}

const MAX_PHOTOS = 4;

export function photoForm(o: { pubId: string; pubName: string; honeypot: () => string }): HTMLElement {
  const id = `photo-form-${++formCount}`;
  const photos: { blob: Blob; url: string }[] = [];

  const status = statusLine();
  const previews = h('ul', { class: 'photo-previews', 'aria-label': 'Photos to send' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, id: `${id}-file`, class: 'visually-hidden' });
  const chooseLabel = h('label', { for: `${id}-file`, class: 'button file-button' }, 'Take or choose photos');
  const note = h('textarea', { id: `${id}-note`, rows: 2, maxlength: NOTE_MAX });
  const count = h('p', { class: 'form-hint', 'aria-live': 'polite' }, `0 of ${NOTE_MAX} characters`);
  const submit = h('button', { type: 'submit', class: 'button button--primary' }, 'Send photos');

  function renderPreviews() {
    previews.replaceChildren(
      ...photos.map((photo, i) => {
        const remove = h('button', { type: 'button', class: 'link-button', 'aria-label': `Remove photo ${i + 1}` }, 'Remove');
        remove.addEventListener('click', () => {
          URL.revokeObjectURL(photo.url);
          photos.splice(i, 1);
          status.textContent = '';
          renderPreviews();
          chooseLabel.focus();
        });
        return h('li', null, h('img', { src: photo.url, alt: `Photo ${i + 1} of the taps at ${o.pubName}` }), remove);
      }),
    );
    const full = photos.length >= MAX_PHOTOS;
    fileInput.disabled = full;
    chooseLabel.hidden = full;
    chooseLabel.textContent = photos.length ? 'Add more photos' : 'Take or choose photos';
    submit.textContent = photos.length === 1 ? 'Send photo' : 'Send photos';
  }

  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    status.textContent = files.length > 1 ? 'Getting the photos ready…' : 'Getting the photo ready…';
    // Don't let the form be sent until every photo is ready.
    busy(submit, 'Getting photos ready…');
    let failed = 0;
    for (const file of files.slice(0, room)) {
      try {
        const blob = await preparePhoto(file);
        photos.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        failed++;
      }
    }
    busy(submit, null);
    renderPreviews();
    const notes = [
      files.length > room
        ? `You can send up to ${MAX_PHOTOS} photos at a time, so only ${room === 1 ? '1 more was' : `${room} more were`} added.`
        : '',
      failed ? `${failed === 1 ? 'One file' : `${failed} files`} couldn't be used as a photo.` : '',
    ].filter(Boolean);
    status.textContent = notes.join(' ');
  });

  note.addEventListener('input', () => {
    count.textContent = `${note.value.length} of ${NOTE_MAX} characters`;
  });

  const form = h(
    'form',
    { class: 'panel-form', 'aria-labelledby': `${id}-title`, novalidate: true },
    h('h3', { id: `${id}-title` }, 'Send photos of the taps'),
    h(
      'p',
      { class: 'form-help' },
      `Photograph the taps, not people. You can send up to ${MAX_PHOTOS} photos at once. A person checks them to update ` +
        'the list, then deletes them. Location details are removed from photos before they are sent.',
    ),
    previews,
    fileInput,
    chooseLabel,
    h('label', { for: `${id}-note` }, 'Note (optional)'),
    note,
    count,
    submit,
    status,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return; // still getting photos ready, or already sending
    if (!photos.length) {
      status.textContent = 'Choose or take a photo first.';
      return;
    }
    busy(submit, 'Sending…');
    status.textContent = '';
    const result = await sendPhotoReport(o.pubId, photos.map((p) => p.blob), note.value.trim(), o.honeypot());
    if (result.ok) {
      const sent = photos.length;
      for (const photo of photos) URL.revokeObjectURL(photo.url);
      thanks(form, `Thanks! We'll check ${sent === 1 ? 'your photo' : 'your photos'} and update the list.`, {
        label: 'Send more photos',
        make: () => photoForm(o),
      });
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
    { class: 'segmented segmented--even' },
    h('legend', { class: 'visually-hidden' }, 'Keg or cask'),
    (['keg', 'cask'] as const).map((d) =>
      h(
        'label',
        null,
        h('input', { type: 'radio', name: `${id}-dispense`, value: d, checked: d === 'keg' }),
        h('span', null, d === 'cask' ? 'Cask' : 'Keg'),
      ),
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
    h('p', { class: 'form-label', id: `${id}-dispense-label` }, 'Keg or cask?'),
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
      thanks(form, `Thanks! We'll check ${beer?.name ?? typed} and add it to the list.`, {
        label: 'Suggest another beer',
        make: () => suggestForm(o),
      });
    } else {
      busy(submit, null);
      status.textContent = result.message;
    }
  });

  return form;
}
