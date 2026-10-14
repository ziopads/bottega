// Control styles shared by every page (ARCHITECTURE §13), so a button or a
// field looks the same wherever it appears. A plain module: server and client
// components both import it.
//
// Every action is drawn as a button, with an outline or a fill, so it reads as
// something to press. Plain text is left for navigation (TEXT_LINK, tabs) and
// for an action inside a sentence, which is underlined. Player, scrubber and
// page-turn controls draw their own glyphs.

const OFF = 'disabled:pointer-events-none disabled:opacity-50';

/** The ordinary button: an outline that darkens on hover. */
export const BUTTON = `t-body rounded border border-ink/40 px-3 py-1 text-ink hover:border-ink hover:bg-ink/5 ${OFF}`;

/** The one action a section is for (Approve, Process, Upload). */
export const BUTTON_PRIMARY = `t-body rounded border border-rust bg-rust px-3 py-1 text-white hover:opacity-90 ${OFF}`;

/** A small action beside content (Edit, Remove, + Note). */
export const BUTTON_SMALL = `inline-flex items-center rounded border border-ink/30 px-2 py-0.5 text-[11px] leading-tight text-ink hover:border-ink hover:bg-ink/5 ${OFF}`;

/** A small action that settles something (Accept, Confirm delete). */
export const BUTTON_SMALL_PRIMARY = `inline-flex items-center rounded border border-rust bg-rust px-2 py-0.5 text-[11px] leading-tight text-white hover:opacity-90 ${OFF}`;

/** A small destructive action (Delete, Remove, Revoke). Rust is the danger colour. */
export const BUTTON_SMALL_DANGER = `inline-flex items-center rounded border border-ink/30 px-2 py-0.5 text-[11px] leading-tight text-ink hover:border-rust hover:bg-rust/5 hover:text-rust ${OFF}`;

/** A link to another page or tab, set in text (Read the pages, All notes →). */
export const TEXT_LINK = 'underline decoration-ink/30 underline-offset-2 hover:decoration-ink';

/** Inputs and selects. */
export const FIELD = 't-body rounded border border-line bg-card px-2 py-1 outline-none focus:border-rust';
