'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { Section } from '@/app/_ui/layout';
import type { MyArtist } from '@/lib/account';
import type { StructureEditor as StructureData } from '@/lib/structureTypes';
import type { TemplateEditor as Editor } from '@/lib/templateTypes';

import { ComingSoon, FIELD } from './parts';
import StructureEditor from './StructureEditor';
import { BoardSettings, TemplateEditor } from './TemplateEditor';

// Preferences (REQUIREMENTS AC-13, W-13, W-22; db/010, db/024): the artist new
// projects are credited to, the board's limits, and the workflow template.
// The sections on the left, the chosen one's detail on the right.

export default function PreferencesTab({
  artists,
  initialDefaultArtistId,
  editor,
  structure,
}: {
  artists: MyArtist[];
  initialDefaultArtistId: number | null;
  editor: Editor;
  structure: StructureData;
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
      <div id="general" className="scroll-mt-4">
        <Section label="New projects">
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
          <p className="mt-2 text-[11px] text-muted">The artist a new project starts with. It can be changed on each project.</p>
        </Section>
      </div>
      <div id="board" className="scroll-mt-4">
        <BoardSettings initial={editor} />
      </div>
      <div id="template" className="scroll-mt-4">
        <TemplateEditor initial={editor} />
      </div>
      <div id="structure" className="scroll-mt-4">
        <StructureEditor initial={structure} />
      </div>
      <Section label="Display">
        <ComingSoon>Date format, and the time zone used for dates.</ComingSoon>
      </Section>
      <Section label="Notifications">
        <ComingSoon>Email when someone shares with you, adds a note or uploads a mix to your projects.</ComingSoon>
      </Section>
    </>
  );

  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-12">
      <nav aria-label="Preference sections" className="t-body lg:col-span-2">
        <ul className="space-y-1 lg:sticky lg:top-4">
          {[
            ['general', 'New projects'],
            ['board', 'Board'],
            ['template', 'Workflow template'],
            ['structure', 'Track structure'],
          ].map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-muted hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 lg:col-span-10">{main}</div>
    </div>
  );
}
