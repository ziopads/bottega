import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth/server';

// Neon Auth's proxy, narrowed to what Bottega uses (decided 12 October 2026).
//
// auth.handler() forwards any path under /api/auth to Neon Auth's Better Auth
// API: sign-up, sign-in, change-email, delete-user and the rest, whatever
// Neon has switched on. Bottega needs none of that here. Signing in, signing
// up, signing out and changing a password run in Server Actions that call
// Neon Auth directly from the server (lib/auth/server.ts), and the middleware
// (proxy.ts) checks sessions against Neon Auth directly too; nothing in the
// browser calls /api/auth. So only reading one's own session is passed on,
// for any client code that may ask for it later, and every other path is a
// 404, as if the route did not exist.
//
// This narrows what reaches Neon Auth through studio.sirsinate.com. Whether
// someone may use Bottega is still decided by approval (REQUIREMENTS AC-1,
// AC-2): an identity created any other way waits as pending and reaches
// nothing.

const ALLOWED: Record<string, readonly string[]> = {
  'get-session': ['GET'],
};

const proxy = auth.handler();

type Ctx = { params: Promise<{ path: string[] }> };

async function guarded(method: 'GET' | 'POST', req: Request, ctx: Ctx) {
  const path = (await ctx.params).path.join('/');
  if (!ALLOWED[path]?.includes(method)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  return proxy[method](req as never, ctx as never);
}

export function GET(req: Request, ctx: Ctx) {
  return guarded('GET', req, ctx);
}

export function POST(req: Request, ctx: Ctx) {
  return guarded('POST', req, ctx);
}
