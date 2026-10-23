'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';
import type { EditorStage, TemplateEditor as Editor } from '@/lib/templateTypes';

import { FIELD } from './parts';

// Preferences › Board and Workflow template (REQUIREMENTS W-13 to W-15, W-22;
// db/024). General to detail, left to right: the template's stages, then the
// chosen stage's name, standard and criteria. The platform default is read
// only; editing starts from one's own copy. Text saves when the field is
// left; every change answers with the whole editor.

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
          <span className="text-[11px] text-muted">Projects in rotation at most</span>
          <input type="number" min={1} max={20} value={limit} onChange={(e) => setLimit(e.target.value)} onBlur={save} className={`${FIELD} w-20`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">A project goes cold after</span>
          <span className="flex items-center gap-1.5">
            <input type="number" min={1} max={365} value={cold} onChange={(e) => setCold(e.target.value)} onBlur={save} className={`${FIELD} w-20`} /> days
          </span>
        </label>
        {state === 'saved' && <span className="text-muted">Saved.</span>}
      </div>
      <p className="mt-2 text-[11px] text-muted">The board keeps your rotation to this many projects; one untouched for this long shows as cold.</p>
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
    const r = await api<{ editor: Editor }>('/api/account/template', { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return false;
    }
    setEd(r.data.editor);
    return true;
  };

  const readOnly = ed.chosen.isDefault;
  const stage = ed.stages.find((s) => s.id === stageId) ?? ed.stages[0];
  const own = ed.templates.filter((t) => !t.isDefault);

  return (
    <Section label="Workflow template · music">
      {error && <p className="t-body mb-2 text-rust">{error}</p>}
      <div className="t-body flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">New music projects start from</span>
          <select
            value={ed.chosen.id}
            onChange={async (e) => {
              const id = Number(e.target.value);
              const t = ed.templates.find((x) => x.id === id);
              if (await post({ op: 'choose', templateId: t?.isDefault ? null : id })) setStageId(null);
            }}
            disabled={busy}
            className={`${FIELD} text-[15px] font-medium`}
          >
            {ed.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.isDefault ? ' (Bottega’s default)' : ''}
              </option>
            ))}
          </select>
        </label>
        {!readOnly && (
          <span className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted">Name</span>
              <input
                key={ed.chosen.name}
                defaultValue={ed.chosen.name}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== ed.chosen.name && void post({ op: 'rename', templateId: ed.chosen.id, name: e.target.value })}
                className={FIELD}
              />
            </label>
            <button onClick={() => post({ op: 'copy', sourceId: ed.chosen.id, name: `${ed.chosen.name} copy` })} disabled={busy} className={BUTTON}>
              Duplicate
            </button>
            <button
              onClick={() => confirm(`Delete “${ed.chosen.name}”? New projects then start from Bottega’s default; projects already started keep their own copies.`) && post({ op: 'delete', templateId: ed.chosen.id })}
              disabled={busy}
              className={BUTTON_DANGER}
            >
              Delete template
            </button>
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Projects already started keep their own copy; their Workflow tab offers your changes to bring in.
        {own.length === 0 ? '' : ` Your templates: ${own.map((t) => t.name).join(', ')}.`}
      </p>

      {readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await post({ op: 'copy', sourceId: ed.chosen.id, name: copyName });
          }}
          className="t-body mt-3 flex flex-wrap items-end gap-2 rounded border border-ink px-3 py-2.5"
        >
          <p className="min-w-0 flex-[1_1_320px]">This is Bottega’s default, which you can read but not change. Make your own copy to edit it; new projects then start from your copy.</p>
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
                  <span className="t-num w-4 font-mono text-[10px] text-muted">{s.position}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                  <span className="t-num font-mono text-[10px] text-muted">{s.criteria.length}</span>
                </button>
                {!readOnly && (
                  <>
                    <button onClick={() => post({ op: 'move-stage', stageId: s.id, dir: -1 })} disabled={busy || i === 0} className="px-1 text-[11px] text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${s.label} earlier`}>
                      ↑
                    </button>
                    <button onClick={() => post({ op: 'move-stage', stageId: s.id, dir: 1 })} disabled={busy || i === ed.stages.length - 1} className="px-1 text-[11px] text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${s.label} later`}>
                      ↓
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && <AddLine placeholder="A new stage" busy={busy} onAdd={(label) => post({ op: 'add-stage', templateId: ed.chosen.id, label })} />}
        </div>
        <div className="min-w-0 lg:col-span-8">{stage && <StageEditor key={stage.id} s={stage} ed={ed} readOnly={readOnly} busy={busy} post={post} />}</div>
      </div>
    </Section>
  );
}

function StageEditor({ s, ed, readOnly, busy, post }: { s: EditorStage; ed: Editor; readOnly: boolean; busy: boolean; post: Post }) {
  return (
    <div className="t-body space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-[1_1_160px] flex-col gap-1">
          <span className="text-[11px] text-muted">Stage name</span>
          <input
            key={s.label}
            defaultValue={s.label}
            disabled={readOnly}
            onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.label && void post({ op: 'stage', stageId: s.id, label: e.target.value })}
            className={`${FIELD} font-medium`}
          />
        </label>
        <label className="flex flex-[3_1_300px] flex-col gap-1">
          <span className="text-[11px] text-muted">The standard, in a line</span>
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
      <p className="text-[11px] text-muted">Criteria · each one condition you can check. A hint says how to check it or what to aim for; indent a line by two spaces to nest it.</p>
      {s.criteria.length === 0 && <p className="text-muted">No criteria yet.</p>}
      <ul className="space-y-2">
        {s.criteria.map((c, i) => (
          <li key={c.id} className="flex gap-2.5 rounded border border-line p-2.5">
            {!readOnly && (
              <span className="flex flex-col text-[11px]">
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
              <textarea
                key={c.hint}
                defaultValue={c.hint}
                disabled={readOnly}
                aria-label="Hint"
                rows={Math.max(1, Math.min(8, c.hint.split('\n').length))}
                placeholder="Hint (optional)"
                onBlur={(e) => e.target.value.replace(/\s+$/, '') !== c.hint && void post({ op: 'criterion', criterionId: c.id, hint: e.target.value })}
                className={`${FIELD} block w-full whitespace-pre-wrap font-mono text-[12px]`}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <label className="flex items-center gap-1.5">
                  Suggest from the set
                  <select
                    value={c.checkKey ?? ''}
                    disabled={readOnly || busy}
                    onChange={(e) => post({ op: 'criterion', criterionId: c.id, checkKey: e.target.value || null })}
                    className={`${FIELD} text-[11px]`}
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
      {s.missingFromDefault.length > 0 && (
        <p className="text-[11px] text-muted">Removed from the default: {s.missingFromDefault.map((m) => `“${m.body}”`).join(', ')}.</p>
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
