'use client';

import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, BUTTON_DANGER } from '@/app/_ui/styles';
import type { ArtistSetting, ArtistSettingsData, TemplateOption } from '@/lib/artistTypes';

import { FIELD } from './parts';

// Account › Profile › Templates and sharing (REQUIREMENTS W-30 to W-32;
// db/028): for each artist, the workflow template and track structure its
// projects start with (else the account's from Preferences), and who it is
// shared with. Edit lets a collaborator credit their own projects to the
// artist and edit the templates it uses; view only shows it. Artists shared
// with the person are listed after their own.

export default function ArtistSettings({ initial }: { initial: ArtistSettingsData }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(artistId: number, body: Record<string, unknown>): Promise<boolean> {
    setError('');
    setBusy(true);
    const r = await api<ArtistSettingsData>(`/api/artists/${artistId}/settings`, { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body?.error || 'That did not go through.');
      return false;
    }
    setData(r.data);
    return true;
  }

  const own = data.artists.filter((a) => a.mine);
  const shared = data.artists.filter((a) => !a.mine);
  return (
    <div className="t-body space-y-3">
      <p className="text-[12px] text-muted">
        A project starts with its artist&rsquo;s workflow template and track structure; &ldquo;Account default&rdquo; uses the ones chosen under
        Preferences. Templates are made and edited under Preferences.
      </p>
      {error && <p className="text-rust">{error}</p>}
      {own.length === 0 && <p className="text-muted">Add an artist above first.</p>}
      <ul className="divide-y divide-line border-y border-line">
        {own.map((a) => (
          <ArtistRow key={a.id} a={a} data={data} busy={busy} post={post} />
        ))}
      </ul>
      {shared.length > 0 && (
        <>
          <p className="t-label pt-2">Shared with you</p>
          <ul className="divide-y divide-line border-y border-line">
            {shared.map((a) => (
              <ArtistRow key={a.id} a={a} data={data} busy={busy} post={post} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TemplateSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  options: TemplateOption[];
  disabled: boolean;
  onChange: (id: number | null) => void;
}) {
  // A template chosen by someone else that this person cannot read shows by its id only.
  const missing = value !== null && !options.some((o) => o.id === value);
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-muted">
      {label}
      <select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={FIELD}>
        <option value="">Account default</option>
        {missing && <option value={value}>A template you cannot see</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name} · {o.note}
          </option>
        ))}
      </select>
    </label>
  );
}

function ArtistRow({
  a,
  data,
  busy,
  post,
}: {
  a: ArtistSetting;
  data: ArtistSettingsData;
  busy: boolean;
  post: (artistId: number, body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState<'edit' | 'view'>('edit');
  const canSet = a.level === 'owner' || a.level === 'edit';
  const setTemplates = (w: number | null, s: number | null) => post(a.id, { op: 'templates', workflowTemplateId: w, structureTemplateId: s });
  const editors = a.shares.filter((s) => s.level === 'edit').map((s) => s.granteeName);
  return (
    <li className="space-y-2 py-3">
      <p className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{a.name}</span>
        <span className="font-mono text-[11px] text-muted">
          {a.code}
          {a.mine ? '' : ` · ${a.ownerName}’s · ${a.level}`}
        </span>
      </p>
      <div className="flex flex-wrap gap-3">
        <TemplateSelect
          label="Workflow template"
          value={a.workflowTemplateId}
          options={data.workflowTemplates}
          disabled={!canSet || busy}
          onChange={(id) => setTemplates(id, a.structureTemplateId)}
        />
        <TemplateSelect
          label="Track structure"
          value={a.structureTemplateId}
          options={data.structures}
          disabled={!canSet || busy}
          onChange={(id) => setTemplates(a.workflowTemplateId, id)}
        />
      </div>
      {editors.length > 0 && (a.workflowTemplateId !== null || a.structureTemplateId !== null) && (
        <p className="text-[11px] text-muted">{editors.join(', ')} can edit these templates through {a.code}.</p>
      )}
      {!a.mine && a.level === 'edit' && (
        <p className="text-[11px] text-muted">You can credit your own projects to {a.code} and edit the templates it uses.</p>
      )}
      {!a.mine && a.level === 'view' && <p className="text-[11px] text-muted">Shared with you to view: you cannot credit projects to it.</p>}

      {a.mine && (
        <div className="space-y-1.5">
          {a.shares.length > 0 && (
            <ul className="space-y-1">
              {a.shares.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <span>{s.granteeName}</span>
                  <select
                    value={s.level}
                    disabled={busy}
                    onChange={(e) => post(a.id, { op: 'share-level', shareId: s.id, level: e.target.value })}
                    aria-label={`${s.granteeName}'s access to ${a.code}`}
                    className={FIELD}
                  >
                    <option value="edit">edit</option>
                    <option value="view">view</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => confirm(`Stop sharing ${a.code} with ${s.granteeName}? Projects already credited to it stay credited.`) && post(a.id, { op: 'unshare', shareId: s.id })}
                    className={BUTTON_DANGER}
                  >
                    Stop sharing
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await post(a.id, { op: 'share', email, level })) setEmail('');
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Share with: their email"
              aria-label={`Share ${a.code} with`}
              className={`${FIELD} w-64`}
            />
            <select value={level} onChange={(e) => setLevel(e.target.value === 'view' ? 'view' : 'edit')} aria-label="Level" className={FIELD}>
              <option value="edit">edit</option>
              <option value="view">view</option>
            </select>
            <button type="submit" disabled={busy || !email.includes('@')} className={BUTTON}>
              Share
            </button>
          </form>
          <p className="text-[11px] text-muted">
            Edit lets them credit their own projects to {a.code} and edit the templates it uses. Each project stays in its owner&rsquo;s account.
          </p>
        </div>
      )}
    </li>
  );
}
