// To-dos: every card across the person's projects, for the To-dos page
// (REQUIREMENTS W-35, W-36). No imports, so client components can use it.

export type TodoStatus = 'accepted' | 'in progress' | 'done';

export type Todo = {
  id: number;
  projectId: number;
  projectTitle: string;
  /** The project's place on the person's board; null when it is not on it. */
  place: 'rotation' | 'backlog' | null;
  stage: string;
  stageLabel: string;
  /** The card's stage against the project's: its current stage, a later one (parked), or an earlier one. */
  when: 'current' | 'later' | 'earlier';
  /** The project's current stage, for the row heading. */
  projectStageLabel: string | null;
  /** "TACTUS / Hats", or null when unassigned. */
  element: string | null;
  /** The top-level element's colour slot (lib/elementColors.ts), or null. */
  elementColor: string | null;
  kind: string | null;
  what: string;
  doneWhen: string;
  status: TodoStatus;
  /** The project's next to-do (db/029). */
  isNext: boolean;
  /** "v4 at 2:10", or null when not pinned to a mix. */
  moment: string | null;
  /** Whether the person may change its status or move it. */
  canChange: boolean;
  updatedAt: string;
};

export const TODO_COLUMNS: { status: TodoStatus; label: string }[] = [
  { status: 'accepted', label: 'To do' },
  { status: 'in progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
];
