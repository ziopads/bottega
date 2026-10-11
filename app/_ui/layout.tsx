import Link from 'next/link';

// The app's layout pieces (ARCHITECTURE §13): the same few, used on every
// page, so pages differ in content and never in how they are put together.
//
//   DetailGrid   twelve columns: main 8, aside 4, the aside on the right or
//                the left (side); one column below lg, main first
//   Section      a small grey label over a hairline rule, then the content
//   MetaList     label / value rows, for an aside
//   TabBar       tabs as links (a page per tab) or as buttons (one page)
//
// Type has four sizes, as utilities in globals.css: t-title (22px, page
// titles only), t-lead (15px, the main thing in a block), t-body (13px,
// everything else) and t-label (11px uppercase, labels and metadata).

export function DetailGrid({
  main,
  aside,
  side = 'right',
}: {
  main: React.ReactNode;
  aside?: React.ReactNode;
  /** Where the narrow column sits from lg up. Below lg, main always comes first. */
  side?: 'left' | 'right';
}) {
  return (
    <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
      <div className={`min-w-0 ${aside ? 'lg:col-span-8' : 'lg:col-span-12'}`}>{main}</div>
      {aside && <aside className={`min-w-0 lg:col-span-4 ${side === 'left' ? 'lg:order-first' : ''}`}>{aside}</aside>}
    </div>
  );
}

export function Section({
  label,
  action,
  children,
  className = '',
}: {
  label: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-8 ${className}`}>
      <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-1">
        <h2 className="t-label">{label}</h2>
        {action && <div className="t-body ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function MetaList({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="t-body divide-y divide-line">
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline gap-3 py-1.5">
          <dt className="t-label w-24 shrink-0">{r.label}</dt>
          <dd className="min-w-0 flex-1">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type Tab = { key: string; label: string; count?: number; href?: string };

export function TabBar({ tabs, current, onSelect }: { tabs: Tab[]; current: string; onSelect?: (key: string) => void }) {
  return (
    <nav className="t-body -mb-px flex flex-wrap gap-1" aria-label="Views">
      {tabs.map((t) => {
        const active = t.key === current;
        const cls = `border px-3 py-1.5 ${
          active ? 'border-line border-b-parchment bg-parchment text-ink' : 'border-transparent text-muted hover:text-ink'
        }`;
        const body = (
          <>
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="t-num ml-1.5 text-muted">{t.count}</span>}
          </>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} aria-current={active ? 'page' : undefined} className={cls}>
            {body}
          </Link>
        ) : (
          <button key={t.key} type="button" onClick={() => onSelect?.(t.key)} aria-current={active ? 'page' : undefined} className={cls}>
            {body}
          </button>
        );
      })}
    </nav>
  );
}
