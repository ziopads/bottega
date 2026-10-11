// The authorization server for the remote MCP endpoint (app/api/mcp),
// ported from Scriptorium (REQUIREMENTS M-1, ARCHITECTURE §6).
//
// Neon Auth cannot act as an OAuth provider, so the application issues tokens
// itself on top of the ordinary sign-in: Neon Auth proves who someone is, the
// account's status decides whether they may use Bottega (§11), and the tokens
// here only carry that decision to Claude. Codes and tokens live in
// oauth_tokens behind db/012's functions, which check the account's status on
// every exchange and every request, so disabling an account stops its
// connector at once.
//
// WHAT CLAUDE NEEDS (claude.com/docs/connectors/building/authentication):
//
//   - protected resource metadata naming this app as the authorization server
//   - authorization server metadata advertising client_id_metadata_document_
//     supported AND token_endpoint_auth_methods_supported ["none"], or Claude
//     falls back to dynamic registration, which this server does not offer
//   - S256 PKCE on every authorization request
//   - a token endpoint that reads form-encoded bodies and rotates refresh tokens
//
// WHICH CLIENTS
//
//   Only Claude. A client_id must be an https URL on claude.ai, and it must
//   dereference to a Client ID Metadata Document whose own client_id is that
//   URL and which lists the redirect_uri being used. Claude Code lists loopback
//   redirects and binds an ephemeral port, so those are compared with the port
//   ignored (RFC 8252 §7.3). Any other client is refused before anything is
//   shown.

import { createHash, randomBytes } from 'node:crypto';

import { db, type Scoped } from '@/lib/db';

export const SCOPE = 'bottega';
export const CLIENT_HOST = 'claude.ai';

const CODE_SECONDS = 10 * 60;
export const ACCESS_SECONDS = 60 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;

// ── Addresses ────────────────────────────────────────────────────────────────

// The public origin, from the proxy headers Vercel sets; the same rule as
// mcp-handler's getPublicOrigin, for places that have Headers but no Request.
export function originFrom(headers: Headers): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? 'localhost:3000';
  const proto =
    headers.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}

export function resourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/api/mcp';

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
  };
}

export const METADATA_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'max-age=300',
};

// ── Secrets ──────────────────────────────────────────────────────────────────

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// ── Clients (Client ID Metadata Documents) ───────────────────────────────────

export type Client = { clientId: string; host: string; redirectUris: string[] };

