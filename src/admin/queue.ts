// The "To check" list: photo reports and beer suggestions waiting for a decision.

import type { Beer, Dispense } from '../types';
import { h } from '../ui/dom';
import { adminApi, AdminError, SignedOut, type NewBeer, type QueueReport, type QueueSuggestion } from './adminApi';
import { beerDatalist, confirmDeletes, createTapEditor, findBeer } from './tapEditor';

const CATEGORIES: [string, string][] = [
  ['lager', 'Lager'],
  ['stout', 'Stout or porter'],
  ['pale_ipa', 'Pale ale or IPA'],
  ['bitter_cask', 'Ales and bitters'],
  ['cider', 'Cider'],
  ['other', 'Other'],
];

interface Context {
  beers: Beer[];
  onSignedOut: () => void;
  /** Called after a decision so the counts can refresh. */
  onDone: () => void;
}

let cardCount = 0;

export function sentAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Approve and reject are colour-coded, so the two aren't confused in a hurry. */
function actionButton(label: string, primary = false) {
  const tone = primary ? 'button--save' : label === 'Reject' ? 'button--reject' : '';
  return h('button', { type: 'button', class: `button ${tone}`.trim() }, label);
}

/** Runs an admin action, showing progress and errors in the card. */
async function run(ctx: Context, card: HTMLElement, status: HTMLElement, buttons: HTMLButtonElement[], work: () => Promise<string>) {
  for (const b of buttons) b.disabled = true;
  status.textContent = 'Saving…';
  try {
    const done = await work();
    const message = h('p', { class: 'form-done', tabindex: '-1' }, done);
    card.replaceWith(message);
    message.focus();
    ctx.onDone();
  } catch (error) {
    if (error instanceof SignedOut) return ctx.onSignedOut();
    status.textContent = error instanceof AdminError ? error.message : "Couldn't save. Check your connection and try again.";
    for (const b of buttons) b.disabled = false;
  }
}

/** "today", "yesterday", "8 days ago" — for a date without a useful time of day. */
function dayAgo(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  return weeks < 9 ? `${weeks} weeks ago` : `${Math.round(days / 30.44)} months ago`;
}

/** True when the photo was taken on an earlier day than it was sent. */
function takenEarlier(report: QueueReport): boolean {
  return Boolean(report.taken_at) && (report.taken_at ?? '').slice(0, 10) < report.created_at.slice(0, 10);
}

