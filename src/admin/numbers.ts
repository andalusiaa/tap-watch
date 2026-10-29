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

function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

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

/** Days for a week's view, or whole weeks when the period is longer. */
function series(s: Stats): { label: string; n: number }[] {
  const rows = s.daily.map((d) => ({ label: dayLabel(d.day), n: d.page ?? 0 }));
  if (s.days <= 31) return rows;
  const weeks: { label: string; n: number }[] = [];
  for (let i = 0; i < rows.length; i += 7) {
    const week = rows.slice(i, i + 7);
    const first = week[0];
    if (!first) continue;
    weeks.push({ label: `Week of ${first.label}`, n: week.reduce((sum, d) => sum + d.n, 0) });
  }
  return weeks;
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
      h('h3', { class: 'admin-label' }, s.days <= 31 ? 'Day by day' : 'Week by week'),
      barList(series(s), 'Nothing yet.'),
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
