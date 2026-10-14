'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { DetailGrid, MetaList, Section } from '@/app/_ui/layout';
import type { MyArtist } from '@/lib/account';

import { FIELD } from './parts';
import When from './When';
import { BUTTON, BUTTON_DANGER } from '@/app/_ui/styles';

// Profile (REQUIREMENTS AC-13): the name others see on shares, notes and
// uploads; the sign-in email; the artists sessions are credited to.

export default function ProfileTab({
  initialName,
  email,
  since,
  initialArtists,
}: {
  initialName: string;
  email: string;
  since: string | null;
  initialArtists: MyArtist[];
}) {
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [nameState, setNameState] = useState<'' | 'saving' | 'saved'>('');
  const [artists, setArtists] = useState(initialArtists);
  const [error, setError] = useState('');

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNameState('saving');
    const r = await api<{ displayName: string }>('/api/account', { method: 'PATCH', body: JSON.stringify({ displayName: draft }) });
    if (!r.ok) {
      setNameState('');
      setError(r.body.error || 'Could not save the name.');
      return;
    }
    setName(r.data.displayName);
    setDraft(r.data.displayName);
    setNameState('saved');
  }

  const main = (
    <>
      <Section label="Display name">
        <form onSubmit={saveName} className="t-body flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setNameState('');
            }}
            maxLength={80}
            aria-label="Display name"
            className={`${FIELD} w-64`}
          />
          <button
            type="submit"
            disabled={nameState === 'saving' || !draft.trim() || draft.trim() === name}
            className={`self-stretch ${BUTTON}`}
          >
            {nameState === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {nameState === 'saved' && <span className="text-muted">Saved.</span>}
        </form>
        <p className="mt-2 text-[11px] text-muted">
          What collaborators see beside your notes, uploads and shares. Your email is never shown to them.
        </p>
      </Section>

      <Section label={`Artists · ${artists.length}`}>
        <ArtistList artists={artists} setArtists={setArtists} onError={setError} />
      </Section>
    </>
  );

  const aside = (
    <Section label="Sign-in">
      <MetaList
        rows={[
          { label: 'Email', value: email },
          { label: 'Member since', value: since ? <When iso={since} day /> : '—' },
        ]}
      />
      <p className="mt-2 text-[11px] text-muted">The email you sign in with. Changing it is not available yet.</p>
    </Section>
  );

  return (
    <>
      {error && <p className="t-body mb-4 text-rust">{error}</p>}
      <DetailGrid main={main} aside={aside} />
    </>
  );
}

function ArtistList({
  artists,
  setArtists,
  onError,
}: {
  artists: MyArtist[];
  setArtists: React.Dispatch<React.SetStateAction<MyArtist[]>>;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  function start(a: MyArtist | null) {
    onError('');
    setEditing(a ? a.id : 'new');
    setCode(a?.code ?? '');
    setName(a?.name ?? '');
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    setBusy(true);
    const isNew = editing === 'new';
    const r = await api<{ artist: MyArtist }>(isNew ? '/api/artists' : `/api/artists/${editing}`, {
      method: isNew ? 'POST' : 'PATCH',
      body: JSON.stringify({ code, name }),
    });
    setBusy(false);
    if (!r.ok) {
      onError(r.body.error || 'Could not save the artist.');
      return;
    }
    setArtists((l) =>
      (isNew ? [...l, r.data.artist] : l.map((x) => (x.id === r.data.artist.id ? r.data.artist : x))).sort((a, b) =>
        a.code.localeCompare(b.code),
      ),
    );
    setEditing(null);
  }

  async function remove(a: MyArtist) {
    onError('');
    if (!window.confirm(`Delete the artist ${a.code} · ${a.name}?`)) return;
    const r = await api(`/api/artists/${a.id}`, { method: 'DELETE' });
    if (!r.ok) {
      onError(r.body.error || 'Could not delete the artist.');
      return;
    }
    setArtists((l) => l.filter((x) => x.id !== a.id));
  }

  const form = (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2 py-1.5">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="CODE"
        aria-label="Code"
        maxLength={12}
        className={`${FIELD} t-num w-24 uppercase`}
        autoFocus
      />
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" className={`${FIELD} w-56`} />
      <button type="submit" disabled={busy || !code.trim() || !name.trim()} className={`self-stretch ${BUTTON}`}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setEditing(null)} className={`self-stretch ${BUTTON}`}>
        Cancel
      </button>
    </form>
  );

  return (
    <div className="t-body">
      {artists.length === 0 && editing !== 'new' && <p className="text-muted">No artists yet. Sessions are credited to one.</p>}
      <ul className="divide-y divide-line">
        {artists.map((a) =>
          editing === a.id ? (
            <li key={a.id}>{form}</li>
          ) : (
            <li key={a.id} className="flex items-baseline gap-3 py-1.5">
              <span className="t-num w-24 shrink-0">{a.code}</span>
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="text-[11px] text-muted">
                {a.uses} {a.uses === 1 ? 'credit' : 'credits'}
              </span>
              <button onClick={() => start(a)} className={BUTTON}>
                Rename
              </button>
              {a.uses === 0 && (
                <button onClick={() => remove(a)} className={BUTTON_DANGER}>
                  Delete
                </button>
              )}
            </li>
          ),
        )}
        {editing === 'new' && <li>{form}</li>}
      </ul>
      {editing === null && (
        <button onClick={() => start(null)} className={`mt-2 ${BUTTON}`}>
          + Add an artist
        </button>
      )}
      <p className="mt-2 text-[11px] text-muted">
        The code starts each session&rsquo;s canonical ID. Codes and names are unique across Bottega. Renaming a code does
        not rename existing canonical IDs.
      </p>
    </div>
  );
}