function reportCard(ctx: Context, report: QueueReport): HTMLElement {
  const status = h('p', { class: 'form-status', role: 'status' });
  const editorSlot = h('div', null, h('p', { class: 'form-help' }, 'Loading the tap list…'));
  const addedSlot = h('div');
  const approve = actionButton('Approve and save ticks', true);
  const reject = actionButton('Reject');
  let editor: ReturnType<typeof createTapEditor> | null = null;

  // Which date the ticks count from. Only worth asking when the two differ.
  const datedName = `dated-${report.id}`;
  const datedChoice = takenEarlier(report)
    ? h(
        'fieldset',
        { class: 'chips' },
        h('legend', null, 'Count the ticks from'),
        h('label', null, h('input', { type: 'radio', name: datedName, value: 'taken', checked: true }), h('span', null, `When taken (${dayAgo(report.taken_at ?? '')})`)),
        h('label', null, h('input', { type: 'radio', name: datedName, value: 'sent' }), h('span', null, 'When sent (today)')),
      )
    : null;
  const datedBlock = datedChoice ? h('div', { class: 'card-dated' }, datedChoice) : null;

  const card = h(
    'article',
    { class: 'card' },
    h('h2', null, `${report.photo_count === 1 ? 'Photo' : 'Photos'} from ${report.pub_name}`),
    h(
      'p',
      { class: 'card-meta' },
      `Sent ${sentAgo(report.created_at)}`,
      report.taken_at ? `, taken ${dayAgo(report.taken_at)}` : ', no date on the photos',
    ),
    report.note ? h('p', { class: 'card-note' }, `“${report.note}”`) : null,
    report.photo_count
      ? h(
          'div',
          { class: 'card-photos' },
          Array.from({ length: report.photo_count }, (_, i) =>
            h(
              'a',
              { class: 'card-photo', href: adminApi.photoUrl(report.id, i + 1), target: '_blank', rel: 'noopener' },
              h('img', {
                src: adminApi.photoUrl(report.id, i + 1),
                alt: `Photo ${i + 1} of ${report.photo_count} of the taps at ${report.pub_name}`,
                loading: 'lazy',
              }),
            ),
          ),
        )
      : h('p', { class: 'form-help' }, 'The photos have expired.'),
    editorSlot,
    datedBlock,
    h('div', { class: 'card-actions' }, approve, reject),
    addedSlot,
    status,
  );

  adminApi
    .pub(report.pub_id)
    .then(({ listings }) => {
      editor = createTapEditor({
        beers: ctx.beers,
        listings,
        hint: 'Mark what the photo shows. "On" counts as checked when the photo was taken, where the photo says so.',
      });
      editorSlot.replaceChildren(editor.element);
      addedSlot.replaceChildren(editor.addedElement);
    })
    .catch((error) => {
      if (error instanceof SignedOut) return ctx.onSignedOut();
      editorSlot.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load this pub's tap list."));
    });

  approve.addEventListener('click', () => {
    const changes = editor?.changes() ?? [];
    if (!confirmDeletes(changes)) return;
    const dated = (datedChoice?.querySelector<HTMLInputElement>('input:checked')?.value ?? 'taken') as 'taken' | 'sent';
    void run(ctx, card, status, [approve, reject], async () => {
      await adminApi.reviewReport(report.id, 'approve', changes, dated);
      const when = report.taken_at && dated === 'taken' ? ` dated ${dayAgo(report.taken_at)}` : '';
      return `Approved the photos from ${report.pub_name}${changes.length ? ` and saved ${changes.length} changes` : ''}${when}. The photos have been deleted.`;
    });
  });
  reject.addEventListener('click', () =>
    run(ctx, card, status, [approve, reject], async () => {
      await adminApi.reviewReport(report.id, 'reject');
      return `Rejected the photos from ${report.pub_name}. The photos have been deleted.`;
    }),
  );
  return card;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h('div', null, h('label', { for: control.id }, label), control);
}

/** What that pub's tap list looks like already, so a claim can be weighed against it. */
function pubStanding(s: QueueSuggestion): string {
  const beers = s.pub_beers ?? 0;
  const listed = beers === 0 ? 'nothing listed yet' : `${beers} ${beers === 1 ? 'beer' : 'beers'} listed`;
  const checked = s.pub_last_checked ? `last checked ${sentAgo(s.pub_last_checked)}` : 'never checked';
  return `${s.pub_name}: ${listed}, ${checked}.`;
}

