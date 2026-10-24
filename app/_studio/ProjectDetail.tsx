'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import BoardPlaceSelect from '@/app/_board/BoardPlaceSelect';
import type { BoardPlace } from '@/lib/boardTypes';

import { onNoteRequest, type NoteRequest } from '@/app/_ui/audio/deck';

import { TabBar } from '@/app/_ui/layout';
import type {
  StudioArtist,
  StudioName,
  StudioNote,
  StudioProject,
  StudioReference,
  StudioRelease,
  StudioShare,
  StudioTrack,
  StudioVariant,
} from '@/lib/studioTypes';
import type { SessionTab } from '@/lib/sessionTabs';
import { levelAtLeast } from '@/lib/studioTypes';
import type { Workflow } from '@/lib/workflowTypes';
import type { SessionState } from '@/lib/als/store';
import { keyLabel } from '@/lib/als/types';

import { api, InlineEdit, Stars } from './controls';
import HistoryTab from './session/HistoryTab';
import MixesTab from './session/MixesTab';
import NotesTab from './session/NotesTab';
import OverviewTab from './session/OverviewTab';
import StateTab from './session/StateTab';
import VariantBar from './session/VariantBar';
import WorkflowTab from './session/WorkflowTab';

// One session (REQUIREMENTS S-1 to S-13), as tabs over one shared state, so
// switching tabs keeps what is playing and what was typed:
//
//   Overview   the current mix, where it stands, the latest notes; details
//   Mixes      every version with its waveform, references; notes by moment
//   State      what the saved Live sets show: zones, arrangement, maintenance
//   Workflow   stages, exit criteria, cards by element, settled decisions
//   Notes      every note, filterable
//   History    uploads and name changes
//
// Variants (db/015): chips in the header choose the main mix or a named
// variant (a radio edit); the Mixes and State tabs show the chosen one's mixes
// and saves. The workflow, references and notes are common to the session.
//
// The tab and the variant are in the address (?tab=, ?variant=), so a link
// can open one. What the
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
  boardPlace,
  uploadsEnabled,
  initialWorkflow,
  initialSessionState,
  initialVariants,
  initialVariant,
  initialTrackId,
  initialAt,
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
  /** Where the project sits on the viewer's own board (W-21). */
  boardPlace: BoardPlace | null;
  uploadsEnabled: boolean;
  initialWorkflow: Workflow;
  initialSessionState: SessionState;
  initialVariants: StudioVariant[];
  /** '' is the main mix. */
  initialVariant: string;
  /** ?track=: the mix the Mixes tab opens on (the player bar links here). */
  initialTrackId: number | null;
  /** ?at=: the note box opens at this moment (the bar's "Note at 1:35"). */
  initialAt: number | null;
}) {
  const [tab, setTab] = useState<SessionTab>(initialTab);
  const [project, setProject] = useState(initialProject);
  const [tracks, setTracks] = useState(initialTracks);
  const [nameHistory, setNameHistory] = useState(names);
  const [genres, setGenres] = useState(initialGenres);
  const [notes, setNotes] = useState(initialNotes);
  const [references, setReferences] = useState(initialReferences);
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const [variants, setVariants] = useState(initialVariants);
  const [variant, setVariant] = useState(initialVariant);
  const [sessionState, setSessionState] = useState(initialSessionState);
  // The variant last chosen, so a slower answer for an earlier choice is dropped.
  const wanted = useRef(initialVariant);
  // The note box to open on a mix: from the address (?track=&at=) on arrival,
  // then from the player bar's "Note at" while the page is open. Each request
  // counts up, and the Mixes tab starts afresh for it.
  const [noteAt, setNoteAt] = useState<{ trackId: number | null; at: number | null; count: number }>({
    trackId: initialTrackId,
    at: initialAt,
    count: 0,
  });
  const takeNoteRequest = useEffectEvent((r: NoteRequest): boolean => {
    if (r.projectId !== project.id) return false;
    if (r.variant !== variant) selectVariant(r.variant);
    selectTab('mixes');
    setNoteAt((n) => ({ trackId: r.trackId, at: r.at, count: n.count + 1 }));
    return true;
  });
  useEffect(() => onNoteRequest((r) => takeNoteRequest(r)), []);
  const [error, setError] = useState('');

  const isOwner = project.level === 'owner';
  const canEdit = levelAtLeast(project.level, 'edit');
  const canContribute = levelAtLeast(project.level, 'contribute');

  // The current mix: chosen by hand, else the newest.
  const current = tracks.find((t) => t.id === project.currentMixId) ?? tracks[0] ?? null;
  const chosenByHand = !!current && project.currentMixId === current.id && current !== tracks[0];
  const pastNames = nameHistory.filter((n) => n.name !== project.workingName);

  const variantTracks = tracks.filter((t) => t.variant === variant);

  async function loadState(name: string) {
    const q = new URLSearchParams({ state: '1' });
    if (name) q.set('variant', name);
    const r = await api<{ state: SessionState }>(`/api/projects/${project.id}/als?${q}`, { method: 'GET' });
    if (wanted.current !== name) return;
    if (r.ok) setSessionState(r.data.state);
    else setError(r.body.error || 'Could not read the saves.');
  }

  function selectVariant(name: string) {
    setVariant(name);
    wanted.current = name;
    if (sessionState.variant !== name) void loadState(name);
    const url = new URL(window.location.href);
    if (name) url.searchParams.set('variant', name);
    else url.searchParams.delete('variant');
    window.history.replaceState(null, '', url);
  }

  /** A rename or removal changes mixes' labels and saves' places: the page is read again. */
  function reloadWith(name: string) {
    const url = new URL(window.location.href);
    if (name) url.searchParams.set('variant', name);
    else url.searchParams.delete('variant');
    window.location.assign(url.toString());
  }

  async function refreshVariants() {
    const r = await api<{ variants: StudioVariant[] }>(`/api/projects/${project.id}/variants`, { method: 'GET' });
    if (r.ok) setVariants(r.data.variants);
  }

  /** New saves set the BPM from the newest one (db/023): show it without a reload. */
  async function refreshBpm() {
    const r = await api<{ project: StudioProject }>(`/api/projects/${project.id}`, { method: 'GET' });
    if (r.ok) setProject((p) => ({ ...p, bpm: r.data.project.bpm }));
  }

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
      {/* ── Header: one line, the name first ─────────────────────────────── */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {canEdit ? (
          <InlineEdit value={project.workingName} placeholder="untitled" label="Working name" textClass="t-title" onSave={(v) => patch({ workingName: v })} />
        ) : (
          <h1 className="t-title">{project.workingName || 'untitled'}</h1>
        )}
        <span className="t-num t-body text-muted" title="Canonical ID: matches the Ableton folder; permanent">
          {project.canonicalId}
        </span>
        <BoardPlaceSelect projectId={project.id} initial={boardPlace} />
        {isOwner && artists.length > 0 ? (
          <select
            value={project.artist.id}
            onChange={(e) => patch({ artistId: Number(e.target.value) })}
            title="Artist"
            aria-label="Artist"
            className="t-body rounded border border-line bg-card px-1 py-0 text-muted outline-none focus:border-rust"
          >
            {artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="t-body text-muted" title={project.artist.name}>
            {project.artist.code}
          </span>
        )}
        <span className="t-body">
          {canEdit ? (
            <Stars rating={project.rating} onRate={(n) => patch({ rating: n })} />
          ) : (
            <span className="text-muted" title="Rating">
              {project.rating ? '★'.repeat(project.rating) : 'unrated'}
            </span>
          )}
        </span>
        {!isOwner && (
          <span className="t-body text-muted">
            shared by {project.ownerName}; you can{' '}
            {project.level === 'edit' ? 'edit' : project.level === 'contribute' ? 'contribute' : 'listen'}
          </span>
        )}
        <div className="ml-auto">
          <VariantBar
            projectId={project.id}
            variants={variants}
            current={variant}
            canEdit={canEdit}
            isOwner={isOwner}
            onSelect={selectVariant}
            onCreated={(list, name) => {
              setVariants(list);
              selectVariant(name);
            }}
            onRenamed={reloadWith}
            onRemoved={() => reloadWith('')}
          />
        </div>
      </div>

      <div className="mb-6 mt-3 border-b border-line">
        <TabBar
          current={tab}
          onSelect={selectTab}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'mixes', label: variant ? `Mixes · ${variant}` : 'Mixes', count: variantTracks.length },
            { key: 'state', label: variant ? `State · ${variant}` : 'State' },
            { key: 'workflow', label: workflow.stage ? `Workflow · ${workflow.stages.find((x) => x.key === workflow.stage)?.label ?? ''}` : 'Workflow' },
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
          workflow={workflow}
          setKey={sessionState.selected?.set.key === undefined ? undefined : keyLabel(sessionState.selected.set.key)}
        />
      )}
      {tab === 'mixes' && (
        <MixesTab
          key={`${variant}:${noteAt.count}`}
          projectId={project.id}
          session={{ code: `${project.artist.code} ${project.canonicalId}`, title: project.workingName }}
          initialTrackId={noteAt.trackId}
          initialAt={noteAt.at}
          tracks={variantTracks}
          variant={variant}
          setTracks={setTracks}
          references={references}
          setReferences={setReferences}
          notes={notes}
          setNotes={setNotes}
          cards={workflow.cards}
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
      {tab === 'state' && (
        <StateTab
          projectId={project.id}
          state={sessionState}
          setState={setSessionState}
          variant={variant}
          variants={variants}
          canEdit={canEdit}
          onSavesMoved={() => {
            void refreshVariants();
            void refreshBpm();
          }}
        />
      )}
      {tab === 'workflow' && (
        <WorkflowTab
          projectId={project.id}
          workflow={workflow}
          setWorkflow={setWorkflow}
          setNotes={setNotes}
          viewerId={viewerId}
          canContribute={canContribute}
          canEdit={canEdit}
          isOwner={isOwner}
        />
      )}
      {tab === 'notes' && (
        <NotesTab
          workflow={workflow}
          setWorkflow={setWorkflow}
          canEdit={canEdit}
          projectId={project.id}
          tracks={tracks}
          variants={variants}
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
