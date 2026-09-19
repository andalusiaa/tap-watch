// The Usage tab: today's activity, how close Tap Watch is to its limits, and what every limit is.

import { h } from '../ui/dom';
import { adminApi, type Usage } from './adminApi';

const MB = 1_000_000;

/** Cloudflare's free plan, from developers.cloudflare.com (checked 2026-09-18). Daily limits reset at midnight UTC. */
const CLOUDFLARE_CAPS: [what: string, cap: string, ifReached: string][] = [
  ['Worker requests', '100,000 a day',
    'Every page load, vote, photo report and beer submission counts. Page files and map tiles don’t. If reached, pages open but show no beers.'],
  ['Worker time', '10 ms of processing per request', 'A request that takes longer fails. Tap Watch’s requests are small and well under this.'],
  ['Database rows read', '5 million a day', 'If reached, beer lists and votes stop working until the reset.'],
  ['Database rows written', '100,000 a day', 'If reached, votes, photos, suggestions and admin saves stop working until the reset.'],
  ['Database size', '500 MB', 'New data can’t be added until old data is cleared.'],
  ['Database queries', '50 per request', 'Why admin saves take up to 40 changes at a time.'],
  ['Photo store reads', '100,000 a day', 'Only the admin page reads photos.'],
  ['Photo store writes', '1,000 a day', 'If reached, photo reports fail until the reset.'],
  ['Photo store deletes', '1,000 a day', 'Approving, rejecting and clean-up delete photos.'],
  ['Photo store size', '1 GB', 'Unchecked photos are deleted after 30 days.'],
];

const numberText = (n: number) => n.toLocaleString('en-GB');
function sizeText(bytes: number): string {
  if (bytes < MB) return `${Math.round(bytes / 1_000).toLocaleString('en-GB')} KB`;
  return `${(bytes / MB).toLocaleString('en-GB', { maximumFractionDigits: bytes < 10 * MB ? 1 : 0 })} MB`;
}

function meter(label: string, value: number, max: number, text: string, help: string): HTMLElement {
  const percent = Math.min(100, Math.round((value / max) * 100));
  return h(
    'div',
    { class: 'usage-meter' },
    h('p', { class: 'usage-meter-label' }, h('span', null, label), h('span', null, `${percent}%`)),
    h('meter', { min: 0, max, low: max * 0.5, high: max * 0.8, optimum: 0, value, 'aria-label': label }),
    h('p', { class: 'usage-meter-text' }, text),
    h('p', { class: 'form-help' }, help),
  );
}

function dayName(day: string, today: string): string {
  if (day === today) return 'Today';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
}

function render(u: Usage): HTMLElement[] {
  const today = u.now.slice(0, 10);
  const c = u.caps;
  return [
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'usage-today' },
      h('h2', { id: 'usage-today' }, 'Today'),
      h('p', { class: 'card-meta' }, 'Daily counts start again at midnight UTC (1am UK time in summer).'),
      meter(
        'Database writes',
        u.today.writes,
        c.daily_write_budget,
        `About ${numberText(u.today.writes)} of ${numberText(c.daily_write_budget)}`,
        `Tap Watch stops taking votes, photos and beer submissions at ${numberText(c.daily_write_budget)}, half of Cloudflare's 100,000, so admin saves and clean-up always have room.`,
      ),
      meter(
        'Photos sent',
        u.today.photos,
        c.photos_per_day,
        `${numberText(u.today.photos)} of ${numberText(c.photos_per_day)}`,
        `After ${numberText(c.photos_per_day)} photos in a day, photo reports are paused until tomorrow. The photo store allows 1,000 writes a day.`,
      ),
      h(
        'p',
        null,
        `${numberText(u.today.votes)} ${u.today.votes === 1 ? 'vote' : 'votes'}, `,
        `${numberText(u.today.reports)} photo ${u.today.reports === 1 ? 'report' : 'reports'}, `,
        `${numberText(u.today.suggestions)} beer ${u.today.suggestions === 1 ? 'submission' : 'submissions'}.`,
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'usage-storage' },
      h('h2', { id: 'usage-storage' }, 'Storage'),
      u.database_bytes === null
        ? h('p', null, 'Database size isn’t available right now.')
        : meter('Database', u.database_bytes, 500 * MB, `${sizeText(u.database_bytes)} of 500 MB`, 'Beers, pubs, tap lists, votes and the admin queue.'),
      meter(
        'Photos waiting',
        u.stored_photos.bytes,
        1_000 * MB,
        `${numberText(u.stored_photos.count)} ${u.stored_photos.count === 1 ? 'photo' : 'photos'}, ${sizeText(u.stored_photos.bytes)} of 1 GB`,
        'Photos are deleted when you approve or reject a report, or after 30 days.',
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'usage-week' },
      h('h2', { id: 'usage-week' }, 'Last 7 days'),
      h(
        'table',
        { class: 'usage-table' },
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col' }, 'Votes'), h('th', { scope: 'col' }, 'Reports'), h('th', { scope: 'col' }, 'Beers'))),
        h(
          'tbody',
          null,
          u.days.map((d) =>
            h('tr', null, h('th', { scope: 'row' }, dayName(d.day, today)), h('td', null, numberText(d.votes)), h('td', null, numberText(d.reports)), h('td', null, numberText(d.suggestions))),
          ),
        ),
      ),
      h(
        'p',
        { class: 'form-help' },
        'Page loads and Cloudflare’s own totals are on the Cloudflare dashboard: ',
        h('a', { href: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages', target: '_blank', rel: 'noopener noreferrer' }, 'Workers'),
        ' (open tap-watch, then Metrics) and ',
        h('a', { href: 'https://dash.cloudflare.com/?to=/:account/workers/d1', target: '_blank', rel: 'noopener noreferrer' }, 'D1'),
        ' (open tap-watch, then Metrics).',
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'usage-caps' },
      h('h2', { id: 'usage-caps' }, 'Cloudflare free plan limits'),
      h('p', { class: 'card-meta' }, 'These are free. When one is reached, that part stops until the next reset. Nothing is ever charged.'),
      h(
        'dl',
        { class: 'usage-caps' },
        CLOUDFLARE_CAPS.map(([what, cap, ifReached]) => [h('dt', null, what, h('span', { class: 'usage-cap' }, cap)), h('dd', null, ifReached)]),
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'usage-own' },
      h('h2', { id: 'usage-own' }, 'Tap Watch’s own limits'),
      h('p', { class: 'card-meta' }, 'Set by Tap Watch to stop spam and keep well inside the free plan.'),
      h(
        'dl',
        { class: 'usage-caps' },
        [
          ['Votes', `${c.votes_per_device_per_hour} per device per hour, and one per beer per device per day`],
          ['Photo reports', `${c.reports_per_device_per_day} per device per day, up to ${c.photos_per_report} photos each`],
          ['Photos from everyone', `${numberText(c.photos_per_day)} a day`],
          ['Beer submissions', `${c.suggestions_per_device_per_day} per device per day`],
          ['Database writes from visitors', `About ${numberText(c.daily_write_budget)} a day`],
          ['Admin saves', 'Up to 40 changes at a time'],
          ['Nightly clean-up', 'Deletes up to 10 unchecked photo reports older than 30 days'],
        ].map(([what, cap]) => [h('dt', null, what), h('dd', null, cap)]),
      ),
    ),
  ];
}

export async function renderUsage(panel: HTMLElement): Promise<void> {
  panel.replaceChildren(h('p', { class: 'form-help' }, 'Loading…'));
  const usage = await adminApi.usage();
  panel.replaceChildren(...render(usage));
}
