// The "Tell us" page: one message box, the same spam checks as every other public write.

import { primeToken, sendFeedback } from './api';
import { byId } from './ui/dom';

const MAX = 1000;
const els = {
  form: byId<HTMLFormElement>('feedback-form'),
  message: byId<HTMLTextAreaElement>('feedback-message'),
  count: byId('feedback-count'),
  send: byId<HTMLButtonElement>('feedback-send'),
  status: byId('feedback-status'),
  honeypot: byId<HTMLInputElement>('website'),
};

function updateCount() {
  const left = MAX - els.message.value.length;
  els.count.textContent = `${left} character${left === 1 ? '' : 's'} left.`;
}
els.message.addEventListener('input', updateCount);
updateCount();

// Fetches the page token now rather than on send, which also counts the visit.
void primeToken('feedback');

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (els.send.disabled) return;
  const message = els.message.value.trim();
  if (!message) {
    els.status.textContent = 'Write a message first.';
    els.message.focus();
    return;
  }
  els.send.disabled = true;
  els.status.textContent = 'Sending…';
  const result = await sendFeedback(message, els.honeypot.value);
  if (result.ok) {
    els.form.replaceChildren(
      Object.assign(document.createElement('p'), {
        className: 'form-done',
        tabIndex: -1,
        textContent: 'Thanks, that’s been sent. Nothing else needed from you.',
      }),
    );
    els.form.querySelector<HTMLElement>('.form-done')?.focus();
    return;
  }
  els.status.textContent = result.message;
  els.send.disabled = false;
});
