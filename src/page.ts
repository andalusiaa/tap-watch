// The descriptive pages (About, How it works, Questions, Privacy). The words live in the
// database so they can be edited on the admin page; the copy built into the HTML is the
// fallback, used until the saved version arrives or if it can't be reached.
//
// The saved text is plain, with a little markup: "## heading", "- bullet", "[text](link)"
// and "**bold**". Elements are built one at a time, never from a string of HTML.

import { h } from './ui/dom';

type Child = string | HTMLElement;

/** Splits "a **bold** bit and a [link](/here)" into text and elements. */
function inline(text: string): Child[] {
  const out: Child[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1]) out.push(h('strong', null, m[1]));
    else if (m[2] && m[3]) {
      const external = /^https?:\/\//.test(m[3]);
      out.push(h('a', external ? { href: m[3], rel: 'noopener noreferrer' } : { href: m[3] }, m[2]));
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Turns the saved text into headings, paragraphs and lists. */
export function renderPageBody(body: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let list: HTMLElement | null = null;
  for (const line of body.split('\n').map((l) => l.trim())) {
    if (!line) {
      list = null;
      continue;
    }
    if (line.startsWith('- ')) {
      if (!list) {
        list = h('ul', null);
        out.push(list);
      }
      list.append(h('li', null, inline(line.slice(2))));
      continue;
    }
    list = null;
    if (line.startsWith('### ')) out.push(h('h3', null, inline(line.slice(4))));
    else if (line.startsWith('## ')) out.push(h('h2', null, inline(line.slice(3))));
    else out.push(h('p', null, inline(line)));
  }
  return out;
}

const main = document.querySelector<HTMLElement>('main[data-page]');
const slug = main?.dataset.page;
if (main && slug) {
  void fetch(`/api/pages/${slug}`, { headers: { Accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) return;
      const page = (await res.json()) as { title: string; body: string };
      const heading = h('h1', { class: 'page-title' }, page.title);
      document.title = `${page.title} · Tap Watch E17`;
      main.replaceChildren(heading, ...renderPageBody(page.body));
    })
    .catch(() => {
      // Keep the words that came with the page.
    });
}
