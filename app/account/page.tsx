import { requireAccount } from '@/lib/access';
import { getAllowance } from '@/lib/documents';
import { listUnconvertedImages } from '@/lib/gear';
import { formatBytes } from '@/lib/studioTypes';
import { getUsage, USAGE_LABEL } from '@/lib/usage';

import ChangePasswordForm from './ChangePasswordForm';
import ConvertImages from './ConvertImages';

export const metadata = { title: 'Account · Bottega' };

// The account: what it stores and processes against its allowances
// (REQUIREMENTS K-10, O-7), and its password.

function Meter({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) return null;
  const share = limit > 0 ? Math.min(1, used / limit) : 1;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-line" aria-hidden>
      <div className={`h-full ${share > 0.9 ? 'bg-rust' : 'bg-ink/70'}`} style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

export default async function AccountPage() {
  const user = await requireAccount();
  const [usage, allowance, unconverted] = await Promise.all([
    getUsage(user.db),
    getAllowance(user.db),
    listUnconvertedImages(user.db),
  ]);
  const totalFiles = usage.reduce((n, u) => n + u.files, 0);
  const stored = allowance?.storageUsed ?? usage.reduce((n, u) => n + u.bytes, 0);

  return (
    <div className="max-w-2xl space-y-10 py-4">
      <div>
        <h1 className="text-2xl">Account</h1>
        <p className="mt-1 text-sm text-muted">{user.email}</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg">Usage</h2>

        <div className="text-sm">
          <div className="flex items-baseline justify-between">
            <span>Storage</span>
            <span className="text-muted">
              {formatBytes(stored) || '0 KB'}
              {allowance?.storageBytes != null ? ` of ${formatBytes(allowance.storageBytes)}` : ' (no limit)'} · {totalFiles}{' '}
              {totalFiles === 1 ? 'file' : 'files'}
            </span>
          </div>
          <Meter used={stored} limit={allowance?.storageBytes ?? null} />
        </div>

        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {usage.map((u) => (
              <tr key={u.kind}>
                <td className="py-1.5">{USAGE_LABEL[u.kind]}</td>
                <td className="py-1.5 text-right text-muted">
                  {u.files} {u.files === 1 ? 'file' : 'files'}
                </td>
                <td className="w-28 py-1.5 text-right">{u.bytes ? formatBytes(u.bytes) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {allowance && (
          <div className="text-sm">
            <div className="flex items-baseline justify-between">
              <span>Pages processed this month</span>
              <span className="text-muted">
                {allowance.pagesUsed.toLocaleString()}
                {allowance.pagesPerMonth !== null ? ` of ${allowance.pagesPerMonth.toLocaleString()}` : ' (no limit)'}
              </span>
            </div>
            <Meter used={allowance.pagesUsed} limit={allowance.pagesPerMonth} />
            {allowance.maxDocumentPages !== null && (
              <p className="mt-1 text-xs text-muted">Documents can be up to {allowance.maxDocumentPages.toLocaleString()} pages.</p>
            )}
          </div>
        )}

        {unconverted.length > 0 && <ConvertImages images={unconverted} />}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg">Change password</h2>
        <ChangePasswordForm />
      </section>
    </div>
  );
}
