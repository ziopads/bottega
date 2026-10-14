'use client';

import { useActionState } from 'react';

import { changePassword, type ChangePasswordState } from './actions';
import { BUTTON_PRIMARY } from '@/app/_ui/styles';

export default function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(changePassword, null);

  if (state && 'ok' in state) {
    return <p className="t-body">Password changed. Other devices have been signed out.</p>;
  }

  return (
    <form action={formAction} className="plain-form max-w-sm space-y-4">
      <label className="block space-y-1">
        <span className="t-body">Current password</span>
        <input type="password" name="current" autoComplete="current-password" required />
      </label>

      <label className="block space-y-1">
        <span className="t-body">New password</span>
        <input type="password" name="next" autoComplete="new-password" minLength={8} required />
      </label>

      <label className="block space-y-1">
        <span className="t-body">New password again</span>
        <input type="password" name="confirm" autoComplete="new-password" minLength={8} required />
      </label>

      {state && 'error' in state ? <p className="t-body text-rust">{state.error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className={BUTTON_PRIMARY}
      >
        {pending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
