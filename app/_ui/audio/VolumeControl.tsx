'use client';

import { setVolume, useVolume } from './volume';

// The app's one volume (REQUIREMENTS S-12). Any instance changes it for every
// player.

export default function VolumeControl({ className = '' }: { className?: string }) {
  const { level, muted } = useVolume();
  const shown = muted ? 0 : level;
  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => setVolume({ muted: !muted })}
        className="w-4 t-small leading-none text-muted hover:text-ink"
        aria-label={muted ? 'Unmute' : 'Mute'}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {shown === 0 ? '○' : shown < 0.5 ? '◔' : '●'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        onChange={(e) => setVolume({ level: Number(e.target.value), muted: false })}
        aria-label="Volume"
        className="h-1 w-16 accent-ink"
      />
    </span>
  );
}
