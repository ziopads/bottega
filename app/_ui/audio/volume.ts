'use client';

import { useSyncExternalStore } from 'react';

// One volume for the whole app (REQUIREMENTS S-12): set it on any player and
// every player follows, on every page, and it is still there tomorrow. Kept
// in this browser's storage; a browser that refuses storage still gets a
// volume that holds for the visit.

const KEY = 'bottega.volume';
type Volume = { level: number; muted: boolean };
const DEFAULT: Volume = { level: 0.8, muted: false };

let current: Volume = DEFAULT;
let loaded = false;
const listeners = new Set<() => void>();

function load(): Volume {
  if (loaded) return current;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Volume>;
      const level = typeof v.level === 'number' && v.level >= 0 && v.level <= 1 ? v.level : DEFAULT.level;
      current = { level, muted: v.muted === true };
    }
  } catch {
    // storage unavailable: keep the default for this visit
  }
  return current;
}

function emit() {
  listeners.forEach((l) => l());
}

export function setVolume(next: Partial<Volume>) {
  current = { ...load(), ...next };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // as above
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      loaded = false;
      load();
      emit();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useVolume(): Volume {
  return useSyncExternalStore(subscribe, load, () => DEFAULT);
}

/** Puts an <audio> element at the app's volume; call from an effect on [level, muted]. */
export function applyVolume(el: HTMLAudioElement | null, v: Volume) {
  if (!el) return;
  el.volume = v.level;
  el.muted = v.muted;
}
