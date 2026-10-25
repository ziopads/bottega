import Link from 'next/link';

// The method (REQUIREMENTS W-42, db/032): the principles of the workflow
// template, closed by default at the foot of the Workflow tab and the board.
// A server or client component; it holds no state.

export type MethodPrinciple = { id: number; title: string; body: string };

export default function Method({ principles, editHref }: { principles: MethodPrinciple[]; editHref?: string }) {
  if (principles.length === 0) return null;
  return (
    <details className="panel t-body mt-10 border-t border-line pt-3">
      <summary className="t-section cursor-pointer">The method</summary>
      <ol className="mt-4 grid list-none grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-x-8 gap-y-4 p-0">
        {principles.map((p) => (
          <li key={p.id}>
            <p className="font-medium">{p.title}</p>
            {p.body && <p className="mt-0.5 text-muted">{p.body}</p>}
          </li>
        ))}
      </ol>
      {editHref && (
        <p className="mt-4 t-small text-muted">
          The method belongs to the workflow template.{' '}
          <Link href={editHref} className="underline decoration-ink/30 underline-offset-2 hover:decoration-ink">
            Change it in Preferences
          </Link>
        </p>
      )}
    </details>
  );
}
