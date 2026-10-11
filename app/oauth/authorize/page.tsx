// The consent screen Claude opens when the Bottega connector is added.
//
// proxy.ts leaves /oauth to this page, because the sign-in middleware's
// redirect drops the query string and with it Claude's request. So the page
// does its own: not signed in goes to /auth/sign-in with ?next= pointing back
// here; a pending or disabled account goes to /auth/pending.
//
// A bad client or redirect_uri is shown here and never redirected to: an
// address the client's own metadata document does not list must not receive
// anything, not even an error. The screen names the client by the host of its
// client_id, not by the name it gives itself.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAccount } from '@/lib/access';
import { AUTHORIZE_FIELDS, checkAuthorize, originFrom, readAuthorizeParams } from '@/lib/oauth';

import { allow, deny } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connect Claude · Bottega' };

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const p = readAuthorizeParams((name) => {
    const v = sp[name];
    return Array.isArray(v) ? v[0] : v;
  });

  const account = await getAccount();
  if (!account) {
    const back = new URLSearchParams();
    for (const f of AUTHORIZE_FIELDS) if (p[f]) back.set(f, p[f]);
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/oauth/authorize?${back.toString()}`)}`);
  }
  if (account.status !== 'active') redirect('/auth/pending');

  let host: string;
  try {
    host = (await checkAuthorize(p, originFrom(await headers()))).host;
  } catch (err) {
    return (
      <div className="mx-auto max-w-sm space-y-4 py-12">
        <h1 className="t-title">Cannot connect</h1>
        <p className="t-body">This request to connect to Bottega was refused.</p>
        <p className="t-body text-rust">{(err as Error).message}</p>
      </div>
    );
  }

  const hidden = AUTHORIZE_FIELDS.map((f) => <input key={f} type="hidden" name={f} value={p[f]} />);

  return (
    <div className="mx-auto max-w-sm space-y-5 py-12">
      <h1 className="t-title">Connect Claude</h1>
      <p className="t-body">
        <strong>{host}</strong> is asking to use Bottega as <strong>{account.email}</strong>: to read your sessions, their
        workflow, notes and mixes&rsquo; details, your gear and documents, and what others have shared with you, through the
        tools the connector offers. Anything it writes waits for you to accept it.
      </p>
      <p className="t-body text-muted">
        Access lasts until you revoke it under Account › Security. Signing out here does not end it.
      </p>
      <div className="flex gap-3">
        <form action={allow}>
          {hidden}
          <button type="submit" className="t-body rounded border border-ink px-4 py-1.5 hover:bg-ink hover:text-parchment">
            Allow
          </button>
        </form>
        <form action={deny}>
          {hidden}
          <button type="submit" className="t-body rounded border border-line px-4 py-1.5 text-muted hover:text-ink">
            Deny
          </button>
        </form>
      </div>
    </div>
  );
}
