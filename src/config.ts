// Values that are likely to be tuned live here, in one place.

import type { Category } from './types';

export const SITE_NAME = 'Tap Watch';
export const AREA_ID = 'e17';

/**
 * Freshness thresholds in days (SPEC section 8, lengthened by Tristan on 2026-09-18):
 * green up to 1 month, amber up to 4 months, grey after that.
 */
export const FRESH_MAX_DAYS = 30;
export const AGEING_MAX_DAYS = 120;

/** Pub page groups, in display order. Alcohol-free beers always go in their own group. */
export const GROUPS: { id: Category | 'alcohol_free'; label: string }[] = [
  { id: 'lager', label: 'Lager' },
  { id: 'stout', label: 'Stout' },
  { id: 'pale_ipa', label: 'Pale and IPA' },
  { id: 'bitter_cask', label: 'Bitter and cask ale' },
  { id: 'cider', label: 'Cider' },
  { id: 'alcohol_free', label: 'Alcohol-free' },
  { id: 'other', label: 'Other' },
];

export const MAX_SUGGESTIONS = 12;