export async function loadClient(clientId: string): Promise<Client> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new Error('client_id is not a URL');
  }
  if (url.protocol !== 'https:' || url.hostname !== CLIENT_HOST || url.hash) {
    throw new Error(`only Claude (https://${CLIENT_HOST}) may connect`);
  }

  let doc: unknown;
  try {
    const res = await fetch(url, {
      redirect: 'error',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    doc = await res.json();
  } catch (err) {
    throw new Error(`the client's metadata document could not be read (${(err as Error).message})`);
  }

  const d = doc as { client_id?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
  if (d.client_id !== clientId) throw new Error("the client's metadata document does not name itself");
  if (!Array.isArray(d.redirect_uris) || !d.redirect_uris.every((u) => typeof u === 'string')) {
    throw new Error("the client's metadata document lists no redirect URIs");
  }
  if (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== 'none') {
    throw new Error('only public clients are supported');
  }
  return { clientId, host: url.hostname, redirectUris: d.redirect_uris as string[] };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function redirectAllowed(client: Client, redirectUri: string): boolean {
  let asked: URL;
  try {
    asked = new URL(redirectUri);
  } catch {
    return false;
  }
  if (asked.hash) return false;

  for (const listed of client.redirectUris) {
    let reg: URL;
    try {
      reg = new URL(listed);
    } catch {
      continue;
    }
    if (LOOPBACK.has(reg.hostname)) {
      // Native client: same scheme, host and path, any port.
      if (
        asked.protocol === 'http:' &&
        reg.protocol === 'http:' &&
        asked.hostname === reg.hostname &&
        asked.pathname === reg.pathname &&
        asked.search === reg.search
      ) {
        return true;
      }
    } else if (listed === redirectUri) {
      // Web client: exact match, and on the client's own origin.
      if (asked.origin === new URL(client.clientId).origin) return true;
    }
  }
  return false;
}

// ── The authorization request ────────────────────────────────────────────────

export type AuthorizeParams = {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  resource: string;
};

export const AUTHORIZE_FIELDS: (keyof AuthorizeParams)[] = [
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'resource',
];

export function readAuthorizeParams(get: (name: string) => string | null | undefined): AuthorizeParams {
  const out = {} as AuthorizeParams;
  for (const f of AUTHORIZE_FIELDS) out[f] = (get(f) ?? '').toString();
  return out;
}

// Everything that must hold before a consent screen is shown or a code issued.
// Run on the page and again in the Server Action, because hidden form fields
// can be changed by anyone who can post the form.
export async function checkAuthorize(p: AuthorizeParams, origin: string): Promise<Client> {
  if (p.response_type !== 'code') throw new Error('response_type must be code');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') throw new Error('a PKCE S256 code_challenge is required');
  if (!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) throw new Error('code_challenge is malformed');
  if (p.resource && p.resource.replace(/\/$/, '') !== resourceUrl(origin)) {
    throw new Error(`this server only issues tokens for ${resourceUrl(origin)}`);
  }
  const client = await loadClient(p.client_id);
  if (!redirectAllowed(client, p.redirect_uri)) throw new Error("redirect_uri is not one the client's metadata document lists");
  return client;
}

export function redirectWith(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

// ── Storage (db/012) ─────────────────────────────────────────────────────────

/** The signed-in person consents: a one-time code for Claude, logged as token_issued. */
export async function issueCode(person: Scoped, p: AuthorizeParams): Promise<string> {
  const code = newSecret();
  await person.q('select oauth_issue_code($1, $2, $3, $4, $5)', [
    hashSecret(code),
    p.client_id,
    p.redirect_uri,
    p.code_challenge,
    CODE_SECONDS,
  ]);
  return code;
}

export class TokenError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function pair() {
  const access = newSecret();
  const refresh = newSecret();
  return {
    access,
    refresh,
    body: { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPE },
  };
}

// Before anyone is known: the code or refresh token is the authority, and
// db/012's functions do every check in one statement.
export async function exchangeCode(form: { code: string; client_id: string; redirect_uri: string; code_verifier: string }) {
  if (!form.code || !form.code_verifier) throw new TokenError('invalid_request', 'code and code_verifier are required');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(form.code_verifier)) throw new TokenError('invalid_grant', 'PKCE verification failed');
  const p = pair();
  const rows = (await db().query('select oauth_exchange_code($1, $2, $3, $4, $5, $6, $7, $8) as refusal', [
    hashSecret(form.code),
    form.client_id,
    form.redirect_uri,
    s256(form.code_verifier),
    hashSecret(p.access),
    hashSecret(p.refresh),
    ACCESS_SECONDS,
    REFRESH_SECONDS,
  ])) as { refusal: string | null }[];
  if (rows[0]?.refusal) throw new TokenError('invalid_grant', rows[0].refusal);
  return p.body;
}

export async function exchangeRefresh(form: { refresh_token: string; client_id: string }) {
  if (!form.refresh_token) throw new TokenError('invalid_request', 'refresh_token is required');
  const p = pair();
  const rows = (await db().query('select oauth_exchange_refresh($1, $2, $3, $4, $5, $6) as refusal', [
    hashSecret(form.refresh_token),
    form.client_id,
    hashSecret(p.access),
    hashSecret(p.refresh),
    ACCESS_SECONDS,
    REFRESH_SECONDS,
  ])) as { refusal: string | null }[];
  if (rows[0]?.refusal) throw new TokenError('invalid_grant', rows[0].refusal);
  return p.body;
}

/** The account an access token was issued to, while the token is live and the account active. */
export async function verifyAccess(token: string) {
  const rows = (await db().query('select user_id, client_id, expires_epoch from oauth_verify($1)', [hashSecret(token)])) as {
    user_id: string;
    client_id: string;
    expires_epoch: string | number;
  }[];
  const row = rows[0];
  if (!row) return undefined;
  return { userId: row.user_id, clientId: row.client_id, expiresAt: Number(row.expires_epoch) };
}
