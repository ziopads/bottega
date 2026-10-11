import { NextResponse } from 'next/server';

import type { Scoped } from '@/lib/db';
import { getWorkflow, WorkflowError } from '@/lib/workflow';

// Shared by the workflow's route handlers: reading the body and the id, and
// turning a refusal from db/011 into a 400 the page shows as it stands. Every
// change answers with the whole workflow, so the tab never drifts from the
// database.

export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function answer(db: Scoped, projectId: number, change: () => Promise<unknown>) {
  try {
    await change();
  } catch (err) {
    if (err instanceof WorkflowError) return bad(err.message);
    throw err;
  }
  return NextResponse.json({ workflow: await getWorkflow(db, projectId) });
}
