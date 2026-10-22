// The words on the descriptive pages (About, How it works, Questions, Privacy), kept in the
// database so Tristan can edit them on the admin Pages tab.
//
//   GET  /api/pages/:slug                 → { title, body, updated_at }
//   GET  /api/admin/pages                 → every page, for the editor
//   POST /api/admin/pages/:slug           { title, body }
//
// The body is plain text with a tiny bit of markup (## headings, - bullets, [text](link),
// **bold**). It is never HTML: the browser builds elements from it, so nothing can inject tags.

import { logAdmin } from './activity';
import { ApiError, isoTime, json, readJsonBody } from './http';

const MAX_TITLE = 120;
const MAX_BODY = 20_000;

export const isPageSlug = (value: string): boolean => /^[a-z][a-z0-9-]{0,40}$/.test(value);

export async function getPage(env: Env, slug: string): Promise<Response> {
  const page = await env.DB.prepare('SELECT slug, title, body, updated_at FROM pages WHERE slug = ?')
    .bind(slug)
    .first<{ slug: string; title: string; body: string; updated_at: string }>();
  if (!page) throw new ApiError(404, 'not_found', "There's nothing at this address.");
  return json(page, 200, { 'Cache-Control': 'no-store' });
}

export async function listPages(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT slug, title, body, updated_at FROM pages ORDER BY slug').all();
  return json({ pages: results });
}

export async function savePage(request: Request, env: Env, slug: string, now: number): Promise<Response> {
  const body = await readJsonBody(request, MAX_BODY + 2_000);
  const title = typeof body.title === 'string' ? body.title.trim().replace(/\s+/g, ' ') : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || title.length > MAX_TITLE) throw new ApiError(400, 'bad_title', `Give the page a title, under ${MAX_TITLE} characters.`);
  if (!text) throw new ApiError(400, 'empty', 'The page needs some words.');
  if (text.length > MAX_BODY) throw new ApiError(400, 'too_long', `That page is too long: keep it under ${MAX_BODY} characters.`);
  if (/<[a-z/!]/i.test(text)) throw new ApiError(400, 'no_html', "Please write plain text: HTML tags aren't allowed here.");

  const db = env.DB;
  const [result] = await db.batch([
    db.prepare('UPDATE pages SET title = ?, body = ?, updated_at = ? WHERE slug = ?').bind(title, text, isoTime(now), slug),
    logAdmin(db, now, 'page_edited', null, `Edited the ${slug} page.`),
  ]);
  if (!result?.meta.changes) throw new ApiError(404, 'not_found', "We couldn't find that page.");
  return json({ ok: true });
}

export function pageSlugFrom(path: string): string | null {
  const match = path.match(/^\/api\/pages\/([a-z0-9-]{1,40})$/);
  return match?.[1] && isPageSlug(match[1]) ? match[1] : null;
}
