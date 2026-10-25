import type { Scoped, Statement } from '@/lib/db';
import { accountNames, nameOf } from '@/lib/names';
import type { CheckOption, EditorCriterion, EditorLearning, EditorStage, Principle, TemplateEditor, TemplateSummary } from '@/lib/templateTypes';

// Workflow templates in Preferences (REQUIREMENTS W-13 to W-15, W-22;
// db/024). One's own templates are edited directly; the platform default is
// read-only and copied with template_copy() before editing. Row-level
// security keeps every write to one's own templates.

type Row = Record<string, unknown>;
const num = (v: unknown): number => Number(v);

/** A refusal a person can read. */
export class TemplateError extends Error {}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const e = err as { message?: string; code?: string };
    const msg = e?.message ?? '';
    if (e?.code === '23505') throw new TemplateError('You already have a template with that name.');
    if (/not one you can copy|must be a music template|needs an active account/.test(msg)) throw new TemplateError(msg.charAt(0).toUpperCase() + msg.slice(1) + '.');
    if (/row-level security|permission denied/.test(msg)) throw new TemplateError('Only templates you can edit can be changed. Make a copy first.');
    if (/violates check constraint/.test(msg)) throw new TemplateError('That is too long or empty.');
    throw err;
  }
}

/** The editor for the chosen template, or for editId when it is one the person can read. */
export async function getTemplateEditor(db: Scoped, editId: number | null = null): Promise<TemplateEditor> {
  const [prefRows, templateRows, checkRows] = await db.tx([
    { text: 'select music_template_id, rotation_limit, cold_days from account_preferences where user_id = app_user()', params: [] },
    {
      // Row-level security (db/028) shows the default, one's own, and those used by artists shared with one.
      text: `select id, name, owner_id, owner_id is null as is_default, coalesce(owner_id = app_user(), false) as mine,
                    template_can_edit(id) as can_edit
               from workflow_templates where kind = 'music'
              order by owner_id is not null, coalesce(owner_id = app_user(), false) desc, lower(name)`,
      params: [],
    },
    { text: 'select key, label, description from workflow_checks order by label', params: [] },
  ]);
  const owners = await accountNames(db, templateRows.map((r) => (r.owner_id === null ? null : String(r.owner_id))));
  const templates: TemplateSummary[] = templateRows.map((r) => ({
    id: num(r.id),
    name: String(r.name),
    isDefault: r.is_default === true,
    mine: r.mine === true,
    canEdit: r.can_edit === true,
    ownerName: r.owner_id === null || r.mine === true ? null : nameOf(owners, String(r.owner_id)),
  }));
  const def = templates.find((t) => t.isDefault)!;
  const chosenId = prefRows[0]?.music_template_id ? num(prefRows[0].music_template_id) : def.id;
  const chosen = templates.find((t) => t.id === chosenId) ?? def;
  const editing = templates.find((t) => t.id === editId) ?? chosen;

  const [stageRows, criteriaRows, defaultRows, learningRows, principleRows] = await db.tx([
    { text: 'select id, key, position, label, standard from template_stages where template_id = $1 order by position', params: [editing.id] },
    {
      text: `select c.id, c.stage_id, c.uid, c.position, c.body, c.hint, c.check_key from template_criteria c
               join template_stages s on s.id = c.stage_id where s.template_id = $1 order by c.position, c.id`,
      params: [editing.id],
    },
    {
      text: `select s.key, c.uid, c.body, c.hint, c.check_key from template_stages s
               left join template_criteria c on c.stage_id = s.id where s.template_id = $1`,
      params: [def.id],
    },
    {
      text: `select l.id, l.stage_id, l.body, l.reviewed, l.source, l.created_by from template_learnings l
               join template_stages s on s.id = l.stage_id where s.template_id = $1 order by l.position, l.id`,
      params: [editing.id],
    },
    { text: 'select id, title, body from template_principles where template_id = $1 order by position, id', params: [editing.id] },
  ]);
  const learners = await accountNames(db, learningRows.map((r) => String(r.created_by)));
  const defaultByUid = new Map(defaultRows.filter((r) => r.uid !== null).map((r) => [String(r.uid), r]));
  const defaultKeys = new Set(defaultRows.map((r) => String(r.key)));
  const uids = new Set(criteriaRows.map((r) => String(r.uid)));

  const stages: EditorStage[] = stageRows.map((s) => {
    const criteria: EditorCriterion[] = criteriaRows
      .filter((c) => num(c.stage_id) === num(s.id))
      .map((c) => {
        const d = defaultByUid.get(String(c.uid));
        const difference = editing.isDefault
          ? 'same'
          : !d
            ? 'added'
            : d.body !== c.body || String(d.hint ?? '') !== String(c.hint ?? '') || (d.check_key ?? null) !== (c.check_key ?? null)
              ? 'changed'
              : 'same';
        return {
          id: num(c.id),
          uid: String(c.uid),
          position: num(c.position),
          body: String(c.body),
          hint: String(c.hint ?? ''),
          checkKey: c.check_key === null ? null : String(c.check_key),
          difference,
        };
      });
    const missing = editing.isDefault
      ? []
      : defaultRows.filter((d: Row) => d.uid !== null && String(d.key) === String(s.key) && !uids.has(String(d.uid))).map((d) => ({ body: String(d.body) }));
    return {
      id: num(s.id),
      key: String(s.key),
      position: num(s.position),
      label: String(s.label),
      standard: String(s.standard ?? ''),
      criteria,
      missingFromDefault: missing,
      inDefault: defaultKeys.has(String(s.key)),
      learnings: learningRows
        .filter((l) => num(l.stage_id) === num(s.id))
        .map(
          (l): EditorLearning => ({
            id: num(l.id),
            body: String(l.body),
            reviewed: l.reviewed === true,
            source: String(l.source ?? ''),
            createdByName: nameOf(learners, String(l.created_by)),
          }),
        ),
    };
  });
  const checks: CheckOption[] = checkRows.map((r) => ({ key: String(r.key), label: String(r.label), description: String(r.description) }));
  return {
    chosen,
    editing,
    templates,
    stages,
    principles: principleRows.map((r): Principle => ({ id: num(r.id), title: String(r.title), body: String(r.body) })),
    checks,
    rotationLimit: prefRows[0] ? num(prefRows[0].rotation_limit) : 4,
    coldDays: prefRows[0] ? num(prefRows[0].cold_days) : 21,
  };
}

