import type { SetChange } from '@/lib/als/analyse';

// Work sessions read from saved sets (REQUIREMENTS W-40, plan of 25 October):
// a run of saves with no gap longer than SESSION_GAP_HOURS is one session.
// Shared by server and client; type imports only.

export const SESSION_GAP_HOURS = 2;

export type WorkSession = {
  start: string;
  end: string;
  saves: number;
  /** The variant of its last save: '' is the main mix. */
  variant: string;
  /** Its last save's file name. */
  lastFile: string;
  /** What changed from the save before the session to its last, as short phrases; null when not read or nothing changed. */
  changes: string[] | null;
  /** The session holds the first save read, so there is nothing before it to compare with. */
  first: boolean;
};

/** What changed, as short phrases (the State tab and session summaries). */
export function changeParts(c: SetChange): string[] {
  const parts: string[] = [];
  if (c.tracksAdded.length) parts.push(`+${c.tracksAdded.length} ${c.tracksAdded.length === 1 ? 'track' : 'tracks'} (${c.tracksAdded.join(', ')})`);
  if (c.tracksRemoved.length) parts.push(`−${c.tracksRemoved.length} (${c.tracksRemoved.join(', ')})`);
  for (const r of c.tracksRenamed) parts.push(`${r.from} → ${r.to}`);
  if (c.pluginsAdded.length) parts.push(`added ${c.pluginsAdded.join(', ')}`);
  if (c.pluginsRemoved.length) parts.push(`removed ${c.pluginsRemoved.join(', ')}`);
  if (c.clips) parts.push(`${c.clips > 0 ? '+' : ''}${c.clips} clips`);
  if (Math.abs(c.lengthBeats) >= 4) parts.push(`length ${c.lengthBeats > 0 ? '+' : '−'}${Math.round(Math.abs(c.lengthBeats) / 4)} bars`);
  if (c.tempo) parts.push(`tempo ${c.tempo.from ?? '?'} → ${c.tempo.to ?? '?'}`);
  for (const z of c.zones) parts.push(`${z.zone ?? 'no zone'} ${Math.round(z.from / 4)} → ${Math.round(z.to / 4)} bars`);
  if (c.samplesExternal) parts.push(`${c.samplesExternal > 0 ? '+' : ''}${c.samplesExternal} samples outside the folder`);
  return parts;
}
