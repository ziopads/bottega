'use client';

import { useState } from 'react';

import type { CapabilityDef, CapabilityValue } from '@/lib/gearTypes';
import { BUTTON_SMALL, BUTTON_SMALL_DANGER } from '@/app/_ui/styles';

// One capability's value, edited in the form its type needs: a yes/no choice,
// a number, text, one choice, or several. Used for a unit's overrides and for
// the administrator's model capabilities. The server parses and checks again.

const field = 'rounded border border-line bg-card px-2 py-1 t-body outline-none focus:border-rust';

export function CapabilityInput({
  def,
  value,
  onChange,
}: {
  def: CapabilityDef;
  value: CapabilityValue | undefined;
  onChange: (v: CapabilityValue | undefined) => void;
}) {
  switch (def.valueType) {
    case 'boolean':
      return (
        <select
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}
          className={field}
          aria-label={def.label}
        >
          <option value="">—</option>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      );
    case 'integer':
    case 'number':
      return (
        <input
          type="number"
          step={def.valueType === 'integer' ? 1 : 'any'}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className={`${field} w-24`}
          aria-label={def.label}
        />
      );
    case 'text':
      return (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className={`${field} w-64`}
          aria-label={def.label}
        />
      );
    case 'enum':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className={field}
          aria-label={def.label}
        >
          <option value="">—</option>
          {def.choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    case 'list': {
      const chosen = new Set(Array.isArray(value) ? value : []);
      return (
        <span className="flex flex-wrap gap-x-3 gap-y-1 t-body">
          {def.choices.map((c) => (
            <label key={c} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={chosen.has(c)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(c);
                  else next.delete(c);
                  onChange(next.size ? def.choices.filter((x) => next.has(x)) : undefined);
                }}
              />
              {c}
            </label>
          ))}
        </span>
      );
    }
  }
}

/** A capability row in edit mode: the input, Save, and Clear. */
export function CapabilityEditor({
  def,
  initial,
  clearLabel,
  onSave,
}: {
  def: CapabilityDef;
  initial: CapabilityValue | undefined;
  /** "Use the model's" for a unit; "Clear" for a model. */
  clearLabel: string;
  onSave: (value: CapabilityValue | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<CapabilityValue | undefined>(initial);
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <CapabilityInput def={def} value={draft} onChange={setDraft} />
      <button
        disabled={busy || draft === undefined}
        onClick={async () => {
          setBusy(true);
          await onSave(draft ?? null);
          setBusy(false);
        }}
        className={BUTTON_SMALL}
      >
        Save
      </button>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          if (await onSave(null)) setDraft(undefined);
          setBusy(false);
        }}
        className={BUTTON_SMALL_DANGER}
      >
        {clearLabel}
      </button>
    </span>
  );
}
