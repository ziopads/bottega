import { createNeonAuth } from '@neondatabase/auth/next/server';

// Managed Better Auth, hosted by Neon, copied from Scriptorium. Authentication
// only: proving that someone is who they say. Authorization is ours and lives
// in ./guard.ts.
//
// Neon Auth allows anyone on the web to sign up, and /api/auth/[...path]
// proxies that API, so open registration is reachable whether or not there is
// a sign-up form. Accounts are therefore created in the Neon Console, and
// access is decided by the allowlist.
//
// Constructed at module load, because proxy.ts calls auth.middleware() at
// module scope. Both variables must exist at BUILD time as well as at runtime;
// a Vercel build missing either fails while collecting page data.

const baseUrl = process.env.NEON_AUTH_BASE_URL;
const secret = process.env.NEON_AUTH_COOKIE_SECRET;

if (!baseUrl) {
  throw new Error(
    'NEON_AUTH_BASE_URL is not set. It is in the Neon Console under Auth → ' +
      'Configuration, and it must exist in the build environment as well as at runtime.',
  );
}

if (!secret) {
  throw new Error(
    'NEON_AUTH_COOKIE_SECRET is not set. Generate one with `openssl rand -base64 32`. ' +
      'It must exist in the build environment as well as at runtime.',
  );
}

export const auth = createNeonAuth({
  baseUrl,
  cookies: { secret },
});
