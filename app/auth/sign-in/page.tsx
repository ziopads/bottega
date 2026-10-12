'use client';

import Link from 'next/link';
import { use, useActionState } from 'react';

import { signInWithEmail } from './actions';

// Signing in. New accounts are created at /auth/sign-up and wait for the
// platform administrator's approval (REQUIREMENTS AC-1).

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [state, formAction, pending] = useActionState(signInWithEmail, null);
  const nextParam = use(searchParams).next;
  const next = Array.isArray(nextParam) ? nextParam[0] : nextParam;

  return (
    <form action={formAction} className="plain-form w-full max-w-sm space-y-5 py-12">
      <div>
        <h1 className="t-title">Sign in</h1>
        <p className="mt-1 t-body text-muted">Bottega</p>
      </div>

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="block space-y-1">
        <span className="t-body">Email</span>
        <input type="text" name="email" autoComplete="username" required />
      </label>

      <label className="block space-y-1">
        <span className="t-body">Password</span>
        <input type="password" name="password" autoComplete="current-password" required />
      </label>

      {state?.error ? <p className="t-body text-rust">{state.error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="border border-rust px-4 py-1.5 t-body text-rust hover:bg-rust hover:text-parchment disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="t-body text-muted">
        New here?{' '}
        <Link href="/auth/sign-up" className="text-rust hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
