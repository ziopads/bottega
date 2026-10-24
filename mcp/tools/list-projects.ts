// list_projects: the projects the person can see, their own first, each with
// where it stands (db/011, db/024), its place on the person's board, its next
// to-do (db/029) and its current mix. The ids go to get_session.

import type { Scoped } from '@/lib/db';
import { listProjects } from '@/lib/studio';
import { formatDuration } from '@/lib/studioTypes';

export async function listProjectsTool(db: Scoped, args: { query?: string }) {
  const [projects, stages, places] = await Promise.all([
    listProjects(db),
    db.q(
      `select w.project_id, s.label, w.finished_at, (select c.what from cards c where c.project_id = w.project_id and c.is_next) as next_todo
         from project_workflow w join project_stages s on s.project_id = w.project_id and s.key = w.stage`,
    ),
    db.q('select project_id, place from board_places where user_id = app_user()'),
  ]);
  const stageOf = new Map(stages.map((r) => [Number(r.project_id), r]));
  const placeOf = new Map(places.map((r) => [Number(r.project_id), String(r.place)]));
  const boardPlace = (id: number): string | null => {
    const place = placeOf.get(id);
    if (!place) return null;
    return stageOf.get(id)?.finished_at ? 'finished' : place;
  };
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
      stage: stageOf.has(p.id) ? String(stageOf.get(p.id)!.label) : null,
      board: boardPlace(p.id),
      next: stageOf.get(p.id)?.next_todo ? String(stageOf.get(p.id)!.next_todo) : null,
      current_mix: p.latest ? { mix: p.latest.label, length: formatDuration(p.latest.durationS) || null, of: p.latest.count } : null,
      owner: p.ownerId === me ? 'you' : p.ownerName,
      your_access: p.level,
    })),
  };
}
