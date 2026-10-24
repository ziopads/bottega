// Element colours (db/030): eight slots, stored as each slot's light-mode hex
// and drawn through the theme's --el-1 … --el-8, which step each slot for
// light and dark. Checked as a set for colour-blind separation; an element's
// colour is always shown with its name. A plain module for server and client.

export const SLOTS = [
  { hex: '#2a78d6', name: 'Blue' },
  { hex: '#eb6834', name: 'Orange' },
  { hex: '#1baf7a', name: 'Aqua' },
  { hex: '#eda100', name: 'Yellow' },
  { hex: '#e87ba4', name: 'Magenta' },
  { hex: '#008300', name: 'Green' },
  { hex: '#6250d6', name: 'Violet' },
  { hex: '#e34948', name: 'Red' },
] as const;

/** The slot (1–8) of a stored colour, or null for none or an unknown one. */
export function slotOf(color: string | null | undefined): number | null {
  if (!color) return null;
  const i = SLOTS.findIndex((s) => s.hex === color.toLowerCase());
  return i < 0 ? null : i + 1;
}

export function isSlotHex(color: unknown): color is string {
  return typeof color === 'string' && slotOf(color) !== null;
}

/** The CSS colour for a stored colour; an element without one takes the
 *  slot of its place among the top-level elements, so none goes uncoloured. */
export function elementColor(color: string | null | undefined, place?: number): string {
  const slot = slotOf(color) ?? (place === undefined ? null : (place % SLOTS.length) + 1);
  return slot === null ? 'var(--muted)' : `var(--el-${slot})`;
}

type ElementLike = { id: number; parentId: number | null; color: string | null };

/** The colour of a card's element: its top-level element's slot, or muted
 *  when it has none (STRUCTURE and BUS start without one) or no element. */
export function cardElementColor(elements: ElementLike[], elementId: number | null): string {
  if (elementId === null) return 'var(--muted)';
  const byId = new Map(elements.map((e) => [e.id, e]));
  let e = byId.get(elementId);
  while (e && e.parentId !== null) e = byId.get(e.parentId);
  return e ? elementColor(e.color) : 'var(--muted)';
}
