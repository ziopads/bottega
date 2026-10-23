import Link from 'next/link';

// The app's layout pieces (ARCHITECTURE §13): the same few, used on every
// page, so pages differ in content and never in how they are put together.
//
//   PageHeader   the way back, the title, one line of facts, the page's actions
//   DetailGrid   twelve columns: main 8, aside 4, the aside on the right or
//                the left (side); one column below lg, main first
//   Section      a small grey label over a hairline rule, then the content
//   MetaList     label / value rows, for an aside
//   TabBar       tabs as links (a page per tab) or as buttons (one page)
//
// Type has four sizes, as utilities in globals.css: t-title (18px, page
// titles only), t-lead (15px, the main thing in a block), t-body (13px,
// everything else) and t-label (11px uppercase, labels and metadata).

export function PageHeader({
  back,
  title,
  meta,
  actions,
}: {
  back?: { href: string; label: string };
  /** A string, or an inline editor at t-title size. */
  title: React.ReactNode;
  /** Short facts, joined by a middle dot: maker, kind, size, owner. */
  meta?: React.ReactNode[];
  actions?: React.ReactNode;
}) {
  const facts = (meta ?? []).filter((m) => m !== null && m !== undefined && m !== false && m !== '');
  return (
    <header className="mb-6 mt-3">
      {back && (
        <Link href={back.href} className="t-body text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="t-title min-w-0">{title}</h1>
        {actions && <div className="t-body ml-auto flex flex-wrap items-center gap-3">{actions}</div>}
      </div>
      {facts.length > 0 && (
        <p className="t-body mt-1 flex flex-wrap items-baseline gap-x-2 text-muted">
          {facts.map((f, i) => (
            <span key={i} className="flex items-baseline gap-x-2">
              {i > 0 && <span aria-hidden>·</span>}
              {f}
            </span>
          ))}
        </p>
      )}
    </header>
  );
}

/**
 * A page's columns, general to detail from left to right (23 October). With an
 * outline (a contents list, the stages, the sections), three columns: the
 * outline on the left, kept in view; the work in the middle; context such as
 * members or notes on the right. Without one, the work and a narrow column.
 */
export function DetailGrid({
  main,
  aside,
  outline,
  side = 'right',
}: {
  main: React.ReactNode;
  aside?: React.ReactNode;
  /** The general view on the left from lg up: what the page is part of, to move around it. */
  outline?: React.ReactNode;
  /** Where the narrow column sits from lg up when there is no outline. Below lg, main always comes first. */
  side?: 'left' | 'right';
}) {
  if (outline) {
    return (
      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-3">
          <div className="lg:sticky lg:top-4">{outline}</div>
        </div>
        <div className={`min-w-0 ${aside ? 'lg:col-span-6' : 'lg:col-span-9'}`}>{main}</div>
        {aside && <aside className="min-w-0 lg:col-span-3">{aside}</aside>}
      </div>
    );
  }
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
