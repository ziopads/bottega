'use client';

import Link from 'next/link';
import { useActionState } from 'react';

import { signUpWithEmail, type SignUpState } from './actions';

// Creating an account (REQUIREMENTS AC-1). Anyone can; a new account waits
// for the platform administrator's approval and reaches nothing until then.

export default function SignUpPage() {
  const [state, formAction, pending] = useActionState<SignUpState, FormData>(signUpWithEmail, null);

  if (state && 'checkEmail' in state) {
    return (
      <div className="w-full max-w-sm space-y-4 py-12">
        <h1 className="t-title">Check your email</h1>
        <p className="t-body">
          A message to {state.checkEmail} confirms the address. Then <Link href="/auth/sign-in" className="text-rust hover:underline">sign in</Link>;
          your account waits for approval before it opens.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="plain-form w-full max-w-sm space-y-5 py-12">
      <div>
        <h1 className="t-title">Create an account</h1>
        <p className="mt-1 t-body text-muted">Bottega. A new account waits for approval before it opens.</p>
      </div>

      <label className="block space-y-1">
        <span className="t-body">Name</span>
        <input type="text" name="name" autoComplete="name" maxLength={80} required />
        <span className="block text-[11px] text-muted">What others see on what you share and write.</span>
      </label>

      <label className="block space-y-1">
        <span className="t-body">Email</span>
        <input type="email" name="email" autoComplete="email" required />
      </label>

      <label className="block space-y-1">
        <span className="t-body">Password</span>
        <input type="password" name="password" autoComplete="new-password" minLength={8} required />
      </label>

      <label className="block space-y-1">
        <span className="t-body">Password again</span>
        <input type="password" name="confirm" autoComplete="new-password" minLength={8} required />
      </label>

      {state && 'error' in state ? <p className="t-body text-rust">{state.error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="border border-rust px-4 py-1.5 t-body text-rust hover:bg-rust hover:text-parchment disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create the account'}
      </button>

      <p className="t-body text-muted">
        Already have one?{' '}
        <Link href="/auth/sign-in" className="text-rust hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
