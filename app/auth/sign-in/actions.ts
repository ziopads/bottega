'use server';

import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth/server';

export async function signInWithEmail(
  _prev: { error: string } | null,
  form: FormData,
): Promise<{ error: string } | null> {
  const email = form.get('email');
  const password = form.get('password');

  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Email and password are both required.' };
  }

  const { error } = await auth.signIn.email({ email, password });

  // An unknown address and a wrong password get the same answer.
  if (error) {
    return { error: 'That email and password did not match an account.' };
  }

  redirect(safeNext(form.get('next')));
}

// Where to go after signing in. Only the connector's consent screen may be
// named (app/oauth/authorize, from Phase 1); anything else goes home, so the
// parameter cannot send someone to another site.
function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value === 'string' && value.startsWith('/oauth/authorize?') && !value.includes('//')) {
    return value;
  }
  return '/';
}

export async function signOut(): Promise<void> {
  await auth.signOut();
  redirect('/auth/sign-in');
}
