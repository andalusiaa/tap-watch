// The Pubs tab: the test banner switch, and adding or changing a pub (name, address,
// map position, operator, open or closed).

import { lookupPostcode, tidyPostcode } from '../location';
import { h } from '../ui/dom';
import { adminApi, AdminError, SignedOut, type AdminOperator, type EditablePub, type PubChanges } from './adminApi';

const OPERATOR_TYPES: [AdminOperator['type'], string][] = [
  ['independent', 'Independent'],
  ['pubco', 'Pub company'],
  ['brewery', 'Brewery'],
];
const NEW_OPERATOR = '__new__';

interface Options {
  panel: HTMLElement;
  /** Called after a save, so the tap list picker can pick up new or renamed pubs. */
  onPubsChanged: () => void;
  onSignedOut: () => void;
}

let formCount = 0;

/** Two or more equal buttons, like the public site's Keg or cask. */
function choice<T extends string>(name: string, labelledBy: string, options: [T, string][], value: T): HTMLFieldSetElement {
  return h(
    'fieldset',
    { class: 'segmented segmented--even', 'aria-labelledby': labelledBy },
    options.map(([v, label]) => h('label', null, h('input', { type: 'radio', name, value: v, checked: v === value }), h('span', null, label))),
  );
}

const chosen = (group: HTMLFieldSetElement) => group.querySelector<HTMLInputElement>('input:checked')?.value ?? '';

function bannerCard(sample: boolean, o: Options, reload: () => void): HTMLElement {
  const status = h('p', { class: 'form-status', role: 'status' });
  const button = h('button', { type: 'button', class: 'button' }, sample ? 'Hide the banner' : 'Show the banner again');
  button.addEventListener('click', async () => {
    const question = sample
      ? 'Hide the "made up for testing" banner? Do this once the tap lists are real.'
      : 'Show the "made up for testing" banner again?';
    if (!confirm(question)) return;
    button.disabled = true;
    status.textContent = 'Saving…';
    try {
      await adminApi.setSample(!sample);
      reload();
    } catch (error) {
      if (error instanceof SignedOut) return o.onSignedOut();
      if (error instanceof AdminError) status.textContent = error.message;
      else status.textContent = "Couldn't save. Check your connection and try again.";
      button.disabled = false;
    }
  });
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'banner-title' },
    h('h2', { id: 'banner-title' }, 'Test banner'),
    h(
      'p',
      null,
      sample
        ? 'On. The public site says the tap lists are made up for testing.'
        : 'Off. The public site presents the tap lists as real.',
    ),
    button,
    status,
  );
}

