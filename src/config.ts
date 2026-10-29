// Values that are likely to be tuned live here, in one place.

import type { Category } from './types';

export const SITE_NAME = 'Tap Watch';
export const AREA_ID = 'e17';

/**
 * Freshness thresholds in days (SPEC section 8, lengthened again by Tristan on 2026-10-20):
 * green up to 8 weeks, amber up to 6 months, grey after that. The map key, the badges and
 * the wording on /about/ all follow these, so keep /about/ in step when they change.
 */
export const FRESH_MAX_DAYS = 56;
export const AGEING_MAX_DAYS = 180;

/** Pub page groups, in display order. Alcohol-free beers always go in their own group. */
export const GROUPS: { id: Category | 'alcohol_free'; label: string }[] = [
  { id: 'lager', label: 'Lager' },
  { id: 'stout', label: 'Stout' },
  { id: 'pale_ipa', label: 'Pale and IPA' },
  { id: 'bitter_cask', label: 'Ales and bitters' },
  { id: 'cider', label: 'Cider' },
  { id: 'alcohol_free', label: 'Alcohol-free' },
  { id: 'other', label: 'Other' },
];

export const MAX_SUGGESTIONS = 12;
