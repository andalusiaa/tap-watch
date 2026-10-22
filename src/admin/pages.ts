// The Pages tab: edit the words on About, How it works, Questions and Privacy.
// Plain text in, with ## headings, - bullets, [text](link) and **bold**. No HTML.

import { h } from '../ui/dom';
import { renderPageBody } from '../page';
import { adminApi, AdminError, SignedOut, type SitePage } from './adminApi';

const WHERE: Record<string, string> = {
  about: '/about/',
  'how-it-works': '/how-it-works/',
  faq: '/faq/',
  privacy: '/privacy/',
};

interface Options {
  panel: HTMLElement;
  onSignedOut: () => void;
}

export async function renderPages(o: Options, openSlug?: string, message?: string): Promise<void> {
  o.panel.replaceChildren(h('p', { class: 'form-help' }, 'Loading…'));
  const { pages } = await adminApi.pages();

  const picker = h(
    'select',
    { id: 'page-picker' },
    h('option', { value: '' }, 'Choose a page'),
    pages.map((p) => h('option', { value: p.slug, selected: p.slug === openSlug }, p.title)),
  );
  const editorSlot = h('div');
  const done = h('p', { class: 'form-status', role: 'status', tabindex: '-1' }, message ?? '');

  function editor(page: SitePage): HTMLElement {
    const title = h('input', { id: 'page-title', type: 'text', maxlength: 120, value: page.title });
    const body = h('textarea', { id: 'page-body', rows: 18 }, page.body);
    const status = h('p', { class: 'form-status', role: 'status' });
    const save = h('button', { type: 'submit', class: 'button button--save' }, 'Save page');
    const preview = h('div', { class: 'page-preview prose' }, ...renderPageBody(page.body));
    const showPreview = h('button', { type: 'button', class: 'button' }, 'Update preview');
    showPreview.addEventListener('click', () => preview.replaceChildren(...renderPageBody(body.value)));

    const form = h(
      'form',
      { class: 'panel-form', novalidate: true },
      h('h2', null, `Editing ${WHERE[page.slug] ?? page.slug}`),
      h(
        'p',
        { class: 'form-help' },
        'Plain text. Start a line with ## for a heading, - for a bullet. Links are [the words](/the-address), ' +
          'and **two stars** make text bold. A blank line starts a new paragraph.',
      ),
      h('label', { for: 'page-title' }, 'Page title'),
      title,
      h('label', { for: 'page-body' }, 'Words'),
      body,
      h('div', { class: 'card-actions' }, save, showPreview),
      status,
      h('h3', null, 'Preview'),
      preview,
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        await adminApi.savePage(page.slug, title.value, body.value);
        await renderPages(o, page.slug, 'Saved. The page updates for everyone straight away.');
      } catch (error) {
        if (error instanceof SignedOut) return o.onSignedOut();
        status.textContent = error instanceof AdminError ? error.message : "Couldn't save. Check your connection and try again.";
        save.disabled = false;
      }
    });
    return form;
  }

  const show = () => {
    const page = pages.find((p) => p.slug === picker.value);
    editorSlot.replaceChildren(...(page ? [editor(page)] : []));
    if (page) done.textContent = '';
  };
  picker.addEventListener('change', show);

  o.panel.replaceChildren(
    h('p', { class: 'form-help' }, 'The words on the public pages. Changes show on the site as soon as they are saved.'),
    h('div', null, h('label', { for: picker.id, class: 'admin-label' }, 'Page'), picker),
    done,
    editorSlot,
  );
  if (openSlug) show();
  if (message) done.focus();
}
