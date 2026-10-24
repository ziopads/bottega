import Link from 'next/link';

import type { Theme } from '@/lib/theme';

// The name in the header, set as each theme's mark (app/themes.css; the
// "Bottega themes" canvas). Sizes outside the type scale are allowed here:
// the wordmark is one of the scale's named exceptions.

export default function Wordmark({ theme }: { theme: Theme }) {
  if (theme === 'console') {
    return (
      <Link href="/" className="flex items-center gap-2.5 pb-3 font-mono text-[13px] font-medium tracking-[0.32em]">
        <span aria-hidden className="h-2 w-2 bg-accent shadow-[0_0_10px_var(--accent)]" />
        BOTTEGA
      </Link>
    );
  }
  if (theme === 'riso') {
    return (
      <Link href="/" aria-label="Bottega" className="relative mb-2.5 block h-7 w-[92px] font-[family-name:var(--font-anton)] text-[22px] leading-7 tracking-[0.04em]">
        <span aria-hidden className="riso-ink absolute left-0 top-0 text-meter-done">
          BOTTEGA
        </span>
        <span aria-hidden className="riso-ink absolute left-[2px] top-[1px] text-meter-now">
          BOTTEGA
        </span>
      </Link>
    );
  }
  if (theme === 'gallery') {
    return (
      <Link href="/" className="pb-2.5 font-serif text-[26px] italic leading-none">
        Bottega
      </Link>
    );
  }
  if (theme === 'rack') {
    return (
      <Link href="/" className="pb-2.5 font-serif text-[28px] font-extrabold uppercase leading-none tracking-[0.02em]">
        Bottega
      </Link>
    );
  }
  return (
    <Link href="/" className="pb-2.5 text-[20px] font-semibold tracking-tight">
      Bottega
    </Link>
  );
}
