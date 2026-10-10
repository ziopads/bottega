import { redirect } from 'next/navigation';

import { signOut } from '@/app/auth/sign-in/actions';
import { getAccount } from '@/lib/access';

// Where a signed-in person lands until the platform administrator approves
// their account, and where a disabled account is held (REQUIREMENTS AC-1,
// AC-2). It shows nothing of anyone's work.

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Awaiting approval · Bottega' };

export default async function PendingPage() {
  const account = await getAccount();
  if (!account) redirect('/auth/sign-in');
  if (account.status === 'active') redirect('/');

  return (
    <div className="max-w-sm space-y-4 py-12">
      {account.status === 'disabled' ? (
        <>
          <h1 className="text-2xl">Account disabled</h1>
          <p className="text-sm">
            The account for {account.email} has been disabled. Ask the person who runs Bottega if you think this is a
            mistake.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl">Awaiting approval</h1>
          <p className="text-sm">
            Your account ({account.email}) has been created and is waiting to be approved. Once it is, signing in
            brings you to your own sessions and gear.
          </p>
        </>
      )}
      <form action={signOut}>
        <button type="submit" className="text-sm text-rust underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
