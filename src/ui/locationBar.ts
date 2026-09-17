// The "Distances are from…" line, with "Use my location" and "Enter a postcode".

import { distanceKm, formatDistance, type LatLng } from '../geo';
import { devicePosition, locationPermission, lookupPostcode, tidyPostcode, type LocationPermission } from '../location';
import { byId } from './dom';

interface Options {
  areaName: string;
  areaCentre: LatLng;
  onChange: (origin: LatLng) => void;
}

type Source = { kind: 'area' } | { kind: 'device'; at: number } | { kind: 'postcode'; postcode: string };

/** A device location younger than this is reused when the user searches again. */
const FRESH_FIX_MS = 60_000;
/** Beyond this, say that the user is a long way from the area. */
const FAR_KM = 5;

export function setupLocationBar(o: Options) {
  const els = {
    status: byId('location-status'),
    useLocation: byId<HTMLButtonElement>('use-location'),
    showPostcode: byId<HTMLButtonElement>('show-postcode'),
    form: byId<HTMLFormElement>('postcode-form'),
    input: byId<HTMLInputElement>('postcode'),
    error: byId('postcode-error'),
  };

  let origin: LatLng = o.areaCentre;
  let source: Source = { kind: 'area' };
  let permission: LocationPermission = 'unknown';
  let locating: Promise<void> | null = null;
  /** Bumped on every change of origin, so a slow location fix can't undo a newer choice. */
  let generation = 0;

  function describe(): string {
    const from =
      source.kind === 'device'
        ? 'your location'
        : source.kind === 'postcode'
          ? source.postcode
          : `central ${o.areaName}`;
    let text = `Distances are from ${from}.`;
    const away = distanceKm(origin, o.areaCentre);
    if (source.kind !== 'area' && away > FAR_KM) {
      text += ` That's about ${formatDistance(away)} from ${o.areaName}.`;
    }
    return text;
  }

  function show(prefix = '') {
    els.status.textContent = `${prefix}${describe()}`;
    els.useLocation.textContent = source.kind === 'device' ? 'Update my location' : 'Use my location';
    els.useLocation.hidden = permission === 'unsupported';
  }

  function setOrigin(point: LatLng, next: Source) {
    generation++;
    origin = point;
    source = next;
    show();
    o.onChange(origin);
  }

  function locate(): Promise<void> {
    if (locating) return locating;
    const startedAt = generation;
    els.status.textContent = 'Finding your location…';
    locating = devicePosition()
      .then((point) => {
        permission = 'granted';
        if (generation === startedAt) setOrigin(point, { kind: 'device', at: Date.now() });
      })
      .catch((error: GeolocationPositionError) => {
        if (generation !== startedAt) return;
        if (error.code === error.PERMISSION_DENIED) {
          permission = 'denied';
          show('Location is turned off for this site in your browser settings. ');
        } else {
          show("We couldn't find your location. ");
        }
      })
      .finally(() => {
        locating = null;
      });
    return locating;
  }

  function togglePostcode(open: boolean) {
    els.form.hidden = !open;
    els.showPostcode.setAttribute('aria-expanded', String(open));
    els.error.hidden = true;
    if (open) els.input.focus();
  }

  els.useLocation.addEventListener('click', () => void locate());
  els.showPostcode.addEventListener('click', () => togglePostcode(els.form.hasAttribute('hidden')));

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const showError = (message: string) => {
      els.error.textContent = message;
      els.error.hidden = false;
      els.input.focus();
    };
    const postcode = tidyPostcode(els.input.value);
    if (!postcode) return showError('That doesn\'t look like a UK postcode. Try something like "E17 4JD".');

    els.error.hidden = true;
    els.status.textContent = `Looking up ${postcode}…`;
    try {
      const point = await lookupPostcode(postcode);
      if (!point) {
        show();
        return showError(`We couldn't find ${postcode}. Check it and try again.`);
      }
      els.input.value = '';
      togglePostcode(false);
      setOrigin(point, { kind: 'postcode', postcode });
    } catch {
      show();
      showError("We couldn't look up postcodes just now. Check your connection and try again.");
    }
  });

  show();
  // If the user already allowed location on an earlier visit, use it straight away (no prompt).
  void locationPermission().then((state) => {
    permission = state;
    show();
    if (state === 'granted') void locate();
  });

  return {
    origin: () => origin,

    /**
     * Called when the user searches. Measures from where they are right now, asking the
     * browser for permission the first time. Skipped if they chose a postcode or said no.
     */
    onSearch() {
      if (source.kind === 'postcode' || permission === 'denied' || permission === 'unsupported') return;
      if (source.kind === 'device' && Date.now() - source.at < FRESH_FIX_MS) return;
      void locate();
    },
  };
}
