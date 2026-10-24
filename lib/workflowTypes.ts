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

export type WorkflowElement = {
  id: number;
  parentId: number | null;
  name: string;
  position: number;
  /** From the track structure (db/025). */
  description: string;
  color: string | null;
  isZone: boolean;
  prefixes: string[];
  groupNames: string[];
  templateUid: string | null;
};

/** One change the project's track structure offers (W-28). */
export type StructureChange = {
  uid: string;
  change: 'new' | 'changed';
  name: string;
  /** The zone or element a part belongs to; null for a top-level element. */
  parentName: string | null;
  /** What the project has now, for a changed one: "TACTUS · TAC". */
  was: string | null;
  /** What the template has: "PULSE · TAC, DRM". */
  now: string;
};

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
  /** The project's next to-do (db/029): at most one. */
  isNext: boolean;
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

/** What a check read from the newest saved set (W-18). */
export type CheckResult = { verdict: 'likely' | 'not yet' | 'unknown'; reading: string };

/** The checks the project's criteria name, run against its newest saved set of the main mix. */
export type SetReading = {
  /** The set read; null when no set has been read for the project. */
  fileName: string | null;
  savedAt: string | null;
  results: Record<string, CheckResult>;
};

/**
 * A learning on a stage of the project's template (W-33, db/028): a reminder
 * with no checkbox, read live from the template, so every project using it
 * shows the same ones.
 */
export type WorkflowLearning = {
  id: number;
  stage: string;
  position: number;
  body: string;
  origin: 'human' | 'assistant';
  /** false: Claude's proposal, waiting for a person. */
  reviewed: boolean;
  /** Where it came from, as written when it was made: "Khione · v4 at 3:30". */
  source: string;
  createdByName: string;
  createdAt: string;
  /** Whether the person may change the template's learnings. */
  canEdit: boolean;
};

/** A template the workflow can start with (W-31). */
export type TemplateChoice = { id: number; name: string; note: string };

/** What starting the workflow offers, before it starts. */
export type StartChoices = {
  templates: TemplateChoice[];
  /** Empty for kinds with no track structure. */
  structures: TemplateChoice[];
  /** The project's own: its artist's, else its owner's. */
  templateId: number | null;
  structureId: number | null;
};

/** One ended session (W-20). */
export type WorkLogEntry = { id: number; did: string; nextMove: string; loggedByName: string; loggedAt: string };

export type Workflow = {
  /** The project's stages in order (its own once started); empty when it has none. */
  stages: WorkflowStage[];
  /** null until the workflow is started. */
  stage: string | null;
  enteredAt: string | null;
  /** Set while the project is in its last stage with every criterion there met. */
  finishedAt: string | null;
  template: WorkflowTemplateStatus | null;
  /** What the template offers when it has moved on; empty otherwise. */
  templateChanges: TemplateChange[];
  /** The track structure the project took, and what it offers since (W-28). */
  structure: { name: string; version: number; seenVersion: number } | null;
  structureChanges: StructureChange[];
  /** Sessions ended by hand before 25 October, newest first; sessions are read from saved sets since (lib/sessions.ts). */
  workLog: WorkLogEntry[];
  /** Likely-done marks for criteria with a check; null when none has one. */
  setReading: SetReading | null;
  moves: StageMove[];
  criteria: ExitCriterion[];
  elements: WorkflowElement[];
  cards: WorkflowCard[];
  /** The learnings of the template the project uses, by stage (W-33). */
  learnings: WorkflowLearning[];
  /** Whether the person may add to and change the template's learnings. */
  learningsEditable: boolean;
  /** Before the workflow starts: the templates it can start with. */
  startChoices: StartChoices | null;
};

export const CARD_TEXT_MAX = 1000;
export const LEARNING_MAX = 2000;
export const CRITERION_MAX = 500;
export const ELEMENT_NAME_MAX = 80;

export function stagePosition(w: Pick<Workflow, 'stages'>, key: string | null): number {
  return w.stages.find((s) => s.key === key)?.position ?? 0;
}
