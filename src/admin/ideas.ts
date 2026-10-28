// The Ideas tab: messages from the "Tell us" box. Keep one and it stays here as an idea to
// come back to; discard it and it's gone.

import { h } from '../ui/dom';
import { adminApi, AdminError, SignedOut, type FeedbackMessage } from './adminApi';
import { sentAgo } from './queue';

interface Options {
  panel: HTMLElement;
  onSignedOut: () => void;
  /** Called after a message is kept or discarded, so the Home tab's count catches up. */
  onChanged?: () => void;
}

export async function renderIdeas(o: Options): Promise<void> {
  o.panel.replaceChildren(h('p', { class: 'form-help' }, 'Loading…'));
  const { pending, kept } = await adminApi.feedback();
  const reload = () => {
    renderIdeas(o).catch(() => {
      o.panel.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load the messages. Check your connection and try again."));
    });
  };

  function card(message: FeedbackMessage): HTMLElement {
    const status = h('p', { class: 'form-status', role: 'status' });
    const keep = h('button', { type: 'button', class: 'button button--save' }, 'Keep as an idea');
    const reject = h('button', { type: 'button', class: 'button button--reject' }, 'Discard');
    const decide = (action: 'keep' | 'reject') => async () => {
      if (action === 'reject' && !confirm('Discard this message? It will be deleted.')) return;
      keep.disabled = true;
      reject.disabled = true;
      status.textContent = 'Saving…';
      try {
        await adminApi.reviewFeedback(message.id, action);
        o.onChanged?.();
        reload();
      } catch (error) {
        if (error instanceof SignedOut) return o.onSignedOut();
        status.textContent = error instanceof AdminError ? error.message : "Couldn't save. Check your connection and try again.";
        keep.disabled = false;
        reject.disabled = false;
      }
    };
    keep.addEventListener('click', () => void decide('keep')());
    reject.addEventListener('click', () => void decide('reject')());
    return h(
      'article',
      { class: 'card' },
      h('p', { class: 'card-meta' }, `Sent ${sentAgo(message.created_at)}`),
      h('p', { class: 'idea-text' }, message.message),
      h('div', { class: 'card-actions' }, keep, reject),
      status,
    );
  }

  o.panel.replaceChildren(
    h(
      'section',
      { 'aria-labelledby': 'ideas-new' },
      h('h2', { id: 'ideas-new', class: 'admin-label' }, pending.length ? `To read (${pending.length})` : 'To read'),
      pending.length
        ? h('div', { class: 'admin-panel' }, pending.map(card))
        : h('p', { class: 'empty-queue' }, 'Nothing new. Messages from the "Tell us" page land here.'),
    ),
    h(
      'section',
      { 'aria-labelledby': 'ideas-kept' },
      h('h2', { id: 'ideas-kept', class: 'admin-label' }, `Kept ideas (${kept.length})`),
      kept.length
        ? h(
            'ul',
            { class: 'idea-list' },
            kept.map((k) =>
              h('li', null, h('p', { class: 'idea-text' }, k.message), h('p', { class: 'card-meta' }, `Sent ${sentAgo(k.created_at)}`)),
            ),
          )
        : h('p', { class: 'empty-queue' }, 'Nothing kept yet.'),
    ),
  );
}
