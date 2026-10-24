'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The site's navigation, with the section one is in marked the way the tabs
// within a page are (TabBar in layout.tsx): a box joined to the line under the
// header. The Board is the home page, so it is marked only there.

export type NavItem = { href: string; label: string };

function isActive(path: string, href: string): boolean {
  if (href === '/') return path === '/';
  return path === href || path.startsWith(`${href}/`);
}

export default function MainNav({ items }: { items: NavItem[] }) {
  const path = usePathname() ?? '/';
  return (
    <nav className="t-body -mb-px flex flex-wrap gap-1 self-end" aria-label="Sections">
      {items.map((item) => {
        const active = isActive(path, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`border px-3 py-1.5 ${active ? 'border-line border-b-parchment bg-parchment text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
