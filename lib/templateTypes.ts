// The workflow template editor's shapes (REQUIREMENTS W-13 to W-15, W-22,
// W-32, W-33; db/024, db/028), shared by server and client. No imports.

export type CheckOption = { key: string; label: string; description: string };

/** How a criterion of one's own template compares with the platform default. */
export type Difference = 'same' | 'changed' | 'added';

export type EditorCriterion = {
  id: number;
  uid: string;
  position: number;
  body: string;
  hint: string;
  checkKey: string | null;
  difference: Difference;
};

export type EditorStage = {
  id: number;
  key: string;
  position: number;
  label: string;
  standard: string;
  criteria: EditorCriterion[];
  /** Default criteria of this stage that the template no longer has. */
  missingFromDefault: { body: string }[];
  /** Whether the default has a stage with this key, so the stage can be reset to it. */
  inDefault: boolean;
  /** Reminders on this stage, shown on every project using the template (db/028). */
  learnings: EditorLearning[];
};

export type EditorLearning = { id: number; body: string; reviewed: boolean; source: string; createdByName: string };

export type TemplateSummary = {
  id: number;
  name: string;
  isDefault: boolean;
  /** One's own: renamed and deleted only by its owner. */
  mine: boolean;
  /** One's own, or one used by an artist shared with one to edit (db/028). */
  canEdit: boolean;
  /** Whose it is, for one shared through an artist. */
  ownerName: string | null;
};

export type TemplateEditor = {
  /** The music template new projects start from when their artist names none: one's own, or the default. */
  chosen: TemplateSummary;
  /** The template shown below for editing: the chosen one unless another is picked. */
  editing: TemplateSummary;
  /** Every music template one can read: the default, one's own, and those shared through artists. */
  templates: TemplateSummary[];
  stages: EditorStage[];
  /** The template's method: principles for the whole workflow (db/032). */
  principles: Principle[];
  checks: CheckOption[];
  rotationLimit: number;
  coldDays: number;
};

export const TEMPLATE_NAME_MAX = 80;
export const STAGE_LABEL_MAX = 40;
export const STANDARD_MAX = 200;
export const HINT_MAX = 2000;
export const LEARNING_MAX = 2000;

/** One principle of a template's method (db/032): a bold line and its explanation. */
export type Principle = { id: number; title: string; body: string };
export const PRINCIPLE_TITLE_MAX = 200;
export const PRINCIPLE_BODY_MAX = 1000;
