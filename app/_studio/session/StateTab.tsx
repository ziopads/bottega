'use client';

import { useMemo, useRef, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { DetailGrid, Section } from '@/app/_ui/layout';
import { beatsToTime, playable, type SetChange } from '@/lib/als/analyse';
import { parseSet } from '@/lib/als/parse';
import { filesFromDrop, filesFromInput, gunzipText, listing, savedSets, sha256, type PickedFile } from '@/lib/als/readFolder';
import type { SaveEntry, SessionState } from '@/lib/als/store';
import { PARSER_VERSION, type AlsSet, type AlsTrack, type Zone } from '@/lib/als/types';
import { formatBytes, type StudioVariant } from '@/lib/studioTypes';

// The State tab (REQUIREMENTS S-15, S-16, A-6 to A-8): what the saved Live
// sets show about one variant of the session (the main mix, or a radio edit
// chosen above the tabs). The variant's saves are listed on the left, newest
// first; choosing one shows the set as it was at that save, and what changed
// since the save before. Dropping the session's Ableton project folder reads
// every saved set in it here in the browser; the database sorts each save
// into a variant by its file name (db/015), and a save can be moved by hand.

const ZONE_COLOR: Record<string, string> = {
  TACTUS: '#b5543c',
  BASS: '#3d5a80',
  BACKGROUND: '#6b8f71',
  LEADS: '#c49a1f',
  TEXTURE: '#8a6fa8',
  VOX: '#c46a8a',
  none: '#9a948a',
};
const color = (z: Zone | null) => ZONE_COLOR[z ?? 'none'];

type Line = { name: string; state: 'reading' | 'stored' | 'replaced' | 'kept' | 'error'; detail?: string };

function whenDay(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function bars(beats: number): string {
  return `${Math.round(beats / 4)} bars`;
}

const bare = (fileName: string) => fileName.replace(/\.als$/i, '');
const variantLabel = (v: string) => v || 'Main';

/** What changed, as short phrases. */
function changeParts(c: SetChange): string[] {
  const parts: string[] = [];
  if (c.tracksAdded.length) parts.push(`+${c.tracksAdded.length} ${c.tracksAdded.length === 1 ? 'track' : 'tracks'} (${c.tracksAdded.join(', ')})`);
  if (c.tracksRemoved.length) parts.push(`−${c.tracksRemoved.length} (${c.tracksRemoved.join(', ')})`);
  for (const r of c.tracksRenamed) parts.push(`${r.from} → ${r.to}`);
  if (c.pluginsAdded.length) parts.push(`added ${c.pluginsAdded.join(', ')}`);
  if (c.pluginsRemoved.length) parts.push(`removed ${c.pluginsRemoved.join(', ')}`);
  if (c.clips) parts.push(`${c.clips > 0 ? '+' : ''}${c.clips} clips`);
  if (Math.abs(c.lengthBeats) >= 4) parts.push(`length ${c.lengthBeats > 0 ? '+' : '−'}${Math.round(Math.abs(c.lengthBeats) / 4)} bars`);
  if (c.tempo) parts.push(`tempo ${c.tempo.from ?? '?'} → ${c.tempo.to ?? '?'}`);
  for (const z of c.zones) parts.push(`${z.zone ?? 'no zone'} ${Math.round(z.from / 4)} → ${Math.round(z.to / 4)} bars`);
  if (c.samplesExternal) parts.push(`${c.samplesExternal > 0 ? '+' : ''}${c.samplesExternal} samples outside the folder`);
  return parts;
}

function summary(s: SaveEntry): string {
  if (s.first) return 'The first save read.';
  if (!s.change) return 'Nothing the parser tracks changed.';
  return changeParts(s.change).join(' · ');
}

export default function StateTab({
  projectId,
  state,
  setState,
  variant,
  variants,
  canEdit,
  onSavesMoved,
}: {
  projectId: number;
  state: SessionState;
  setState: (s: SessionState) => void;
  /** The variant chosen above the tabs: '' is the main mix. */
  variant: string;
  variants: StudioVariant[];
  canEdit: boolean;
  /** Saves were read or moved: the variants' counts change. */
  onSavesMoved: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function load(saveId?: number) {
    setLoading(true);
    const q = new URLSearchParams({ state: '1' });
    if (variant) q.set('variant', variant);
    if (saveId) q.set('save', String(saveId));
    try {
      const r = await fetch(`/api/projects/${projectId}/als?${q}`).then((x) => x.json());
      if (r.state) setState(r.state);
      else setError(r.error || 'Could not read the saves.');
    } catch {
      setError('Could not read the saves.');
    } finally {
      setLoading(false);
    }
  }


  async function importFolder(folderName: string, files: PickedFile[]) {
    setError('');
    const sets = savedSets(files).sort((a, b) => a.file.lastModified - b.file.lastModified);
    if (!sets.length) {
      setError('No saved sets (.als files) at the top of that folder. Drop the session’s Ableton project folder itself.');
      return;
    }
    setBusy(true);
    setLines(sets.map((s) => ({ name: s.path, state: 'reading' })));
    const set = (i: number, l: Partial<Line>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...l } : x)));
    try {
      const known = await fetch(`/api/projects/${projectId}/als`).then((r) => r.json());
      const read = new Map<string, number>((known.snapshots ?? []).map((s: { sha256: string; parserVersion: number }) => [s.sha256, s.parserVersion]));
      for (let i = 0; i < sets.length; i++) {
        const { path, file } = sets[i];
        try {
          const buf = await file.arrayBuffer();
          const sha = await sha256(buf);
          if ((read.get(sha) ?? 0) >= PARSER_VERSION) {
            set(i, { state: 'kept' });
            continue;
          }
          const parsed: AlsSet = parseSet(await gunzipText(buf));
          const res = await fetch(`/api/projects/${projectId}/als`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: path, savedAt: new Date(file.lastModified).toISOString(), sha256: sha, bytes: file.size, set: parsed }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) set(i, { state: 'error', detail: body.error || `Could not store it (${res.status}).` });
          else set(i, { state: body.result as Line['state'] });
        } catch (err) {
          set(i, { state: 'error', detail: err instanceof Error ? err.message : 'Could not read it.' });
        }
      }
      const put = await fetch(`/api/projects/${projectId}/folder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName, files: listing(files) }),
      });
      if (!put.ok) setError('The sets were read, but the folder listing could not be stored.');
      await load();
      onSavesMoved();
    } catch {
      setError('Reading the folder failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function move(saveId: number, to: string | null) {
    setError('');
    const r = await api(`/api/projects/${projectId}/als/${saveId}`, { method: 'PATCH', body: JSON.stringify({ variant: to }) });
    if (!r.ok) {
      setError(r.body.error || 'Could not move the save.');
      return;
    }
    await load(saveId);
    onSavesMoved();
  }

  // The page is fetching the variant chosen above the tabs.
  const switching = state.variant !== variant;
  const sel = state.selected;
  const latest = sel?.set ?? null;
  const m = state.maintenance;
  const stored = lines.filter((l) => l.state === 'stored' || l.state === 'replaced').length;
  const kept = lines.filter((l) => l.state === 'kept').length;
  const rule = variants.find((v) => v.name === variant)?.match ?? null;

  // ── Left column ─────────────────────────────────────────────────────────────
  const aside = (
    <>
      <Section label={`Saves · ${variantLabel(variant)} · ${state.saves.length}`}>
        {state.saves.length === 0 ? (
          <p className="t-body text-muted">
            {state.total === 0
              ? 'No sets read yet. Drop the project folder below.'
              : variant
                ? `No saves in ${variant} yet. A save whose file name contains “${rule}” joins it; any save can also be moved here from another variant.`
                : 'Every save read belongs to a variant.'}
          </p>
        ) : (
          <ul className={`t-body max-h-96 space-y-px overflow-y-auto ${loading || switching ? 'opacity-60' : ''}`}>
            {state.saves.map((s) => {
              const on = s.id === sel?.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => !on && void load(s.id)}
                    aria-current={on ? 'true' : undefined}
                    className={`block w-full border-l-2 py-1 pl-2 pr-1 text-left ${on ? 'border-rust bg-card' : 'border-transparent hover:bg-card'}`}
                  >
                    <span className="flex items-baseline gap-2">
                      <span className={`min-w-0 flex-1 truncate ${on ? 'font-medium' : ''}`} title={s.fileName}>
                        {bare(s.fileName)}
                      </span>
                      <span className="t-num shrink-0 text-[11px] text-muted">{new Date(s.savedAt).toLocaleDateString()}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted" title={summary(s)}>
                      {summary(s)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {sel && latest && (
        <Section label="This save">
          <dl className="t-body space-y-1">
            <div className="break-words font-medium">{bare(sel.fileName)}</div>
            <div className="text-[11px] text-muted">
              Saved {whenDay(sel.savedAt)} · {latest.live.replace('Ableton ', '')}
            </div>
            <div className="t-num pt-1">
              {latest.tempo ? `${latest.tempo} BPM · ` : ''}
              {bars(latest.lengthBeats)}
              {latest.tempo ? ` · ${beatsToTime(latest.lengthBeats, latest.tempo)}` : ''}
            </div>
            <div className="text-muted">
              {countKinds(latest.tracks)} · {m?.plugins.reduce((n, p) => n + p.instances, 0) ?? 0} plugin instances
            </div>
          </dl>
          {canEdit && (variants.length > 0 || sel.byHand) && (
            <div className="t-body mt-3 flex flex-wrap items-center gap-2 text-muted">
              <label className="flex items-center gap-1.5">
                Variant
                <select
                  value={variant}
                  onChange={(e) => void move(sel.id, e.target.value)}
                  className="rounded border border-line bg-card px-1.5 py-0.5 text-ink outline-none focus:border-rust"
                >
                  <option value="">Main</option>
                  {variants.map((v) => (
                    <option key={v.id} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              {sel.byHand ? (
                <button type="button" onClick={() => void move(sel.id, null)} className="underline hover:text-ink">
                  follow the name rules
                </button>
              ) : (
                <span className="text-[11px]">by its file name</span>
              )}
            </div>
          )}
        </Section>
      )}

      <Section label="Project folder">
        {state.folder && (
          <p className="t-body mb-2 text-muted">
            <span className="text-ink">{state.folder.name || 'Folder'}</span> · read {whenDay(state.folder.scannedAt)} ·{' '}
            {state.folder.fileCount} files, {formatBytes(state.folder.totalBytes)}
          </p>
        )}
        {state.stale > 0 && (
          <p className="t-body mb-2 text-rust">
            {state.stale} {state.stale === 1 ? 'save was' : 'saves were'} read by an older parser. Drop the folder again to read them anew.
          </p>
        )}
        {canEdit ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragging(false);
              if (busy) return;
              const { folderName, files } = await filesFromDrop(e.dataTransfer.items);
              void importFolder(folderName, files);
            }}
            className={`t-body rounded border border-dashed px-3 py-3 text-center ${dragging ? 'border-ink' : 'border-line text-muted'}`}
          >
            {busy ? (
              'Reading…'
            ) : (
              <>
                Drop the session&rsquo;s Ableton project folder here, or{' '}
                <button onClick={() => input.current?.click()} className="underline hover:text-ink">
                  choose it
                </button>
                .
              </>
            )}
            <input
              ref={input}
              type="file"
              className="hidden"
              // Lets the picker choose a folder; not yet in React's types.
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => {
                if (e.target.files?.length) {
                  const { folderName, files } = filesFromInput(e.target.files);
                  void importFolder(folderName, files);
                }
                e.target.value = '';
              }}
            />
          </div>
        ) : (
          <p className="t-body text-muted">Someone with edit access reads the folder.</p>
        )}
        <p className="mt-2 text-[11px] text-muted">
          Every saved set in the folder is read here in your browser and sorted into a variant by its file name. The rest of the folder is listed by
          name and size; no audio is uploaded. Dropping it again adds only new saves.
        </p>
        {error && <p className="t-body mt-2 text-rust">{error}</p>}
        {lines.length > 0 && (
          <div className="t-body mt-3">
            {!busy && (
              <p className="mb-1">
                {stored} read{kept ? `, ${kept} already read` : ''}
                {lines.some((l) => l.state === 'error') ? `, ${lines.filter((l) => l.state === 'error').length} failed` : ''}.
              </p>
            )}
            <ul className="max-h-48 space-y-0.5 overflow-y-auto text-[11px]">
              {lines.map((l) => (
                <li key={l.name} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate" title={l.name}>
                    {bare(l.name)}
                  </span>
                  <span className={l.state === 'error' ? 'text-rust' : 'text-muted'} title={l.detail}>
                    {l.state === 'reading' ? '…' : l.state === 'kept' ? 'already read' : l.state === 'error' ? 'failed' : 'read'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </>
  );

  if (!sel || !latest || !m) {
    return (
      <DetailGrid
        side="left"
        aside={aside}
        main={
          <Section label="What the set shows">
            <div className="t-body max-w-prose space-y-2 text-muted">
              <p>
                {state.total === 0
                  ? 'Drop the session’s Ableton project folder on the left. From its saved sets this tab shows:'
                  : `Once ${variantLabel(variant)} has a save, this tab shows:`}
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>how much of the arrangement each zone covers, and a map of where everything plays;</li>
                <li>plugins and devices with their instances, samples outside the project folder, missing and unused files;</li>
                <li>what changed from one saved version to the next.</li>
              </ul>
            </div>
          </Section>
        }
      />
    );
  }

  const main = (
    <div className={loading || switching ? 'opacity-60' : ''}>
      <ChangesSection save={sel} />
      <Zones state={state} set={latest} />
      <ArrangementMap set={latest} />
      <MaintenanceSection m={m} folderRead={!!state.folder} />
    </div>
  );

  return <DetailGrid side="left" aside={aside} main={main} />;
}

function countKinds(tracks: AlsTrack[]): string {
  const n = (k: AlsTrack['kind']) => tracks.filter((t) => t.kind === k).length;
  const parts = [
    n('midi') && `${n('midi')} MIDI`,
    n('audio') && `${n('audio')} audio`,
    n('group') && `${n('group')} ${n('group') === 1 ? 'group' : 'groups'}`,
    n('return') && `${n('return')} ${n('return') === 1 ? 'return' : 'returns'}`,
  ].filter(Boolean);
  return parts.join(', ');
}

// ── Zones ─────────────────────────────────────────────────────────────────────

function Zones({ state, set }: { state: SessionState; set: AlsSet }) {
  const anyZone = state.coverage.some((z) => z.zone !== null && z.tracks > 0);
  return (
    <Section label="Zones · what the set shows">
      <ul className="t-body space-y-1.5">
        {state.coverage.map((z) => (
          <li key={z.zone ?? 'none'} className="flex items-center gap-3">
            <span className="w-28 shrink-0">{z.zone ?? 'No zone'}</span>
            <span className="relative h-2.5 flex-1 overflow-hidden rounded-sm bg-line" title={`${Math.round(z.share * 100)}% of the arrangement`}>
              <span className="absolute inset-y-0 left-0" style={{ width: `${Math.round(z.share * 100)}%`, background: color(z.zone) }} />
            </span>
            <span className="t-num w-10 shrink-0 text-right">{z.tracks ? `${Math.round(z.share * 100)}%` : '—'}</span>
            <span className="t-num w-40 shrink-0 text-[11px] text-muted">
              {z.tracks ? `${z.tracks} ${z.tracks === 1 ? 'track' : 'tracks'} · ${z.clips} clips · ${z.devices} devices` : 'no tracks'}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">
        Share of the arrangement ({bars(set.lengthBeats)}) where at least one switched-on track of the zone plays. Presence, not finish: your own
        read of each zone comes next.
      </p>
      {!anyZone && (
        <p className="t-body mt-2 text-muted">
          No track name starts with a zone prefix yet (TAC, BAS, BKG, LDS, TEX, VOX), so every track counts as having no zone. Renaming tracks in
          Live (&ldquo;TAC Kick&rdquo;), or putting them in a group named for its zone, sorts them here on the next save.
        </p>
      )}
    </Section>
  );
}

// ── Arrangement map ────────────────────────────────────────────────────────────

function ArrangementMap({ set }: { set: AlsSet }) {
  const tracks = useMemo(() => {
    const order = ['TACTUS', 'BASS', 'BACKGROUND', 'LEADS', 'TEXTURE', 'VOX'];
    return playable(set)
      .filter((t) => t.clips > 0)
      .sort((a, b) => (a.zone ? order.indexOf(a.zone) : 99) - (b.zone ? order.indexOf(b.zone) : 99));
  }, [set]);
  const len = set.lengthBeats || 1;
  const pct = (b: number) => `${Math.min(100, Math.max(0, (b / len) * 100))}%`;

  // Ticks at a round number of bars, about eight across.
  const step = [4, 8, 16, 32, 64, 128, 256, 512].find((b) => (len / 4 / b) <= 9) ?? 1024;
  const ticks: number[] = [];
  for (let bar = 0; bar * 4 <= len; bar += step) ticks.push(bar * 4);

  if (!tracks.length) {
    return (
      <Section label="Arrangement">
        <p className="t-body text-muted">No clips in the Arrangement yet.</p>
      </Section>
    );
  }

  return (
    <Section label="Arrangement">
      <div className="t-body">
        <div className="relative ml-32 h-4 text-[10px] text-muted">
          {ticks.map((b) => (
            <span key={b} className="t-num absolute -translate-x-1/2" style={{ left: pct(b) }}>
              {b / 4 + 1}
            </span>
          ))}
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-32 right-0">
            {set.locators.map((l, i) => (
              <span key={i} className="absolute inset-y-0 border-l border-dashed border-ink/40" style={{ left: pct(l.beat) }} title={l.name} />
            ))}
          </div>
          <ul className="space-y-px">
            {tracks.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className={`shrink-0 truncate text-[11px] ${t.on ? '' : 'text-muted line-through'}`} style={{ width: '7.5rem' }} title={t.name}>
                  {t.name}
                </span>
                <span className="relative h-3 flex-1 bg-line/50">
                  {t.spans.map(([s, e], i) => (
                    <span
                      key={i}
                      className="absolute inset-y-0"
                      style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})`, background: color(t.zone), opacity: t.on ? 1 : 0.35 }}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {set.locators.length > 0 && (
          <p className="mt-2 ml-32 text-[11px] text-muted">
            Locators: {set.locators.map((l) => `${l.name || 'unnamed'} (bar ${Math.round(l.beat / 4) + 1})`).join(' · ')}
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted">
          Bars across the top. Tracks switched off are faded. {set.tempo ? `The last clip ends at ${beatsToTime(len, set.tempo)}.` : ''}
        </p>
      </div>
    </Section>
  );
}

// ── Maintenance ────────────────────────────────────────────────────────────────

function MaintenanceSection({ m, folderRead }: { m: NonNullable<SessionState['maintenance']>; folderRead: boolean }) {
  const shared = m.plugins.filter((p) => p.instances >= 3);
  return (
    <Section label="Maintenance">
      <div className="t-body space-y-5">
        <div>
          <h3 className="t-label mb-1">Plugins · {m.plugins.reduce((n, p) => n + p.instances, 0)} instances</h3>
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {m.plugins.map((p) => (
                <tr key={`${p.name}|${p.format}`}>
                  <td className="py-1 pr-2">
                    {p.name} <span className="text-[11px] text-muted">{p.format?.toUpperCase()}</span>
                  </td>
                  <td className="t-num w-24 py-1 pr-2 text-right">
                    ×{p.instances}
                    {p.off ? <span className="text-[11px] text-muted"> ({p.off} off)</span> : null}
                  </td>
                  <td className="max-w-0 truncate py-1 text-[11px] text-muted" title={p.tracks.join(', ')}>
                    {p.tracks.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shared.length > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              {shared.map((p) => `${p.name} ×${p.instances}`).join(', ')}: several instances of one effect can often share a return track, which
              saves processing and glues the parts together.
            </p>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-muted">Live devices · {m.devices.reduce((n, d) => n + d.instances, 0)}</summary>
            <ul className="mt-1 columns-2 text-[11px]">
              {m.devices.map((d) => (
                <li key={d.name}>
                  {d.name} ×{d.instances}
                  {d.off ? <span className="text-muted"> ({d.off} off)</span> : null}
                </li>
              ))}
            </ul>
          </details>
        </div>

        <Finding
          title="Samples outside the project folder"
          ok="None: every sample is in the project folder or in Live’s own libraries."
          items={m.external.map((s) => s.path || s.relativePath)}
          note="Collect All and Save (File menu) copies these into the project folder, so the session opens on another computer or after the files move."
        />
        {folderRead ? (
          <>
            <Finding
              title="Missing from the folder"
              ok="None: every project file the set uses is in the folder."
              items={(m.missing ?? []).map((s) => s.relativePath)}
              note="The set expects these in the project folder, but the folder as last read does not have them. Live will ask for them when the set opens."
            />
            <Finding
              title={`Unused files${m.unusedBytes ? ` · ${formatBytes(m.unusedBytes)}` : ''}`}
              ok="None: every audio file under Samples is used by at least one saved set."
              items={(m.unused ?? []).map((f) => `${f.path} · ${formatBytes(f.bytes)}`)}
              note="No saved set in the folder uses these. Live’s Manage Project › Clean Up removes unused files; check first that nothing outside these sets needs them."
            />
          </>
        ) : (
          <p className="text-muted">Missing and unused files appear once the project folder has been read.</p>
        )}
        <Finding title="Tracks switched off" ok="None." items={m.off} />
        <Finding title="Tracks with no clips" ok="None." items={m.empty} />
        {m.frozen.length > 0 && <Finding title="Frozen tracks" ok="None." items={m.frozen} />}
        <p className="text-muted">
          {m.devicesOff
            ? `${m.devicesOff} ${m.devicesOff === 1 ? 'device is' : 'devices are'} switched off. Removing the ones you no longer want keeps the set lighter.`
            : 'No devices switched off.'}
        </p>
      </div>
    </Section>
  );
}

function Finding({ title, ok, items, note }: { title: string; ok: string; items: string[]; note?: string }) {
  return (
    <div>
      <h3 className="t-label mb-1">
        {title}
        {items.length ? ` · ${items.length}` : ''}
      </h3>
      {items.length === 0 ? (
        <p className="text-muted">{ok}</p>
      ) : (
        <>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
            {items.map((x, i) => (
              <li key={i} className="truncate" title={x}>
                {x}
              </li>
            ))}
          </ul>
          {note && <p className="mt-1 text-[11px] text-muted">{note}</p>}
        </>
      )}
    </div>
  );
}

// ── Changes ───────────────────────────────────────────────────────────────────

function ChangesSection({ save }: { save: SaveEntry }) {
  const parts = save.change ? changeParts(save.change) : [];
  const label = save.comparedWith ? `Since ${bare(save.comparedWith)} (main)` : 'Since the save before';
  return (
    <Section label={label}>
      {save.first ? (
        <p className="t-body text-muted">The first save read: nothing earlier to compare with.</p>
      ) : parts.length === 0 ? (
        <p className="t-body text-muted">Nothing the parser tracks changed.</p>
      ) : (
        <ul className="t-body list-disc space-y-0.5 pl-5">
          {parts.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}