function suggestionCard(ctx: Context, s: QueueSuggestion): HTMLElement {
  const id = `suggestion-${++cardCount}`;
  const status = h('p', { class: 'form-status', role: 'status' });
  const approve = actionButton('Approve', true);
  const reject = actionButton('Reject');
  const where = s.pub_name ? ` at ${s.pub_name}` : '';
  const served = s.dispense ? ` (${s.dispense})` : '';
  const isNew = !s.beer_id;

  // For a new beer name: match it to an existing beer, or fill in the details to add it.
  const matchInput = h('input', { id: `${id}-match`, type: 'text', list: `${id}-beers`, autocomplete: 'off' });
  const nameInput = h('input', { id: `${id}-name`, type: 'text', maxlength: 80, value: s.proposed_beer_name ?? '' });
  const breweryInput = h('input', { id: `${id}-brewery`, type: 'text', maxlength: 80 });
  const categorySelect = h(
    'select',
    { id: `${id}-category` },
    h('option', { value: '' }, 'Choose a style'),
    CATEGORIES.map(([value, label]) => h('option', { value }, label)),
  );
  const abvInput = h('input', { id: `${id}-abv`, type: 'number', min: 0, max: 15, step: 0.1, inputmode: 'decimal' });
  const afInput = h('input', { id: `${id}-af`, type: 'checkbox' });
  const aliasesInput = h('input', { id: `${id}-aliases`, type: 'text', placeholder: 'e.g. lucky st, lucky saint lager' });

  const newBeerForm = isNew
    ? h(
        'div',
        { class: 'new-beer' },
        h('p', { class: 'form-help' }, 'Is it a beer that is already in the list, perhaps spelt differently? Choose it here:'),
        field('Existing beer', matchInput),
        beerDatalist(`${id}-beers`, ctx.beers),
        h('p', { class: 'form-help' }, 'Otherwise, check the details to add it to the list:'),
        field('Name', nameInput),
        field('Brewery', breweryInput),
        field('Style', categorySelect),
        field('ABV %', abvInput),
        h('label', { class: 'check', for: afInput.id }, afInput, 'Alcohol-free (0.5% or less)'),
        field('Other spellings, separated by commas', aliasesInput),
      )
    : null;

  const card = h(
    'article',
    { class: 'card' },
    h('h2', null, isNew ? `New beer: ${s.proposed_beer_name}${served}${where}` : `${s.beer_name}${served}${where}`),
    h('p', { class: 'card-meta' }, `Submitted ${sentAgo(s.created_at)}`),
    s.pub_name ? h('p', { class: 'card-meta' }, pubStanding(s)) : null,
    s.pub_name
      ? h('p', { class: 'form-help' }, 'Approving puts it on the site as unconfirmed, until someone else taps 👍 for it.')
      : h('p', { class: 'form-help' }, 'No pub was given, so approving only adds the beer to the list.'),
    newBeerForm,
    h('div', { class: 'card-actions' }, approve, reject),
    status,
  );

  approve.addEventListener('click', () =>
    run(ctx, card, status, [approve, reject], async () => {
      if (!isNew) {
        await adminApi.reviewSuggestion(s.id, { action: 'approve' });
        return `Added ${s.beer_name}${served}${where}.`;
      }
      const match = matchInput.value.trim() ? findBeer(ctx.beers, matchInput.value) : undefined;
      if (matchInput.value.trim() && !match) throw new AdminError(`"${matchInput.value.trim()}" isn't in the list.`);
      if (match) {
        await adminApi.reviewSuggestion(s.id, { action: 'approve', beer_id: match.id });
        return `Added ${match.name}${served}${where}.`;
      }
      const beer: NewBeer = {
        name: nameInput.value.trim(),
        brewery: breweryInput.value.trim(),
        category: categorySelect.value,
        abv: abvInput.value === '' ? null : Number(abvInput.value),
        is_alcohol_free: afInput.checked,
        aliases: aliasesInput.value.split(',').map((a) => a.trim()).filter(Boolean),
      };
      const result = await adminApi.reviewSuggestion(s.id, { action: 'approve', beer, dispense: s.dispense as Dispense | null });
      ctx.beers.push({
        id: result.beer_id ?? '',
        name: beer.name,
        brewery: beer.brewery || null,
        category: beer.category as Beer['category'],
        abv: beer.abv,
        af: beer.is_alcohol_free,
        aliases: beer.aliases,
      });
      return `Added ${beer.name} to the beer list${where ? ` and to ${s.pub_name}` : ''}.`;
    }),
  );
  reject.addEventListener('click', () =>
    run(ctx, card, status, [approve, reject], async () => {
      await adminApi.reviewSuggestion(s.id, { action: 'reject' });
      return 'Submission rejected.';
    }),
  );
  return card;
}

export async function renderQueue(panel: HTMLElement, ctx: Context): Promise<number> {
  const { reports, suggestions } = await adminApi.queue();
  const total = reports.length + suggestions.length;
  panel.replaceChildren(
    h(
      'div',
      { class: 'admin-panel' },
      h('h2', { class: 'visually-hidden' }, 'To check'),
      total === 0 ? h('p', { class: 'empty-queue' }, 'Nothing to check. 🎉') : null,
      reports.map((r) => reportCard(ctx, r)),
      suggestions.map((s) => suggestionCard(ctx, s)),
    ),
  );
  return total;
}
