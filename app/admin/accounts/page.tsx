import Link from 'next/link';

import { requirePlatformAdmin } from '@/lib/access';
import { setAccount } from './actions';

// Accounts and the access log, for the platform administrator (REQUIREMENTS
// AC-2, AC-11, AC-12). New sign-ups appear here as pending; approving one
// opens an empty account for them. Nothing here shows anyone's work; that is
// /admin/accounts/[id], and every visit there is logged.

export const metadata = { title: 'Accounts · Bottega' };

type AccountRow = {
  user_id: string;
  email: string;
  display_name: string;
  status: 'pending' | 'active' | 'disabled';
  is_platform_admin: boolean;
  created_at: Date;
  approved_at: Date | null;
};

type LogRow = {
  id: string;
  at: Date;
  actor: string;
  action: string;
  subject_id: string | null;
  item_kind: string | null;
  item_id: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
};

const when = (d: Date | null) =>
  d ? new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '';

function change(row: LogRow): string {
  const parts: string[] = [];
  if (row.before) parts.push(`from ${JSON.stringify(row.before)}`);
  if (row.after) parts.push(`to ${JSON.stringify(row.after)}`);
  return parts.join(' ');
}

export default async function AccountsPage() {
  const admin = await requirePlatformAdmin();
  const [accounts, log] = await Promise.all([
    admin.db.q(
      `select user_id, email, display_name, status, is_platform_admin, created_at, approved_at
       from accounts order by (status = 'pending') desc, created_at`,
    ) as unknown as Promise<AccountRow[]>,
    admin.db.q(
      `select id, at, actor, action, subject_id, item_kind, item_id, before, after, reason
       from access_log order by id desc limit 200`,
    ) as unknown as Promise<LogRow[]>,
  ]);
  const label = new Map(accounts.map((a) => [a.user_id, a.display_name || a.email]));
  const who = (id: string | null) => (id ? (label.get(id) ?? id) : '');

  return (
    <div className="space-y-10 py-4">
      <section>
        <h1 className="mb-4 t-title">Accounts</h1>
        <table className="w-full t-body">
          <thead className="text-left t-label">
            <tr>
              <th className="py-2 pr-4 font-normal">Person</th>
              <th className="py-2 pr-4 font-normal">Status</th>
              <th className="py-2 pr-4 font-normal">Signed up</th>
              <th className="py-2 font-normal">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line border-y border-line">
            {accounts.map((a) => (
              <tr key={a.user_id} className="align-top">
                <td className="py-2 pr-4">
                  <div>{a.display_name || <span className="text-muted">no name</span>}</div>
                  <div className="text-[11px] text-muted">{a.email}</div>
                  {a.status === 'active' && a.user_id !== admin.userId && (
                    <Link href={`/admin/accounts/${encodeURIComponent(a.user_id)}`} className="text-[11px] underline hover:text-rust">
                      view their work (logged)
                    </Link>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {a.status}
                  {a.is_platform_admin && <span className="text-muted"> · administrator</span>}
                </td>
                <td className="py-2 pr-4 text-[11px] text-muted">{when(a.created_at)}</td>
                <td className="py-2">
                  <form action={setAccount} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="userId" value={a.user_id} />
                    <select name="status" defaultValue={a.status} className="rounded border border-line bg-card px-2 py-1">
                      <option value="pending">pending</option>
                      <option value="active">active</option>
                      <option value="disabled">disabled</option>
                    </select>
                    <select
                      name="isAdmin"
                      defaultValue={String(a.is_platform_admin)}
                      className="rounded border border-line bg-card px-2 py-1"
                    >
                      <option value="false">not administrator</option>
                      <option value="true">administrator</option>
                    </select>
                    <input
                      name="reason"
                      placeholder="reason (kept in the log)"
                      className="w-56 rounded border border-line bg-card px-2 py-1"
                    />
                    <button type="submit" className="rounded border border-line px-3 py-1 hover:border-ink">
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="t-label mb-3 border-b border-line pb-1">Access log</h2>
        <p className="mb-4 text-[11px] text-muted">The latest 200 entries. Entries cannot be changed or removed.</p>
        <ul className="divide-y divide-line border-y border-line t-body">
          {log.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-4 gap-y-1 py-2">
              <span className="w-44 shrink-0 text-[11px] text-muted">{when(e.at)}</span>
              <span className="w-40 shrink-0">{who(e.actor)}</span>
              <span className="font-mono text-[11px]">{e.action}</span>
              {e.subject_id && <span>{who(e.subject_id)}</span>}
              {e.item_kind && (
                <span className="text-[11px] text-muted">
                  {e.item_kind} {e.item_id}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted" title={change(e)}>
                {change(e)}
              </span>
              {e.reason && <span className="text-[11px] italic">“{e.reason}”</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
