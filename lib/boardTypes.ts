// The board's shapes, shared by server and client (REQUIREMENTS W-21 to W-23,
// db/024). No imports, so client components can use them.

export type BoardPlace = 'backlog' | 'rotation';

export type BoardStage = { key: string; label: string; met: number; total: number };

export type BoardProject = {
  id: number;
  /** The working name, else the canonical id. */
  title: string;
  /** "VIG 2025 0727". */
  code: string;
  bpm: number | null;
  /** The owner's name when the project is someone else's; null for one's own. */
  ownerName: string | null;
  place: BoardPlace;
  /** Set while the project is finished (W-23); it then sits under Finished. */
  finishedAt: string | null;
  /** null until the project's workflow starts. */
  stage: string | null;
  stages: BoardStage[];
  nextMove: string;
  blocker: string;
  /** Open cards in the current stage. */
  openCards: number;
  /** The last thing done on it: a session, a card, a criterion, a move, a mix, a saved set. */
  touchedAt: string | null;
};

/** A project the person can see that is not on their board. */
export type BoardCandidate = { id: number; title: string; code: string; ownerName: string | null };

export type Board = {
  rotationLimit: number;
  coldDays: number;
  projects: BoardProject[];
  candidates: BoardCandidate[];
};

/** Whole days since a moment; null when there is none. */
export function daysSince(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86_400_000));
}

/** How far along a project is, for sorting: whole stages met, then criteria met. */
export function progressOf(p: BoardProject): number {
  const stagesDone = p.stages.filter((s) => s.total > 0 && s.met === s.total).length;
  return stagesDone * 1000 + p.stages.reduce((n, s) => n + s.met, 0);
}
