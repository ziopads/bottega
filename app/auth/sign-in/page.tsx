'use client';

import { use, useActionState } from 'react';

import { signInWithEmail } from './actions';

// No sign-up form: accounts are created in the Neon Console.

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [state, formAction, pending] = useActionState(signInWithEmail, null);
  const nextParam = use(searchParams).next;
  const next = Array.isArray(nextParam) ? nextParam[0] : nextParam;

  return (
    <form action={formAction} className="w-full max-w-sm space-y-5 py-12">
      <div>
        <h1 className="text-2xl">Sign in</h1>
        <p className="mt-1 text-sm text-muted">Bottega</p>
      </div>

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <label className="block space-y-1">
        <span className="text-sm">Email</span>
        <input type="text" name="email" autoComplete="username" required />
      </label>

      <label className="block space-y-1">
        <span className="text-sm">Password</span>
        <input type="password" name="password" autoComplete="current-password" required />
      </label>

      {state?.error ? <p className="text-sm text-rust">{state.error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="border border-rust px-4 py-1.5 text-sm text-rust hover:bg-rust hover:text-parchment disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
