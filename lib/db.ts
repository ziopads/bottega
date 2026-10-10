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

// ── Queries made as a person (db/002, ARCHITECTURE §11) ─────────────────────
//
// Every statement the app sends about account data runs as someone. Each call
// below is one non-interactive transaction that first sets app.user_id (and
// app.admin_view for the administrator's read-only view) with is_local =
// true, then runs the statement. The setting ends with the transaction, so
// nothing carries over on the pooled connection, and it costs no extra round
// trip. Row-level security reads the setting; with no person set, every
// policy returns nothing.
//
// A Scoped handle comes only from lib/access.ts (a signed-in account) or, from
// Phase 1, the connector (a token's account). Data functions take one as their
// first argument, so a query cannot be written without saying whose it is.

export interface Person {
  userId: string;
  /** The platform administrator's read-only view of another account (AC-9). */
  adminView?: boolean;
}

export interface Statement {
  text: string;
  params?: unknown[];
}

export interface Scoped {
  person: Person;
  /** One statement, as the person. */
  q(text: string, params?: unknown[]): Promise<Row[]>;
  /** Several statements in one transaction, as the person; results in order. */
  tx(statements: Statement[]): Promise<Row[][]>;
}

const SET_PERSON = `select set_config('app.user_id', $1, true), set_config('app.admin_view', $2, true)`;

export function forPerson(person: Person): Scoped {
  if (!person.userId) throw new Error('forPerson needs a user id.');
  const setter = () => db().query(SET_PERSON, [person.userId, person.adminView ? 'on' : '']);
  return {
    person,
    async q(text, params = []) {
      const results = (await db().transaction([setter(), db().query(text, params)])) as Row[][];
      return results[1];
    },
    async tx(statements) {
      if (!statements.length) return [];
      const results = (await db().transaction([
        setter(),
        ...statements.map((s) => db().query(s.text, s.params ?? [])),
      ])) as Row[][];
      return results.slice(1);
    },
  };
}
