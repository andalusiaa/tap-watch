// The Activity tab: votes, photo reports, beer submissions and admin changes, newest first,
// with the busiest visitors of the last 30 days. Visitors are friendly labels made from the
// device code the site already keeps for 30 days; no new data about anyone is stored.

import { h } from '../ui/dom';
import { adminApi, type ActivityEntry, type ActivityVisitor } from './adminApi';

const TYPES: [string, string][] = [
  ['all', 'Everything'],
  ['votes', 'Votes'],
  ['reports', 'Photo reports'],
  ['submissions', 'Beer submissions'],
  ['admin', 'My changes'],
];

const KIND_LABEL: Record<ActivityEntry['kind'], string> = {
  vote: 'Vote',
  report: 'Photos',
  submission: 'Beer',
  admin: 'Admin',
};

const STATUS_LABEL: Record<string, string> = { pending: 'waiting to check', approved: 'approved', rejected: 'rejected' };

function when(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  const day = (d: Date) => d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  const now = new Date();
  if (day(date) === day(now)) return `Today ${time}`;
  if (day(date) === day(new Date(now.valueOf() - 86_400_000))) return `Yesterday ${time}`;
  return `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })} ${time}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Options {
  panel: HTMLElement;
  /** Pubs for the filter, from the admin pub list. */
  pubs: { id: string; name: string }[];
}

export async function renderActivity(o: Options): Promise<void> {
  const state = { type: 'all', pub: '', visitor: '' };
  const entries: ActivityEntry[] = [];
  let next: string | null = null;

  const typeSelect = h('select', { id: 'activity-type' }, TYPES.map(([v, label]) => h('option', { value: v }, label)));
  const pubSelect = h(
    'select',
    { id: 'activity-pub' },
    h('option', { value: '' }, 'All pubs'),
    o.pubs.map((p) => h('option', { value: p.id }, p.name)),
  );
  const visitorsCard = h('section', { class: 'card', 'aria-labelledby': 'visitors-title' });
  const filterNote = h('p', { class: 'form-status', role: 'status' });
  const list = h('ol', { class: 'activity-list' });
  const more = h('button', { type: 'button', class: 'button', hidden: true }, 'Show older');
  const status = h('p', { class: 'form-status', role: 'status' });

  function entryElement(e: ActivityEntry): HTMLElement {
    const visitor = e.visitor
      ? h('button', { type: 'button', class: 'link-button activity-visitor', onclick: () => showVisitor(e.visitor ?? '') }, e.visitor)
      : null;
    return h(
      'li',
      { class: `activity-entry activity-entry--${e.kind}` },
      h(
        'p',
        { class: 'activity-meta' },
        h('span', { class: 'activity-kind' }, KIND_LABEL[e.kind]),
        h('span', null, when(e.at)),
        e.pub_name && e.kind !== 'admin' ? h('span', null, e.pub_name) : null,
      ),
      h('p', { class: 'activity-text' }, e.text),
      visitor || (e.status && STATUS_LABEL[e.status])
        ? h(
            'p',
            { class: 'activity-who' },
            visitor ? ['By ', visitor] : null,
            visitor && e.status && STATUS_LABEL[e.status] ? ' · ' : null,
            e.status && STATUS_LABEL[e.status] ? STATUS_LABEL[e.status] : null,
          )
        : null,
    );
  }

  function draw() {
    const shown = state.visitor ? entries.filter((e) => e.visitor === state.visitor) : entries;
    list.replaceChildren(
      ...(shown.length ? shown.map(entryElement) : [h('li', { class: 'empty' }, h('p', null, 'Nothing here yet.'))]),
    );
    more.hidden = !next;
    filterNote.replaceChildren();
    if (state.visitor) {
      const clear = h('button', { type: 'button', class: 'link-button' }, 'Show everyone');
      clear.addEventListener('click', () => {
        state.visitor = '';
        draw();
      });
      filterNote.append(`Showing only ${state.visitor} (${plural(shown.length, 'entry', 'entries')} loaded). `, clear);
    }
  }

  function showVisitor(label: string) {
    state.visitor = label;
    draw();
    filterNote.setAttribute('tabindex', '-1');
    filterNote.focus();
  }

  function drawVisitors(visitors: ActivityVisitor[]) {
    visitorsCard.replaceChildren(
      h('h2', { id: 'visitors-title' }, 'Busiest visitors, last 30 days'),
      h(
        'p',
        { class: 'card-meta' },
        'Each label stands for one phone or computer on one internet connection. The same person on wifi and on mobile data shows as two. Labels change every 30 days.',
      ),
      visitors.length
        ? h(
            'ul',
            { class: 'visitor-list' },
            visitors.map((v) =>
              h(
                'li',
                null,
                h('button', { type: 'button', class: 'link-button', onclick: () => showVisitor(v.visitor ?? '') }, v.visitor ?? 'Unknown'),
                h(
                  'span',
                  { class: 'card-meta' },
                  `${[
                    v.reports && plural(v.reports, 'photo report'),
                    v.submissions && plural(v.submissions, 'beer submission'),
                    v.votes && plural(v.votes, 'vote'),
                  ]
                    .filter(Boolean)
                    .join(', ')} · last ${when(v.last_at)}`,
                ),
              ),
            ),
          )
        : h('p', null, 'No visitor activity in the last 30 days.'),
    );
  }

  async function load(reset: boolean) {
    status.textContent = 'Loading…';
    more.disabled = true;
    try {
      const result = await adminApi.activity({ type: state.type, pub: state.pub, before: reset ? undefined : next ?? undefined });
      if (reset) entries.length = 0;
      entries.push(...result.entries);
      next = result.next;
      if (result.visitors) drawVisitors(result.visitors);
      status.textContent = '';
      draw();
    } catch {
      status.textContent = "Couldn't load the activity. Check your connection and try again.";
    } finally {
      more.disabled = false;
    }
  }

  typeSelect.addEventListener('change', () => {
    state.type = typeSelect.value;
    void load(true);
  });
  pubSelect.addEventListener('change', () => {
    state.pub = pubSelect.value;
    void load(true);
  });
  more.addEventListener('click', () => void load(false));

  o.panel.replaceChildren(
    visitorsCard,
    h(
      'div',
      { class: 'activity-filters' },
      h('div', null, h('label', { for: typeSelect.id, class: 'admin-label' }, 'Show'), typeSelect),
      h('div', null, h('label', { for: pubSelect.id, class: 'admin-label' }, 'Pub'), pubSelect),
    ),
    filterNote,
    list,
    more,
    status,
    h('p', { class: 'form-help' }, 'Your own changes are kept for a year. Visitor labels are only shown for the last 30 days.'),
  );
  await load(true);
}