// ── Board settings and the template one uses ───────────────────────────────

export async function setBoardSettings(db: Scoped, rotationLimit: number, coldDays: number): Promise<void> {
  await run(() =>
    db.q(
      `insert into account_preferences (rotation_limit, cold_days) values ($1, $2)
       on conflict (user_id) do update set rotation_limit = excluded.rotation_limit, cold_days = excluded.cold_days`,
      [rotationLimit, coldDays],
    ),
  );
}

/** Chooses the template new music projects start from; null means the default. */
export async function chooseTemplate(db: Scoped, templateId: number | null): Promise<void> {
  await run(() =>
    db.q(
      `insert into account_preferences (music_template_id) values ($1)
       on conflict (user_id) do update set music_template_id = excluded.music_template_id`,
      [templateId],
    ),
  );
}

/** Copies a template into one's account and uses the copy. */
export async function copyTemplate(db: Scoped, sourceId: number, name: string): Promise<void> {
  await run(async () => {
    const rows = await db.q('select template_copy($1, $2) as id', [sourceId, name]);
    await db.q(
      `insert into account_preferences (music_template_id) values ($1)
       on conflict (user_id) do update set music_template_id = excluded.music_template_id`,
      [num(rows[0].id)],
    );
  });
}

export async function renameTemplate(db: Scoped, id: number, name: string): Promise<void> {
  await run(() => db.q('update workflow_templates set name = $2 where id = $1', [id, name]));
}

/** Deletes one's own template; new projects then start from the default. Projects already started keep their copies. */
export async function deleteTemplate(db: Scoped, id: number): Promise<void> {
  await run(() => db.q('delete from workflow_templates where id = $1 and owner_id = app_user()', [id]));
}

// ── Stages ─────────────────────────────────────────────────────────────────