function pubForm(pub: EditablePub | null, operators: AdminOperator[], o: Options, saved: (id: string) => void): HTMLElement {
  const id = `pub-form-${++formCount}`;
  const field = (label: string, input: HTMLElement, help?: string) => [
    h('label', { for: input.id }, label),
    input,
    help ? h('p', { class: 'form-help' }, help) : null,
  ];

  const name = h('input', { id: `${id}-name`, type: 'text', maxlength: 80, value: pub?.name ?? '', autocomplete: 'off' });
  const address = h('input', { id: `${id}-address`, type: 'text', maxlength: 120, value: pub?.address ?? '', autocomplete: 'off' });
  const postcode = h('input', {
    id: `${id}-postcode`,
    type: 'text',
    maxlength: 8,
    value: pub?.postcode ?? '',
    autocapitalize: 'characters',
    autocomplete: 'off',
  });
  const lat = h('input', { id: `${id}-lat`, type: 'number', step: 'any', inputmode: 'decimal', value: pub?.lat ?? '' });
  const lng = h('input', { id: `${id}-lng`, type: 'number', step: 'any', inputmode: 'decimal', value: pub?.lng ?? '' });
  const mapLink = h('a', { target: '_blank', rel: 'noopener noreferrer' }, 'Check the position on Google Maps');
  const updateMapLink = () => {
    mapLink.setAttribute('href', `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat.value},${lng.value}`)}`);
    mapLink.hidden = !lat.value || !lng.value;
  };
  lat.addEventListener('input', updateMapLink);
  lng.addEventListener('input', updateMapLink);
  updateMapLink();

  const positionStatus = h('p', { class: 'form-help', role: 'status' });
  const fromPostcode = h('button', { type: 'button', class: 'button' }, 'Set position from postcode');
  async function positionFromPostcode(): Promise<boolean> {
    const tidy = tidyPostcode(postcode.value);
    if (!tidy || !tidy.includes(' ')) {
      positionStatus.textContent = 'Enter the full postcode first, like E17 4NE.';
      return false;
    }
    positionStatus.textContent = 'Looking up the postcode…';
    try {
      const found = await lookupPostcode(tidy);
      if (!found) {
        positionStatus.textContent = `We couldn't find ${tidy}.`;
        return false;
      }
      postcode.value = tidy;
      lat.value = String(Math.round(found[0] * 1e6) / 1e6);
      lng.value = String(Math.round(found[1] * 1e6) / 1e6);
      updateMapLink();
      positionStatus.textContent = 'Position set to the middle of the postcode. It can be up to 100 m out, so check it on the map.';
      return true;
    } catch {
      positionStatus.textContent = "Couldn't look up the postcode. Check your connection.";
      return false;
    }
  }
  fromPostcode.addEventListener('click', () => void positionFromPostcode());

  const operator = h(
    'select',
    { id: `${id}-operator` },
    h('option', { value: '' }, 'Not known'),
    operators.map((op) => h('option', { value: op.id, selected: op.id === pub?.operator_id }, op.name)),
    h('option', { value: NEW_OPERATOR }, 'Add a new operator…'),
  );
  const newOperatorName = h('input', { id: `${id}-new-operator`, type: 'text', maxlength: 80, autocomplete: 'off' });
  const newOperatorType = choice(`${id}-new-operator-type`, `${id}-new-operator-type-label`, OPERATOR_TYPES, 'independent');
  const newOperator = h(
    'div',
    { class: 'panel-sub', hidden: true },
    field('New operator name', newOperatorName),
    h('p', { class: 'form-label', id: `${id}-new-operator-type-label` }, 'Type'),
    newOperatorType,
  );
  operator.addEventListener('change', () => {
    newOperator.hidden = operator.value !== NEW_OPERATOR;
  });

  const venue = choice(`${id}-venue`, `${id}-venue-label`, [['pub', 'Pub'], ['bar', 'Bar']], pub?.venue_type ?? 'pub');
  const open = choice(`${id}-open`, `${id}-open-label`, [['open', 'Open'], ['closed', 'Closed']], pub && !pub.is_active ? 'closed' : 'open');

  const status = h('p', { class: 'form-status', role: 'status' });
  const submit = h('button', { type: 'submit', class: 'button button--primary' }, pub ? 'Save changes' : 'Add pub');

  const form = h(
    'form',
    { class: 'panel-form', 'aria-labelledby': `${id}-title`, novalidate: true },
    h('h3', { id: `${id}-title` }, pub ? pub.name : 'Add a pub'),
    pub ? h('p', { class: 'form-help' }, `${pub.beers} ${pub.beers === 1 ? 'beer' : 'beers'} listed. Edit them on the Tap lists tab.`) : null,
    field('Name', name),
    field('Address', address, 'Street and number, e.g. 617 Forest Road'),
    field('Postcode', postcode),
    fromPostcode,
    positionStatus,
    h('div', { class: 'position-row' }, h('div', null, field('Latitude', lat)), h('div', null, field('Longitude', lng))),
    mapLink,
    field('Operator', operator, 'Who runs the pub. Independents can stay as Not known or Free house.'),
    newOperator,
    h('p', { class: 'form-label', id: `${id}-venue-label` }, 'Pub or bar?'),
    venue,
    h('p', { class: 'form-label', id: `${id}-open-label` }, 'Open or closed?'),
    open,
    h('p', { class: 'form-help' }, 'Closed pubs are hidden from the site. Their tap lists are kept in case they reopen.'),
    submit,
    status,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
    if (!name.value.trim()) {
      status.textContent = 'Give the pub a name.';
      name.focus();
      return;
    }
    if ((!lat.value || !lng.value) && !(await positionFromPostcode())) {
      status.textContent = 'The pub needs a map position. Enter its postcode and use it for the position.';
      return;
    }
    const isNewOperator = operator.value === NEW_OPERATOR;
    if (isNewOperator && !newOperatorName.value.trim()) {
      status.textContent = 'Give the new operator a name.';
      newOperatorName.focus();
      return;
    }
    const changes: PubChanges = {
      name: name.value,
      address: address.value,
      postcode: tidyPostcode(postcode.value) ?? postcode.value,
      lat: Number(lat.value),
      lng: Number(lng.value),
      venue_type: chosen(venue) === 'bar' ? 'bar' : 'pub',
      is_active: chosen(open) !== 'closed',
      operator_id: isNewOperator ? null : operator.value || null,
      new_operator: isNewOperator ? { name: newOperatorName.value, type: chosen(newOperatorType) as AdminOperator['type'] } : null,
    };
    if (pub?.is_active && !changes.is_active && !confirm(`Mark ${pub.name} as closed? It will disappear from the site.`)) return;
    submit.disabled = true;
    status.textContent = 'Saving…';
    try {
      const result = pub ? await adminApi.updatePub(pub.id, changes) : await adminApi.addPub(changes);
      saved(result.id);
    } catch (error) {
      if (error instanceof SignedOut) return o.onSignedOut();
      status.textContent = error instanceof AdminError ? error.message : "Couldn't save. Check your connection and try again.";
      submit.disabled = false;
    }
  });

  return form;
}

export async function renderPubs(o: Options, focusPubId?: string, message?: string): Promise<void> {
  o.panel.replaceChildren(h('p', { class: 'form-help' }, 'Loading…'));
  const { sample, pubs, operators } = await adminApi.pubs();
  const reload = (pubId?: string, note?: string) => {
    renderPubs(o, pubId, note).catch(() => {
      o.panel.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load the pubs. Check your connection and try again."));
    });
  };

  const editor = h('div');
  const picker = h(
    'select',
    { id: 'pub-edit-picker' },
    h('option', { value: '' }, 'Choose a pub'),
    h('option', { value: NEW_OPERATOR }, 'Add a new pub'),
    pubs.map((p) => h('option', { value: p.id, selected: p.id === focusPubId }, p.is_active ? p.name : `${p.name} (closed)`)),
  );
  const done = h('p', { class: 'form-status', role: 'status', tabindex: '-1' }, message ?? '');
  const show = () => {
    const pub = pubs.find((p) => p.id === picker.value) ?? null;
    if (!pub && picker.value !== NEW_OPERATOR) {
      editor.replaceChildren();
      return;
    }
    done.textContent = '';
    editor.replaceChildren(
      pubForm(pub, operators, o, (id) => {
        o.onPubsChanged();
        reload(id, `Saved. The site updates within a minute.`);
      }),
    );
  };
  picker.addEventListener('change', show);

  o.panel.replaceChildren(
    bannerCard(sample, o, () => reload(picker.value, sample ? 'Banner hidden. The site updates within a minute.' : 'Banner shown again.')),
    h('div', null, h('label', { for: picker.id, class: 'admin-label' }, 'Pub'), picker),
    done,
    editor,
  );
  if (focusPubId) show();
  if (message) done.focus();
}
