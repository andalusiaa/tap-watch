// The private admin page (/admin/).

import { loadSnapshot } from '../api';
import type { Beer, Snapshot } from '../types';
import { byId, h } from '../ui/dom';
import { adminApi, AdminError, SignedOut } from './adminApi';
import { renderQueue } from './queue';
import { confirmDeletes, createTapEditor } from './tapEditor';
import { renderActivity } from './activity';
import { renderPubs } from './pubs';
import { renderUsage } from './usage';

const els = {
  status: byId('admin-status'),
  signin: byId('signin'),
  signinForm: byId<HTMLFormElement>('signin-form'),
  password: byId<HTMLInputElement>('password'),
  signinStatus: byId('signin-status'),
  workspace: byId('workspace'),
  signout: byId<HTMLButtonElement>('signout'),
  tabs: byId<HTMLFieldSetElement>('tabs'),
  queueTabLabel: byId('queue-tab-label'),
  queuePanel: byId('queue-panel'),
  tapsPanel: byId('taps-panel'),
  usagePanel: byId('usage-panel'),
  pubsPanel: byId('pubs-panel'),
  activityPanel: byId('activity-panel'),
  pubPicker: byId<HTMLSelectElement>('pub-picker'),
  pubEditor: byId('pub-editor'),
};

let snapshot: Snapshot | null = null;

let beers: Beer[] = [];

function showSignIn(message = '') {
  els.workspace.hidden = true;
  els.signin.hidden = false;
  els.status.textContent = '';
  els.signinStatus.textContent = message;
  els.password.value = '';
  els.password.focus();
}

async function refreshQueue() {
  try {
    const count = await renderQueue(els.queuePanel, {
      beers,
      onSignedOut: () => showSignIn('Your session ended. Please sign in again.'),
      onDone: () => void refreshCount(),
    });
    els.queueTabLabel.textContent = count ? `To check (${count})` : 'To check';
  } catch (error) {
    if (error instanceof SignedOut) return showSignIn('Please sign in.');
    els.queuePanel.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load the list. Check your connection and refresh."));
  }
}

async function refreshUsage() {
  try {
    await renderUsage(els.usagePanel);
  } catch (error) {
    if (error instanceof SignedOut) return showSignIn('Your session ended. Please sign in again.');
    els.usagePanel.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load usage. Check your connection and try again."));
  }
}

async function refreshActivity() {
  try {
    const { pubs } = await adminApi.pubs();
    await renderActivity({ panel: els.activityPanel, pubs });
  } catch (error) {
    if (error instanceof SignedOut) return showSignIn('Your session ended. Please sign in again.');
    els.activityPanel.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load the activity. Check your connection and try again."));
  }
}

async function refreshPubs() {
  try {
    await renderPubs({
      panel: els.pubsPanel,
      onPubsChanged: () => void fillPubPicker(),
      onSignedOut: () => showSignIn('Your session ended. Please sign in again.'),
    });
  } catch (error) {
    if (error instanceof SignedOut) return showSignIn('Your session ended. Please sign in again.');
    els.pubsPanel.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load the pubs. Check your connection and try again."));
  }
}

/** The tap list picker lists every pub from the admin API, so new and renamed pubs show straight away. */
async function fillPubPicker() {
  const current = els.pubPicker.value;
  const { pubs } = await adminApi.pubs();
  els.pubPicker.replaceChildren(
    h('option', { value: '' }, 'Choose a pub'),
    ...pubs.map((p) => h('option', { value: p.id, selected: p.id === current }, p.is_active ? p.name : `${p.name} (closed)`)),
  );
}

async function refreshCount() {
  try {
    const { reports, suggestions } = await adminApi.queue();
    const count = reports.length + suggestions.length;
    els.queueTabLabel.textContent = count ? `To check (${count})` : 'To check';
  } catch {
    // The count is a nicety; ignore failures.
  }
}

