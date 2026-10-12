'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { COMMON_VARIANTS, type StudioVariant } from '@/lib/studioTypes';

// The session's variants as chips in its header (REQUIREMENTS S-14, S-16;
// db/015): Main, then each named variant. The chosen one decides what the
// Mixes and State tabs show; the workflow, references and notes on the whole
// session are common to all. Edit access adds and renames variants, each with
// a name rule that sorts saved sets into it by file name; the owner removes
// one that has no mixes.

type Form = { mode: 'add' } | { mode: 'edit'; v: StudioVariant };

export default function VariantBar({
  projectId,
  variants,
  current,
  canEdit,
  isOwner,
  onSelect,
  onCreated,
  onRenamed,
  onRemoved,
}: {
  projectId: number;
  variants: StudioVariant[];
  /** '' is the main mix. */
  current: string;
  canEdit: boolean;
  isOwner: boolean;
  onSelect: (name: string) => void;
  onCreated: (variants: StudioVariant[], name: string) => void;
  onRenamed: (name: string) => void;
  onRemoved: () => void;
}) {
  const [form, setForm] = useState<Form | null>(null);
  const [name, setName] = useState('');
  const [match, setMatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!variants.length && !canEdit) return null;
  const selected = variants.find((v) => v.name === current) ?? null;

  function open(f: Form) {
    setForm(f);
    setError('');
    setName(f.mode === 'edit' ? f.v.name : '');
    setMatch(f.mode === 'edit' ? f.v.match : '');
  }

  async function submit() {
    if (!form) return;
    setBusy(true);
    setError('');
    const body = JSON.stringify({ name, match });
    const r =
      form.mode === 'add'
        ? await api<{ variants: StudioVariant[] }>(`/api/projects/${projectId}/variants`, { method: 'POST', body })
        : await api<{ variants: StudioVariant[] }>(`/api/projects/${projectId}/variants/${form.v.id}`, { method: 'PATCH', body });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not save the variant.');
      return;
    }
    const typed = name.trim().replace(/\s+/g, ' ');
    const saved = r.data.variants.find((v) => v.name.toLowerCase() === typed.toLowerCase())?.name ?? typed;
    setForm(null);
    if (form.mode === 'add') onCreated(r.data.variants, saved);
    else onRenamed(saved);
  }

  async function remove(v: StudioVariant) {
    setBusy(true);
    setError('');
    const r = await api(`/api/projects/${projectId}/variants/${v.id}`, { method: 'DELETE' });
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error || 'Could not remove the variant.');
      return;
    }
    setForm(null);
    onRemoved();
  }

  const chip = (label: string, value: string, title: string) => {
    const on = value === current;
    return (
      <button
        key={value || 'main'}
        type="button"
        onClick={() => onSelect(value)}
        aria-pressed={on}
        title={title}
        className={`rounded-full border px-2.5 py-0.5 ${on ? 'border-ink text-ink' : 'border-line text-muted hover:text-ink'}`}
      >
        {label}
      </button>
    );
  };
  const field = 'rounded border border-line bg-card px-1.5 py-0.5 text-ink outline-none focus:border-rust';

  return (
    <div className="t-body flex flex-wrap items-center gap-1.5">
      {chip('Main', '', 'The main mix: its mixes, and the saves no variant’s name rule finds')}
      {variants.map((v) =>
        chip(v.name, v.name, `${v.mixes} ${v.mixes === 1 ? 'mix' : 'mixes'} · ${v.saves} ${v.saves === 1 ? 'save' : 'saves'} · saves named “…${v.match}…”`),
      )}
      {canEdit && !form && (
        <>
          <button
            type="button"
            onClick={() => open({ mode: 'add' })}
            className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-muted hover:border-ink hover:text-ink"
            title="A radio edit, an extended mix…: its own mixes and its own saved sets"
          >
            + Add variant
          </button>
          {selected && (
            <button type="button" onClick={() => open({ mode: 'edit', v: selected })} className="px-1 text-muted hover:text-ink">
              Edit
            </button>
          )}
        </>
      )}
      {form && (
        <span className="flex flex-wrap items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder="Radio edit"
            list="session-variant-names"
            aria-label="The variant's name"
            maxLength={40}
            className={`${field} w-32`}
          />
          <datalist id="session-variant-names">
            {COMMON_VARIANTS.filter((c) => !variants.some((v) => v.name.toLowerCase() === c.toLowerCase())).map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <span className="text-muted">saves named</span>
          <input
            value={match}
            onChange={(e) => setMatch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
            placeholder={name.trim().toLowerCase() || 'radio edit'}
            aria-label="Text in a saved set's file name that puts it in this variant; any case"
            maxLength={60}
            className={`${field} w-32`}
          />
          <button type="button" onClick={() => void submit()} disabled={busy || !name.trim()} className="text-ink underline disabled:opacity-50">
            {form.mode === 'add' ? 'Add' : 'Save'}
          </button>
          {form.mode === 'edit' && isOwner && (
            <button
              type="button"
              onClick={() => void remove(form.v)}
              disabled={busy || form.v.mixes > 0}
              title={form.v.mixes > 0 ? 'Delete its mixes first' : 'Its saves return to the name rules'}
              className="text-muted hover:text-rust disabled:opacity-40"
            >
              Remove
            </button>
          )}
          <button type="button" onClick={() => setForm(null)} className="text-muted hover:text-ink">
            Cancel
          </button>
        </span>
      )}
      {error && <span className="basis-full text-rust">{error}</span>}
    </div>
  );
}
