// list_projects: the sessions the person can see, their own first, each with
// where it stands (db/011) and its current mix. The ids go to get_session.

import type { Scoped } from '@/lib/db';
import { listProjects } from '@/lib/studio';
import { formatDuration } from '@/lib/studioTypes';

export async function listProjectsTool(db: Scoped, args: { query?: string }) {
  const [projects, stages] = await Promise.all([
    listProjects(db),
    db.q(`select w.project_id, s.label from project_workflow w join workflow_stages s on s.kind = w.kind and s.key = w.stage`),
  ]);
  const stageOf = new Map(stages.map((r) => [Number(r.project_id), String(r.label)]));
  const q = (args.query ?? '').trim().toLowerCase();
  const me = db.person.userId;
  const list = projects
    .filter((p) => !q || `${p.canonicalId} ${p.workingName} ${p.artist.code} ${p.artist.name} ${p.genre}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.ownerId === me) - Number(a.ownerId === me));
  return {
    count: list.length,
    sessions: list.map((p) => ({
      id: p.id,
      canonical_id: p.canonicalId,
      working_name: p.workingName || null,
      artist: `${p.artist.code} · ${p.artist.name}`,
      genre: p.genre || null,
      bpm: p.bpm,
      rating: p.rating || null,
      stage: stageOf.get(p.id) ?? null,
      current_mix: p.latest ? { version: p.latest.version, length: formatDuration(p.latest.durationS) || null, of: p.latest.count } : null,
      owner: p.ownerId === me ? 'you' : p.ownerName,
      your_access: p.level,
    })),
  };
}
