'use client';

import { useEffect, useImperativeHandle, useRef } from 'react';

import { formatDuration } from '@/lib/studioTypes';

import { currentTime, play, seek as deckSeek, toggle, useDeck, useDeckTime, type PlayItem } from './deck';
import Waveform, { type Marker } from './Waveform';

// A mix or reference on its page (REQUIREMENTS S-10): one slim row, a play
// button, the time, the waveform to scrub, and the length. It holds no audio
// of its own: it plays the item in the site's one player (deck.ts, S-17),
// whose bar stays at the foot of the window as the person moves on, and it
// shows that player's progress while the item is the one loaded.

export type PlayerHandle = {
  /** Play from a moment: the item is loaded first if another is playing. */
  seek: (seconds: number, play?: boolean) => void;
  /** Where the site's player is in this item; 0 when another is loaded. */
  currentTime: () => number;
  playing: () => boolean;
};

export default function Player({
  item,
  queue,
  peaks,
  durationS,
  markers,
  height = 40,
  ref,
  onDuration,
  onMarker,
}: {
  item: PlayItem;
  /** The list it sits in, for next and previous in the bar. */
  queue?: PlayItem[];
  peaks: number[] | null;
  durationS: number | null;
  markers?: Marker[];
  height?: number;
  ref?: React.Ref<PlayerHandle>;
  /** The length, once the file reports it (for files with none on record). */
  onDuration?: (seconds: number) => void;
  onMarker?: (m: Marker) => void;
}) {
  const deck = useDeck();
  const mine = deck.item?.trackId === item.trackId;
  const time = useDeckTime(mine);
  const duration = (mine && deck.duration) || durationS || 0;
  const playing = mine && deck.playing;

  // A file with no length on record reports it once loaded: pass it on once.
  const reported = useRef(false);
  useEffect(() => {
    if (!mine || durationS !== null || !deck.duration || reported.current) return;
    reported.current = true;
    onDuration?.(deck.duration);
  }, [mine, durationS, deck.duration, onDuration]);

  function seek(seconds: number, andPlay = false) {
    if (mine) deckSeek(seconds, andPlay);
    else if (andPlay) play(item, queue, seconds);
  }

  useImperativeHandle(ref, () => ({
    seek,
    currentTime: () => (mine ? currentTime() : 0),
    playing: () => playing,
  }));

  const progress = duration ? Math.min(1, time / duration) : 0;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => toggle(item, queue)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink t-small text-parchment hover:bg-ink/80"
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="t-num w-10 shrink-0 text-right t-small text-muted">{formatDuration(time) || '0:00'}</span>
      <div className="min-w-0 flex-1">
        <Waveform
          peaks={peaks}
          progress={progress}
          duration={duration || null}
          markers={markers}
          height={height}
          onSeek={(f) => (duration ? seek(f * duration, true) : toggle(item, queue))}
          onMarker={onMarker}
        />
      </div>
      <span className="t-num w-10 shrink-0 t-small text-muted">{formatDuration(duration || null) || '—'}</span>
    </div>
  );
}
