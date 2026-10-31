'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY } from '@/app/_ui/styles';
import { zoneOfName } from '@/lib/als/zones';
import { elementColor } from '@/lib/elementColors';
import type { StructureEditor as Editor, StructureElement } from '@/lib/structureTypes';

import LiveColorPicker from './LiveColorPicker';
import { FIELD } from './parts';

// Preferences › Track structure (REQUIREMENTS W-25 to W-29; db/025): the
// zones a set's tracks are sorted into, how a track is matched to one (its
// name starts with a prefix or the zone's name; or it sits in a group with one
// of the zone's group names), the parts under each, and the elements that are
// not zones (STRUCTURE, BUS). General to detail, left to right: the elements,
// then the chosen one. The default is read only; editing starts from one's
// own copy. Text saves when the field is left.

type Post = (body: Record<string, unknown>) => Promise<boolean>;

const list = (xs: string[]) => xs.join(', ');

export default function StructureEditor({ initial }: { initial: Editor }) {
  const [ed, setEd] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [elementId, setElementId] = useState<number | null>(initial.elements[0]?.id ?? null);
  const [copyName, setCopyName] = useState('My structure');
  const [trial, setTrial] = useState('');
  const [trialGroup, setTrialGroup] = useState(false);

  const post: Post = async (body) => {
    setError('');
    setBusy(true);
    const r = await api<{ editor: Editor }>('/api/account/structure', { method: 'POST', body: JSON.stringify({ editId: ed.editing.id, ...body }) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'That did not go through.');
      return false;
    }
    setEd(r.data.editor);
    return true;
  };

  const readOnly = !ed.editing.canEdit;
  const choosable = ed.templates.filter((t) => t.isDefault || t.mine);

  async function edit(id: number) {
    setError('');
    setBusy(true);
    const r = await api<{ editor: Editor }>(`/api/account/structure?edit=${id}`, { method: 'GET' });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not open that structure.');
      return;
    }
    setEd(r.data.editor);
    setElementId(null);
  }
  const el = ed.elements.find((e) => e.id === elementId) ?? ed.elements[0];
  const zones = ed.elements.filter((e) => e.isZone).map((e) => ({ name: e.name, color: e.color, prefixes: e.prefixes, groupNames: e.groupNames }));
  const trialZone = trial.trim() ? zoneOfName(trial, zones, trialGroup) : null;

  return (
    <Section label="Track structure">
      {error && <p className="t-body mb-2 text-rust">{error}</p>}
      <div className="t-body flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1">
          <span className="t-small text-muted">New music projects take</span>
          <select
            value={ed.chosen.id}
            onChange={async (e) => {
              const t = ed.templates.find((x) => x.id === Number(e.target.value));
              if (await post({ op: 'choose', templateId: t?.isDefault ? null : Number(e.target.value) })) setElementId(null);
            }}
            disabled={busy}
            className={`${FIELD} t-lead font-medium`}
          >
            {choosable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
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
              onClick={() => confirm(`Delete “${ed.editing.name}”? New projects then take Bottega’s default; projects already started keep theirs.`) && post({ op: 'delete', templateId: ed.editing.id })}
              disabled={busy}
              className={BUTTON_DANGER}
            >
              Delete structure
            </button>
          </span>
        )}
      </div>
      <p className="mt-2 t-small text-muted">
        A project takes a copy when its workflow starts; its Workflow tab offers your later changes. The State tab reads every saved set with the
        project&rsquo;s zones, so a change there sorts old sets too.
      </p>

      {readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await post({ op: 'copy', sourceId: ed.editing.id, name: copyName });
          }}
          className="t-body mt-3 flex flex-wrap items-end gap-2 rounded border border-ink px-3 py-2.5"
        >
          <p className="min-w-0 flex-[1_1_320px]">
            {ed.editing.isDefault ? 'This is Bottega’s default, from the Sirsinate Live template.' : `“${ed.editing.name}” can be read here but not changed.`} Make your own
            copy to rename zones, change prefixes or add your own.
          </p>
          <input value={copyName} onChange={(e) => setCopyName(e.target.value)} aria-label="Name of your copy" className={FIELD} />
          <button type="submit" disabled={busy || !copyName.trim()} className={BUTTON_PRIMARY}>
            Make my copy
          </button>
        </form>
      )}

      <div className="t-body mt-4 flex flex-wrap items-center gap-2 rounded border border-line px-3 py-2">
        <label className="flex items-center gap-2">
          <span className="t-small text-muted">Try a track name</span>
          <input value={trial} onChange={(e) => setTrial(e.target.value)} placeholder="TAC Kick" className={`${FIELD} w-48 font-mono t-small`} />
        </label>
        <label className="flex items-center gap-1 t-small text-muted">
          <input type="checkbox" checked={trialGroup} onChange={(e) => setTrialGroup(e.target.checked)} /> a group
        </label>
        {trial.trim() && (
          <span className={trialZone ? 'font-medium' : 'text-muted'}>
            {trialZone ? `→ ${trialZone}` : '→ no zone of its own (it takes its group’s, if any)'}
          </span>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-4">
          <p className="t-label mb-1">Elements</p>
          <ul className="space-y-1">
            {ed.elements.map((e, i) => (
              <li key={e.id} className={`t-body flex items-center gap-1.5 rounded border px-2 py-1.5 ${e.id === el?.id ? 'border-ink' : 'border-line'}`}>
                <button onClick={() => setElementId(e.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-pressed={e.id === el?.id}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-line" style={{ background: e.color ? elementColor(e.color) : 'transparent' }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{e.name}</span>
                  <span className="truncate font-mono t-small text-muted">{e.isZone ? list(e.prefixes) || 'zone' : 'not a zone'}</span>
                </button>
                {!readOnly && (
                  <>
                    <button onClick={() => post({ op: 'move', elementId: e.id, dir: -1 })} disabled={busy || i === 0} className="px-1 t-small text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${e.name} earlier`}>
                      ↑
                    </button>
                    <button onClick={() => post({ op: 'move', elementId: e.id, dir: 1 })} disabled={busy || i === ed.elements.length - 1} className="px-1 t-small text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${e.name} later`}>
                      ↓
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {!readOnly && <AddLine placeholder="A new zone or element" busy={busy} onAdd={(name) => post({ op: 'add', templateId: ed.editing.id, name })} />}
          <p className="mt-2 t-small text-muted">Zones come first on the State tab in this order; cards can hang on any element.</p>
        </div>
        <div className="min-w-0 lg:col-span-8">{el && <ElementEditor key={el.id} e={el} ed={ed} readOnly={readOnly} busy={busy} post={post} />}</div>
      </div>
    </Section>
  );
}

function ElementEditor({ e, ed, readOnly, busy, post }: { e: StructureElement; ed: Editor; readOnly: boolean; busy: boolean; post: Post }) {
  const save = (patch: Record<string, unknown>) => post({ op: 'element', elementId: e.id, ...patch });
  return (
    <div className="t-body space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-[2_1_200px] flex-col gap-1">
          <span className="t-small text-muted">Name</span>
          <input key={e.name} defaultValue={e.name} disabled={readOnly} onBlur={(x) => x.target.value.trim() && x.target.value.trim() !== e.name && void save({ name: x.target.value })} className={`${FIELD} font-medium`} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="t-small text-muted" id={`colour-${e.id}`}>Colour</span>
          <LiveColorPicker value={e.color} disabled={readOnly || busy} labelledBy={`colour-${e.id}`} onPick={(hex) => void save({ color: hex })} />
          <span className="flex">
            {!readOnly && e.color && (
              <button onClick={() => save({ color: null })} disabled={busy} className={BUTTON}>
                None
              </button>
            )}
          </span>
        </div>
        {e.difference === 'changed' && <span className="t-small text-muted">Edited · differs from the default</span>}
        {e.difference === 'added' && <span className="t-small text-muted">Yours · not in the default</span>}
      </div>
      <label className="flex flex-col gap-1">
        <span className="t-small text-muted">What it holds</span>
        <input key={e.description} defaultValue={e.description} disabled={readOnly} placeholder="The pulse: drums and percussion that carry the beat." onBlur={(x) => x.target.value.trim() !== e.description && void save({ description: x.target.value })} className={FIELD} />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={e.isZone} disabled={readOnly || busy} onChange={(x) => void save({ isZone: x.target.checked })} />
        <span>Tracks belong here (a zone)</span>
        <span className="t-small text-muted">Leave it off for work that belongs to no track, such as STRUCTURE or BUS.</span>
      </label>
      {e.isZone && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="t-small text-muted">Track name prefixes, separated by commas</span>
            <input key={list(e.prefixes)} defaultValue={list(e.prefixes)} disabled={readOnly} placeholder="TAC, DRM" onBlur={(x) => x.target.value !== list(e.prefixes) && void save({ prefixes: x.target.value })} className={`${FIELD} font-mono t-small`} />
            <span className="t-small text-muted">“TAC Kick”, “TAC-hat” and “{e.name} snare” all belong here; case does not matter.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="t-small text-muted">Group names, separated by commas</span>
            <input key={list(e.groupNames)} defaultValue={list(e.groupNames)} disabled={readOnly} placeholder="Drums, Percussion" onBlur={(x) => x.target.value !== list(e.groupNames) && void save({ groupNames: x.target.value })} className={`${FIELD} font-mono t-small`} />
            <span className="t-small text-muted">A group with one of these names, and every track in it, belongs here.</span>
          </label>
        </div>
      )}
      <div>
        <p className="mb-1 t-small text-muted">Parts · what cards in {e.name} can be about</p>
        {e.parts.length === 0 && <p className="text-muted">No parts.</p>}
        <ul className="space-y-1">
          {e.parts.map((p, i) => (
            <li key={p.id} className="flex items-center gap-1.5">
              <input key={p.name} defaultValue={p.name} disabled={readOnly} onBlur={(x) => x.target.value.trim() && x.target.value.trim() !== p.name && void post({ op: 'element', elementId: p.id, name: x.target.value })} className={`${FIELD} min-w-0 flex-1`} aria-label="Part" />
              {!readOnly && (
                <>
                  <button onClick={() => post({ op: 'move', elementId: p.id, dir: -1 })} disabled={busy || i === 0} className="px-1 t-small text-muted hover:text-ink disabled:opacity-30" aria-label="Move up">
                    ↑
                  </button>
                  <button onClick={() => post({ op: 'move', elementId: p.id, dir: 1 })} disabled={busy || i === e.parts.length - 1} className="px-1 t-small text-muted hover:text-ink disabled:opacity-30" aria-label="Move down">
                    ↓
                  </button>
                  <button onClick={() => post({ op: 'remove', elementId: p.id })} disabled={busy} className={BUTTON_DANGER}>
                    Remove
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {!readOnly && <AddLine placeholder={`A part of ${e.name}`} busy={busy} onAdd={(name) => post({ op: 'add', templateId: ed.editing.id, parentId: e.id, name })} />}
      </div>
      {!readOnly && (
        <div className="border-t border-line pt-3">
          <button
            onClick={() => confirm(`Remove ${e.name} and its parts from this structure? Projects already started keep theirs.`) && post({ op: 'remove', elementId: e.id })}
            disabled={busy}
            className={BUTTON_DANGER}
          >
            Remove {e.name}
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