/** A stage key from its label: lower-case letters only, unique in the template. */
function keyFor(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z]/g, '').slice(0, 30) || 'stage';
  if (!taken.has(base)) return base;
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  for (const a of letters) for (const b of letters) if (!taken.has(base + a + b)) return base + a + b;
  throw new TemplateError('Choose another name for the stage.');
}

export async function addStage(db: Scoped, templateId: number, label: string): Promise<void> {
  await run(async () => {
    const rows = await db.q('select key, position from template_stages where template_id = $1', [templateId]);
    const key = keyFor(label, new Set(rows.map((r) => String(r.key))));
    const position = rows.reduce((m, r) => Math.max(m, num(r.position)), 0) + 1;
    await db.q('insert into template_stages (template_id, key, position, label) values ($1, $2, $3, $4)', [templateId, key, position, label]);
  });
}

export async function updateStage(db: Scoped, stageId: number, patch: { label?: string; standard?: string }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [stageId];
  if (patch.label !== undefined) {
    params.push(patch.label);
    sets.push(`label = $${params.length}`);
  }
  if (patch.standard !== undefined) {
    params.push(patch.standard);
    sets.push(`standard = $${params.length}`);
  }
  if (!sets.length) return;
  await run(() => db.q(`update template_stages set ${sets.join(', ')} where id = $1`, params));
}

/** Swaps a stage with its neighbour, earlier (-1) or later (+1). */
export async function moveTemplateStage(db: Scoped, stageId: number, dir: -1 | 1): Promise<void> {
  await run(async () => {
    const rows = await db.q(
      `select s.id, s.position from template_stages s
         where s.template_id = (select template_id from template_stages where id = $1) order by s.position`,
      [stageId],
    );
    const i = rows.findIndex((r) => num(r.id) === stageId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    await db.tx([
      { text: 'update template_stages set position = $2 where id = $1', params: [stageId, num(rows[j].position)] },
      { text: 'update template_stages set position = $2 where id = $1', params: [num(rows[j].id), num(rows[i].position)] },
    ]);
  });
}

/** Removes a stage and its criteria, and closes the gap in positions. A template keeps at least one stage. */
export async function removeStage(db: Scoped, stageId: number): Promise<void> {
  await run(async () => {
    const rows = await db.q(
      `select id from template_stages where template_id = (select template_id from template_stages where id = $1) order by position`,
      [stageId],
    );
    if (rows.length <= 1) throw new TemplateError('A template keeps at least one stage.');
    const rest = rows.filter((r) => num(r.id) !== stageId);
    await db.tx([
      { text: 'delete from template_stages where id = $1', params: [stageId] },
      ...rest.map((r, i) => ({ text: 'update template_stages set position = $2 where id = $1 and position <> $2', params: [num(r.id), i + 1] })),
    ]);
  });
}

/** Puts a stage back as the default has it: label, standard and criteria. */
export async function resetStage(db: Scoped, stageId: number): Promise<void> {
  await run(async () => {
    const rows = await db.q(
      `select d.id as default_stage, d.label, d.standard from template_stages s
         join template_stages d on d.key = s.key
         join workflow_templates t on t.id = d.template_id and t.owner_id is null and t.kind = 'music'
        where s.id = $1`,
      [stageId],
    );
    if (!rows.length) throw new TemplateError('The default has no such stage.');
    const r = rows[0];
    const statements: Statement[] = [
      { text: 'delete from template_criteria where stage_id = $1', params: [stageId] },
      {
        text: `insert into template_criteria (stage_id, uid, position, body, hint, check_key)
               select $1, uid, position, body, hint, check_key from template_criteria where stage_id = $2`,
        params: [stageId, num(r.default_stage)],
      },
      { text: 'update template_stages set label = $2, standard = $3 where id = $1', params: [stageId, String(r.label), String(r.standard)] },
    ];
    await db.tx(statements);
  });
}

// ── Criteria ───────────────────────────────────────────────────────────────

export async function addTemplateCriterion(db: Scoped, stageId: number, body: string): Promise<void> {
  await run(() =>
    db.q(
      `insert into template_criteria (stage_id, position, body)
       values ($1, (select coalesce(max(position), 0) + 1 from template_criteria where stage_id = $1), $2)`,
      [stageId, body],
    ),
  );
}

export async function updateTemplateCriterion(
  db: Scoped,
  id: number,
  patch: { body?: string; hint?: string; checkKey?: string | null },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, col] of [
    ['body', 'body'],
    ['hint', 'hint'],
    ['checkKey', 'check_key'],
  ] as const) {
    if (patch[k] === undefined) continue;
    params.push(patch[k]);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return;
  await run(() => db.q(`update template_criteria set ${sets.join(', ')} where id = $1`, params));
}

