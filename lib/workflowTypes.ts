// Workflow shapes, shared by server and client (REQUIREMENTS W-1 to W-10,
// db/011). No imports, so client components can use them.

export type WorkflowStage = { key: string; label: string; position: number };

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

export type Workflow = {
  /** The stages of this kind of project, in order; empty when it has none. */
  stages: WorkflowStage[];
  /** null until the workflow is started. */
  stage: string | null;
  enteredAt: string | null;
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
