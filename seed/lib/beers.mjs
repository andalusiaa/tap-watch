// Shared helpers for the master beer list.

const CATEGORIES = new Set(['lager', 'stout', 'pale_ipa', 'bitter_cask', 'cider', 'other']);

/**
 * Lowercase, strip accents and punctuation. Must match normalise() in src/search.ts.
 * @param {string} text
 */
export function normalise(text) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('&', ' and ')
    .replace(/['’]/g, '')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

/**
 * Throws if the beer list has duplicate ids, clashing aliases or invalid fields.
 * @param {any[]} beers
 */
export function validateBeers(beers) {
  const problems = [];
  const ids = new Set();
  const names = new Map();

  for (const b of beers) {
    if (ids.has(b.id)) problems.push(`Duplicate id: ${b.id}`);
    ids.add(b.id);
    if (!CATEGORIES.has(b.category)) problems.push(`${b.id}: unknown category "${b.category}"`);
    if (b.abv != null && (b.abv < 0 || b.abv > 15)) problems.push(`${b.id}: odd ABV ${b.abv}`);
    if (b.is_alcohol_free && b.abv != null && b.abv > 0.5) problems.push(`${b.id}: alcohol-free but ABV ${b.abv}`);
    if (!b.is_alcohol_free && b.abv != null && b.abv <= 0.5) problems.push(`${b.id}: ABV ${b.abv} but not marked alcohol-free`);
    if (b.common_name) {
      // Every word has to come from the beer's own name or spellings, so a slip can't turn
      // one beer into another. "Asahi Zero" is fine for "Asahi Super Dry 0.0" (alias "asahi zero").
      if (b.common_name.length > 60) problems.push(`${b.id}: common name "${b.common_name}" is too long`);
      const known = new Set([normalise(b.name), ...b.aliases.map(normalise)].flatMap((t) => t.split(' ')));
      const stray = normalise(b.common_name).split(' ').filter((w) => w && !known.has(w));
      if (stray.length) {
        problems.push(`${b.id}: common name "${b.common_name}" uses ${stray.map((w) => `"${w}"`).join(', ')}, which isn't in its name or spellings`);
      }
    }
    names.set(normalise(b.name), b.id);
  }

  const aliases = new Map();
  for (const b of beers) {
    for (const raw of b.aliases) {
      const alias = normalise(raw);
      if (alias !== raw) problems.push(`${b.id}: alias "${raw}" should be written as "${alias}"`);
      const nameOwner = names.get(alias);
      if (nameOwner && nameOwner !== b.id) problems.push(`${b.id}: alias "${alias}" is another beer's name (${nameOwner})`);
      if (aliases.has(alias)) problems.push(`Alias "${alias}" used by both ${aliases.get(alias)} and ${b.id}`);
      aliases.set(alias, b.id);
    }
  }

  if (problems.length) throw new Error(`Beer list problems:\n  ${problems.join('\n  ')}`);
}
