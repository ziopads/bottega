'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, BUTTON_PRIMARY } from '@/app/_ui/styles';
import { DEFAULT_COLUMNS, PROJECT_COLUMNS, type ProjectColumn } from '@/lib/projectColumns';

// The Projects list's Columns menu (db/033): tick the columns to show, move
// them up or down, Save keeps the choice with the account, Default goes back
// to the standard set (which drops minor columns on narrow windows).

export default function ColumnsMenu({ value, onSaved }: { value: ProjectColumn[] | null; onSaved: (cols: ProjectColumn[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ key: ProjectColumn; on: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function start() {
    const on = value ?? DEFAULT_COLUMNS;
    const off = PROJECT_COLUMNS.map((c) => c.key).filter((k) => !on.includes(k));
    setDraft([...on.map((key) => ({ key, on: true })), ...off.map((key) => ({ key, on: false }))]);
    setError('');
    setOpen(true);
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= draft.length) return;
    const next = draft.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setDraft(next);
  }

  async function save(cols: ProjectColumn[] | null) {
    setBusy(true);
    setError('');
    const r = await api('/api/account/preferences', { method: 'PUT', body: JSON.stringify({ projectColumns: cols }) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body?.error || 'Could not save the columns.');
      return;
    }
    onSaved(cols);
    setOpen(false);
  }

  const chosen = draft.filter((d) => d.on).map((d) => d.key);
  const label = (k: ProjectColumn) => PROJECT_COLUMNS.find((c) => c.key === k)?.label ?? k;

  return (
    <div className="relative">
      <button type="button" onClick={() => (open ? setOpen(false) : start())} className={BUTTON} aria-expanded={open}>
        Columns{value ? ' · yours' : ''}
      </button>
      {open && (
        <div className="t-body absolute right-0 z-20 mt-1 w-64 space-y-2 rounded-[var(--radius)] border border-line bg-parchment p-3 shadow-lg">
          <ul className="space-y-0.5">
            {draft.map((d, i) => (
              <li key={d.key} className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={d.on}
                    onChange={(e) => setDraft(draft.map((x) => (x.key === d.key ? { ...x, on: e.target.checked } : x)))}
                  />
                  <span className={d.on ? '' : 'text-muted'}>{label(d.key)}</span>
                </label>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1 text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${label(d.key)} earlier`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} className="px-1 text-muted hover:text-ink disabled:opacity-30" aria-label={`Move ${label(d.key)} later`}>
                  ↓
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="t-small text-danger">{error}</p>}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => save(chosen)} disabled={busy || chosen.length === 0} className={BUTTON_PRIMARY}>
              Save
            </button>
            <button type="button" onClick={() => save(null)} disabled={busy} className={BUTTON} title="The standard columns, fewer on narrow windows">
              Default
            </button>
            <button type="button" onClick={() => setOpen(false)} className={BUTTON}>
              Cancel
            </button>
          </div>
          <p className="t-small text-muted">Kept with your account, on every computer.</p>
        </div>
      )}
    </div>
  );
}
