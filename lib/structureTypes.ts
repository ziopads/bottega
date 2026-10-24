// The track structure editor's shapes (REQUIREMENTS W-25 to W-29; db/025),
// shared by server and client. No imports.

export type StructurePart = { id: number; uid: string; position: number; name: string; description: string };

export type StructureElement = {
  id: number;
  uid: string;
  position: number;
  name: string;
  description: string;
  /** '#rrggbb', or null for none. */
  color: string | null;
  /** Tracks are sorted into it (by prefix, its name, or a group name). */
  isZone: boolean;
  prefixes: string[];
  groupNames: string[];
  parts: StructurePart[];
  /** Whether the default has this element (by uid) and how this one differs from it. */
  difference: 'same' | 'changed' | 'added';
};

export type StructureSummary = {
  id: number;
  name: string;
  isDefault: boolean;
  /** One's own: renamed and deleted only by its owner. */
  mine: boolean;
  /** One's own, or one used by an artist shared with one to edit (db/028). */
  canEdit: boolean;
  ownerName: string | null;
};

export type StructureEditor = {
  /** The structure new projects take when their artist names none. */
  chosen: StructureSummary;
  /** The structure shown for editing: the chosen one unless another is picked. */
  editing: StructureSummary;
  /** The default, one's own, and those shared through artists. */
  templates: StructureSummary[];
  elements: StructureElement[];
};

export const MATCHER_MAX = 40;
export const MATCHERS_MAX = 20;

/** "TAC, drm ,TAC" → ["TAC", "drm"]: trimmed, no empties, no two alike whatever the case. */
export function parseMatchers(raw: string | string[]): string[] {
  const list = Array.isArray(raw) ? raw : raw.split(',');
  const out: string[] = [];
  for (const x of list) {
    const v = String(x).trim();
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}
