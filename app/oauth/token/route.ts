// The token endpoint. Form-encoded, as RFC 6749 §4.1.3 requires and Claude
// sends. Public clients only: no client secret, PKCE instead (lib/oauth.ts).
// Nobody is signed in here: the code or refresh token is the authority, and
// db/012 checks it.

import { TokenError, exchangeCode, exchangeRefresh } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json(
      { error: 'invalid_request', error_description: 'expected application/x-www-form-urlencoded' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const grant = field(form, 'grant_type');
    const client_id = field(form, 'client_id');
    let body;
    if (grant === 'authorization_code') {
      body = await exchangeCode({
        code: field(form, 'code'),
        client_id,
        redirect_uri: field(form, 'redirect_uri'),
        code_verifier: field(form, 'code_verifier'),
      });
    } else if (grant === 'refresh_token') {
      body = await exchangeRefresh({ refresh_token: field(form, 'refresh_token'), client_id });
    } else {
      throw new TokenError('unsupported_grant_type', 'authorization_code or refresh_token');
    }
    return Response.json(body, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof TokenError) {
      return Response.json({ error: err.code, error_description: err.message }, { status: 400, headers: NO_STORE });
    }
    console.error('oauth token endpoint', err);
    return Response.json({ error: 'server_error' }, { status: 500, headers: NO_STORE });
  }
}
