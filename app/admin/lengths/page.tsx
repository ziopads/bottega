import { requireAccount } from '@/lib/access';
import { missingDurations } from '@/lib/studio';
import LengthBackfill from './LengthBackfill';

// Fills in the length of every mix and reference uploaded without one (the
// older Vivarium uploads). The browser reads each file's metadata through the
// usual signed link and reports the length, exactly as an upload does, so no
// server-side audio library is needed. Lists the files in the signed-in
// person's own projects only; safe to run more than once.

export const metadata = { title: 'Fill in lengths · Bottega' };

export default async function LengthsPage() {
  const { db } = await requireAccount();
  const missing = await missingDurations(db);
  return (
    <div className="max-w-2xl space-y-4 py-4">
      <h1 className="font-serif text-2xl">Fill in lengths</h1>
      <p className="text-sm text-muted">
        {missing.length === 0
          ? 'Every file has its length.'
          : `${missing.length} ${missing.length === 1 ? 'file has' : 'files have'} no length on record.`}
      </p>
      {missing.length > 0 && <LengthBackfill items={missing} />}
    </div>
  );
}
