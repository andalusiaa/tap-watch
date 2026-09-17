// Text helpers shared with the site and the seed scripts.

export { normalise } from '../src/search';

/** "Madrì Excepcional" → "madri-excepcional". Matches seed/fetch-pubs.mjs. */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
