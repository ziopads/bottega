import type { Scoped } from '@/lib/db';
import { mixLabel } from '@/lib/studioTypes';
import type { Todo, TodoStatus } from '@/lib/todoTypes';

// To-dos (REQUIREMENTS W-35, W-36): every open, in-progress or done card in
// the projects the person can see, with each project's place on their board,
// for the To-dos page to filter. Settled decisions and Claude's waiting or
// rejected proposals are left out. Row-level security decides what is seen.

const num = (v: unknown): number => Number(v);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));

function clock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export async function listTodos(db: Scoped): Promise<Todo[]> {
  const rows = await db.q(
    `select c.id, c.project_id, c.stage, c.kind, c.what, c.done_when, c.status, c.is_next, c.created_by, c.updated_at, c.position_s,
            a.version, a.variant, e.name as element, pe.name as parent_element,
            coalesce(nullif(p.title, ''), mp.canonical_id, 'untitled') as project_title,
            coalesce(ps.label, c.stage) as stage_label, ps.position as stage_position,
            cur.label as current_label, cur.position as current_position,
            bp.place, project_rank(c.project_id) as rank
       from cards c
       join projects p on p.id = c.project_id
       left join music_projects mp on mp.project_id = p.id
       left join project_workflow pw on pw.project_id = c.project_id
       left join project_stages ps on ps.project_id = c.project_id and ps.key = c.stage
       left join project_stages cur on cur.project_id = c.project_id and cur.key = pw.stage
       left join elements e on e.id = c.element_id
       left join elements pe on pe.id = e.parent_id
       left join audio a on a.id = c.audio_id
       left join board_places bp on bp.project_id = c.project_id and bp.user_id = app_user()
      where not c.settled and c.status in ('accepted', 'in progress', 'done')
      order by c.updated_at desc, c.id desc
      limit 2000`,
  );
  const me = db.person.userId;
  return rows.map((r) => {
    const rank = num(r.rank);
    const mix = r.version === null || r.version === undefined ? '' : mixLabel(String(r.variant ?? ''), num(r.version));
    const at = mix && r.position_s !== null && r.position_s !== undefined ? ` at ${clock(num(r.position_s))}` : '';
    const sp = r.stage_position === null ? null : num(r.stage_position);
    const cp = r.current_position === null ? null : num(r.current_position);
    return {
      id: num(r.id),
      projectId: num(r.project_id),
      projectTitle: String(r.project_title),
      place: r.place === 'rotation' || r.place === 'backlog' ? r.place : null,
      stage: String(r.stage),
      stageLabel: String(r.stage_label),
      when: sp === null || cp === null || sp === cp ? 'current' : sp > cp ? 'later' : 'earlier',
      projectStageLabel: r.current_label === null ? null : String(r.current_label),
      element: r.element === null ? null : r.parent_element === null ? String(r.element) : `${String(r.parent_element)} / ${String(r.element)}`,
      kind: r.kind === null ? null : String(r.kind),
      what: String(r.what),
      doneWhen: String(r.done_when),
      status: String(r.status) as TodoStatus,
      isNext: r.is_next === true,
      moment: mix ? mix + at : null,
      canChange: rank >= 3 || (rank === 2 && String(r.created_by) === me),
      updatedAt: iso(r.updated_at),
    };
  });
}
