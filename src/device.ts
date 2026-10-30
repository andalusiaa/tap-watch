// A random number this browser keeps, so the server can tell one device from another.
//
// It used to work this out from the address the request came from, but a phone's address
// changes whenever it moves between mobile data and Wi-Fi, and again every few hours on its
// own, while everybody on one pub's Wi-Fi shares a single address. So the same person looked
// like several visitors, and several people looked like one.
//
// This number identifies nobody: no account, nothing personal, never shown to anyone. The
// server only ever stores a hash of it, and forgets that after 30 days. Clearing the site's
// stored data makes a new one.

const KEY = 'tw-device';
const SHAPE = /^[0-9a-f]{32}$/;

let cached: string | null = null;

function make(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * This browser's number, or '' when it can't be stored (private browsing). Sending nothing
 * is deliberate: the server then recognises the address and browser as it did before, which
 * at least holds still for one sitting.
 */
export function deviceId(): string {
  if (cached !== null) return cached;
  cached = '';
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && SHAPE.test(stored)) {
      cached = stored;
    } else {
      const made = make();
      localStorage.setItem(KEY, made);
      cached = made;
    }
  } catch {
    // Storage blocked: leave it empty rather than making a new number on every page.
  }
  return cached;
}
