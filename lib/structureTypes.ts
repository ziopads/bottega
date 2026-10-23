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

export type StructureSummary = { id: number; name: string; isDefault: boolean };

export type StructureEditor = {
  chosen: StructureSummary;
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
