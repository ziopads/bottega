import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Anton,
  Big_Shoulders,
  Bodoni_Moda,
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Instrument_Sans,
  Space_Mono,
  Work_Sans,
} from 'next/font/google';
import './globals.css';
import MainNav from '@/app/_ui/MainNav';
import Wordmark from '@/app/_ui/Wordmark';

import { signOut } from '@/app/auth/sign-in/actions';
import SitePlayer from '@/app/_ui/audio/SitePlayer';
import VolumeControl from '@/app/_ui/audio/VolumeControl';
import { getAccount } from '@/lib/access';

const instrument = Instrument_Sans({ variable: '--font-instrument', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
// The other themes' faces (app/themes.css). Not preloaded: a browser fetches
// a face only when the theme in use asks for it. next/font needs each call's
// options written out in full (no shared object).
const geist = Geist({ subsets: ['latin'], preload: false, variable: '--font-geist' });
const work = Work_Sans({ subsets: ['latin'], preload: false, variable: '--font-work' });
const spaceMono = Space_Mono({ subsets: ['latin'], preload: false, weight: ['400', '700'], variable: '--font-space-mono' });
const anton = Anton({ subsets: ['latin'], preload: false, weight: '400', variable: '--font-anton' });
const bodoni = Bodoni_Moda({ subsets: ['latin'], preload: false, style: ['normal', 'italic'], variable: '--font-bodoni' });
const plex = IBM_Plex_Sans({ subsets: ['latin'], preload: false, variable: '--font-plex' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], preload: false, weight: ['400', '500'], variable: '--font-plex-mono' });
const shoulders = Big_Shoulders({ subsets: ['latin'], preload: false, variable: '--font-shoulders' });
const FONTS = [instrument, geistMono, geist, work, spaceMono, anton, bodoni, plex, plexMono, shoulders].map((f) => f.variable).join(' ');

export const metadata: Metadata = {
  title: 'Bottega',
  description: 'Studio, gear, and work in progress.',
};

// The layout reads the session, so every route touches cookies. Declaring it
// stops Next trying to prerender /_not-found and /auth/sign-in and reporting
// the fallback as a build error.
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/', label: 'Board' },
  { href: '/todos', label: 'To-dos' },
  { href: '/projects', label: 'Projects' },
  { href: '/collections', label: 'Collections' },
  { href: '/gear', label: 'Gear' },
  { href: '/library', label: 'Library' },
  { href: '/learning', label: 'Learning' },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Display only. The guard that matters runs in each page and action, and in
  // the database. Pending and disabled accounts get no navigation.
  const account = await getAccount();
  const user = account?.status === 'active' ? account : null;
  const nav = user?.isPlatformAdmin
    ? [...NAV, { href: '/admin/catalogue', label: 'Catalogue' }, { href: '/admin/accounts', label: 'Accounts' }]
    : NAV;

  return (
    <html
      lang="en"
      data-theme={account?.theme ?? 'minimal'}
      data-mode={account?.mode ?? 'system'}
      className={`${FONTS} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-7xl items-end gap-6 px-5 pt-2.5">
            <Wordmark theme={account?.theme ?? 'minimal'} />
            {user ? <MainNav items={nav} /> : null}
            {user ? (
              <form action={signOut} className="ml-auto flex items-center gap-4 pb-2.5 t-body">
                <VolumeControl />
                <Link href="/account" className="text-muted hover:text-rust">
                  {user.name || user.email}
                </Link>
                <button type="submit" className="text-muted hover:text-rust">
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-4">{children}</main>
        {/* The site's one player: stays mounted across pages, so a mix plays on (S-17). */}
        {user ? <SitePlayer /> : null}
      </body>
    </html>
  );
}
