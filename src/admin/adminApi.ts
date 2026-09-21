// Calls to /api/admin/*. The session cookie is sent automatically (same origin).

import type { Dispense, ListingStatus } from '../types';

export class SignedOut extends Error {}

export class AdminError extends Error {}

export interface ListingChange {
  beer_id: string;
  dispense: Dispense;
  set: 'on' | 'gone' | 'delete';
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
  photo_count: number;
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

export interface AdminOperator {
  id: string;
  name: string;
  type: 'pubco' | 'brewery' | 'independent';
}

export interface EditablePub {
  id: string;
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  venue_type: 'pub' | 'bar';
  operator_id: string | null;
  is_active: number;
  beers: number;
}

export interface PubChanges {
  name: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  venue_type: 'pub' | 'bar';
  is_active: boolean;
  operator_id: string | null;
  new_operator: { name: string; type: AdminOperator['type'] } | null;
}

export interface ActivityEntry {
  kind: 'vote' | 'report' | 'submission' | 'admin';
  at: string;
  pub_id: string | null;
  pub_name: string | null;
  /** A friendly label for the device, e.g. "Amber Otter 17", for the last 30 days only. */
  visitor: string | null;
  text: string;
  status?: string;
}

export interface ActivityVisitor {
  visitor: string | null;
  votes: number;
  reports: number;
  submissions: number;
  last_at: string;
}

export interface Activity {
  entries: ActivityEntry[];
  next: string | null;
  visitors?: ActivityVisitor[];
  log_days: number;
}

export interface Usage {
  now: string;
  today: { votes: number; reports: number; suggestions: number; photos: number; writes: number };
  days: { day: string; votes: number; reports: number; suggestions: number }[];
  stored_photos: { count: number; bytes: number };
  database_bytes: number | null;
  caps: {
    daily_write_budget: number;
    photos_per_day: number;
    reports_per_device_per_day: number;
    photos_per_report: number;
    suggestions_per_device_per_day: number;
    votes_per_device_per_hour: number;
  };
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
  usage: () => call<Usage>('/usage'),
  activity: (filters: { type: string; pub: string; before?: string }) =>
    call<Activity>(`/activity?${new URLSearchParams({ type: filters.type, pub: filters.pub, ...(filters.before ? { before: filters.before } : {}) })}`),
  pubs: () => call<{ sample: boolean; pubs: EditablePub[]; operators: AdminOperator[] }>('/pubs?area=e17'),
  addPub: (pub: PubChanges) => call<{ ok: true; id: string }>('/pubs?area=e17', { pub }),
  updatePub: (id: string, pub: PubChanges) => call<{ ok: true; id: string }>(`/pubs/${encodeURIComponent(id)}`, { pub }),
  setSample: (sample: boolean) => call<{ ok: true; sample: boolean }>('/area/e17/sample', { sample }),
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
  photoUrl: (reportId: number, position: number) => `/api/admin/photo/${reportId}/${position}`,
};
