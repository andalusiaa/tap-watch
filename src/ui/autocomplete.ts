// Accessible beer autocomplete (ARIA combobox with a listbox popup).

import type { Catalogue } from '../catalogue';
import { MAX_SUGGESTIONS } from '../config';
import type { Beer } from '../types';
import { h } from './dom';

interface Options {
  input: HTMLInputElement;
  listbox: HTMLUListElement;
  form: HTMLFormElement;
  catalogue: Catalogue;
  alcoholFreeOnly: () => boolean;
  onSelect: (beer: Beer) => void;
  /** Called when the user submits text that matches no beer. */
  onNoMatch: (query: string) => void;
  /** Called when the user clears the field. */
  onClear: () => void;
}

export function setupAutocomplete(o: Options) {
  let matches: Beer[] = [];
  let active = -1;

  const optionId = (i: number) => `beer-option-${i}`;

  function close() {
    o.listbox.hidden = true;
    o.input.setAttribute('aria-expanded', 'false');
    o.input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function setActive(i: number) {
    active = i;
    for (const [n, el] of [...o.listbox.children].entries()) {
      el.setAttribute('aria-selected', String(n === i));
    }
    if (i >= 0) {
      o.input.setAttribute('aria-activedescendant', optionId(i));
      o.listbox.children[i]?.scrollIntoView({ block: 'nearest' });
    } else {
      o.input.removeAttribute('aria-activedescendant');
    }
  }

  function choose(beer: Beer) {
    o.input.value = beer.name;
    close();
    o.onSelect(beer);
  }

  function update() {
    const query = o.input.value;
    matches = o.catalogue.searchBeers(query, o.alcoholFreeOnly(), MAX_SUGGESTIONS);
    if (!query.trim()) {
      close();
      return;
    }
    o.listbox.replaceChildren(
      ...matches.map((beer, i) => {
        const count = o.catalogue.pubCount(beer);
        const meta = [
          beer.af ? 'Alcohol-free' : null,
          beer.brewery,
          count === 0 ? 'Not listed yet' : `${count} ${count === 1 ? 'pub' : 'pubs'}`,
        ].filter(Boolean);
        return h(
          'li',
          {
            id: optionId(i),
            role: 'option',
            class: 'option',
            'aria-selected': 'false',
            // mousedown, so the input doesn't lose focus before the choice registers
            onmousedown: (e: Event) => {
              e.preventDefault();
              choose(beer);
            },
          },
          h('span', { class: 'option-name' }, beer.name),
          h('span', { class: 'option-meta' }, meta.join(' · ')),
        );
      }),
    );
    if (matches.length === 0) {
      o.listbox.replaceChildren(h('li', { class: 'option option--empty', role: 'presentation' }, 'No matching beers'));
    }
    o.listbox.hidden = false;
    o.input.setAttribute('aria-expanded', 'true');
    setActive(-1);
  }

  o.input.addEventListener('input', () => {
    update();
    if (!o.input.value.trim()) o.onClear();
  });
  o.input.addEventListener('focus', () => {
    if (o.input.value.trim()) update();
  });
  o.input.addEventListener('blur', close);

  o.input.addEventListener('keydown', (e) => {
    const open = !o.listbox.hidden && matches.length > 0;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (o.listbox.hidden) update();
        else if (open) setActive((active + 1) % matches.length);
        break;
      case 'ArrowUp':
        if (open) {
          e.preventDefault();
          setActive(active <= 0 ? matches.length - 1 : active - 1);
        }
        break;
      case 'Enter':
        e.preventDefault();
        submit();
        break;
      case 'Escape':
        if (!o.listbox.hidden) {
          e.preventDefault();
          close();
        }
        break;
    }
  });

  function submit() {
    const query = o.input.value.trim();
    if (!query) return;
    const beer = matches[active] ?? matches[0] ?? o.catalogue.searchBeers(query, o.alcoholFreeOnly(), 1)[0];
    if (beer) choose(beer);
    else {
      close();
      o.onNoMatch(query);
    }
  }

  o.form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  return {
    setValue(text: string) {
      o.input.value = text;
      close();
    },
  };
}
