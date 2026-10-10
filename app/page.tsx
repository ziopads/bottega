import { requireAllowedUser } from '@/lib/auth/guard';
import { db, rows } from '@/lib/db';

// Placeholder home for Phase 0, step 2: proves sign-in, the allowlist and the
// database connection end to end. Replaced by the project list in step 4.

export default async function Home() {
  const user = await requireAllowedUser();
  const sql = db();
  const [counts] = await rows<{ artists: number; projects: number; applied: number }>(sql`
    select (select count(*)::int from artists)          as artists,
           (select count(*)::int from projects)         as projects,
           (select count(*)::int from schema_migrations) as applied
  `);

  return (
    <div className="space-y-2 py-6">
      <h1 className="text-2xl">Bottega</h1>
      <p className="text-sm text-muted">Signed in as {user.email}.</p>
      <p className="text-sm">
        {counts.applied} migrations applied · {counts.artists} artists · {counts.projects} projects
      </p>
    </div>
  );
}
