// The session page's tabs (REQUIREMENTS S-13), shared by the server page that
// reads ?tab= and the client component that draws them. Kept out of the
// 'use client' module: a server component importing a plain value from one
// gets a client reference, not the value.

export const SESSION_TABS = ['overview', 'mixes', 'workflow', 'notes'] as const;
export type SessionTab = (typeof SESSION_TABS)[number];
