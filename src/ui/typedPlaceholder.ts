// "Try searching for Guinness" in the search box, typing itself out one beer at a time.
// Beers come from the live list, so the examples are always things someone could find.
// It pauses while the box is in use, while the tab is hidden, and for anyone who has asked
// their device for less movement.

const PREFIX = 'Try searching for ';
const TYPE_MS = 70;
const DELETE_MS = 35;
const HOLD_MS = 1_800;
const GAP_MS = 500;

interface Options {
  input: HTMLInputElement;
  /** Beer names to show, in the order they should appear. */
  names: string[];
  /** Only animate while this is true (e.g. while the filter panel is open). */
  active: () => boolean;
}

export function typedPlaceholder(o: Options) {
  if (o.names.length === 0) return;
  const stillMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let index = 0;
  let timer = 0;
  let stopped = false;

  const show = (text: string) => {
    o.input.placeholder = PREFIX + text;
  };
  const later = (ms: number, step: () => void) => {
    timer = window.setTimeout(() => {
      if (!stopped) step();
    }, ms);
  };

  /** Waits until the box is free and on screen, then runs the next step. */
  function when(ready: () => void) {
    if (o.active() && !document.hidden && document.activeElement !== o.input && o.input.value === '') ready();
    else later(400, () => when(ready));
  }

  function nextName() {
    index = (index + 1) % o.names.length;
    return o.names[index] ?? '';
  }

  function typeIn(name: string, upto = 1) {
    show(name.slice(0, upto));
    if (upto < name.length) later(TYPE_MS, () => typeIn(name, upto + 1));
    else later(HOLD_MS, () => when(() => deleteOut(name)));
  }

  function deleteOut(name: string) {
    const left = name.length - 1;
    show(name.slice(0, left));
    if (left > 0) later(DELETE_MS, () => deleteOut(name.slice(0, left)));
    else later(GAP_MS, () => when(() => typeIn(nextName())));
  }

  function swapPlainly() {
    show(nextName());
    later(4_000, () => when(swapPlainly));
  }

  show(o.names[0] ?? '');
  when(() => (stillMotion.matches ? swapPlainly() : later(HOLD_MS, () => deleteOut(o.names[0] ?? ''))));

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/** A handful of beers to use as examples: well-known ones first, then a random spread. */
export function exampleBeers(all: { name: string }[], pick: number, random = Math.random): string[] {
  const names = all.map((b) => b.name).filter((n) => n.length <= 22);
  const chosen: string[] = [];
  const pool = [...names];
  while (chosen.length < pick && pool.length) {
    const [name] = pool.splice(Math.floor(random() * pool.length), 1);
    if (name) chosen.push(name);
  }
  return chosen;
}
