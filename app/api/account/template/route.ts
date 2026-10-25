import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import {
  addStage,
  addTemplateCriterion,
  addTemplateLearning,
  addTemplatePrinciple,
  moveTemplatePrinciple,
  removeTemplatePrinciple,
  updateTemplatePrinciple,
  chooseTemplate,
  copyTemplate,
  deleteTemplate,
  getTemplateEditor,
  moveTemplateCriterion,
  moveTemplateStage,
  removeStage,
  removeTemplateCriterion,
  removeTemplateLearning,
  renameTemplate,
  resetStage,
  setBoardSettings,
  TemplateError,
  updateStage,
  updateTemplateCriterion,
  updateTemplateLearning,
} from '@/lib/templates';
import { HINT_MAX, LEARNING_MAX, PRINCIPLE_BODY_MAX, PRINCIPLE_TITLE_MAX, STAGE_LABEL_MAX, STANDARD_MAX, TEMPLATE_NAME_MAX } from '@/lib/templateTypes';
import { parseCriterion, text } from '@/lib/workflowInput';
import { bad, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// The person's workflow template and board settings, edited in Preferences
// (REQUIREMENTS W-13 to W-15, W-22; db/024). Every change answers with the
// whole editor. Row-level security keeps writes to one's own templates.

// GET /api/account/template?edit=:templateId
export async function GET(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const edit = Number(new URL(req.url).searchParams.get('edit'));
  return NextResponse.json({ editor: await getTemplateEditor(account.db, Number.isInteger(edit) && edit > 0 ? edit : null) });
}

const idOf = (raw: unknown): number | null => (Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null);
const dirOf = (raw: unknown): -1 | 1 | null => (raw === -1 || raw === 1 ? raw : null);
const intIn = (raw: unknown, lo: number, hi: number): number | null =>
  Number.isInteger(raw) && (raw as number) >= lo && (raw as number) <= hi ? (raw as number) : null;

// POST /api/account/template   { op, ... }
//   board { rotationLimit, coldDays } · choose { templateId | null } · copy { sourceId, name }
//   rename { templateId, name } · delete { templateId }
//   add-stage { templateId, label } · stage { stageId, label?, standard? } · move-stage { stageId, dir }
//   remove-stage { stageId } · reset-stage { stageId }
//   add-criterion { stageId, body } · criterion { criterionId, body?, hint?, checkKey? }
//   move-criterion { criterionId, dir } · remove-criterion { criterionId }
//   add-learning { stageId, body } · learning { learningId, body?, accept? } · remove-learning { learningId }
//   add-principle { templateId, title, body } · principle { principleId, title?, body? } · move-principle { principleId, dir } · remove-principle { principleId }
// Every body may carry editId: the template the editor shows (db/028), else the chosen one.
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const b = await readBody(req);
  if (!b) return bad('Invalid body');

  try {
    switch (b.op) {
      case 'board': {
        const limit = intIn(b.rotationLimit, 1, 20);
        const cold = intIn(b.coldDays, 1, 365);
        if (!limit) return bad('Rotation holds between 1 and 20 projects.');
        if (!cold) return bad('Cold after between 1 and 365 days.');
        await setBoardSettings(db, limit, cold);
        break;
      }
      case 'choose': {
        const id = b.templateId === null ? null : idOf(b.templateId);
        if (b.templateId !== null && !id) return bad('Name a template');
        await chooseTemplate(db, id);
        break;
      }
      case 'copy': {
        const source = idOf(b.sourceId);
        const name = text(b.name, 'The name', TEMPLATE_NAME_MAX);
        if (!source) return bad('Name a template to copy');
        if ('error' in name) return bad(name.error);
        await copyTemplate(db, source, name.value);
        break;
      }
      case 'rename': {
        const id = idOf(b.templateId);
        const name = text(b.name, 'The name', TEMPLATE_NAME_MAX);
        if (!id) return bad('Name a template');
        if ('error' in name) return bad(name.error);
        await renameTemplate(db, id, name.value);
        break;
      }
      case 'delete': {
        const id = idOf(b.templateId);
        if (!id) return bad('Name a template');
        await deleteTemplate(db, id);
        break;
      }
      case 'add-stage': {
        const id = idOf(b.templateId);
        const label = text(b.label, 'The stage name', STAGE_LABEL_MAX);
        if (!id) return bad('Name a template');
        if ('error' in label) return bad(label.error);
        await addStage(db, id, label.value);
        break;
      }
      case 'stage': {
        const id = idOf(b.stageId);
        if (!id) return bad('Name a stage');
        const label = b.label === undefined ? undefined : text(b.label, 'The stage name', STAGE_LABEL_MAX);
        const standard = b.standard === undefined ? undefined : text(b.standard, 'The standard', STANDARD_MAX, false);
        if (label && 'error' in label) return bad(label.error);
        if (standard && 'error' in standard) return bad(standard.error);
        await updateStage(db, id, { label: label?.value, standard: standard?.value });
        break;
      }
      case 'move-stage': {
        const id = idOf(b.stageId);
        const dir = dirOf(b.dir);
        if (!id || !dir) return bad('Name a stage and a direction');
        await moveTemplateStage(db, id, dir);
        break;
      }
      case 'remove-stage': {
        const id = idOf(b.stageId);
        if (!id) return bad('Name a stage');
        await removeStage(db, id);
        break;
      }
      case 'reset-stage': {
        const id = idOf(b.stageId);
        if (!id) return bad('Name a stage');
        await resetStage(db, id);
        break;
      }
      case 'add-criterion': {
        const id = idOf(b.stageId);
        const body = parseCriterion(b.body);
        if (!id) return bad('Name a stage');
        if ('error' in body) return bad(body.error);
        await addTemplateCriterion(db, id, body.value);
        break;
      }
      case 'criterion': {
        const id = idOf(b.criterionId);
        if (!id) return bad('Name a criterion');
        const body = b.body === undefined ? undefined : parseCriterion(b.body);
        const hint = b.hint === undefined ? undefined : typeof b.hint === 'string' && b.hint.length <= HINT_MAX ? b.hint.replace(/\s+$/, '') : null;
        const check = b.checkKey === undefined ? undefined : b.checkKey === null || b.checkKey === '' ? null : typeof b.checkKey === 'string' ? b.checkKey : false;
        if (body && 'error' in body) return bad(body.error);
        if (hint === null) return bad(`Keep the hint under ${HINT_MAX} characters.`);
        if (check === false) return bad('Choose a check from the list');
        await updateTemplateCriterion(db, id, { body: body?.value, hint, checkKey: check });
        break;
      }
      case 'move-criterion': {
        const id = idOf(b.criterionId);
        const dir = dirOf(b.dir);
        if (!id || !dir) return bad('Name a criterion and a direction');
        await moveTemplateCriterion(db, id, dir);
        break;
      }
      case 'remove-criterion': {
        const id = idOf(b.criterionId);
        if (!id) return bad('Name a criterion');
        await removeTemplateCriterion(db, id);
        break;
      }
      case 'add-learning': {
        const id = idOf(b.stageId);
        const body = text(b.body, 'The learning', LEARNING_MAX);
        if (!id) return bad('Name a stage');
        if ('error' in body) return bad(body.error);
        await addTemplateLearning(db, id, body.value);
        break;
      }
      case 'learning': {
        const id = idOf(b.learningId);
        if (!id) return bad('Name a learning');
        const body = b.body === undefined ? undefined : text(b.body, 'The learning', LEARNING_MAX);
        if (body && 'error' in body) return bad(body.error);
        await updateTemplateLearning(db, id, { body: body?.value, reviewed: b.accept === true ? true : undefined });
        break;
      }
      case 'add-principle': {
        const id = idOf(b.templateId);
        const title = text(b.title, 'The principle', PRINCIPLE_TITLE_MAX);
        const body = text(b.body, 'The explanation', PRINCIPLE_BODY_MAX, false);
        if (!id) return bad('Name a template');
        if ('error' in title) return bad(title.error);
        if ('error' in body) return bad(body.error);
        await addTemplatePrinciple(db, id, title.value, body.value);
        break;
      }
      case 'principle': {
        const id = idOf(b.principleId);
        if (!id) return bad('Name a principle');
        const title = b.title === undefined ? undefined : text(b.title, 'The principle', PRINCIPLE_TITLE_MAX);
        const body = b.body === undefined ? undefined : text(b.body, 'The explanation', PRINCIPLE_BODY_MAX, false);
        if (title && 'error' in title) return bad(title.error);
        if (body && 'error' in body) return bad(body.error);
        await updateTemplatePrinciple(db, id, { title: title?.value, body: body?.value });
        break;
      }
      case 'move-principle': {
        const id = idOf(b.principleId);
        const dir = dirOf(b.dir);
        if (!id || !dir) return bad('Name a principle and a direction');
        await moveTemplatePrinciple(db, id, dir);
        break;
      }
      case 'remove-principle': {
        const id = idOf(b.principleId);
        if (!id) return bad('Name a principle');
        await removeTemplatePrinciple(db, id);
        break;
      }
      case 'remove-learning': {
        const id = idOf(b.learningId);
        if (!id) return bad('Name a learning');
        await removeTemplateLearning(db, id);
        break;
      }
      default:
        return bad('Unknown operation');
    }
  } catch (err) {
    if (err instanceof TemplateError) return bad(err.message);
    if (/violates foreign key constraint .*check_key/.test((err as { message?: string })?.message ?? '')) return bad('Choose a check from the list');
    throw err;
  }
  // A deleted or copied template: the editor falls back to the chosen one.
  const editId = b.op === 'delete' || b.op === 'copy' || b.op === 'choose' ? null : idOf(b.editId);
  return NextResponse.json({ editor: await getTemplateEditor(db, editId) });
}
