'use client';

import { useState } from 'react';

import { DetailGrid, Section, TabBar } from '@/app/_ui/layout';
import type {
  StudioArtist,
  StudioName,
  StudioNote,
  StudioProject,
  StudioReference,
  StudioRelease,
  StudioShare,
  StudioTrack,
} from '@/lib/studioTypes';
import type { SessionTab } from '@/lib/sessionTabs';
import { levelAtLeast } from '@/lib/studioTypes';

import { api, InlineEdit, Stars } from './controls';
import HistoryTab from './session/HistoryTab';
import MixesTab from './session/MixesTab';
import NotesTab from './session/NotesTab';
import OverviewTab from './session/OverviewTab';

// One session (REQUIREMENTS S-1 to S-13), as tabs over one shared state, so
// switching tabs keeps what is playing and what was typed:
//
//   Overview   the current mix, where it stands, the latest notes; details
//   Mixes      every version with its waveform, references; notes by moment
//   Workflow   stages and cards (Phase 2)
//   Notes      every note, filterable
//   History    uploads and name changes
//
// The tab is in the address (?tab=), so a link can open one. What the
// controls offer follows the viewer's level (AC-5); the routes and the
// database enforce the same rules.


export default function ProjectDetail({
  initialTab,
  initialProject,
  initialTracks,
  names,
  artists,
  initialGenres,
  initialNotes,
  initialReferences,
  releases,
  viewerId,
  initialShares,
  uploadsEnabled,
}: {
  initialTab: SessionTab;
  initialProject: StudioProject;
  initialTracks: StudioTrack[];
  names: StudioName[];
  artists: StudioArtist[];
  initialGenres: string[];
  initialNotes: StudioNote[];
  initialReferences: StudioReference[];
  releases: StudioRelease[];
  viewerId: string;
  initialShares: StudioShare[];
  uploadsEnabled: boolean;
}) {
  const [tab, setTab] = useState<SessionTab>(initialTab);
  const [project, setProject] = useState(initialProject);
  const [tracks, setTracks] = useState(initialTracks);
  const [nameHistory, setNameHistory] = useState(names);
  const [genres, setGenres] = useState(initialGenres);
  const [notes, setNotes] = useState(initialNotes);
  const [references, setReferences] = useState(initialReferences);
  const [error, setError] = useState('');

  const isOwner = project.level === 'owner';
  const canEdit = levelAtLeast(project.level, 'edit');
  const canContribute = levelAtLeast(project.level, 'contribute');

  // The current mix: chosen by hand, else the newest.
  const current = tracks.find((t) => t.id === project.currentMixId) ?? tracks[0] ?? null;
  const chosenByHand = !!current && project.currentMixId === current.id && current !== tracks[0];
  const pastNames = nameHistory.filter((n) => n.name !== project.workingName);

  function selectTab(key: string) {
    const next = key as SessionTab;
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  }

  async function patch(fields: Record<string, unknown>): Promise<boolean> {
    setError('');
    const r = await api<{ project: StudioProject }>(`/api/projects/${project.id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    if (!r.ok) {
      setError(r.body.error || 'Could not save the change.');
      return false;
    }
    if ('workingName' in fields && r.data.project.workingName && r.data.project.workingName !== project.workingName) {
      setNameHistory((h) => [{ name: r.data.project.workingName, setByName: 'you', setAt: new Date().toISOString() }, ...h]);
    }
    setProject(r.data.project);
    return true;
  }

  async function addGenre(name: string): Promise<string | null> {
    setError('');
    const r = await api<{ name: string; genres: string[] }>('/api/genres', { method: 'POST', body: JSON.stringify({ name }) });
    if (!r.ok) {
      setError(r.body.error || 'Could not add the genre.');
      return null;
    }
    setGenres(r.data.genres);
    return r.data.name;
  }

  // A file with no length on record (older uploads) reports one once a player
  // has read its metadata, so lengths fill in as sessions are visited.
  async function fillLength(id: number, d: number) {
    const r = await api<{ filled: boolean }>(`/api/audio/${id}/duration`, { method: 'POST', body: JSON.stringify({ durationS: d }) });
    if (!r.ok) return;
    setTracks((l) => l.map((x) => (x.id === id && x.durationS === null ? { ...x, durationS: d } : x)));
    setReferences((l) => l.map((x) => (x.id === id && x.durationS === null ? { ...x, durationS: d } : x)));
  }

  async function removeTrack(t: StudioTrack) {
    setError('');
    const r = await api(`/api/tracks/${t.id}`, { method: 'DELETE' });
    if (!r.ok) {
      setError(r.body.error || 'Could not delete the version.');
      return;
    }
    setTracks((l) => l.filter((x) => x.id !== t.id));
  }

  return (
    <div className="mt-3">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="t-body flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
        <span className="t-num text-ink" title="Canonical ID: matches the Ableton folder; permanent">
          {project.canonicalId}
        </span>
        {isOwner && artists.length > 0 ? (
          <select
            value={project.artist.id}
            onChange={(e) => patch({ artistId: Number(e.target.value) })}
            title="Artist"
            aria-label="Artist"
            className="rounded border border-line bg-card px-1 py-0 text-[12px] outline-none focus:border-rust"
          >
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        ) : (
          <span title={project.artist.name}>{project.artist.code}</span>
        )}
        {canEdit ? (
          <Stars rating={project.rating} onRate={(n) => patch({ rating: n })} />
        ) : (
          <span title="Rating">{project.rating ? '★'.repeat(project.rating) : 'unrated'}</span>
        )}
        {!isOwner && (
          <span>
            · shared by {project.ownerName}; you can{' '}
            {project.level === 'edit' ? 'edit' : project.level === 'contribute' ? 'contribute' : 'listen'}
          </span>
        )}
      </div>
      <div className="mt-1">
        {canEdit ? (
          <InlineEdit value={project.workingName} placeholder="untitled" label="Working name" textClass="t-title" onSave={(v) => patch({ workingName: v })} />
        ) : (
          <h1 className="t-title">{project.workingName || 'untitled'}</h1>
        )}
      </div>

      <div className="mb-6 mt-3 border-b border-line">
        <TabBar
          current={tab}
          onSelect={selectTab}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'mixes', label: 'Mixes', count: tracks.length },
            { key: 'workflow', label: 'Workflow' },
            { key: 'notes', label: 'Notes', count: notes.length },
            { key: 'history', label: 'History' },
          ]}
        />
      </div>

      {error && <p className="t-body mb-4 text-rust">{error}</p>}

      {tab === 'overview' && (
        <OverviewTab
          project={project}
          current={current}
          versions={tracks.length}
          notes={notes}
          pastNames={pastNames}
          releases={releases}
          genres={genres}
          canEdit={canEdit}
          isOwner={isOwner}
          initialShares={initialShares}
          onPatch={patch}
          onAddGenre={addGenre}
          onLength={fillLength}
          onTab={selectTab}
        />
      )}
      {tab === 'mixes' && (
        <MixesTab
          projectId={project.id}
          tracks={tracks}
          setTracks={setTracks}
          references={references}
          setReferences={setReferences}
          notes={notes}
          setNotes={setNotes}
          currentId={current?.id ?? null}
          chosenByHand={chosenByHand}
          viewerId={viewerId}
          canEdit={canEdit}
          canContribute={canContribute}
          canDelete={isOwner}
          uploadsEnabled={uploadsEnabled}
          onMakeCurrent={(t) => patch({ currentMixId: t ? t.id : null })}
          onDelete={removeTrack}
          onLength={fillLength}
        />
      )}
      {tab === 'workflow' && (
        <DetailGrid
          main={
            <Section label="Workflow">
              <div className="t-body max-w-prose space-y-2 text-muted">
                <p>The workflow arrives in Phase 2 (REQUIREMENTS W-1 to W-9):</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>stages, from sketch to master, each with exit criteria to tick off;</li>
                  <li>cards for open work, by element (drums, bass, vocals…);</li>
                  <li>decisions marked settled, so they are not reopened without reason.</li>
                </ul>
                <p>It is being designed with the mentor scenarios, since it is much of what Claude will read about a session.</p>
              </div>
            </Section>
          }
        />
      )}
      {tab === 'notes' && (
        <NotesTab
          projectId={project.id}
          tracks={tracks}
          notes={notes}
          setNotes={setNotes}
          viewerId={viewerId}
          canContribute={canContribute}
          canDelete={isOwner}
        />
      )}
      {tab === 'history' && <HistoryTab tracks={tracks} references={references} names={nameHistory} />}
    </div>
  );
}
