'use client';

import { useSyncExternalStore } from 'react';

import type { StudioProject } from '@/lib/studioTypes';

// The site's one player (REQUIREMENTS S-10, S-17): one audio element for the
// whole tab, held in this module, which stays loaded as the person moves from
// page to page, so a mix keeps playing while they read a manual or open
// another session. Every player on a page (Player.tsx) is a control for it,
// and the bar at the foot of the window (SitePlayer.tsx, in the root layout)
// shows what is playing, links back to its mix and opens a note at the
// moment. A full reload of the page (signing out, refreshing) stops it.
//
// Queue: the list a mix was started from (the sessions list as sorted and
// filtered, a release's running order, a session's mixes), for next,
// previous, and "continue" when one ends.

export type PlayItem = {
  /** The audio row: /api/tracks/:trackId/audio serves mixes and references alike. */
  trackId: number;
  projectId: number;
  /** The artist's code and the session's folder name, "VIG 2026 0926". */
  code: string;
  /** The session's working name; '' when it has none. */
  title: string;
  /** "v3", "Radio edit v1", or a reference's credit. */
  label: string;
  kind: 'mix' | 'reference';
  /** A mix's variant, '' for the main mix (db/015); '' for a reference. */
  variant: string;
  durationS: number | null;
};

/** The sessions list's rating, offered to the bar while that page is open. */
export type Rater = { ratingOf: (projectId: number) => number; rate: (projectId: number, n: number) => void };

type State = {
  item: PlayItem | null;
  queue: PlayItem[];
  playing: boolean;
  /** Seconds, from the file once loaded, else the length on record. */
  duration: number;
  autoAdvance: boolean;
  error: string;
  rater: Rater | null;
};

const INITIAL: State = { item: null, queue: [], playing: false, duration: 0, autoAdvance: true, error: '', rater: null };
let state: State = INITIAL;
const listeners = new Set<() => void>();
let audio: HTMLAudioElement | null = null;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** The audio element, made on first use (in the browser only). */
export function element(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = 'metadata';
  a.addEventListener('play', () => set({ playing: true, error: '' }));
  a.addEventListener('pause', () => set({ playing: false }));
  a.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(a.duration) && a.duration > 0) set({ duration: a.duration });
  });
  a.addEventListener('ended', () => {
    if (state.autoAdvance && state.queue.length > 1) step(1);
    else set({ playing: false });
  });
  a.addEventListener('error', () => {
    if (state.item) set({ playing: false, error: 'Could not play this file.' });
  });
  audio = a;
  return a;
}

function whenLoaded(a: HTMLAudioElement, then: () => void) {
  if (a.readyState >= 1) then();
  else a.addEventListener('loadedmetadata', then, { once: true });
}

function start(a: HTMLAudioElement) {
  // A newer choice interrupting this one rejects the promise; that is not an error.
  a.play().catch(() => undefined);
}

/** Play an item, from a moment if given, with the list it was chosen from as the queue. */
export function play(item: PlayItem, queue?: PlayItem[], at = 0) {
  const a = element();
  const q = queue?.some((x) => x.trackId === item.trackId) ? queue : [item];
  if (state.item?.trackId === item.trackId) {
    set({ queue: q });
    if (at > 0) whenLoaded(a, () => (a.currentTime = at));
    start(a);
    return;
  }
  set({ item, queue: q, duration: item.durationS ?? 0, error: '' });
  a.src = `/api/tracks/${item.trackId}/audio`;
  if (at > 0) whenLoaded(a, () => (a.currentTime = at));
  start(a);
}

/** Play or pause; given an item that is not the one loaded, play that instead. */
export function toggle(item?: PlayItem, queue?: PlayItem[]) {
  if (item && item.trackId !== state.item?.trackId) return play(item, queue);
  if (!state.item) return;
  const a = element();
  if (a.paused) start(a);
  else a.pause();
}

export function seek(seconds: number, andPlay = false) {
  if (!state.item) return;
  const a = element();
  whenLoaded(a, () => {
    a.currentTime = seconds;
    if (andPlay) start(a);
  });
  if (a.readyState < 1) a.load();
}

/** Next or previous in the queue, round the end. */
export function step(dir: 1 | -1) {
  const q = state.queue;
  if (!q.length) return;
  const i = q.findIndex((x) => x.trackId === state.item?.trackId);
  play(i < 0 ? q[0] : q[(i + dir + q.length) % q.length], q);
}

/** Stop and put the bar away. */
export function stop() {
  const a = element();
  a.pause();
  a.removeAttribute('src');
  a.load();
  set({ item: null, queue: [], playing: false, duration: 0, error: '' });
}

export function setAutoAdvance(on: boolean) {
  set({ autoAdvance: on });
}

export function setRater(r: Rater | null) {
  set({ rater: r });
}

export function currentTime(): number {
  return audio?.currentTime ?? 0;
}

/** The state now, for event handlers outside React's render. */
export function get(): State {
  return state;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDeck(): State {
  return useSyncExternalStore(subscribe, () => state, () => INITIAL);
}

const noop = () => () => undefined;
function subscribeTime(l: () => void) {
  const a = element();
  a.addEventListener('timeupdate', l);
  a.addEventListener('seeked', l);
  a.addEventListener('emptied', l);
  return () => {
    a.removeEventListener('timeupdate', l);
    a.removeEventListener('seeked', l);
    a.removeEventListener('emptied', l);
  };
}

/** The playing position in seconds, a few times a second; 0 and no updates when not active. */
export function useDeckTime(active = true): number {
  return useSyncExternalStore(active ? subscribeTime : noop, () => (active ? currentTime() : 0), () => 0);
}

/** A session's current mix, as the sessions list and a release play it. */
export function itemOfProject(p: StudioProject): PlayItem | null {
  if (!p.latest) return null;
  return {
    trackId: p.latest.trackId,
    projectId: p.id,
    code: `${p.artist.code} ${p.canonicalId}`,
    title: p.workingName,
    label: p.latest.label,
    kind: 'mix',
    variant: p.latest.variant,
    durationS: p.latest.durationS,
  };
}

/** The mix's place on its session page; with a moment, the note box opens there. */
export function mixHref(item: PlayItem, at?: number): string {
  const q = new URLSearchParams({ tab: 'mixes' });
  if (item.variant) q.set('variant', item.variant);
  if (item.kind === 'mix') q.set('track', String(item.trackId));
  if (at !== undefined) q.set('at', String(at));
  return `/projects/${item.projectId}?${q}`;
}
