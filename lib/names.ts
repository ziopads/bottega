import type { Scoped } from '@/lib/db';

// Display names for account ids (never emails), through the database's
// account_names(), which returns names only for active accounts. Shared by
// every data layer that shows who owns, uploaded or wrote something.

export const NO_NAME = 'someone';

export async function accountNames(db: Scoped, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(Array.from(ids).filter((x): x is string => !!x)));
  if (!wanted.length) return new Map();
  const rows = await db.q('select user_id, display_name from account_names($1)', [wanted]);
  return new Map(rows.map((r) => [String(r.user_id), String(r.display_name) || NO_NAME]));
}

export function nameOf(map: Map<string, string>, id: string | null | undefined): string {
  return (id && map.get(id)) || NO_NAME;
}
