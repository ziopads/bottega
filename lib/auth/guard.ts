import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/server';

// Authorization, copied from Scriptorium. The people in ALLOWED_EMAILS may use
// the application; anyone else may hold an account and see nothing.
//
// Checked in two places, and both are necessary. Pages call it so that a
// signed-in stranger sees a refusal. Server Actions and route handlers call it
// because each is a POST endpoint that exists independently of the page that
// renders its form; guarding the page and not the action is the usual way this
// goes wrong.
//
// Who someone is within the studio (their artist on the roster) is a separate
// question, answered by the members table (getMemberArtistId() in lib/studio.ts).

export interface AllowedUser {
  id: string;
  email: string;
  name?: string | null;
}

function allowlist(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

// The user when signed in and permitted, null otherwise. Fails closed: an
// unset or empty ALLOWED_EMAILS admits nobody.
export async function getAllowedUser(): Promise<AllowedUser | null> {
  const { data: session } = await auth.getSession();

  const user = session?.user;
  const email = user?.email?.toLowerCase();
  if (!user || !email) return null;

  const permitted = allowlist();
  if (permitted.length === 0) return null;
  if (!permitted.includes(email)) return null;

  return { id: user.id, email, name: user.name };
}

// For pages and Server Actions. Redirects, so an unauthorised visitor lands
// somewhere that explains itself.
export async function requireAllowedUser(): Promise<AllowedUser> {
  const user = await getAllowedUser();
  if (!user) redirect('/auth/denied');
  return user;
}
