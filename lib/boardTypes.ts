// The board's shapes, shared by server and client (REQUIREMENTS W-21 to W-23,
// db/024). No imports, so client components can use them.

export type BoardPlace = 'backlog' | 'rotation';

/** met of total: criteria ticked and to-dos done, over the stage's criteria and to-dos. */
export type BoardStage = { key: string; label: string; met: number; total: number };

export type BoardProject = {
  id: number;
  /** The working name, else the canonical id. */
  title: string;
  /** "VIG 2025 0727". */
  code: string;
  bpm: number | null;
  /** The newest saved set's key, such as "F Minor"; null when no set says. */
  key: string | null;
  genre: string;
  /** 0 = unrated, 1–5 stars. */
  rating: number;
  /** When the project was made. */
  startedAt: string;
  /** The current mix, for the board's player. */
  latest: { trackId: number; label: string; variant: string; durationS: number | null; count: number } | null;
  /** The owner's name when the project is someone else's; null for one's own. */
  ownerName: string | null;
  /** Whether the person may change its to-dos (contribute access or more). */
  canContribute: boolean;
  place: BoardPlace;
  /** Set while the project is finished (W-23); it then sits under Finished. */
  finishedAt: string | null;
  /** null until the project's workflow starts. */
  stage: string | null;
  stages: BoardStage[];
  /** The project's next to-do (db/029), or null. */
  next: string | null;
  /** Open cards in the current stage. */
  openCards: number;
  /** The last thing done on it: a session, a card, a criterion, a move, a mix, a saved set. */
  touchedAt: string | null;
};

/** A project the person can see that is not on their board. */
export type BoardCandidate = {
  id: number;
  title: string;
  /** "VIG 2025 0727". */
  code: string;
  ownerName: string | null;
  /** When the project was made, for showing the newest first. */
  createdAt: string;
  /** The last thing done on it, as for a project on the board. */
  touchedAt: string | null;
  /** 0 = unrated, 1–5 stars. */
  rating: number;
};

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

/** How far along a project is, for sorting: whole stages done, then items done. */
export function progressOf(p: BoardProject): number {
  const stagesDone = p.stages.filter((s) => s.total > 0 && s.met === s.total).length;
  return stagesDone * 1000 + p.stages.reduce((n, s) => n + s.met, 0);
}
