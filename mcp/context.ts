// Who a connector request is for. app/api/mcp/route.ts verifies the bearer
// token and puts the account id in authInfo.extra; every tool builds its
// query handle from it, so it sees exactly what that person sees in the app
// (REQUIREMENTS M-2, AC-10).

import { forPerson, type Scoped } from '@/lib/db';

/** For the model to read and act on; anything else is a bug and is reported without detail. */
export class ToolError extends Error {}

export function personFrom(ctx: unknown): Scoped {
  const c = ctx as { http?: { authInfo?: { extra?: { userId?: unknown } } }; authInfo?: { extra?: { userId?: unknown } } };
  const userId = c?.http?.authInfo?.extra?.userId ?? c?.authInfo?.extra?.userId;
  if (typeof userId !== 'string' || !userId) throw new ToolError('This connection has no account. Reconnect Bottega.');
  return forPerson({ userId });
}

/** The app's address as the request reached it, for links back into the app. */
export function appOrigin(ctx: unknown): string {
  const c = ctx as { http?: { authInfo?: { extra?: { origin?: unknown } } }; authInfo?: { extra?: { origin?: unknown } } };
  const origin = c?.http?.authInfo?.extra?.origin ?? c?.authInfo?.extra?.origin;
  return typeof origin === 'string' && origin ? origin : 'https://studio.sirsinate.com';
}
