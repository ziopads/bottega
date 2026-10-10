'use server';

import { revalidatePath } from 'next/cache';

import { requirePlatformAdmin } from '@/lib/access';

// The platform administrator's changes to accounts (REQUIREMENTS AC-2). Each
// goes through the database function admin_set_account, which checks again
// that the caller is the administrator, refuses to remove the last one, and
// leaves the change in the access log with the reason given here.

const STATUSES = ['pending', 'active', 'disabled'] as const;
type Status = (typeof STATUSES)[number];

export async function setAccount(form: FormData): Promise<void> {
  const admin = await requirePlatformAdmin();
  const userId = form.get('userId');
  const status = form.get('status');
  const isAdmin = form.get('isAdmin') === 'true';
  const reason = form.get('reason');
  if (typeof userId !== 'string' || !userId) throw new Error('Missing account.');
  if (typeof status !== 'string' || !STATUSES.includes(status as Status)) throw new Error('Unknown status.');
  await admin.db.q('select admin_set_account($1, $2, $3, $4)', [
    userId,
    status,
    isAdmin,
    typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null,
  ]);
  revalidatePath('/admin/accounts');
}
