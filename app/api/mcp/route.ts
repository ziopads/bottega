// The remote MCP endpoint, behind OAuth: https://<host>/api/mcp
//
// Every request needs a bearer token issued by this app's authorization server
// (lib/oauth.ts, app/oauth/*). Without one the answer is 401 with a
// WWW-Authenticate header pointing at the protected resource metadata, which
// is how Claude learns where to send the person to sign in. The token names
// its account (db/012 oauth_verify, which also requires the account to be
// active), and every tool runs as that account, exactly as a page would
// (REQUIREMENTS M-2, AC-10).

import { withMcpAuth } from 'mcp-handler';

import { originFrom, RESOURCE_METADATA_PATH, SCOPE, verifyAccess } from '@/lib/oauth';
import { handler } from '@/mcp/server';

export const dynamic = 'force-dynamic';

const authed = withMcpAuth(
  handler,
  async (req, token) => {
    if (!token) return undefined;
    const found = await verifyAccess(token);
    if (!found) return undefined;
    return {
      token,
      clientId: found.clientId,
      scopes: [SCOPE],
      expiresAt: found.expiresAt,
      // origin: for links back into the app in tool results.
      extra: { userId: found.userId, origin: originFrom(req.headers) },
    };
  },
  { required: true, resourceMetadataPath: RESOURCE_METADATA_PATH },
);

export { authed as GET, authed as POST, authed as DELETE };
