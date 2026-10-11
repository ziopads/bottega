// Control styles shared by every page (ARCHITECTURE §13), so a button or a
// field looks the same wherever it appears. A plain module: server and client
// components both import it.

/** The ordinary button: a hairline that darkens on hover. */
export const BUTTON = 't-body rounded border border-line px-3 py-1 hover:border-ink disabled:opacity-50';

/** The one action a section is for (Approve, Process, Upload). */
export const BUTTON_PRIMARY = 't-body rounded border border-rust bg-rust px-3 py-1 text-white hover:opacity-90 disabled:opacity-50';

/** A quiet text action beside content (Edit, Remove, Cancel). */
export const TEXT_ACTION = 'text-muted hover:text-ink';

/** A destructive text action (Delete, Revoke). */
export const TEXT_DANGER = 'text-muted hover:text-rust';

/** Inputs and selects. */
export const FIELD = 't-body rounded border border-line bg-card px-2 py-1 outline-none focus:border-rust';
