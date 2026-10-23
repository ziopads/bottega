import type { Scoped } from '@/lib/db';
import { listProjects } from '@/lib/studio';
import type { Board, BoardPlace, BoardProject, BoardStage } from '@/lib/boardTypes';

// Each person's board (REQUIREMENTS W-21 to W-23, db/024): the projects they
// put in their backlog or rotation, with where each stands. Every statement
// runs as the person; board_places shows only their own rows, and
// board_place() and board_swap() keep rotation within their limit.

const num = (v: unknown): number => Number(v);
const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

/** A refusal from db/024 a person can read. */
export class BoardError extends Error {}

const READABLE = /rotation is full|not one you can put|in the backlog or in rotation|not in your rotation/;

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? '';
    if (READABLE.test(msg)) throw new BoardError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
    throw err;
  }
}

export async function getBoard(db: Scoped, userId: string): Promise<Board> {
  const [projects, placeRows, prefRows] = await Promise.all([
    listProjects(db),
    db.q(
      `select b.project_id, b.place, pw.stage, pw.next_move, pw.blocker, pw.finished_at
         from board_places b left join project_workflow pw on pw.project_id = b.project_id
        where b.user_id = app_user()`,
    ),
    db.q('select rotation_limit, cold_days from account_preferences where user_id = app_user()'),
  ]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const places = placeRows.filter((r) => byId.has(num(r.project_id)));
  const ids = places.map((r) => num(r.project_id));

  const [stageRows, tallyRows, cardRows, touchRows] = ids.length
    ? await db.tx([
        { text: 'select project_id, key, label, position from project_stages where project_id = any($1) order by project_id, position', params: [ids] },
        {
          text: `select project_id, stage, count(*) filter (where met_at is not null) as met, count(*) as total
                   from exit_criteria where project_id = any($1) and reviewed and rejected_at is null group by 1, 2`,
          params: [ids],
        },
        {
          text: `select c.project_id, count(*) as n from cards c
                   join project_workflow pw on pw.project_id = c.project_id and pw.stage = c.stage
                  where c.project_id = any($1) and not c.settled and c.status in ('accepted', 'in progress') group by 1`,
          params: [ids],
        },
        {
          text: `select p.id, greatest(
                   (select max(logged_at) from work_log x where x.project_id = p.id),
                   (select max(updated_at) from cards x where x.project_id = p.id),
                   (select max(met_at) from exit_criteria x where x.project_id = p.id),
                   (select max(moved_at) from stage_moves x where x.project_id = p.id),
                   (select max(uploaded_at) from audio x where x.project_id = p.id),
                   (select max(saved_at) from als_snapshots x where x.project_id = p.id)) as touched
                   from unnest($1::bigint[]) as p(id)`,
          params: [ids],
        },
      ])
    : [[], [], [], []];

  const tally = new Map(tallyRows.map((r) => [`${r.project_id}:${r.stage}`, { met: num(r.met), total: num(r.total) }]));
  const stagesOf = new Map<number, BoardStage[]>();
  for (const r of stageRows) {
    const pid = num(r.project_id);
    const t = tally.get(`${pid}:${r.key}`) ?? { met: 0, total: 0 };
    stagesOf.set(pid, [...(stagesOf.get(pid) ?? []), { key: String(r.key), label: String(r.label), ...t }]);
  }
  const open = new Map(cardRows.map((r) => [num(r.project_id), num(r.n)]));
  const touched = new Map(touchRows.map((r) => [num(r.id), isoOrNull(r.touched)]));

  const label = (id: number) => {
    const p = byId.get(id)!;
    return {
      title: p.workingName || p.canonicalId,
      code: `${p.artist.code} ${p.canonicalId}`,
      ownerName: p.ownerId === userId ? null : p.ownerName,
    };
  };

  const boardProjects: BoardProject[] = places.map((r) => {
    const id = num(r.project_id);
    const p = byId.get(id)!;
    return {
      id,
      ...label(id),
      bpm: p.bpm,
      place: String(r.place) as BoardPlace,
      finishedAt: isoOrNull(r.finished_at),
      stage: r.stage === null || r.stage === undefined ? null : String(r.stage),
      stages: stagesOf.get(id) ?? [],
      nextMove: String(r.next_move ?? ''),
      blocker: String(r.blocker ?? ''),
      openCards: open.get(id) ?? 0,
      touchedAt: touched.get(id) ?? isoOrNull(p.createdAt),
    };
  });
  const onBoard = new Set(ids);
  return {
    rotationLimit: prefRows[0] ? num(prefRows[0].rotation_limit) : 4,
    coldDays: prefRows[0] ? num(prefRows[0].cold_days) : 21,
    projects: boardProjects,
    candidates: projects
      .filter((p) => !onBoard.has(p.id))
      .map((p) => ({ id: p.id, ...label(p.id) }))
      .sort((a, b) => Number(a.ownerName !== null) - Number(b.ownerName !== null) || a.title.localeCompare(b.title)),
  };
}

export async function placeOnBoard(db: Scoped, projectId: number, place: BoardPlace): Promise<void> {
  await run(() => db.q('select board_place($1, $2)', [projectId, place]));
}

export async function swapOnBoard(db: Scoped, inId: number, outId: number): Promise<void> {
  await run(() => db.q('select board_swap($1, $2)', [inId, outId]));
}

export async function takeOffBoard(db: Scoped, projectId: number): Promise<void> {
  await db.q('delete from board_places where user_id = app_user() and project_id = $1', [projectId]);
}
