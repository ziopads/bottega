// Control styles shared by every page (ARCHITECTURE §13), so a button or a
// field looks the same wherever it appears. A plain module: server and client
// components both import it.
//
// Every action is drawn as a button, with an outline or a fill and all at one
// size, so it reads as something to press. Plain text is left for navigation (TEXT_LINK, tabs) and
// for an action inside a sentence, which is underlined. Player, scrubber and
// page-turn controls draw their own glyphs.

const OFF = 'disabled:pointer-events-none disabled:opacity-50';
const SHAPE = 'inline-flex items-center justify-center rounded border px-2 py-0.5 text-[11px] leading-[14px]';

// One size for every button. In a row with fields, a button stretches to the
// fields' height (a flex row's default, or self-stretch where the row centres).

/** The ordinary button: a light outline that darkens on hover. */
export const BUTTON = `${SHAPE} border-ink/30 text-ink hover:border-ink hover:bg-ink/5 ${OFF}`;

/** The action a section or form is for, and confirming one (Save, Process, Accept, Confirm delete). */
export const BUTTON_PRIMARY = `${SHAPE} border-accent bg-accent text-on-accent hover:opacity-90 ${OFF}`;

/** A destructive action (Delete, Remove, Revoke), in the theme's danger colour on hover. */
export const BUTTON_DANGER = `${SHAPE} border-ink/30 text-ink hover:border-danger hover:bg-danger/5 hover:text-danger ${OFF}`;

/** A segmented control: one choice from a set (a session's variants). The
 *  container joins the segments; SEGMENT(on) styles each, the chosen one filled. */
export const SEGMENTS = 'inline-flex divide-x divide-ink/30 overflow-hidden rounded border border-ink/30';
export const SEGMENT = (on: boolean) =>
  `px-2 py-0.5 text-[11px] leading-[14px] ${on ? 'bg-ink text-parchment' : 'text-ink hover:bg-ink/5'}`;

/** A link to another page or tab, set in text (Read the pages, All notes →). */
export const TEXT_LINK = 'underline decoration-ink/30 underline-offset-2 hover:decoration-ink';

/** Inputs and selects. */
export const FIELD = 't-body rounded border border-line bg-card px-2 py-1 outline-none focus:border-rust';
