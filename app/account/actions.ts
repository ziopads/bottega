'use server';

import { getAccount, logPasswordChange } from '@/lib/access';
import { auth } from '@/lib/auth/server';

// Changing a password needs the current one: no email delivery is set up, so
// there is no reset by link. A forgotten password is replaced by an admin (see
// docs/HANDOFF.md, accounts).
//
// Better Auth's default minimum is 8 characters; checking it here gives a clear
// message before the round trip. Other sessions are signed out, so a password
// changed because it leaked also closes whatever was using it. The change is
// written to the access log (REQUIREMENTS AC-11).

export type ChangePasswordState = { error: string } | { ok: true } | null;

const MIN_LENGTH = 8;

export async function changePassword(
  _prev: ChangePasswordState,
  form: FormData,
): Promise<ChangePasswordState> {
  // A Server Action is its own POST endpoint; guard it as well as the page.
  const user = await getAccount();
  if (!user || user.status !== 'active') return { error: 'You are not signed in.' };

  const current = form.get('current');
  const next = form.get('next');
  const confirm = form.get('confirm');

  if (typeof current !== 'string' || typeof next !== 'string' || typeof confirm !== 'string') {
    return { error: 'All three fields are required.' };
  }
  if (next.length < MIN_LENGTH) {
    return { error: `The new password needs at least ${MIN_LENGTH} characters.` };
  }
  if (next !== confirm) {
    return { error: 'The new password and its confirmation differ.' };
  }
  if (next === current) {
    return { error: 'The new password is the same as the current one.' };
  }

  const { error } = await auth.changePassword({
    currentPassword: current,
    newPassword: next,
    revokeOtherSessions: true,
  });

  if (error) {
    // As in sign-in: the cause goes to the server log, never a password.
    const e = error as { status?: number; code?: string; message?: string };
    console.error('[change-password] refused', {
      email: user.email,
      status: e.status,
      code: e.code,
      message: e.message,
    });
    if (e.code === 'INVALID_PASSWORD' || e.status === 400 || e.status === 401) {
      return { error: 'The current password is not right.' };
    }
    return { error: 'The password could not be changed. Try again shortly.' };
  }

  try {
    await logPasswordChange(user);
  } catch (err) {
    // The password has changed either way; a missing log entry is reported, not hidden.
    console.error('[change-password] changed, but the access log entry failed', err);
  }
  return { ok: true };
}
