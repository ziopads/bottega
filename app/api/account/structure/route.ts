import { NextResponse } from 'next/server';

import { apiAccount } from '@/lib/access';
import {
  addStructureElement,
  chooseStructure,
  copyStructure,
  deleteStructure,
  getStructureEditor,
  moveStructureElement,
  removeStructureElement,
  renameStructure,
  StructureError,
  updateStructureElement,
  type ElementPatch,
} from '@/lib/structure';
import { MATCHER_MAX, MATCHERS_MAX, parseMatchers } from '@/lib/structureTypes';
import { text } from '@/lib/workflowInput';
import { bad, readBody } from '@/lib/workflowRoutes';

export const dynamic = 'force-dynamic';

// The person's track structure, edited in Preferences (REQUIREMENTS W-25 to
// W-29; db/025). Every change answers with the whole editor. Row-level
// security keeps writes to one's own structures.

// GET /api/account/structure
export async function GET() {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  return NextResponse.json({ editor: await getStructureEditor(account.db) });
}

const idOf = (raw: unknown): number | null => (Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null);

function matchers(raw: unknown, label: string): { value: string[] } | { error: string } {
  if (typeof raw !== 'string' && !Array.isArray(raw)) return { error: `${label} must be text.` };
  const value = parseMatchers(raw as string | string[]);
  if (value.length > MATCHERS_MAX) return { error: `At most ${MATCHERS_MAX} ${label.toLowerCase()}.` };
  if (value.some((v) => v.length > MATCHER_MAX)) return { error: `Keep each of the ${label.toLowerCase()} under ${MATCHER_MAX} characters.` };
  return { value };
}

// POST /api/account/structure   { op, ... }
//   choose { templateId | null } · copy { sourceId, name } · rename { templateId, name } · delete { templateId }
//   add { templateId, parentId?, name } · element { elementId, name?, description?, color?, isZone?, prefixes?, groupNames? }
//   move { elementId, dir } · remove { elementId }
export async function POST(req: Request) {
  const account = await apiAccount();
  if (account instanceof NextResponse) return account;
  const { db } = account;
  const b = await readBody(req);
  if (!b) return bad('Invalid body');

  try {
    switch (b.op) {
      case 'choose': {
        const id = b.templateId === null ? null : idOf(b.templateId);
        if (b.templateId !== null && !id) return bad('Name a structure');
        await chooseStructure(db, id);
        break;
      }
      case 'copy': {
        const source = idOf(b.sourceId);
        const name = text(b.name, 'The name', 80);
        if (!source) return bad('Name a structure to copy');
        if ('error' in name) return bad(name.error);
        await copyStructure(db, source, name.value);
        break;
      }
      case 'rename': {
        const id = idOf(b.templateId);
        const name = text(b.name, 'The name', 80);
        if (!id) return bad('Name a structure');
        if ('error' in name) return bad(name.error);
        await renameStructure(db, id, name.value);
        break;
      }
      case 'delete': {
        const id = idOf(b.templateId);
        if (!id) return bad('Name a structure');
        await deleteStructure(db, id);
        break;
      }
      case 'add': {
        const id = idOf(b.templateId);
        const parent = b.parentId === undefined || b.parentId === null ? null : idOf(b.parentId);
        const name = text(b.name, 'The name', 80);
        if (!id) return bad('Name a structure');
        if (b.parentId !== undefined && b.parentId !== null && !parent) return bad('Name the element the part belongs to');
        if ('error' in name) return bad(name.error);
        await addStructureElement(db, id, parent, name.value);
        break;
      }
      case 'element': {
        const id = idOf(b.elementId);
        if (!id) return bad('Name an element');
        const patch: ElementPatch = {};
        if (b.name !== undefined) {
          const n = text(b.name, 'The name', 80);
          if ('error' in n) return bad(n.error);
          patch.name = n.value;
        }
        if (b.description !== undefined) {
          const d = text(b.description, 'The description', 300, false);
          if ('error' in d) return bad(d.error);
          patch.description = d.value;
        }
        if (b.color !== undefined) {
          if (b.color !== null && !(typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color))) return bad('A colour is #rrggbb');
          patch.color = b.color === null ? null : (b.color as string).toLowerCase();
        }
        if (b.isZone !== undefined) patch.isZone = b.isZone === true;
        if (b.prefixes !== undefined) {
          const m = matchers(b.prefixes, 'Prefixes');
          if ('error' in m) return bad(m.error);
          patch.prefixes = m.value;
        }
        if (b.groupNames !== undefined) {
          const m = matchers(b.groupNames, 'Group names');
          if ('error' in m) return bad(m.error);
          patch.groupNames = m.value;
        }
        await updateStructureElement(db, id, patch);
        break;
      }
      case 'move': {
        const id = idOf(b.elementId);
        if (!id || (b.dir !== -1 && b.dir !== 1)) return bad('Name an element and a direction');
        await moveStructureElement(db, id, b.dir);
        break;
      }
      case 'remove': {
        const id = idOf(b.elementId);
        if (!id) return bad('Name an element');
        await removeStructureElement(db, id);
        break;
      }
      default:
        return bad('Unknown operation');
    }
  } catch (err) {
    if (err instanceof StructureError) return bad(err.message);
    throw err;
  }
  return NextResponse.json({ editor: await getStructureEditor(db) });
}
