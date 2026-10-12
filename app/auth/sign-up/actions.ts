'use server';

import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/server';

// Creating an account (REQUIREMENTS AC-1). Neon Auth creates the identity;
// the first request after it registers the account in Bottega as pending
// (register_session, db/002), and the person sees only the "awaiting
// approval" page until the platform administrator approves them at Accounts.
// Nothing here grants access to anything.

export type SignUpState = { error: string } | { checkEmail: string } | null;

const PASSWORD_MIN = 8;

export async function signUpWithEmail(_prev: SignUpState, form: FormData): Promise<SignUpState> {
  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  if (!name) return { error: 'Give the name others will see.' };
  if (name.length > 80) return { error: 'Keep the name under 80 characters.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'That does not look like an email address.' };
  if (password.length < PASSWORD_MIN) return { error: `Use a password of at least ${PASSWORD_MIN} characters.` };
  if (password !== confirm) return { error: 'The two passwords differ.' };

  const { error } = await auth.signUp.email({ email, password, name });
  if (error) {
    // Logged server-side so a refusal that is not an existing account (an
    // untrusted origin, a password rule) names its cause. Never the password.
    const e = error as { status?: number; code?: string; message?: string };
    console.error('[sign-up] refused', { email, status: e.status, code: e.code, message: e.message });
    if (e.code === 'USER_ALREADY_EXISTS' || e.status === 422) {
      return { error: 'An account with that email already exists. Sign in instead.' };
    }
    if (e.code === 'PASSWORD_TOO_SHORT' || e.code === 'PASSWORD_TOO_LONG') {
      return { error: e.message || 'The password does not meet the rules.' };
    }
    return { error: 'The account could not be created. Try again in a moment.' };
  }

  // Signed in straight away, unless Neon Auth is set to verify email first.
  const { data } = await auth.getSession();
  if (!data?.user) return { checkEmail: email };
  redirect('/auth/pending');
}
