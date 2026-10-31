'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';

import { api } from '@/app/_studio/controls';
import { Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';
import type { EditorLearning, EditorStage, TemplateEditor as Editor } from '@/lib/templateTypes';

import { FIELD } from './parts';

// Preferences › Board and Workflow template (REQUIREMENTS W-13 to W-15, W-22;
// db/024). General to detail, left to right: the template's stages, then the
// chosen stage's name, standard, criteria and learnings. The platform default
// is read only; editing starts from one's own copy. Since db/028 a template
// used by an artist shared with one to edit can be edited here too, so which
// template new projects start from and which one is being edited are chosen
// apart. Text saves when the field is left; every change answers with the
// whole editor.

type Post = (body: Record<string, unknown>) => Promise<boolean>;

export function BoardSettings({ initial }: { initial: Editor }) {
  const [limit, setLimit] = useState(String(initial.rotationLimit));
  const [cold, setCold] = useState(String(initial.coldDays));
  const [state, setState] = useState<'' | 'saving' | 'saved'>('');
  const [error, setError] = useState('');
  async function save() {
    if (Number(limit) === initial.rotationLimit && Number(cold) === initial.coldDays && state !== 'saved') return;
    setError('');
    setState('saving');
    const r = await api<{ editor: Editor }>('/api/account/template', {
      method: 'POST',
      body: JSON.stringify({ op: 'board', rotationLimit: Number(limit), coldDays: Number(cold) }),
    });
    if (!r.ok) {
      setState('');
      setError(r.body.error || 'Could not save that.');
      return;
    }
    setState('saved');
  }
  return (
    <Section label="Board">
      {error && <p className="t-body mb-2 text-rust">{error}</p>}
      <div className="t-body flex flex-wrap items-end gap-6">
        <label className="flex flex-col gap-1">
          <span className="t-small text-muted">Projects in rotation at most</span>
          <input type="number" min={1} max={20} value={limit} onChange={(e) => setLimit(e.target.value)} onBlur={save} className={`${FIELD} w-20`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="t-small text-muted">A project goes cold after</span>
          <span className="flex items-center gap-1.5">
            <input type="number" min={1} max={365} value={cold} onChange={(e) => setCold(e.target.value)} onBlur={save} className={`${FIELD} w-20`} /> days
          </span>
        </label>
        {state === 'saved' && <span className="text-muted">Saved.</span>}
      </div>
      <p className="mt-2 t-small text-muted">The board keeps your rotation to this many projects; one untouched for this long shows as cold.</p>
    </Section>
  );
}

export function TemplateEditor({ initial }: { initial: Editor }) {
  const [ed, setEd] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stageId, setStageId] = useState<number | null>(initial.stages[0]?.id ?? null);
  const [copyName, setCopyName] = useState('My template');

  const post: Post = async (body) => {
    setError('');
    setBusy(true);
    const r = await api<{ editor: Editor }>('/api/account/template', { method: 'POST', body: JSON.stringify({ editId: ed.editing.id, ...body }) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return false;
    }
    setEd(r.data.editor);
    return true;
  };

  const readOnly = !ed.editing.canEdit;
  const stage = ed.stages.find((s) => s.id === stageId) ?? ed.stages[0];
  const own = ed.templates.filter((t) => t.mine);
  const choosable = ed.templates.filter((t) => t.isDefault || t.mine);
  const shared = ed.templates.filter((t) => !t.isDefault && !t.mine);

  async function edit(id: number) {
    setError('');
    setBusy(true);
    const r = await api<{ editor: Editor }>(`/api/account/template?edit=${id}`, { method: 'GET' });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not open that template.');
      return;
    }
    setEd(r.data.editor);
    setStageId(null);
  }

  return (
    <Section label="Workflow template · music">
      {error && <p className="t-body mb-2 text-rust">{error}</p>}
      <div className="t-body flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1">
          <span className="t-small text-muted">New music projects start from</span>
          <select
            value={ed.chosen.id}
            onChange={async (e) => {
              const id = Number(e.target.value);
              const t = ed.templates.find((x) => x.id === id);
              if (await post({ op: 'choose', templateId: t?.isDefault ? null : id })) setStageId(null);
            }}
            disabled={busy}
            className={`${FIELD} t-lead font-medium`}
          >
            {choosable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault && t.name !== 'Bottega default' ? ' (Bottega’s default)' : ''}
              </option>
            ))}
          </select>
        </label>
        {ed.templates.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="t-small text-muted">Editing</span>
            <select value={ed.editing.id} onChange={(e) => edit(Number(e.target.value))} disabled={busy} className={FIELD}>
              {ed.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? (t.name !== 'Bottega default' ? ' · Bottega default' : '') : t.mine ? '' : ` · ${t.ownerName ?? 'shared'}’s, through an artist`}
                </option>
              ))}
            </select>
          </label>
        )}
        {ed.editing.mine && (
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="t-small text-muted">Name</span>
              <input
                key={ed.editing.name}
                defaultValue={ed.editing.name}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== ed.editing.name && void post({ op: 'rename', templateId: ed.editing.id, name: e.target.value })}
                className={FIELD}
              />
            </label>
            <button onClick={() => post({ op: 'copy', sourceId: ed.editing.id, name: `${ed.editing.name} copy` })} disabled={busy} className={BUTTON}>
              Duplicate
            </button>
            <button
              onClick={() => confirm(`Delete “${ed.editing.name}”? New projects then start from Bottega’s default; projects already started keep their own copies.`) && post({ op: 'delete', templateId: ed.editing.id })}
              disabled={busy}
              className={BUTTON_DANGER}
            >
              Delete template
            </button>
          </span>
        )}
      </div>
      <p className="mt-2 t-small text-muted">
        Projects already started keep their own copy; their Workflow tab offers your changes to bring in.
        {own.length === 0 ? '' : ` Your templates: ${own.map((t) => t.name).join(', ')}.`}
        {shared.length === 0 ? '' : ` Shared with you through artists: ${shared.map((t) => t.name).join(', ')}; an artist’s own templates are chosen under Profile.`}
      </p>
      {!ed.editing.mine && ed.editing.canEdit && (
        <p className="t-body mt-2 rounded border border-line px-3 py-2">
          “{ed.editing.name}” is {ed.editing.ownerName ?? 'someone else'}’s, shared with you through an artist: your changes reach everyone using it.
        </p>
      )}

      {readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await post({ op: 'copy', sourceId: ed.editing.id, name: copyName });
          }}
          className="t-body mt-3 flex flex-wrap items-end gap-2 rounded border border-ink px-3 py-2.5"
        >
          <p className="min-w-0 flex-[1_1_320px]">
            {ed.editing.isDefault ? 'This is Bottega’s default, which you can read but not change.' : `“${ed.editing.name}” can be read here but not changed.`} Make your own copy to
            edit it; new projects then start from your copy.
          </p>
          <input value={copyName} onChange={(e) => setCopyName(e.target.value)} aria-label="Name of your copy" className={FIELD} />
          <button type="submit" disabled={busy || !copyName.trim()} className={BUTTON_PRIMARY}>
            Make my copy
          </button>
        </form>
      )}

      <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-4">
          <p className="t-label mb-1">Stages</p>
          <ul className="space-y-1">
            {ed.stages.map((s, i) => (
              <li key={s.id} className={`t-body flex items-center gap-1.5 rounded border px-2 py-1.5 ${s.id === stage?.id ? 'border-ink' : 'border-line'}`}>
                <button onClick={() => setStageId(s.id)} className="flex min-w-0 flex-1 items-baseline gap-2 text-left" aria-pressed={s.id === stage?.id}>
                  <span className="t-num w-4 font-mono t-small text-muted">{s.position}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                  <span className="t-num font-mono t-small text-muted">{s.criteria.length}</span>
                </button>
                {!readOnly && (
                  <>
                    <button onClick={() => post({ op: 'move-stage', stageId: s.id, dir: -1 })} disabled={busy || i === 0} className="px-1 t-small text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${s.label} earlier`}>
                      ↑
                    </button>
                    <button onClick={() => post({ op: 'move-stage', stageId: s.id, dir: 1 })} disabled={busy || i === ed.stages.length - 1} className="px-1 t-small text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${s.label} later`}>
                      ↓
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && <AddLine placeholder="A new stage" busy={busy} onAdd={(label) => post({ op: 'add-stage', templateId: ed.editing.id, label })} />}
        </div>
        <div className="min-w-0 lg:col-span-8">{stage && <StageEditor key={stage.id} s={stage} ed={ed} readOnly={readOnly} busy={busy} post={post} />}</div>
      </div>
      <MethodEditor ed={ed} readOnly={readOnly} busy={busy} post={post} />
    </Section>
  );
}

/** The template's method (W-42, db/032): principles for the whole workflow,
 *  shown at the foot of the Workflow tab and the board. */
/** A textarea that grows with its text, so a long hint or explanation shows in full instead of scrolling inside one line. */
function Grow(props: ComponentProps<'textarea'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, []);
  useLayoutEffect(fit);
  // The text wraps differently when the window changes width.
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);
  const { onInput, className, ...rest } = props;
  return (
    <textarea
      {...rest}
      ref={ref}
      onInput={(e) => {
        fit();
        onInput?.(e);
      }}
      className={`${className ?? ''} resize-none overflow-hidden`}
    />
  );
}

