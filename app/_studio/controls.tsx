'use client';

import { useRef, useState } from 'react';
import { RATING_MAX } from '@/lib/studioTypes';

// Small controls shared by the studio list and project pages.

export async function api<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; status: number; body: any }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, data: body as T } : { ok: false, status: res.status, body };
}

/**
 * Click to edit; Enter or leaving the field saves, Escape cancels. The text
 * sent is trimmed and the server does the validating, so an error comes back
 * through the page's error line and the field stays open for a correction.
 */
export function InlineEdit({
  value,
  placeholder,
  label,
  onSave,
  inputMode,
  align = 'left',
  textClass = 'text-sm',
}: {
  value: string;
  placeholder: string;
  label: string;
  onSave: (v: string) => Promise<boolean>;
  inputMode?: 'text' | 'decimal';
  align?: 'left' | 'right';
  /** Type size for both states, e.g. 'text-2xl' for a page heading. */
  textClass?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Escape cancels, and the blur that may follow must not then save.
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    if (ok) setEditing(false);
  }

  const alignClass = align === 'right' ? 'text-right' : 'text-left';

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={saving}
        inputMode={inputMode}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            cancelled.current = true;
            setDraft(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        className={`w-full rounded-md border border-line bg-parchment px-2 py-1 ${textClass} text-ink outline-none focus:border-rust ${alignClass}`}
      />
    );
  }

  return (
    <button
      onClick={() => {
        // Browsers disagree on whether removing a focused input fires blur,
        // so the Escape flag may never have been consumed. Clear it here.
        cancelled.current = false;
        setDraft(value);
        setEditing(true);
      }}
      title={`Edit ${label.toLowerCase()}`}
      className={`block w-full truncate ${textClass} hover:text-rust ${alignClass}`}
    >
      {value || <span className="text-muted/60">{placeholder}</span>}
    </button>
  );
}

/**
 * Five clickable stars. Hover previews; clicking the current rating clears it
 * back to unrated, so there is no separate "remove rating" control.
 */
export function Stars({ rating, onRate }: { rating: number; onRate: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const shown = hover || rating;
  return (
    <span className="flex shrink-0" onMouseLeave={() => setHover(0)} role="group" aria-label={`Rating: ${rating} of ${RATING_MAX}`}>
      {Array.from({ length: RATING_MAX }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(0)}
          onClick={() => onRate(n === rating ? 0 : n)}
          aria-label={n === rating ? `Clear rating (${n})` : `Rate ${n} of ${RATING_MAX}`}
          title={n === rating ? 'Clear rating' : `${n} of ${RATING_MAX}`}
          className={`px-px text-base leading-none ${n <= shown ? 'text-ink' : 'text-muted/40'}`}
        >
          {n <= shown ? '★' : '☆'}
        </button>
      ))}
    </span>
  );
}

const NEW_GENRE = '__new__';

/**
 * Genre picker: the studio's list, "—" for none, and "+ New genre…", which
 * turns the menu into a text field. Enter (or leaving the field with text in
 * it) adds the genre to the list and applies it; Escape backs out.
 */
export function GenreSelect({
  value,
  genres,
  onChange,
  onAddGenre,
  className = '',
}: {
  value: string;
  genres: string[];
  onChange: (genre: string) => unknown;
  /** Adds to the shared list; resolves to the stored spelling, or null on failure. */
  onAddGenre: (name: string) => Promise<string | null>;
  className?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    const name = draft.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    setBusy(true);
    const stored = await onAddGenre(name);
    setBusy(false);
    if (stored) {
      setAdding(false);
      await onChange(stored);
    }
  }

  const base = `rounded-md border border-line bg-card px-2 py-1 text-sm outline-none focus:border-rust ${className}`;

  if (adding) {
    return (
      <input
        autoFocus
        value={draft}
        disabled={busy}
        placeholder="New genre"
        aria-label="New genre"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={create}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft('');
            setAdding(false);
          }
        }}
        className={base}
      />
    );
  }

  // A value missing from the list (it shouldn't happen, the database forbids
  // it) still shows, rather than the menu silently reading "—".
  const options = value && !genres.includes(value) ? [value, ...genres] : genres;

  return (
    <select
      value={value}
      aria-label="Genre"
      onChange={(e) => {
        if (e.target.value === NEW_GENRE) {
          setDraft('');
          setAdding(true);
        } else {
          onChange(e.target.value);
        }
      }}
      className={base}
    >
      <option value="">—</option>
      {options.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
      <option value={NEW_GENRE}>+ New genre…</option>
    </select>
  );
}
