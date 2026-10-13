'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// A YouTube video played in the page (REQUIREMENTS L-23), through YouTube's
// IFrame Player API so the page can read the current time ("note at 4:32")
// and jump to a moment (a note's time). Served from youtube-nocookie.com.
// The API script is loaded once per page and shared.

export interface VideoHandle {
  /** Jump to a moment, in seconds, and play. */
  seek(seconds: number): void;
  /** The current moment, in seconds, or null before the player is ready. */
  current(): number | null;
}

type YTPlayer = { seekTo(s: number, allowSeekAhead: boolean): void; playVideo(): void; getCurrentTime(): number; destroy(): void };
type YTNamespace = {
  Player: new (
    el: HTMLElement,
    opts: { videoId: string; host?: string; playerVars?: Record<string, number | string>; events?: { onReady?: () => void } },
  ) => YTPlayer;
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT as YTNamespace);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  });
  return apiPromise;
}

const VideoPlayer = forwardRef<VideoHandle, { videoId: string; start?: number | null; title: string }>(function VideoPlayer(
  { videoId, start, title },
  ref,
) {
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const ready = useRef(false);
  const pending = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      if (player.current && ready.current) {
        player.current.seekTo(seconds, true);
        player.current.playVideo();
      } else {
        pending.current = seconds;
      }
    },
    current() {
      return player.current && ready.current ? player.current.getCurrentTime() : null;
    },
  }));

  useEffect(() => {
    let cancelled = false;
    const el = document.createElement('div');
    holder.current?.appendChild(el);
    loadApi().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(el, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, start: Math.floor(start ?? 0) },
        events: {
          onReady: () => {
            ready.current = true;
            if (pending.current !== null) {
              player.current?.seekTo(pending.current, true);
              player.current?.playVideo();
              pending.current = null;
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      ready.current = false;
      player.current?.destroy();
      player.current = null;
      el.remove();
    };
    // The start moment is read once; later jumps go through seek().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  return (
    <div className="relative w-full overflow-hidden rounded border border-line bg-ink/5" style={{ aspectRatio: '16 / 9' }}>
      <div ref={holder} aria-label={title} className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />
    </div>
  );
});

export default VideoPlayer;
