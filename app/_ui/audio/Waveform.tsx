'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

// A mix's waveform (REQUIREMENTS S-10): bars from its stored loudness outline,
// the played part dark and the rest grey, a hover line showing where a click
// will land, and beneath it a mark for each note pinned to a moment (S-11):
// a small disc with the author's initials, as SoundCloud shows comments.
// Pointing at a mark (or tabbing to it) shows the note beside it, to the
// right, or to the left near the end of the mix. A file with no outline yet
// gets an even, low bar so every player looks alike.

export type Marker = { id: number; at: number; label: string; author?: string; body?: string };

const BAR = 2;
const GAP = 1;
const MARKS = 16; // height of the row of marks beneath the bars

function initials(name: string | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fit(peaks: number[] | null, bars: number): number[] {
  if (bars <= 0) return [];
  if (!peaks || !peaks.length) return Array.from({ length: bars }, () => 0.18);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i * peaks.length) / bars);
    const b = Math.max(a + 1, Math.floor(((i + 1) * peaks.length) / bars));
    let max = 0;
    for (let j = a; j < b && j < peaks.length; j++) max = Math.max(max, peaks[j]);
    out.push(Math.max(0.06, max / 255));
  }
  return out;
}

export default function Waveform({
  peaks,
  progress,
  duration,
  markers = [],
  height = 40,
  onSeek,
  onMarker,
}: {
  peaks: number[] | null;
  /** 0–1 of the way through. */
  progress: number;
  /** Seconds; markers need it to find their place. */
  duration: number | null;
  markers?: Marker[];
  height?: number;
  onSeek: (fraction: number) => void;
  onMarker?: (m: Marker) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [shown, setShown] = useState<number | null>(null);
  const clip = useId();

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bars = useMemo(() => fit(peaks, Math.floor(width / (BAR + GAP))), [peaks, width]);
  const mid = height / 2;
  const fraction = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const shape = bars.map((v, i) => {
    const h = Math.max(1, v * (height - 2));
    return <rect key={i} x={i * (BAR + GAP)} y={mid - h / 2} width={BAR} height={h} />;
  });

  return (
    <div
      ref={box}
      className="relative w-full cursor-pointer select-none"
      style={{ height: height + (markers.length ? MARKS : 0) }}
      onMouseMove={(e) => setHover(fraction(e.clientX))}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => onSeek(fraction(e.clientX))}
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + 0.02));
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - 0.02));
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block" aria-hidden>
          <defs>
            <clipPath id={clip}>
              <rect x={0} y={0} width={progress * width} height={height} />
            </clipPath>
          </defs>
          <g className="fill-ink/20">{shape}</g>
          <g className="fill-ink" clipPath={`url(#${CSS.escape(clip)})`}>
            {shape}
          </g>
          {hover !== null && <rect x={Math.round(hover * width)} y={0} width={1} height={height} className="fill-ink/40" />}
        </svg>
      )}
      {duration && markers.length > 0 && (
        <div className="absolute inset-x-0 bottom-0" style={{ height: MARKS }}>
          {markers.map((m) => {
            const left = Math.min(100, (m.at / duration) * 100);
            const open = shown === m.id;
            return (
              <div key={m.id} className={`absolute top-0 ${open ? 'z-20' : 'z-0'}`} style={{ left: `${left}%` }}>
                <button
                  type="button"
                  aria-label={`Note at ${m.label}`}
                  onMouseEnter={() => setShown(m.id)}
                  onMouseLeave={() => setShown((s) => (s === m.id ? null : s))}
                  onFocus={() => setShown(m.id)}
                  onBlur={() => setShown((s) => (s === m.id ? null : s))}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(Math.min(1, m.at / duration));
                    onMarker?.(m);
                  }}
                  className={`flex h-3.5 w-3.5 -translate-x-1/2 items-center justify-center rounded-full border border-parchment text-[7px] font-medium leading-none text-parchment ${
                    open ? 'bg-ink' : 'bg-ink/55 hover:bg-ink'
                  }`}
                >
                  {initials(m.author)}
                </button>
                {open && (
                  <div
                    role="tooltip"
                    className={`pointer-events-none absolute top-[-3px] flex max-w-[22rem] items-baseline gap-2 whitespace-nowrap rounded border border-line bg-parchment px-2 py-0.5 text-[12px] shadow-sm ${
                      left > 65 ? 'right-3' : 'left-3'
                    }`}
                  >
                    {m.author && <span className="font-medium">{m.author}</span>}
                    <span className="font-mono text-[10px] text-muted">{clock(m.at)}</span>
                    <span className="min-w-0 truncate">{m.body ?? m.label}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
