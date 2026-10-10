import { auth } from '@/lib/auth/server';

// Proxies every Managed Better Auth call, including sign-up, which is inherent
// to the SDK. That is why the allowlist, and not registration, controls access.

export const { GET, POST } = auth.handler();
