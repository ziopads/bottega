import { signOut } from '@/app/auth/sign-in/actions';

// Reached when someone is signed in but not on the allowlist, and also when
// ALLOWED_EMAILS is unset, since the guard fails closed. If this appears for an
// address that should work, check the environment variable before the account.

export const dynamic = 'force-dynamic';

export default function DeniedPage() {
  return (
    <div className="max-w-sm space-y-4 py-12">
      <h1 className="text-2xl">No access</h1>
      <p className="text-sm">That account exists but is not permitted to use Bottega.</p>
      <form action={signOut}>
        <button type="submit" className="text-sm text-rust underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
