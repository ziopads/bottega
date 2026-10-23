// The workflow template editor's shapes (REQUIREMENTS W-13 to W-15, W-22;
// db/024), shared by server and client. No imports.

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
};

export type TemplateSummary = { id: number; name: string; isDefault: boolean };

export type TemplateEditor = {
  /** The music template new projects start from: one's own, or the default. */
  chosen: TemplateSummary;
  /** The default and one's own music templates. */
  templates: TemplateSummary[];
  stages: EditorStage[];
  checks: CheckOption[];
  rotationLimit: number;
  coldDays: number;
};

export const TEMPLATE_NAME_MAX = 80;
export const STAGE_LABEL_MAX = 40;
export const STANDARD_MAX = 200;
export const HINT_MAX = 2000;
