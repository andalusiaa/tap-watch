// Calls to /api/admin/*. The session cookie is sent automatically (same origin).

import type { Dispense, ListingStatus } from '../types';

export class SignedOut extends Error {}

export class AdminError extends Error {}

export interface ListingChange {
  beer_id: string;
  dispense: Dispense;
  set: 'on' | 'gone';
}

export interface AdminListing {
  id: number;
  beer_id: string;
  beer_name: string;
  dispense: Dispense;
  status: ListingStatus | 'removed';
  source: string;
  last_confirmed_at: string | null;
  reported_gone_at: string | null;
}

export interface AdminPub {
  pub: { id: string; name: string; address: string; postcode: string };
  listings: AdminListing[];
}

export interface QueueReport {
  id: number;
  pub_id: string;
  pub_name: string;
  note: string | null;
  created_at: string;
  has_photo: number;
}

export interface QueueSuggestion {
  id: number;
  pub_id: string | null;
  pub_name: string | null;
  beer_id: string | null;
  beer_name: string | null;
  proposed_beer_name: string | null;
  dispense: Dispense | null;
  created_at: string;
}

export interface NewBeer {
  name: string;
  brewery: string;
  category: string;
  abv: number | null;
  is_alcohol_free: boolean;
  aliases: string[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401 && data.error === 'signed_out') throw new SignedOut();
  if (!res.ok) throw new AdminError(typeof data.message === 'string' ? data.message : `Something went wrong (${res.status}).`);
  return data as T;
}

export const adminApi = {
  session: () => call<{ signedIn: boolean; setUp: boolean }>('/session'),
  signIn: (password: string) => call<{ ok: true }>('/login', { password }),
  signOut: () => call<{ ok: true }>('/logout', {}),
  queue: () => call<{ reports: QueueReport[]; suggestions: QueueSuggestion[] }>('/queue'),
  pub: (pubId: string) => call<AdminPub>(`/pub/${encodeURIComponent(pubId)}`),
  saveListings: (pubId: string, changes: ListingChange[]) =>
    call<AdminPub>(`/pub/${encodeURIComponent(pubId)}/listings`, { changes }),
  reviewReport: (id: number, action: 'approve' | 'reject', changes: ListingChange[] = []) =>
    call<{ ok: true }>(`/report/${id}`, { action, changes }),
  reviewSuggestion: (
    id: number,
    decision:
      | { action: 'reject' }
      | { action: 'approve'; beer_id?: string; beer?: NewBeer; dispense?: Dispense | null },
  ) => call<{ ok: true; beer_id?: string }>(`/suggestion/${id}`, decision),
  photoUrl: (reportId: number) => `/api/admin/photo/${reportId}`,
};
