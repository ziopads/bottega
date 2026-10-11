'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { DetailGrid, Section } from '@/app/_ui/layout';
import type { MyArtist } from '@/lib/account';

import { ComingSoon, FIELD } from './parts';

// Preferences (REQUIREMENTS AC-13, db/010): the artist new sessions are
// credited to. More arrive as they are needed.

export default function PreferencesTab({
  artists,
  initialDefaultArtistId,
}: {
  artists: MyArtist[];
  initialDefaultArtistId: number | null;
}) {
  const [artistId, setArtistId] = useState<number | null>(initialDefaultArtistId);
  const [state, setState] = useState<'' | 'saving' | 'saved'>('');
  const [error, setError] = useState('');

  async function choose(value: string) {
    const next = value === '' ? null : Number(value);
    const before = artistId;
    setArtistId(next);
    setError('');
    setState('saving');
    const r = await api<{ preferences: { defaultArtistId: number | null } }>('/api/account/preferences', {
      method: 'PUT',
      body: JSON.stringify({ defaultArtistId: next }),
    });
    if (!r.ok) {
      setArtistId(before);
      setState('');
      setError(r.body.error || 'Could not save the preference.');
      return;
    }
    setArtistId(r.data.preferences.defaultArtistId);
    setState('saved');
  }

  const main = (
    <>
      <Section label="New sessions">
        {error && <p className="t-body mb-2 text-rust">{error}</p>}
        {artists.length === 0 ? (
          <p className="t-body text-muted">Add an artist under Profile first.</p>
        ) : (
          <label className="t-body flex flex-wrap items-center gap-2">
            <span className="t-label w-28">Default artist</span>
            <select value={artistId ?? ''} onChange={(e) => choose(e.target.value)} className={FIELD} disabled={state === 'saving'}>
              <option value="">The first by code ({artists[0].code})</option>
              {artists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
            {state === 'saved' && <span className="text-muted">Saved.</span>}
          </label>
        )}
        <p className="mt-2 text-[11px] text-muted">The artist a new session starts with. It can be changed on each session.</p>
      </Section>
      <Section label="Display">
        <ComingSoon>Date format, and the time zone used for dates.</ComingSoon>
      </Section>
      <Section label="Notifications">
        <ComingSoon>Email when someone shares with you, adds a note or uploads a mix to your sessions.</ComingSoon>
      </Section>
    </>
  );

  return <DetailGrid main={main} />;
}
