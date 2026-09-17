// The "Distances are from…" line, with "Use my location" and "Enter a postcode".

import { distanceKm, formatDistance, type LatLng } from '../geo';
import {
  devicePosition,
  locationPermission,
  lookupPostcode,
  PERMISSION_DENIED,
  tidyPostcode,
  type DeviceFix,
  type LocationPermission,
} from '../location';
import { byId } from './dom';

interface Options {
  areaName: string;
  areaCentre: LatLng;
  onChange: (origin: LatLng) => void;
}

type Source =
  | { kind: 'area' }
  | { kind: 'device'; at: number; accuracy: number; refining: boolean }
  | { kind: 'postcode'; postcode: string };

/** A device location younger than this is reused when the user searches again. */
const FRESH_FIX_MS = 60_000;
/** Beyond this, say that the user is a long way from the area. */
const FAR_KM = 5;
/** A device reading less accurate than this gets a tip about precise location. */
const ROUGH_M = 150;

function formatAccuracy(metres: number): string {
  return metres < 1000 ? `${Math.max(10, Math.round(metres / 10) * 10)} m` : formatDistance(metres / 1000);
}

export function setupLocationBar(o: Options) {
  const els = {
    status: byId('location-status'),
    tip: byId('location-tip'),
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

  function describe(): { text: string; tip?: string } {
    let text: string;
    let tip: string | undefined;
    switch (source.kind) {
      case 'device':
        text = `Distances are in a straight line from your location, accurate to about ${formatAccuracy(source.accuracy)}.`;
        if (source.refining) text += ' Getting a closer fix…';
        else if (source.accuracy > ROUGH_M) {
          tip =
            'Your device only knows roughly where you are. For closer distances, turn on precise location for this browser, or enter a postcode.';
        }
        break;
      case 'postcode':
        text = `Distances are in a straight line from the middle of ${source.postcode}.`;
        break;
      default:
        text = `Distances are in a straight line from central ${o.areaName}.`;
    }
    const away = distanceKm(origin, o.areaCentre);
    if (source.kind !== 'area' && away > FAR_KM) {
      text += ` That's about ${formatDistance(away)} from ${o.areaName}.`;
    }
    return { text, tip };
  }

  function setStatus(text: string, tip?: string) {
    els.status.textContent = text;
    els.tip.textContent = tip ?? '';
    els.tip.hidden = !tip;
  }

  function show(problem = '') {
    const { text, tip } = describe();
    setStatus(problem ? `${problem} ${text}` : text, problem ? undefined : tip);
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
    // Our own updates bump generation too, so track the latest one we made.
    let ours = generation;
    const useFix = (fix: DeviceFix, refining: boolean) => {
      if (generation !== ours) return;
      permission = 'granted';
      setOrigin(fix.point, { kind: 'device', at: Date.now(), accuracy: fix.accuracy, refining });
      ours = generation;
    };
    setStatus('Finding your location…');
    locating = devicePosition((fix) => useFix(fix, true))
      .then((fix) => useFix(fix, false))
      .catch((error: { code?: number }) => {
        if (generation !== ours) return;
        if (error.code === PERMISSION_DENIED) {
          permission = 'denied';
          show('Location is turned off for this site in your browser settings.');
        } else {
          show("We couldn't find your location.");
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
    setStatus(`Looking up ${postcode}…`);
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
