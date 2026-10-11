'use server';

// Allow and Deny on the consent screen. Everything the page checked is checked
// again here: the form's hidden fields are only a convenience, and anyone who
// can post this action can change them.

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAccount } from '@/lib/access';
import { checkAuthorize, issueCode, originFrom, readAuthorizeParams, redirectWith } from '@/lib/oauth';

async function checked(form: FormData) {
  const p = readAuthorizeParams((name) => {
    const v = form.get(name);
    return typeof v === 'string' ? v : null;
  });
  await checkAuthorize(p, originFrom(await headers()));
  return p;
}

export async function allow(form: FormData): Promise<void> {
  const account = await getAccount();
  if (!account) redirect('/auth/sign-in');
  if (account.status !== 'active') redirect('/auth/pending');
  const p = await checked(form);
  const code = await issueCode(account.db, p);
  redirect(redirectWith(p.redirect_uri, { code, state: p.state }));
}

export async function deny(form: FormData): Promise<void> {
  const account = await getAccount();
  if (!account) redirect('/auth/sign-in');
  const p = await checked(form);
  redirect(redirectWith(p.redirect_uri, { error: 'access_denied', state: p.state }));
}
