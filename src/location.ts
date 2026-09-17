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

/** Asks the browser where the device is. The browser shows its own permission prompt. */
export function devicePosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.latitude, p.coords.longitude]),
      reject,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  });
}
