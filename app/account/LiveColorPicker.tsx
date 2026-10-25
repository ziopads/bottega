'use client';

import { describeLive, LIVE_COLORS, liveColorOfHex, SUGGESTED, type LiveColor } from '@/lib/liveColors';

// An element's colour, picked from Ableton Live's palette as Live lays it out
// (14 columns, 5 rows), so a zone in Bottega matches the track colour in the
// Live template (db/031). The suggested eight come first: in that order they
// stay apart for colour-blind readers.

export default function LiveColorPicker({
  value,
  disabled,
  labelledBy,
  onPick,
}: {
  value: string | null;
  disabled: boolean;
  labelledBy: string;
  onPick: (hex: string) => void;
}) {
  const current = liveColorOfHex(value);

  const swatch = (c: LiveColor, big: boolean) => {
    const on = current?.index === c.index;
    return (
      <button
        key={`${big ? 's' : 'g'}${c.index}`}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={describeLive(c)}
        title={describeLive(c)}
        disabled={disabled}
        onClick={() => onPick(c.hex)}
        className={`${big ? 'h-6 w-6' : 'h-5 w-full'} rounded-[2px] outline-offset-1 ${on ? 'outline outline-2 outline-ink' : 'hover:outline hover:outline-1 hover:outline-muted'}`}
        style={{ background: c.hex }}
      />
    );
  };

  return (
    <div className="space-y-2" role="radiogroup" aria-labelledby={labelledBy}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="t-small text-muted">Suggested</span>
        {SUGGESTED.map((i) => swatch(LIVE_COLORS[i], true))}
      </div>
      <div className="grid max-w-[22rem] grid-cols-[repeat(14,minmax(0,1fr))] gap-[3px]">{LIVE_COLORS.map((c) => swatch(c, false))}</div>
      <p className="t-small text-muted">Live&rsquo;s palette, laid out as in Live. Colour your template&rsquo;s tracks the same and the two match.</p>
    </div>
  );
}
