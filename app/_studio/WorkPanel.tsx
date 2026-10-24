'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, BUTTON_PRIMARY, FIELD } from '@/app/_ui/styles';
import type { SnapshotMeta } from '@/lib/als/store';
import type { WorkSession } from '@/lib/sessionTypes';
import { DONE_WHEN_UNWRITTEN, parseSessionLine } from '@/lib/workflowInput';
import type { Workflow } from '@/lib/workflowTypes';

// The working panel (REQUIREMENTS W-41, plan of 25 October): a narrow page to
// keep beside Live while working. One box logs a line as a to-do (by default),
// a note ("note:") or a learning ("learn:"); "next:" makes the to-do the next
// one. Below: the next to-do, the stage's open to-dos, its criteria with what
// the newest saved set suggests, its learnings, and the saves as the watcher
// sends them. It reads the project again every 30 seconds.

type Feed = { sessions: WorkSession[]; saves: SnapshotMeta[] };
type Logged = { kind: string; text: string; at: string };

const POLL_MS = 30_000;

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function WorkPanel({
  projectId,
  title,
  initialWorkflow,
  initialFeed,
  canContribute,
  canEdit,
}: {
  projectId: number;
  title: string;
  initialWorkflow: Workflow;
  initialFeed: Feed;
  canContribute: boolean;
  canEdit: boolean;
}) {
  const [w, setW] = useState(initialWorkflow);
  const [feed, setFeed] = useState(initialFeed);
  const [line, setLine] = useState('');
  const [logged, setLogged] = useState<Logged[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = `/api/projects/${projectId}/workflow`;

  // Kept current while Live saves: the likely-done marks follow each set the watcher sends.
  useEffect(() => {
    const tick = async () => {
      const [a, b] = await Promise.all([
        api<{ workflow: Workflow }>(url, { method: 'GET' }),
        api<Feed>(`/api/projects/${projectId}/sessions`, { method: 'GET' }),
      ]);
      if (a.ok) setW(a.data.workflow);
      if (b.ok) setFeed(b.data);
    };
    const t = setInterval(() => void tick(), POLL_MS);
    return () => clearInterval(t);
  }, [projectId, url]);

  async function call(target: string, method: string, body?: unknown): Promise<Workflow | null> {
    setError('');
    setBusy(true);
    const r = await api<{ workflow?: Workflow }>(target, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body?.error || 'That did not go through.');
      return null;
    }
    if (r.data.workflow) setW(r.data.workflow);
    return r.data.workflow ?? w;
  }

  const stage = w.stages.find((s) => s.key === w.stage) ?? null;
  const pos = stage?.position ?? 0;
  const next = w.cards.find((c) => c.isNext) ?? null;
  const open = w.cards.filter((c) => c.stage === w.stage && !c.settled && (c.status === 'accepted' || c.status === 'in progress') && !c.isNext);
  const criteria = w.criteria.filter((c) => c.stage === w.stage && c.reviewed && !c.rejected);
  const learnings = w.learnings.filter((l) => l.stage === w.stage && l.reviewed);
  const note = (kind: string, text: string) => setLogged((l) => [{ kind, text, at: new Date().toISOString() }, ...l].slice(0, 6));

  async function log(e: React.FormEvent) {
    e.preventDefault();
    const raw = line.trim();
    if (!raw || !w.stage) return;
    const m = raw.match(/^(note|learn|learning|next|todo|to-do):\s*/i);
    const kind = m ? m[1].toLowerCase() : 'todo';
    const rest = m ? raw.slice(m[0].length) : raw;
    if (!rest.trim()) return;
    if (kind === 'note') {
      setBusy(true);
      const r = await api(`/api/projects/${projectId}/notes`, { method: 'POST', body: JSON.stringify({ body: rest }) });
      setBusy(false);
      if (!r.ok) return setError(r.body?.error || 'Could not save the note.');
      note('Note', rest);
    } else if (kind === 'learn' || kind === 'learning') {
      if (!(await call(url, 'POST', { op: 'learning', action: 'add', stage: w.stage, body: rest }))) return;
      note(`Learning · ${stage?.label}`, rest);
    } else {
      const p = parseSessionLine(rest, w.elements, w.stages);
      if (!p) return;
      // A #stage later than the current one parks it there; an earlier one is ignored.
      const target = p.stage && (w.stages.find((s) => s.key === p.stage)?.position ?? 0) > pos ? p.stage : w.stage;
      const after = await call(`/api/projects/${projectId}/cards`, 'POST', {
        stage: target,
        elementId: p.elementId,
        what: p.what,
        doneWhen: p.doneWhen || DONE_WHEN_UNWRITTEN,
      });
      if (!after) return;
      const el = w.elements.find((x) => x.id === p.elementId)?.name;
      if (kind === 'next') {
        const made = after.cards.filter((c) => c.what === p.what).sort((a, b) => b.id - a.id)[0];
        if (made) await call(url, 'POST', { op: 'next-card', cardId: made.id });
      }
      note(`${kind === 'next' ? 'Next to-do' : 'To-do'}${target !== w.stage ? ` · parked for ${w.stages.find((s) => s.key === target)?.label}` : ''}${el ? ` · ${el}` : ''}`, p.what);
    }
    setLine('');
  }

  if (!w.stage) {
    return (
      <div className="t-body space-y-2">
        <p className="font-medium">{title}</p>
        <p className="text-muted">The workflow has not been started; start it on the project&rsquo;s Workflow tab.</p>
        <Link href={`/projects/${projectId}?tab=workflow`} className={BUTTON}>
          Open the project
        </Link>
      </div>
    );
  }

  return (
    <div className="t-body mx-auto max-w-xl space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="t-lead font-medium">{title}</p>
          <p className="t-small text-muted">
            Stage {pos} of {w.stages.length} · {stage?.label}
            {stage?.standard ? `: ${stage.standard}` : ''}
          </p>
        </div>
        <Link href={`/projects/${projectId}?tab=workflow`} target="_blank" className="t-small text-muted underline underline-offset-2 hover:text-ink">
          Open the project ↗
        </Link>
      </header>

      {canContribute && (
        <form onSubmit={log} className="space-y-1">
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="Snare too loud against the hats #tactus"
            aria-label="Log a line"
            autoFocus
            className={`${FIELD} w-full t-lead`}
          />
          <p className="t-small text-muted">
            Enter logs a to-do. Start with <span className="font-mono">note:</span>, <span className="font-mono">learn:</span> or{' '}
            <span className="font-mono">next:</span>; a <span className="font-mono">#tag</span> names the element or parks it for a later stage; after{' '}
            <span className="font-mono">--</span>, how you&rsquo;ll know it&rsquo;s done.
          </p>
          {logged.length > 0 && (
            <ul className="space-y-0.5 t-small">
              {logged.map((l, i) => (
                <li key={i} className="text-muted">
                  {clockTime(l.at)} · <span className="text-ink">{l.kind}</span>: {l.text}
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
      {error && <p className="text-rust">{error}</p>}

      <section aria-label="Next" className="rounded-md border border-ink p-3">
        <p className="t-label">Next</p>
        {next ? (
          <>
            <p className="mt-0.5 t-lead font-medium">{next.what}</p>
            {next.doneWhen && next.doneWhen !== DONE_WHEN_UNWRITTEN && <p className="t-small text-muted">Done when: {next.doneWhen}</p>}
            {canContribute && (
              <button type="button" onClick={() => call(`/api/cards/${next.id}`, 'PATCH', { status: 'done' })} disabled={busy} className={`mt-2 ${BUTTON_PRIMARY}`}>
                Done · next one up
              </button>
            )}
          </>
        ) : (
          <p className="text-muted">Nothing marked next. Log a line starting with next:, or press Next on a to-do below.</p>
        )}
      </section>

      <section aria-label="To-dos">
        <p className="t-label">
          To-dos · {stage?.label} · {open.length}
        </p>
        {open.length === 0 ? (
          <p className="text-muted">None open besides the next one.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line border-y border-line">
            {open.map((c) => (
              <li key={c.id} className="flex items-start gap-2 py-1.5">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={!canContribute || busy}
                  onChange={() => call(`/api/cards/${c.id}`, 'PATCH', { status: 'done' })}
                  aria-label={`Done: ${c.what}`}
                  className="mt-1 accent-ink"
                />
                <span className="min-w-0 flex-1">
                  {c.what}
                  {c.status === 'in progress' && <span className="ml-1 font-mono t-small text-muted">in progress</span>}
                </span>
                {canContribute && (
                  <button type="button" onClick={() => call(url, 'POST', { op: 'next-card', cardId: c.id })} disabled={busy} className={BUTTON}>
                    Next
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Criteria">
        <p className="t-label">
          Finished when · {criteria.filter((c) => c.metAt).length} of {criteria.length}
        </p>
        <ul className="mt-1 space-y-1">
          {criteria.map((c) => {
            const r = c.checkKey ? w.setReading?.results[c.checkKey] : undefined;
            return (
              <li key={c.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={!!c.metAt}
                  disabled={!canEdit || busy}
                  onChange={(e) => call(`/api/criteria/${c.id}`, 'PATCH', { met: e.target.checked })}
                  aria-label={c.body}
                  className="mt-1 accent-ink"
                />
                <span className="min-w-0 flex-1">
                  <span className={c.metAt ? 'text-muted line-through' : ''}>{c.body}</span>
                  {r && !c.metAt && r.verdict !== 'unknown' && (
                    <span className="mt-0.5 block font-mono t-small text-muted">
                      {r.verdict === 'likely' ? 'Likely done' : 'Likely not yet'} · {r.reading}
                    </span>
                  )}
                  {c.hint && !c.metAt && <span className="block whitespace-pre-line t-small text-muted">{c.hint}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      {learnings.length > 0 && (
        <section aria-label="Learnings">
          <p className="t-label">Learnings · {stage?.label}</p>
          <ul className="mt-1 space-y-1.5">
            {learnings.map((l) => (
              <li key={l.id} className="rounded border border-line bg-ink/[0.03] px-2.5 py-1.5">
                {l.body}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Saves">
        <p className="t-label">Saves</p>
        {feed.saves.length === 0 ? (
          <p className="text-muted">No sets read yet. With the watcher running, each save Live makes shows here within a minute.</p>
        ) : (
          <ul className="mt-1 space-y-0.5 t-small">
            {feed.saves.map((s) => (
              <li key={s.id} className="flex gap-2">
                <span className="t-num w-16 shrink-0 text-muted">{clockTime(s.savedAt)}</span>
                <span className="min-w-0 truncate">{s.fileName}</span>
              </li>
            ))}
          </ul>
        )}
        {feed.sessions[0]?.changes && feed.sessions[0].changes.length > 0 && (
          <div className="mt-2">
            <p className="t-small text-muted">This session so far</p>
            <ul className="list-disc pl-4 t-small text-muted">
              {feed.sessions[0].changes.slice(0, 8).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
