import { requireAccount } from '@/lib/access';
import ChangePasswordForm from './ChangePasswordForm';

export const metadata = { title: 'Account · Bottega' };

export default async function AccountPage() {
  const user = await requireAccount();

  return (
    <div className="max-w-2xl space-y-6 py-4">
      <div>
        <h1 className="text-2xl">Account</h1>
        <p className="mt-1 text-sm text-muted">{user.email}</p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg">Change password</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
