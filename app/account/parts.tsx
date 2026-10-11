// Small pieces shared by the account page's tabs. No 'use client': the server
// page and the client tabs both import these.

export function ComingSoon({ children }: { children?: React.ReactNode }) {
  return (
    <div className="t-body text-muted">
      <p className="font-medium text-ink">Coming soon…</p>
      {children && <p className="mt-1 max-w-prose">{children}</p>}
    </div>
  );
}

export const FIELD = 'rounded border border-line bg-card px-1.5 py-0.5 outline-none focus:border-rust';

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
