'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { Section } from '@/app/_ui/layout';
import { SEGMENT, SEGMENTS } from '@/app/_ui/styles';
import { SLOTS } from '@/lib/elementColors';
import { MODES, THEMES, type Mode, type Theme } from '@/lib/theme';

// Account › Preferences › Look (REQUIREMENTS O-9, db/030): the theme and
// whether it follows the computer's light or dark setting. Each choice is a
// small sample drawn in that theme itself (app/themes.css applies to any
// element with data-theme). The page changes at once; the layout's wordmark
// follows after a refresh from the server.

type Look = { theme: Theme; mode: Mode };

/** Shows a look at once, before the server confirms it. */
function apply(look: Look) {
  const root = document.documentElement;
  root.setAttribute('data-theme', look.theme);
  root.setAttribute('data-mode', look.mode);
}

export default function ThemePicker({ initial }: { initial: Look }) {
  const router = useRouter();
  const [look, setLook] = useState<Look>(initial);
  const [error, setError] = useState('');

  async function choose(next: Partial<Look>) {
    const before = look;
    const after = { ...look, ...next };
    setLook(after);
    setError('');
    apply(after);
    const r = await api<{ look: Look }>('/api/account/preferences', { method: 'PUT', body: JSON.stringify(next) });
    if (!r.ok) {
      setLook(before);
      apply(before);
      setError(r.body.error || 'Could not save the look.');
      return;
    }
    router.refresh();
  }

  return (
    <Section label="Look">
      {error && <p className="t-body mb-2 text-danger">{error}</p>}
      <div className="t-body mb-4 flex flex-wrap items-center gap-3">
        <span className="t-label w-28">Light or dark</span>
        <span className={SEGMENTS} role="radiogroup" aria-label="Light or dark">
          {MODES.map((m) => (
            <button key={m.key} type="button" role="radio" aria-checked={look.mode === m.key} onClick={() => choose({ mode: m.key })} className={SEGMENT(look.mode === m.key)}>
              {m.label}
            </button>
          ))}
        </span>
      </div>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {THEMES.map((t) => {
          const on = look.theme === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose({ theme: t.key })}
              data-theme={t.key}
              className={`overflow-hidden rounded-[var(--radius)] border-2 bg-parchment p-3 text-left text-ink ${on ? 'border-rust' : 'border-line hover:border-muted'}`}
              style={{ fontFamily: 'var(--font-body)' }}
            >
              <span className="t-title block">{t.label}</span>
              <span className="t-small mt-1 block text-muted">{t.blurb}</span>
              <span className="mt-3 grid grid-cols-7 gap-[3px]" aria-hidden>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <span key={i} className={`h-1.5 rounded-[1px] ${i < 2 ? 'bg-meter-done' : i === 2 ? 'bg-meter-now' : 'bg-led-off'}`} />
                ))}
              </span>
              <span className="mt-3 flex items-center justify-between gap-2">
                <span className="flex gap-1" aria-hidden>
                  {SLOTS.map((s, i) => (
                    <span key={s.hex} className="h-2 w-2 rounded-full" style={{ background: `var(--el-${i + 1})` }} />
                  ))}
                </span>
                <span className="rounded-[var(--radius)] bg-accent px-2 py-0.5 text-[11px] leading-[14px] text-on-accent">{on ? 'In use' : 'Use'}</span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 t-small text-muted">
        Element colours stay the same in every theme. The look is kept with your account, so it follows you to each computer.
      </p>
    </Section>
  );
}