function MethodEditor({ ed, readOnly, busy, post }: { ed: Editor; readOnly: boolean; busy: boolean; post: Post }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  return (
    <div className="t-body mt-8 border-t border-line pt-4">
      <p className="t-label">The method · {ed.principles.length}</p>
      <p className="mt-0.5 t-small text-muted">Principles for the whole workflow, a short line and a sentence or two each. Projects using this template show them at the foot of the Workflow tab; Claude reads them too.</p>
      <ol className="mt-3 space-y-3">
        {ed.principles.map((p, i) => (
          <li key={p.id} className="flex gap-2">
            {!readOnly && (
              <span className="flex flex-col">
                <button onClick={() => post({ op: 'move-principle', principleId: p.id, dir: -1 })} disabled={busy || i === 0} className="px-1 text-muted hover:text-ink disabled:opacity-30" aria-label="Move up">
                  ↑
                </button>
                <button onClick={() => post({ op: 'move-principle', principleId: p.id, dir: 1 })} disabled={busy || i === ed.principles.length - 1} className="px-1 text-muted hover:text-ink disabled:opacity-30" aria-label="Move down">
                  ↓
                </button>
              </span>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <input
                key={`t${p.id}:${p.title}`}
                defaultValue={p.title}
                disabled={readOnly}
                aria-label="Principle"
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.title && void post({ op: 'principle', principleId: p.id, title: e.target.value })}
                className={`${FIELD} w-full font-medium`}
              />
              <Grow
                key={`b${p.id}:${p.body}`}
                defaultValue={p.body}
                disabled={readOnly}
                rows={2}
                aria-label="Explanation"
                onBlur={(e) => e.target.value.trim() !== p.body && void post({ op: 'principle', principleId: p.id, body: e.target.value })}
                className={`${FIELD} w-full`}
              />
            </div>
            {!readOnly && (
              <button onClick={() => post({ op: 'remove-principle', principleId: p.id })} disabled={busy} className={`self-start ${BUTTON_DANGER}`}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await post({ op: 'add-principle', templateId: ed.editing.id, title, body })) {
              setTitle('');
              setBody('');
            }
          }}
          className="mt-3 space-y-1"
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A principle, such as: Bounce early." className={`${FIELD} w-full`} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Why, in a sentence or two" className={`${FIELD} w-full`} />
          <button type="submit" disabled={busy || !title.trim()} className={BUTTON}>
            Add principle
          </button>
        </form>
      )}
      {readOnly && <p className="mt-2 t-small text-muted">Make a copy to change the method.</p>}
    </div>
  );
}

function StageEditor({ s, ed, readOnly, busy, post }: { s: EditorStage; ed: Editor; readOnly: boolean; busy: boolean; post: Post }) {
  return (
    <div className="t-body space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-[1_1_160px] flex-col gap-1">
          <span className="t-small text-muted">Stage name</span>
          <input
            key={s.label}
            defaultValue={s.label}
            disabled={readOnly}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.label && void post({ op: 'stage', stageId: s.id, label: e.target.value })}
            className={`${FIELD} font-medium`}
          />
        </label>
        <label className="flex flex-[3_1_300px] flex-col gap-1">
          <span className="t-small text-muted">The standard, in a line</span>
          <input
            key={s.standard}
            defaultValue={s.standard}
            disabled={readOnly}
            placeholder="Plays start to finish"
            onBlur={(e) => e.target.value.trim() !== s.standard && void post({ op: 'stage', stageId: s.id, standard: e.target.value })}
            className={FIELD}
          />
        </label>
      </div>
      <p className="t-small text-muted">Criteria · each one condition you can check. A hint says how to check it or what to aim for; indent a line by two spaces to nest it.</p>
      {s.criteria.length === 0 && <p className="text-muted">No criteria yet.</p>}
      <ul className="space-y-2">
        {s.criteria.map((c, i) => (
          <li key={c.id} className="flex gap-2.5 rounded border border-line p-2.5">
            {!readOnly && (
              <span className="flex flex-col t-small">
                <button onClick={() => post({ op: 'move-criterion', criterionId: c.id, dir: -1 })} disabled={busy || i === 0} className="px-1 text-muted hover:text-ink disabled:opacity-30" aria-label="Move up">
                  ↑
                </button>
                <button onClick={() => post({ op: 'move-criterion', criterionId: c.id, dir: 1 })} disabled={busy || i === s.criteria.length - 1} className="px-1 text-muted hover:text-ink disabled:opacity-30" aria-label="Move down">
                  ↓
                </button>
              </span>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <input
                key={c.body}
                defaultValue={c.body}
                disabled={readOnly}
                aria-label="Criterion"
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.body && void post({ op: 'criterion', criterionId: c.id, body: e.target.value })}
                className={`${FIELD} w-full font-medium`}
              />
              <Grow
                key={c.hint}
                defaultValue={c.hint}
                disabled={readOnly}
                aria-label="Hint"
                rows={1}
                placeholder="Hint (optional)"
                onBlur={(e) => e.target.value.replace(/\s+$/, '') !== c.hint && void post({ op: 'criterion', criterionId: c.id, hint: e.target.value })}
                className={`${FIELD} block w-full whitespace-pre-wrap font-mono t-small`}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 t-small text-muted">
                <label className="flex items-center gap-1.5">
                  Suggest from the set
                  <select
                    value={c.checkKey ?? ''}
                    disabled={readOnly || busy}
                    onChange={(e) => post({ op: 'criterion', criterionId: c.id, checkKey: e.target.value || null })}
                    className={`${FIELD} t-small`}
                    title={ed.checks.find((k) => k.key === c.checkKey)?.description}
                  >
                    <option value="">No check</option>
                    {ed.checks.map((k) => (
                      <option key={k.key} value={k.key}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                {c.difference === 'changed' && <span>Edited · differs from the default</span>}
                {c.difference === 'added' && <span>Yours · not in the default</span>}
              </div>
            </div>
            {!readOnly && (
              <button onClick={() => post({ op: 'remove-criterion', criterionId: c.id })} disabled={busy} className={`self-start ${BUTTON_DANGER}`}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && <AddLine placeholder="This stage is finished when…" busy={busy} onAdd={(body) => post({ op: 'add-criterion', stageId: s.id, body })} />}
      <div className="space-y-1.5 border-t border-line pt-3">
        <p className="t-label">Learnings · {s.learnings.filter((l) => l.reviewed).length}</p>
        <p className="t-small text-muted">Reminders with no checkbox, shown on every project using this template while it is at {s.label}.</p>
        {s.learnings.length > 0 && (
          <ul className="space-y-1.5">
            {s.learnings.map((l) => (
              <LearningLine key={l.id} l={l} readOnly={readOnly} busy={busy} post={post} />
            ))}
          </ul>
        )}
        {!readOnly && <AddLine placeholder={`Something to remember at ${s.label}`} busy={busy} onAdd={(body) => post({ op: 'add-learning', stageId: s.id, body })} />}
      </div>
      {s.missingFromDefault.length > 0 && (
        <p className="t-small text-muted">Removed from the default: {s.missingFromDefault.map((m) => `“${m.body}”`).join(', ')}.</p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {s.inDefault && (
            <button
              onClick={() => confirm(`Put ${s.label} back as Bottega’s default has it? Your changes to this stage are lost.`) && post({ op: 'reset-stage', stageId: s.id })}
              disabled={busy}
              className={BUTTON}
            >
              Reset this stage to the default
            </button>
          )}
          <button
            onClick={() => confirm(`Remove the stage ${s.label} and its criteria from this template? Projects already started keep theirs.`) && post({ op: 'remove-stage', stageId: s.id })}
            disabled={busy || ed.stages.length <= 1}
            className={BUTTON_DANGER}
          >
            Remove stage
          </button>
        </div>
      )}
    </div>
  );
}

function AddLine({ placeholder, busy, onAdd }: { placeholder: string; busy: boolean; onAdd: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onAdd(text)) setText('');
      }}
      className="mt-2 flex gap-2"
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className={`${FIELD} t-body min-w-0 flex-1`} />
      <button type="submit" disabled={busy || !text.trim()} className={BUTTON}>
        Add
      </button>
    </form>
  );
}

function LearningLine({ l, readOnly, busy, post }: { l: EditorLearning; readOnly: boolean; busy: boolean; post: Post }) {
  return (
    <li className={`t-body flex flex-col gap-1 rounded border px-2.5 py-2 ${l.reviewed ? 'border-line' : 'border-dashed border-ink'}`}>
      {!l.reviewed && <span className="font-mono t-small text-muted">Proposed by Claude</span>}
      {readOnly ? (
        <span className="whitespace-pre-line">{l.body}</span>
      ) : (
        <Grow
          key={l.body}
          defaultValue={l.body}
          rows={2}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.body && void post({ op: 'learning', learningId: l.id, body: e.target.value })}
          className={`${FIELD} w-full`}
          aria-label="Learning"
        />
      )}
      <span className="flex flex-wrap items-center gap-2 t-small text-muted">
        <span>
          {l.createdByName}
          {l.source ? ` · from ${l.source}` : ''}
        </span>
        {!readOnly && (
          <span className="ml-auto flex gap-2">
            {!l.reviewed && (
              <button onClick={() => post({ op: 'learning', learningId: l.id, accept: true })} disabled={busy} className={BUTTON_PRIMARY}>
                Keep
              </button>
            )}
            <button onClick={() => post({ op: 'remove-learning', learningId: l.id })} disabled={busy} className={BUTTON_DANGER}>
              {l.reviewed ? 'Remove' : 'Reject'}
            </button>
          </span>
        )}
      </span>
    </li>
  );
}
