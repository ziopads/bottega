// Workflow shapes, shared by server and client (REQUIREMENTS W-1 to W-24,
// db/011, db/024). No imports, so client components can use them.

/** One of a project's own stages (db/024), with its one-line standard. */
export type WorkflowStage = { key: string; label: string; position: number; standard: string };

export const CARD_KINDS = ['sound design', 'writing', 'arrangement', 'mix', 'fix'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_STATUSES = ['proposed', 'accepted', 'in progress', 'done', 'rejected'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];
/** What a person sets; 'proposed' is Claude's alone. */
export const PERSON_STATUSES: CardStatus[] = ['accepted', 'in progress', 'done', 'rejected'];

export type StageMove = {
  id: number;
  fromStage: string | null;
  toStage: string;
  reason: string;
  movedByName: string;
  movedAt: string;
};

export type ExitCriterion = {
  id: number;
  stage: string;
  body: string;
  /** How to check it or what to aim for; lines indented by two spaces nest. */
  hint: string;
  /** A check from workflow_checks that can mark it likely done, or null. */
  checkKey: string | null;
  /** The template criterion it was copied from, to compare with the template. */
  templateUid: string | null;
  position: number;
  metAt: string | null;
  metByName: string | null;
  origin: 'human' | 'assistant';
  /** false: Claude's proposal, waiting for a person. */
  reviewed: boolean;
  rejected: boolean;
};

export type WorkflowElement = { id: number; parentId: number | null; name: string; position: number };

export type WorkflowCard = {
  id: number;
  elementId: number | null;
  stage: string;
  kind: CardKind | null;
  what: string;
  doneWhen: string;
  status: CardStatus;
  origin: 'human' | 'assistant';
  sourceNoteId: number | null;
  audioId: number | null;
  /** The version of audioId. */
  audioVersion: number | null;
  /** audioId's label for display: "v3", or "Radio edit v1". */
  audioLabel: string | null;
  positionS: number | null;
  settled: boolean;
  settledReason: string;
  settledAt: string | null;
  reopenCount: number;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

/** The template a project's workflow was copied from (db/024). */
export type WorkflowTemplateStatus = {
  id: number;
  name: string;
  version: number;
  /** The template version the project last took in; lower than version when it has moved on. */
  seenVersion: number;
};

/** One template change a project can bring in (W-17). */
export type TemplateChange = {
  uid: string;
  stage: string;
  stageLabel: string;
  /** 'new': not in the project yet; 'changed': the project's copy differs. */
  change: 'new' | 'changed';
  body: string;
  hint: string;
  /** The project's own text, for a changed one. */
  was: { body: string; hint: string } | null;
};

/** One ended session (W-20). */
export type WorkLogEntry = { id: number; did: string; nextMove: string; loggedByName: string; loggedAt: string };

export type Workflow = {
  /** The project's stages in order (its own once started); empty when it has none. */
  stages: WorkflowStage[];
  /** null until the workflow is started. */
  stage: string | null;
  enteredAt: string | null;
  /** The re-entry note: one action to start with next time. */
  nextMove: string;
  blocker: string;
  blockerSetAt: string | null;
  /** Set while the project is in its last stage with every criterion there met. */
  finishedAt: string | null;
  template: WorkflowTemplateStatus | null;
  /** What the template offers when it has moved on; empty otherwise. */
  templateChanges: TemplateChange[];
  /** The latest ended sessions, newest first. */
  workLog: WorkLogEntry[];
  /** Sessions ended since the blocker was set. */
  sessionsSinceBlocker: number;
  moves: StageMove[];
  criteria: ExitCriterion[];
  elements: WorkflowElement[];
  cards: WorkflowCard[];
};

export const CARD_TEXT_MAX = 1000;
export const CRITERION_MAX = 500;
export const ELEMENT_NAME_MAX = 80;

export function stagePosition(w: Pick<Workflow, 'stages'>, key: string | null): number {
  return w.stages.find((s) => s.key === key)?.position ?? 0;
}
