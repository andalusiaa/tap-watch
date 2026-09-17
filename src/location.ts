// Where to measure distances from. Everything here stays in the browser: the location is
// never sent to our server or stored. A typed postcode is sent only to postcodes.io.

import type { LatLng } from './geo';

const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;
const DISTRICT = /^[A-Z]{1,2}\d[A-Z\d]?$/;

/** "e179lb" → "E17 9LB", "e17" → "E17", anything else → null. */
export function tidyPostcode(input: string): string | null {
  const compact = input.replace(/\s+/g, '').toUpperCase();
  if (FULL_POSTCODE.test(compact)) return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  if (DISTRICT.test(compact)) return compact;
  return null;
}

/** Looks up a tidied postcode or postcode district. Returns null if it doesn't exist. */
export async function lookupPostcode(postcode: string): Promise<LatLng | null> {
  const kind = postcode.includes(' ') ? 'postcodes' : 'outcodes';
  const res = await fetch(`https://api.postcodes.io/${kind}/${encodeURIComponent(postcode)}`, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`postcodes.io returned ${res.status}`);
  const body = (await res.json()) as { result?: { latitude?: number | null; longitude?: number | null } };
  const { latitude, longitude } = body.result ?? {};
  return latitude != null && longitude != null ? [latitude, longitude] : null;
}

export type LocationPermission = PermissionState | 'unsupported' | 'unknown';

export async function locationPermission(): Promise<LocationPermission> {
  if (!('geolocation' in navigator)) return 'unsupported';
  try {
    return (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch {
    return 'unknown';
  }
}

export interface DeviceFix {
  point: LatLng;
  /** How far off the position may be, in metres, as reported by the device. */
  accuracy: number;
}

/** Stop listening once the device is at least this sure of its position. */
const GOOD_ENOUGH_M = 25;
/** Never listen for longer than this. */
const MAX_WAIT_MS = 10_000;

export const PERMISSION_DENIED = 1;

/**
 * Asks the browser where the device is (it shows its own permission prompt).
 *
 * The first answer is often a rough guess from Wi-Fi or phone masts, so this keeps
 * listening for a few seconds and resolves with the most accurate reading.
 * onBetterFix is called each time a more accurate reading arrives, so the page can
 * show distances straight away and refine them.
 */
export function devicePosition(onBetterFix?: (fix: DeviceFix) => void): Promise<DeviceFix> {
  return new Promise((resolve, reject) => {
    let best: DeviceFix | null = null;
    let lastError: { code: number } = { code: 3 }; // TIMEOUT unless told otherwise
    let watchId = -1;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      navigator.geolocation.clearWatch(watchId);
      if (best) resolve(best);
      else reject(lastError);
    };
    const timer = setTimeout(finish, MAX_WAIT_MS);

    watchId = navigator.geolocation.watchPosition(
      (p) => {
        const fix: DeviceFix = { point: [p.coords.latitude, p.coords.longitude], accuracy: p.coords.accuracy };
        if (!best || fix.accuracy < best.accuracy) {
          best = fix;
          if (!done) onBetterFix?.(fix);
        }
        if (fix.accuracy <= GOOD_ENOUGH_M) finish();
      },
      (error) => {
        lastError = error;
        if (error.code === PERMISSION_DENIED) finish();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: MAX_WAIT_MS },
    );
  });
}
