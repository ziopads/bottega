'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { Section } from '@/app/_ui/layout';
import { BUTTON, BUTTON_PRIMARY, FIELD, TEXT_ACTION } from '@/app/_ui/styles';
import type { StudyGroupSummary, StudyInvitation } from '@/lib/studyTypes';

// The Learning page (REQUIREMENTS §10): invitations waiting for the person,
// the study groups they belong to, and starting a new one.

export default function LearningHome({ groups, invitations }: { groups: StudyGroupSummary[]; invitations: StudyInvitation[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  async function answerInvitation(inv: StudyInvitation, accept: boolean) {
    setError('');
    setBusy(true);
    const r = await api<{ groupId: number }>(`/api/study/invitations/${inv.id}`, { method: 'POST', body: JSON.stringify({ accept }) });
    setBusy(false);
    if (!r.ok) return setError(r.body.error || 'That did not go through.');
    if (accept) router.push(`/learning/${r.data.groupId}`);
    else router.refresh();
  }

  async function create(e: { preventDefault(): void }) {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    setBusy(true);
    const r = await api<{ id: number }>('/api/study/groups', { method: 'POST', body: JSON.stringify({ name, description }) });
    setBusy(false);
    if (!r.ok) return setError(r.body.error || 'Could not start the group.');
    router.push(`/learning/${r.data.id}`);
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-6 t-title">Learning</h1>

      {invitations.length > 0 && (
        <Section label="Invitations">
          <ul className="t-body divide-y divide-line">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                <span className="min-w-0 flex-1">
                  <span className="t-lead">{inv.groupName}</span>
                  <span className="text-muted"> · from {inv.invitedByName}</span>
                </span>
                <button onClick={() => answerInvitation(inv, true)} disabled={busy} className={BUTTON_PRIMARY}>
                  Join
                </button>
                <button onClick={() => answerInvitation(inv, false)} disabled={busy} className={TEXT_ACTION}>
                  Decline
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label="Your study groups">
        {groups.length === 0 ? (
          <p className="t-body text-muted">
            None yet. A study group holds a syllabus of topics, lessons that cite your manuals and books, and exercises each member
            checks off. Start one below; you can invite people once they have an approved account.
          </p>
        ) : (
          <ul className="t-body divide-y divide-line">
            {groups.map((g) => (
              <li key={g.id} className="py-2">
                <Link href={`/learning/${g.id}`} className="t-lead hover:text-rust">
                  {g.name}
                </Link>
                <p className="text-muted">
                  {[
                    `${g.memberCount} ${g.memberCount === 1 ? 'member' : 'members'}`,
                    `${g.topicCount} ${g.topicCount === 1 ? 'topic' : 'topics'}`,
                    `custodian ${g.custodianName}`,
                    g.waiting > 0 ? `${g.waiting} proposed by Claude, waiting` : null,
                    g.status === 'closed' ? 'closed' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {g.description && <p className="mt-0.5 max-w-prose">{g.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label="Start a study group">
        <form onSubmit={create} className="t-body max-w-prose space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, such as MPC study" aria-label="Name" className={`${FIELD} w-full`} />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What the group is for (optional)"
            aria-label="Description"
            rows={2}
            className={`${FIELD} w-full`}
          />
          <button disabled={busy || !name.trim()} className={BUTTON}>
            Start it
          </button>
          <p className="text-[11px] text-muted">You become its custodian: you write the syllabus, review Claude’s proposals and invite members.</p>
        </form>
      </Section>
      {error && <p className="t-body text-rust">{error}</p>}
    </div>
  );
}
