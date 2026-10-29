// The Numbers tab: how the site is being used, from the daily totals in the `stats` table.
// Nothing here is about a person — every figure is "this happened n times on this day".

import { h } from '../ui/dom';
import { adminApi, type Stats } from './adminApi';

const PERIODS: [days: number, label: string][] = [
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
];

/** Page slugs as Tristan knows them. Anything new falls back to its slug. */
const PAGE_NAMES: Record<string, string> = {
  home: 'Home page',
  about: 'About',
  'how-it-works': 'How it works',
  faq: 'Questions',
  privacy: 'Privacy',
  feedback: 'Tell us',
};

const count = (n: number) => n.toLocaleString('en-GB');
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** A labelled bar. `meter` keeps it to attributes, since the stylesheet forbids inline styles. */
function bar(label: string, n: number, max: number, note?: string): HTMLElement {
  return h(
    'li',
    { class: 'bar-row' },
    h('p', { class: 'bar-label' }, label, note ? h('span', { class: 'bar-note' }, note) : null),
    h('meter', { min: 0, max: Math.max(max, 1), value: n, 'aria-label': `${label}: ${count(n)}` }),
    h('p', { class: 'bar-count' }, count(n)),
  );
}

function barList(rows: { label: string; n: number; note?: string }[], empty: string): HTMLElement {
  if (!rows.length) return h('p', { class: 'empty-queue' }, empty);
  const max = Math.max(...rows.map((r) => r.n));
  return h('ul', { class: 'bar-list' }, rows.map((r) => bar(r.label, r.n, max, r.note)));
}

/** Five shades of green, so a busy day stands out from a quiet one at a glance. */
function shade(n: number, max: number): number {
  if (n <= 0) return 0;
  return Math.min(5, Math.ceil((n / max) * 5));
}

const WEEKDAYS: [short: string, full: string][] = [
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
  ['S', 'Sunday'],
];

/** Monday is the first column, so weekends sit together on the right. */
const columnOf = (date: Date) => (date.getUTCDay() + 6) % 7;

function monthTable(monthStart: Date, counts: Map<string, number>, max: number): HTMLElement {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const lastDate = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const blank = () => ({ el: h('td', { class: 'cal-day cal-day--off' }), counted: false });
  const cells = Array.from({ length: columnOf(monthStart) }, blank);
  for (let date = 1; date <= lastDate; date++) {
    const iso = new Date(Date.UTC(year, month, date)).toISOString().slice(0, 10);
    const n = counts.get(iso);
    // Outside the period being shown: an empty square, so only counted days carry a number.
    if (n === undefined) {
      cells.push(blank());
      continue;
    }
    cells.push({
      counted: true,
      el: h(
        'td',
        {
          class: `cal-day cal-day--${shade(n, max)}`,
          'aria-label': `${date} ${monthStart.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}: ${plural(n, 'page')}`,
        },
        h('span', { class: 'cal-date' }, String(date)),
        h('span', { class: 'cal-count' }, count(n)),
      ),
    });
  }
  while (cells.length % 7) cells.push(blank());

  // Weeks with nothing in them are left out, so a part-month doesn't sit in a sea of blanks.
  const weeks: HTMLElement[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    if (week.some((cell) => cell.counted)) weeks.push(h('tr', null, week.map((cell) => cell.el)));
  }

  return h(
    'table',
    { class: 'calendar' },
    h('caption', null, monthStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })),
    h('thead', null, h('tr', null, WEEKDAYS.map(([short, full]) => h('th', { scope: 'col' }, h('abbr', { title: full }, short))))),
    h('tbody', null, weeks),
  );
}

/** The period as a calendar, one table per month, each day shaded by how busy it was. */
function calendar(s: Stats): HTMLElement {
  const counts = new Map(s.daily.map((d) => [d.day, d.page ?? 0]));
  const max = Math.max(1, ...counts.values());
  const months: Date[] = [];
  for (const iso of counts.keys()) {
    const date = new Date(`${iso}T00:00:00Z`);
    const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    if (!months.some((m) => m.getTime() === first.getTime())) months.push(first);
  }
  months.sort((a, b) => a.getTime() - b.getTime());
  return h(
    'div',
    { class: 'cal-months' },
    months.map((month) => monthTable(month, counts, max)),
    h(
      'p',
      { class: 'cal-key' },
      h('span', null, 'Quiet'),
      [1, 2, 3, 4, 5].map((level) => h('span', { class: `cal-swatch cal-day--${level}` })),
      h('span', null, 'Busy'),
    ),
  );
}

