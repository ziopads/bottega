// Element colours (db/030, db/031): one of Ableton Live's 70 colours, stored
// as its hex (lib/liveColors.ts), so every function that copies colours keeps
// working and a zone looks as it does in Live. Drawn as Live draws it, in
// light and dark alike; an element's colour is always shown with its name.
// A plain module for server and client.

import { LIVE_COLORS, liveColorOfHex, SUGGESTED } from '@/lib/liveColors';

export function isLiveHex(color: unknown): color is string {
  return typeof color === 'string' && liveColorOfHex(color) !== null;
}

/** The CSS colour for a stored colour; an element without one takes a
 *  suggested Live colour by its place among the zones, when a place is given. */
export function elementColor(color: string | null | undefined, place?: number): string {
  const live = liveColorOfHex(color);
  if (live) return live.hex;
  if (place === undefined) return 'var(--muted)';
  return LIVE_COLORS[SUGGESTED[place % SUGGESTED.length]].hex;
}

type ElementLike = { id: number; parentId: number | null; color: string | null };

/** The colour of a card's element: its top-level element's colour, or muted
 *  when it has none (STRUCTURE and BUS start without one) or no element. */
export function cardElementColor(elements: ElementLike[], elementId: number | null): string {
  if (elementId === null) return 'var(--muted)';
  const byId = new Map(elements.map((e) => [e.id, e]));
  let e = byId.get(elementId);
  while (e && e.parentId !== null) e = byId.get(e.parentId);
  return e ? elementColor(e.color) : 'var(--muted)';
}