async function openPub(pubId: string) {
  if (!pubId) {
    els.pubEditor.replaceChildren();
    return;
  }
  els.pubEditor.replaceChildren(h('p', { class: 'form-help' }, 'Loading…'));
  try {
    const { pub, listings } = await adminApi.pub(pubId);
    const editor = createTapEditor({
      beers,
      listings,
      hint: 'Standing at the bar? Mark each beer On or Gone, add any that are missing, then save. "On" counts as checked now.',
    });
    const status = h('p', { class: 'form-status save-status', role: 'status' });
    const save = h('button', { type: 'button', class: 'button button--primary' }, 'Save');
    save.addEventListener('click', async () => {
      const changes = editor.changes();
      if (changes.length === 0) {
        status.textContent = 'Nothing to save yet.';
        return;
      }
      if (changes.length > 40) {
        status.textContent = `That's ${changes.length} changes. Please save up to 40 at a time.`;
        return;
      }
      if (!confirmDeletes(changes)) return;
      save.disabled = true;
      status.textContent = 'Saving…';
      try {
        await adminApi.saveListings(pub.id, changes);
        await openPub(pub.id);
        const saved = els.pubEditor.querySelector<HTMLElement>('.save-status');
        if (saved) {
          saved.textContent = `Saved ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}. The site updates within a minute.`;
          saved.setAttribute('tabindex', '-1');
          saved.focus();
        }
      } catch (error) {
        if (error instanceof SignedOut) return showSignIn('Your session ended. Please sign in again.');
        status.textContent = error instanceof AdminError ? error.message : "Couldn't save. Check your connection and try again.";
        save.disabled = false;
      }
    });
    els.pubEditor.replaceChildren(
      h('h2', { class: 'visually-hidden' }, pub.name),
      h('p', { class: 'card-meta' }, [pub.address, pub.postcode].filter(Boolean).join(', ')),
      editor.element,
      save,
      status,
    );
  } catch (error) {
    if (error instanceof SignedOut) return showSignIn('Please sign in.');
    els.pubEditor.replaceChildren(h('p', { class: 'form-status' }, "Couldn't load this pub. Check your connection and try again."));
  }
}

async function showWorkspace() {
  els.signin.hidden = true;
  els.status.textContent = 'Loading…';
  snapshot ??= await loadSnapshot();
  beers = [...snapshot.beers];
  await fillPubPicker();
  els.status.textContent = snapshot.sample ? 'The public site is still showing the made-up sample tap lists.' : '';
  els.workspace.hidden = false;
  await refreshQueue();
}

els.signinForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.signinStatus.textContent = 'Signing in…';
  try {
    await adminApi.signIn(els.password.value);
    els.password.value = '';
    els.signinStatus.textContent = '';
    await showWorkspace();
  } catch (error) {
    els.signinStatus.textContent = error instanceof AdminError ? error.message : "Couldn't sign in. Check your connection.";
    els.password.select();
  }
});

els.signout.addEventListener('click', async () => {
  await adminApi.signOut().catch(() => undefined);
  showSignIn('Signed out.');
});

els.tabs.addEventListener('change', (e) => {
  const tab = (e.target as HTMLInputElement).value;
  els.queuePanel.hidden = tab !== 'queue';
  els.tapsPanel.hidden = tab !== 'taps';
  els.usagePanel.hidden = tab !== 'usage';
  els.pubsPanel.hidden = tab !== 'pubs';
  els.activityPanel.hidden = tab !== 'activity';
  if (tab === 'activity') void refreshActivity();
  if (tab === 'pubs') void refreshPubs();
  if (tab === 'queue') void refreshQueue();
  if (tab === 'usage') void refreshUsage();
});

els.pubPicker.addEventListener('change', () => void openPub(els.pubPicker.value));

adminApi
  .session()
  .then(({ signedIn, setUp }) => {
    if (!setUp) {
      els.status.textContent = "The admin password hasn't been set up yet. See the README for how to set it.";
      return;
    }
    if (signedIn) return showWorkspace();
    els.status.textContent = '';
    showSignIn();
  })
  .catch(() => {
    els.status.textContent = "Couldn't reach Tap Watch. Check your connection and refresh.";
  });
