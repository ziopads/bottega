// The Neon connection, as in Scriptorium.
//
// @neondatabase/serverless speaks to Postgres over HTTP, which is what makes it
// usable from a serverless function where a long-lived TCP pool has nowhere to
// live. Two consequences:
//
//   1. Every tagged-template call is its own round trip. Prefer one query with
//      a join over two convenient ones.
//   2. There is no transaction across separate calls. Anything that must be
//      atomic needs sql.transaction([...]) (non-interactive: no result passes
//      from one statement to the next) or a single statement doing the work.
//
// DATABASE_URL is the pooled string. DATABASE_URL_UNPOOLED is for the pipeline
// and for anything needing a real session.

import { neon } from '@neondatabase/serverless';

type Sql = ReturnType<typeof neon>;

let cached: Sql | null = null;

// Resolved on first use, so that a build without environment variables does not
// throw on import.
export function db(): Sql {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. It belongs in .env.local.');
  cached = neon(url);
  return cached;
}

// The driver's result type is a union of its array and object modes. Every
// query here uses the default object mode, so rows are cast once, here.
export type Row = Record<string, unknown>;

export async function rows<T = Row>(query: Promise<unknown>): Promise<T[]> {
  return (await query) as T[];
}
