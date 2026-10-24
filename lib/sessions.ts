import { changed, diff } from '@/lib/als/analyse';
import type { AlsSet } from '@/lib/als/types';
import { applyZones, type ZoneRule } from '@/lib/als/zones';
import type { Scoped } from '@/lib/db';
import { changeParts, SESSION_GAP_HOURS, type WorkSession } from '@/lib/sessionTypes';

// Work sessions read from a project's saved sets (REQUIREMENTS W-40, plan of
// 25 October): saves with no gap longer than two hours between them are one
// sitting. They replace ending a session by hand: what a session did is what
// changed between the save before it and its last save, in the same variant.
// Server only: reading a set's description needs the database.

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

type Save = { id: number; savedAt: string; fileName: string; variant: string };

/**
 * The project's sessions, newest first; the newest `withChanges` carry what
 * changed (each costs reading two sets).
 */
export async function listWorkSessions(db: Scoped, projectId: number, limit = 10, withChanges = 1): Promise<WorkSession[]> {
  const rows = await db.q('select id, saved_at, file_name, variant from als_snapshots where project_id = $1 order by saved_at, id', [projectId]);
  const saves: Save[] = rows.map((r) => ({ id: Number(r.id), savedAt: iso(r.saved_at), fileName: String(r.file_name), variant: String(r.variant ?? '') }));
  if (!saves.length) return [];

  // Group into sittings, oldest first.
  const groups: Save[][] = [];
  for (const s of saves) {
    const last = groups[groups.length - 1];
    const gap = last ? Date.parse(s.savedAt) - Date.parse(last[last.length - 1].savedAt) : Infinity;
    if (last && gap <= SESSION_GAP_HOURS * 3_600_000) last.push(s);
    else groups.push([s]);
  }
  const newest = groups.slice(-limit).reverse();

  // For each session to describe: its last save, and the save before its first in the same variant.
  const pairs = newest.slice(0, withChanges).map((g) => {
    const last = g[g.length - 1];
    const firstIndex = saves.findIndex((s) => s.id === g[0].id);
    const before = saves.slice(0, firstIndex).reverse().find((s) => s.variant === last.variant) ?? null;
    return { last, before };
  });
  const ids = [...new Set(pairs.flatMap((p) => (p.before ? [p.before.id, p.last.id] : [])))];
  const [dataRows, zoneRows] = ids.length
    ? await db.tx([
        { text: 'select id, data from als_snapshots where id = any($1::bigint[])', params: [ids] },
        { text: 'select name, color, prefixes, group_names from project_zones($1)', params: [projectId] },
      ])
    : [[], []];
  const rules: ZoneRule[] = zoneRows.map((r) => ({
    name: String(r.name),
    color: r.color === null ? null : String(r.color),
    prefixes: (r.prefixes as string[]) ?? [],
    groupNames: (r.group_names as string[]) ?? [],
  }));
  const sets = new Map(dataRows.map((r) => [Number(r.id), applyZones(r.data as AlsSet, rules)]));
  const zoneNames = rules.map((r) => r.name);

  return newest.map((g, i) => {
    const last = g[g.length - 1];
    const pair = pairs[i];
    let changes: string[] | null = null;
    if (pair?.before) {
      const a = sets.get(pair.before.id);
      const b = sets.get(pair.last.id);
      if (a && b) {
        const c = diff(a, b, zoneNames);
        changes = changed(c) ? changeParts(c) : [];
      }
    }
    return {
      start: g[0].savedAt,
      end: last.savedAt,
      saves: g.length,
      variant: last.variant,
      lastFile: last.fileName,
      changes,
      first: !!pair && !pair.before,
    };
  });
}
