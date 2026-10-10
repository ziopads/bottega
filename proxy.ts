import { auth } from '@/lib/auth/server';

// Next 16 names this file proxy.ts (middleware.ts before). It only establishes
// that someone is signed in; the allowlist is checked beside the data, in
// pages, Server Actions and route handlers (lib/auth/guard.ts).

export default auth.middleware({
  loginUrl: '/auth/sign-in',
});

export const config = {
  matcher: [
    // Everything except the auth pages, the auth API, static assets, and the
    // three paths Claude calls from Anthropic's servers for the connector
    // (api/mcp, .well-known, oauth), which cannot follow a redirect to a
    // sign-in form and decide access themselves. Anything with a file
    // extension is an asset; a page route never has a dot in its last segment.
    '/((?!auth|api/auth|api/mcp|\\.well-known|oauth|_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)',
  ],
};
