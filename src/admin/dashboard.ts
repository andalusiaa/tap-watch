// The Home tab: what needs a look, and nothing else. One line per admin tab that has
// something outstanding, with a button that opens it. main.ts refreshes it every half
// minute while the page is on screen, so the admin page can be left open and watched.

import { h } from '../ui/dom';
import { type Dashboard } from './adminApi';
import { sentAgo } from './queue';

/** Which tab a line opens. Matches the radio values in admin/index.html. */
export type TabName = 'queue' | 'taps' | 'pubs' | 'activity' | 'ideas' | 'pages' | 'usage';

interface Job {
  tab: TabName;
  tabLabel: string;
  /** What's waiting, in one line. */
  what: string;
  detail?: string | null;
  /** Needs doing, as opposed to worth knowing. */
  urgent: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (n: number) => n.toLocaleString('en-GB');

/** "8 weeks", "6 months" — the same wording the public pages use. */
function periodName(days: number): string {
  if (days % 365 === 0) return plural(days / 365, 'year');
  if (days % 30 === 0) return plural(days / 30, 'month');
  if (days % 7 === 0) return plural(days / 7, 'week');
  return plural(days, 'day');
}

function someNames(list: string[], total: number): string {
  const shown = list.join(', ');
  return total > list.length ? `${shown} and ${total - list.length} more` : shown;
}

/** Everything outstanding, most pressing first. */
export function jobs(d: Dashboard): Job[] {
  const out: Job[] = [];
  if (d.queue.reports + d.queue.suggestions) {
    const parts = [
      d.queue.reports ? plural(d.queue.reports, 'photo report') : '',
      d.queue.suggestions ? plural(d.queue.suggestions, 'beer submission') : '',
    ].filter(Boolean);
    out.push({
      tab: 'queue',
      tabLabel: 'To check',
      what: `${parts.join(' and ')} waiting`,
      detail: d.queue.oldest_at ? `Oldest sent ${sentAgo(d.queue.oldest_at)}.` : null,
      urgent: true,
    });
  }
  if (d.ideas.pending) {
    out.push({
      tab: 'ideas',
      tabLabel: 'Ideas',
      what: `${plural(d.ideas.pending, 'message')} to read`,
      detail: d.ideas.oldest_at ? `Oldest sent ${sentAgo(d.ideas.oldest_at)}.` : null,
      urgent: true,
    });
  }
  const u = d.usage;
  const nearCap =
    u.writes >= u.write_budget * 0.8 ? 'Database writes' : u.photos >= u.photos_cap * 0.8 ? 'Photos sent today' : null;
  if (nearCap) {
    out.push({
      tab: 'usage',
      tabLabel: 'Usage',
      what: `${nearCap}: over 80% of today’s limit`,
      detail: 'Votes, photos and submissions stop when the limit is reached, until midnight UTC.',
      urgent: true,
    });
  }
  if (d.pubs.no_beers.count) {
    out.push({
      tab: 'taps',
      tabLabel: 'Tap lists',
      what: `${plural(d.pubs.no_beers.count, 'pub')} with no beers listed`,
      detail: someNames(d.pubs.no_beers.names, d.pubs.no_beers.count),
      urgent: false,
    });
  }
  if (d.pubs.stale.count) {
    out.push({
      tab: 'taps',
      tabLabel: 'Tap lists',
      what: `${plural(d.pubs.stale.count, 'tap list')} not checked in over ${periodName(d.pubs.stale_days)}`,
      detail: `Grey on the site: ${someNames(d.pubs.stale.names, d.pubs.stale.count)}`,
      urgent: false,
    });
  }
  if (d.sample) {
    out.push({
      tab: 'pubs',
      tabLabel: 'Pubs',
      what: 'The public site still shows the testing banner',
      detail: 'Turn it off on the Pubs tab once the tap lists are real.',
      urgent: false,
    });
  }
  return out;
}

/** The number on the Home tab: things actually waiting to be checked or read. */
export const waitingCount = (d: Dashboard) => d.queue.reports + d.queue.suggestions + d.ideas.pending;

/**
 * Builds the tab once; `update` fills it in. Only rebuilt when something has changed, so a
 * refresh never moves what's under the pointer or drops the keyboard's place.
 */
export function createDashboard(goTo: (tab: TabName) => void) {
  const list = h('div');
  const tally = h('ul', { class: 'tally' });
  const heading = h('h2', { id: 'home-title' }, 'Needs a look');
  const checked = h('p', { class: 'card-meta' });
  const trouble = h('p', { class: 'form-status', role: 'status' });
  let signature = '';

  const line = (job: Job): HTMLElement => {
    const open = h('button', { type: 'button', class: 'link-button job-open' }, `Open ${job.tabLabel}`);
    open.addEventListener('click', () => goTo(job.tab));
    return h(
      'li',
      { class: `job${job.urgent ? ' job--urgent' : ''}` },
      h('p', { class: 'job-what' }, job.what),
      job.detail ? h('p', { class: 'job-detail' }, job.detail) : null,
      open,
    );
  };

  function update(d: Dashboard): void {
    trouble.textContent = '';
    const open = jobs(d);
    const next = JSON.stringify([open, d.pubs.total, d.usage.writes]);
    if (next !== signature) {
      signature = next;
      heading.textContent = open.length ? 'Needs a look' : 'Nothing waiting';
      list.replaceChildren(
        open.length
          ? h('ul', { class: 'job-list' }, open.map(line))
          : h('p', { class: 'empty-queue' }, 'Nothing to check, nothing to read, and every tap list has been seen recently.'),
      );
      tally.replaceChildren(
        h('li', null, `${plural(d.pubs.total, 'pub')} open on the site`),
        h('li', null, `${plural(d.queue.reports + d.queue.suggestions, 'thing')} to check`),
        h('li', null, `${plural(d.ideas.pending, 'message')} unread`),
        h('li', null, `${count(d.usage.writes)} of ${count(d.usage.write_budget)} database writes used today`),
      );
    }
    checked.textContent = `Checked at ${new Date(d.now).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    })}, and again every half minute while this page is open.`;
  }

  return {
    element: h(
      'div',
      { class: 'admin-panel admin-panel--plain' },
      h('section', { class: 'card', 'aria-labelledby': 'home-title' }, heading, list, checked, trouble),
      h('section', { class: 'card', 'aria-labelledby': 'home-shape' }, h('h2', { id: 'home-shape' }, 'Where things stand'), tally),
    ),
    update,
    /** A quiet note when a refresh fails; whatever was already shown stays put. */
    setTrouble(message: string) {
      trouble.textContent = message;
    },
  };
}