/** Swaps a criterion with its neighbour in the stage, renumbering the stage from 1. */
export async function moveTemplateCriterion(db: Scoped, id: number, dir: -1 | 1): Promise<void> {
  await run(async () => {
    const rows = await db.q(
      `select id from template_criteria where stage_id = (select stage_id from template_criteria where id = $1) order by position, id`,
      [id],
    );
    const ids = rows.map((r) => num(r.id));
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await db.tx(ids.map((cid, k) => ({ text: 'update template_criteria set position = $2 where id = $1 and position <> $2', params: [cid, k + 1] })));
  });
}

export async function removeTemplateCriterion(db: Scoped, id: number): Promise<void> {
  await run(() => db.q('delete from template_criteria where id = $1', [id]));
}

// ── The method (W-42, db/032) ───────────────────────────────────────────────
// Through template_principles' policies: only templates the person can edit.

export async function addTemplatePrinciple(db: Scoped, templateId: number, title: string, body: string): Promise<void> {
  await run(() =>
    db.q(
      `insert into template_principles (template_id, position, title, body)
       values ($1, (select coalesce(max(position), 0) + 1 from template_principles where template_id = $1), $2, $3)`,
      [templateId, title, body],
    ),
  );
}

export async function updateTemplatePrinciple(db: Scoped, id: number, patch: { title?: string; body?: string }): Promise<void> {
  if (patch.title !== undefined) await run(() => db.q('update template_principles set title = $2 where id = $1', [id, patch.title]));
  if (patch.body !== undefined) await run(() => db.q('update template_principles set body = $2 where id = $1', [id, patch.body]));
}

export async function moveTemplatePrinciple(db: Scoped, id: number, dir: -1 | 1): Promise<void> {
  await run(async () => {
    const rows = await db.q(
      'select id from template_principles where template_id = (select template_id from template_principles where id = $1) order by position, id',
      [id],
    );
    const ids = rows.map((r) => num(r.id));
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await db.tx(ids.map((pid, k) => ({ text: 'update template_principles set position = $2 where id = $1 and position <> $2', params: [pid, k + 1] })));
  });
}

export async function removeTemplatePrinciple(db: Scoped, id: number): Promise<void> {
  await run(() => db.q('delete from template_principles where id = $1', [id]));
}

/** The method of the template the person's new projects start from: the board shows it. */
export async function getAccountMethod(db: Scoped): Promise<Principle[]> {
  const rows = await db.q(
    `select p.id, p.title, p.body from template_principles p
      where p.template_id = coalesce((select music_template_id from account_preferences where user_id = app_user()),
                                     (select id from workflow_templates where owner_id is null and kind = 'music' order by id limit 1))
      order by p.position, p.id`,
  );
  return rows.map((r) => ({ id: num(r.id), title: String(r.title), body: String(r.body) }));
}

// ── Learnings (W-33, db/028) ───────────────────────────────────────────────
// Through template_learnings' policies: only templates the person can edit.

export async function addTemplateLearning(db: Scoped, stageId: number, body: string): Promise<void> {
  await run(() =>
    db.q(
      `insert into template_learnings (stage_id, position, body)
       values ($1, (select coalesce(max(position), 0) + 1 from template_learnings where stage_id = $1), $2)`,
      [stageId, body],
    ),
  );
}

export async function updateTemplateLearning(db: Scoped, id: number, patch: { body?: string; reviewed?: true }): Promise<void> {
  if (patch.body !== undefined) await run(() => db.q('update template_learnings set body = $2 where id = $1', [id, patch.body]));
  if (patch.reviewed) await run(() => db.q('update template_learnings set reviewed = true where id = $1', [id]));
}

export async function removeTemplateLearning(db: Scoped, id: number): Promise<void> {
  await run(() => db.q('delete from template_learnings where id = $1', [id]));
}
