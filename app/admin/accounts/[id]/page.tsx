import Link from 'next/link';
import { notFound } from 'next/navigation';

import { adminViewOf, requirePlatformAdmin } from '@/lib/access';
import { listProjects, listReleases } from '@/lib/studio';
import { formatDuration } from '@/lib/studioTypes';

// The platform administrator's read-only view of one account's work
// (REQUIREMENTS AC-9). Opening it writes an access-log entry naming the
// account; the handle it uses can read but the database refuses every write
// through it.

export const metadata = { title: 'Account view · Bottega' };

export default async function AccountViewPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requirePlatformAdmin();
  const accountId = decodeURIComponent((await params).id);
  const found = await admin.db.q('select email, display_name, status from accounts where user_id = $1', [accountId]);
  if (!found.length) notFound();
  const person = found[0];

  const view = await adminViewOf(admin, accountId, `/admin/accounts/${accountId}`);
  const [projects, releases] = await Promise.all([listProjects(view), listReleases(view)]);
  const theirs = projects.filter((p) => p.ownerId === accountId);
  const theirReleases = releases.filter((r) => r.ownerId === accountId);

  return (
    <div className="space-y-8 py-4">
      <div>
        <Link href="/admin/accounts" className="t-body text-muted hover:text-rust">
          ← Accounts
        </Link>
        <h1 className="mt-2 t-title">{String(person.display_name || person.email)}</h1>
        <p className="t-body text-muted">
          {String(person.email)} · {String(person.status)} · read-only; this visit is in the access log
        </p>
      </div>

      <section>
        <h2 className="t-label mb-3 border-b border-line pb-1">Sessions ({theirs.length})</h2>
        <ul className="divide-y divide-line border-y border-line t-body">
          {theirs.map((p) => (
            <li key={p.id} className="flex gap-4 py-2">
              <span className="w-40 shrink-0 font-mono text-[11px] text-muted">
                {p.artist.code} {p.canonicalId}
              </span>
              <span className="min-w-0 flex-1">{p.workingName || 'untitled'}</span>
              <span className="text-[11px] text-muted">
                {p.latest ? `${p.latest.count} mixes · ${formatDuration(p.latest.durationS)}` : 'no audio'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="t-label mb-3 border-b border-line pb-1">Collections ({theirReleases.length})</h2>
        <ul className="divide-y divide-line border-y border-line t-body">
          {theirReleases.map((r) => (
            <li key={r.id} className="py-2">
              {r.title} <span className="text-[11px] text-muted">· {r.trackCount} tracks</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
