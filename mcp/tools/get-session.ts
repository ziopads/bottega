// get_session: everything needed to say where a project stands and what to
// do next (REQUIREMENTS W-10, the "where was I?" scenario): its details, the
// next move, blocker and latest ended sessions (W-19, W-20), its own stages
// with how far each has come, the current stage's exit criteria with hints and
// likely-done marks (W-18), template changes on offer (W-17), open cards by
// element, cards parked for later stages, settled decisions, Claude's pending
// proposals, the latest notes with their moments, and the mixes and
// references.

import type { Scoped } from '@/lib/db';
import { getProject, listNotes, listReferences, listTracks } from '@/lib/studio';
import { formatDuration } from '@/lib/studioTypes';
import { getWorkflow } from '@/lib/workflow';
import { stagePosition, type WorkflowCard } from '@/lib/workflowTypes';
import { ToolError } from '@/mcp/context';

const moment = (s: number | null) => (s === null ? null : formatDuration(s) || '0:00');

export async function getSessionTool(db: Scoped, args: { id: number; notes?: number }) {
  const project = await getProject(db, args.id);
  if (!project) throw new ToolError(`No project ${args.id} that you can see. list_projects gives the ids.`);
  const [w, tracks, references, notes] = await Promise.all([
    getWorkflow(db, args.id),
    listTracks(db, args.id),
    listReferences(db, args.id),
    listNotes(db, args.id),
  ]);

  const byId = new Map(w.elements.map((e) => [e.id, e]));
  const elementPath = (id: number | null) => {
    const e = id === null ? undefined : byId.get(id);
    if (!e) return null;
    const parent = e.parentId === null ? undefined : byId.get(e.parentId);
    return parent ? `${parent.name} › ${e.name}` : e.name;
  };
  const stageLabel = (key: string) => w.stages.find((s) => s.key === key)?.label ?? key;
  const pos = stagePosition(w, w.stage);
  const card = (c: WorkflowCard) => ({
    id: c.id,
    element: elementPath(c.elementId),
    stage: stageLabel(c.stage),
    kind: c.kind,
    what: c.what,
    done_when: c.doneWhen || null,
    status: c.status,
    written_by: c.origin === 'assistant' ? `Claude, for ${c.createdByName}` : c.createdByName,
    about: c.audioLabel !== null ? { mix: c.audioLabel, at: moment(c.positionS) } : null,
    from_note: c.sourceNoteId,
    reopened: c.reopenCount || undefined,
  });

  const current = tracks.find((t) => t.id === project.currentMixId) ?? tracks[0] ?? null;
  const live = w.cards.filter((c) => !c.settled && c.status !== 'proposed' && c.status !== 'rejected');
  const accepted = w.criteria.filter((c) => c.reviewed && !c.rejected);
  const limit = Math.min(Math.max(args.notes ?? 15, 0), 100);

  return {
    session: {
      id: project.id,
      canonical_id: project.canonicalId,
      working_name: project.workingName || null,
      artist: `${project.artist.code} · ${project.artist.name}`,
      genre: project.genre || null,
      bpm: project.bpm,
      rating: project.rating || null,
      started: project.createdAt.slice(0, 10),
      owner: project.ownerId === db.person.userId ? 'you' : project.ownerName,
      your_access: project.level,
    },
    workflow: w.stage
      ? {
          next_move: w.nextMove || null,
          blocker: w.blocker ? { text: w.blocker, sessions_since: w.sessionsSinceBlocker } : null,
          latest_sessions: w.workLog.slice(0, 5).map((e) => ({ on: e.loggedAt.slice(0, 10), by: e.loggedByName, did: e.did || null, next: e.nextMove || null })),
          stages: w.stages.map((s) => {
            const cs = accepted.filter((c) => c.stage === s.key);
            return { stage: s.label, standard: s.standard || null, criteria_met: `${cs.filter((c) => c.metAt).length} of ${cs.length}` };
          }),
          stage: stageLabel(w.stage),
          in_stage_since: w.enteredAt?.slice(0, 10) ?? null,
          finished: w.finishedAt?.slice(0, 10) ?? null,
          exit_criteria: accepted
            .filter((c) => c.stage === w.stage)
            .map((c) => {
              const r = c.checkKey ? w.setReading?.results[c.checkKey] : undefined;
              return {
                id: c.id,
                criterion: c.body,
                hint: c.hint || undefined,
                met: !!c.metAt,
                likely_done: r && !c.metAt ? { verdict: r.verdict, read: r.reading } : undefined,
              };
            }),
          set_read: w.setReading?.fileName ? { file: w.setReading.fileName, saved: w.setReading.savedAt?.slice(0, 10) ?? null } : undefined,
          template: w.template
            ? {
                name: w.template.name,
                changes_on_offer: w.templateChanges.length || undefined,
              }
            : null,
          // The template's learnings (db/028): reminders on stages, the same on every project using the template.
          learnings: w.learnings
            .filter((l) => l.reviewed)
            .map((l) => ({ stage: stageLabel(l.stage), learning: l.body, from: l.source || undefined, by: l.createdByName })),
          you_can_add_learnings: w.learningsEditable,
          open_cards: live.filter((c) => c.stage === w.stage && c.status !== 'done').map(card),
          done_this_stage: live.filter((c) => c.stage === w.stage && c.status === 'done').length,
          parked_for_later_stages: live.filter((c) => stagePosition(w, c.stage) > pos).map(card),
          settled_decisions: w.cards
            .filter((c) => c.settled)
            .map((c) => ({ ...card(c), reason: c.settledReason || null, settled: c.settledAt?.slice(0, 10) ?? null })),
          awaiting_review: {
            cards: w.cards.filter((c) => c.status === 'proposed').map(card),
            exit_criteria: w.criteria.filter((c) => !c.reviewed).map((c) => ({ id: c.id, stage: stageLabel(c.stage), criterion: c.body })),
            learnings: w.learnings.filter((l) => !l.reviewed).map((l) => ({ id: l.id, stage: stageLabel(l.stage), learning: l.body })),
          },
          recent_moves: w.moves.slice(0, 5).map((m) => ({
            from: m.fromStage ? stageLabel(m.fromStage) : null,
            to: stageLabel(m.toStage),
            reason: m.reason || null,
            by: m.movedByName,
            on: m.movedAt.slice(0, 10),
          })),
          elements: w.elements
            .filter((e) => e.parentId === null)
            .sort((a, b) => a.position - b.position)
            .map((t) => ({
              name: t.name,
              parts: w.elements.filter((e) => e.parentId === t.id).sort((a, b) => a.position - b.position).map((e) => e.name),
            })),
        }
      : { stage: null, note: 'The workflow has not been started. Someone with edit access starts it on the Workflow tab.' },
    mixes: tracks.map((t) => ({
      mix: t.label,
      variant: t.variant || 'main',
      version: t.version,
      file: t.originalFilename,
      length: formatDuration(t.durationS) || null,
      uploaded: t.uploadedAt.slice(0, 10),
      by: t.uploadedByName,
      current: t.id === current?.id || undefined,
      notes: notes.filter((n) => n.trackId === t.id).length,
    })),
    references: references.map((r) => ({ credit: r.credit || r.originalFilename, length: formatDuration(r.durationS) || null })),
    latest_notes: notes.slice(0, limit).map((n) => ({
      id: n.id,
      by: n.authorName,
      on: n.createdAt.slice(0, 10),
      about: n.trackLabel ?? 'the whole project',
      at: n.trackLabel !== null ? moment(n.positionS) : null,
      text: n.body,
    })),
    notes_total: notes.length,
  };
}