function render(s: Stats, onPeriod: (days: number) => void): HTMLElement[] {
  const t = s.totals;
  const period = h(
    'fieldset',
    { class: 'segmented segmented--even', 'aria-label': 'How far back' },
    PERIODS.map(([days, label]) =>
      h('label', null, h('input', { type: 'radio', name: 'stats-days', value: String(days), checked: days === s.days }), h('span', null, label)),
    ),
  );
  period.addEventListener('change', (e) => onPeriod(Number((e.target as HTMLInputElement).value)));

  const since = s.counting_since
    ? `Counting since ${new Date(`${s.counting_since}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`
    : 'Nothing counted yet. Figures appear the first time someone opens the site.';

  return [
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'numbers-visits' },
      h('h2', { id: 'numbers-visits' }, 'Pages opened'),
      period,
      h('p', { class: 'card-meta' }, `${since} Days run to midnight UTC.`),
      h('p', { class: 'numbers-big' }, plural(t.page, 'page opened', 'pages opened'), h('span', { class: 'card-meta' }, ` in the last ${s.days} days`)),
      barList(
        s.pages.map((p) => ({ label: PAGE_NAMES[p.key] ?? p.key, n: p.n })),
        'No pages opened yet.',
      ),
      h('h3', { class: 'admin-label' }, 'Day by day'),
      calendar(s),
      h(
        'p',
        { class: 'form-help' },
        'This counts pages opened, not people: one person opening the home page twice counts twice, ' +
          'and nothing is stored that could tell the two apart. The "page not found" page isn’t counted.',
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'numbers-searches' },
      h('h2', { id: 'numbers-searches' }, 'What people searched for'),
      h('p', { class: 'card-meta' }, `${plural(t.search, 'search')} that found a beer, ${count(t.miss)} that found none.`),
      barList(
        s.searches.map((row) => ({ label: row.name ?? row.key, n: row.n })),
        'No searches yet.',
      ),
      h('h3', { class: 'admin-label' }, 'Found nothing'),
      barList(
        s.misses.map((row) => ({ label: row.key, n: row.n })),
        'Every search found something.',
      ),
      h('p', { class: 'form-help' }, 'Words that found nothing are worth a look: they are usually beers to add to the list.'),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'numbers-pubs' },
      h('h2', { id: 'numbers-pubs' }, 'Pubs and the map'),
      h('p', { class: 'card-meta' }, `${plural(t.pub, 'pub list')} opened, map opened ${plural(t.map, 'time')}.`),
      barList(
        s.pubs.map((row) => ({ label: row.name ?? row.key, n: row.n })),
        'No pub lists opened yet.',
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'numbers-joining' },
      h('h2', { id: 'numbers-joining' }, 'Joining in'),
      barList(
        [
          { label: 'Votes', n: t.vote },
          { label: 'Photo reports', n: t.photo },
          { label: 'Beers submitted', n: t.beer },
          { label: 'Messages', n: t.message },
        ].filter((row) => row.n > 0),
        'Nobody has voted or sent anything in this period.',
      ),
      h('p', { class: 'form-help' }, 'Counted when they were accepted. Today’s figures and the limits are on the Usage tab.'),
    ),
  ];
}

export async function renderNumbers(panel: HTMLElement, days = 30): Promise<void> {
  panel.replaceChildren(h('p', { class: 'form-help' }, 'Loading…'));
  const stats = await adminApi.stats(days);
  panel.replaceChildren(
    ...render(stats, (chosen) => {
      renderNumbers(panel, chosen).catch(() => {
        panel.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load the numbers. Check your connection and try again."));
      });
    }),
  );
}
