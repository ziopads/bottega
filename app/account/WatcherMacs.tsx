'use client';

import Link from 'next/link';
import { useState } from 'react';

import { api } from '@/app/_studio/controls';
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY, TEXT_LINK } from '@/app/_ui/styles';
import type { MacsData, WatcherMac } from '@/lib/macs';
import type { WatcherReport } from '@/lib/tokens';

import { FIELD, formatWhen } from './parts';

// Account › Security › Mac watcher (REQUIREMENTS A-9 to A-12; db/026, db/027):
// each Mac the watcher runs on, with its name and its own sessions folder,
// set here. Adding a Mac, or installing it again, gives a one-time setup code
// inside an install command to paste into Terminal on that Mac; the installer
// trades the code for the Mac's own token, kept in its keychain, so no secret
// is shown here. Changing a Mac's folder here reaches its watcher at its next
// sweep. Each Mac shows its watcher's last report. Tokens made by hand before
// Macs are listed below them, to revoke.

type Shown = { macId: number; code: string; command: string };

const PATH_HINT =
  'In Finder, select the sessions folder, then Control-click it, hold Option, and choose “Copy … as Pathname”. Paste it here.';

function installCommand(code: string): string {
  const origin = window.location.origin;
  return `curl -fsSL ${origin}/watcher/install.sh | bash -s -- --server ${origin} --code ${code}`;
}

export default function WatcherMacs({ initial }: { initial: MacsData }) {
  const [data, setData] = useState(initial);
  const [shown, setShown] = useState<Shown | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(initial.macs.length === 0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setError('');
    setBusy(true);
    const r = await api<MacsData & { code?: string }>('/api/account/macs', { method: 'POST', body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) {
      setError(r.body?.error || 'That did not go through.');
      return false;
    }
    const { code, ...next } = r.data;
    setData(next);
    if (code) {
      // The Mac just added is the newest; one installed again keeps its id.
      const macId = typeof body.id === 'number' ? body.id : Math.max(...next.macs.map((m) => m.id));
      setShown({ macId, code, command: installCommand(code) });
    }
    return true;
  }

  const reportOf = (tokenId: number | null) => (tokenId === null ? undefined : data.reports.find((r) => r.tokenId === tokenId));

  return (
    <div className="t-body space-y-3">
      <p className="text-muted">
        The watcher runs on your Mac, notices each set Live saves in your sessions folder, and sends it here with the folder&rsquo;s file list, as
        you. Add each Mac you make music on, with the folder its sessions are in; the install command sets it up in one step.
      </p>
      {error && <p className="text-rust">{error}</p>}

      {data.macs.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {data.macs.map((m) => (
            <li key={m.id} className="space-y-1.5 py-2">
              {editing === m.id ? (
                <MacForm
                  initialName={m.name}
                  initialRoot={m.root}
                  submitLabel="Save"
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (name, root) => {
                    if (await post({ op: 'update', id: m.id, name, root })) setEditing(null);
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">{m.name}</span>
                    <span className="min-w-0 break-all font-mono text-[12px]">{m.root}</span>
                    <span className="ml-auto flex gap-2">
                      <button onClick={() => setEditing(m.id)} disabled={busy} className={BUTTON}>
                        Edit
                      </button>
                      <button onClick={() => void post({ op: 'new-code', id: m.id })} disabled={busy} className={BUTTON}>
                        {m.tokenId === null ? 'New code' : 'Install again'}
                      </button>
                      <button
                        onClick={() =>
                          confirm(`Remove “${m.name}”? Its watcher stops sending sets at once. To uninstall it from the Mac as well, see the setup guide.`) &&
                          void post({ op: 'remove', id: m.id })
                        }
                        disabled={busy}
                        className={BUTTON_DANGER}
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                  <MacStatus mac={m} report={reportOf(m.tokenId)} />
                </>
              )}
              {shown?.macId === m.id && <InstallPanel shown={shown} mac={m} onDone={() => setShown(null)} />}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded border border-line p-3">
          <p className="mb-2 font-medium">Add a Mac</p>
          <MacForm
            initialName={data.macs.length === 0 ? 'Studio Mac' : ''}
            initialRoot=""
            submitLabel="Add and get the install command"
            busy={busy}
            onCancel={data.macs.length > 0 ? () => setAdding(false) : undefined}
            onSubmit={async (name, root) => {
              if (await post({ op: 'add', name, root })) setAdding(false);
            }}
          />
        </div>
      ) : (
        <button onClick={() => setAdding(true)} disabled={busy} className={BUTTON}>
          Add a Mac
        </button>
      )}

      {data.otherTokens.length > 0 && (
        <div className="space-y-1 pt-2">
          <p className="font-medium">Tokens made by hand</p>
          <p className="text-[12px] text-muted">
            From before Macs were set up here. Once a Mac above is installed, revoke the token it used.
          </p>
          <ul className="divide-y divide-line border-y border-line">
            {data.otherTokens.map((t) => {
              const r = reportOf(t.id);
              return (
                <li key={t.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">{t.name}</span>
                    <span className="font-mono text-[11px] text-muted">{t.prefix}…</span>
                    <span className="text-[11px] text-muted">{t.lastUsedAt ? `last used ${formatWhen(t.lastUsedAt)}` : 'never used'}</span>
                    <button
                      onClick={() => confirm(`Revoke “${t.name}”? A watcher using it stops sending sets.`) && void post({ op: 'revoke-token', id: t.id })}
                      disabled={busy}
                      className={`ml-auto ${BUTTON_DANGER}`}
                    >
                      Revoke
                    </button>
                  </div>
                  {r && <ReportLine report={r} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function MacForm({
  initialName,
  initialRoot,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  initialRoot: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (name: string, root: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [root, setRoot] = useState(initialRoot);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(name, root);
      }}
      className="space-y-2"
    >
      <label className="block">
        <span className="text-[12px] text-muted">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio Mac" className={`block w-full max-w-xs ${FIELD}`} />
      </label>
      <label className="block">
        <span className="text-[12px] text-muted">Sessions folder on this Mac</span>
        <input
          value={root}
          onChange={(e) => setRoot(e.target.value)}
          placeholder="/Volumes/Drive/Ableton Sessions"
          spellCheck={false}
          className={`block w-full font-mono text-[12px] ${FIELD}`}
        />
        <span className="mt-0.5 block text-[11px] text-muted">{PATH_HINT} The project folders are the folders directly inside it.</span>
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !name.trim() || !root.trim()} className={BUTTON_PRIMARY}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={BUTTON}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function InstallPanel({ shown, mac, onDone }: { shown: Shown; mac: WatcherMac; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded border border-ink p-3">
      <p className="font-medium">Install on {mac.name}</p>
      <p className="mt-1 text-[12px] text-muted">
        On that Mac, open Terminal (in Applications › Utilities), paste this, and press Return. The code in it works once, for fifteen minutes
        {mac.codeExpiresAt ? ` (until ${new Date(mac.codeExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})` : ''}.
      </p>
      <p className="mt-2 select-all break-all rounded bg-ink/5 px-2 py-1 font-mono text-[12px]">{shown.command}</p>
      <p className="mt-2 text-[11px] text-muted">
        It downloads Node.js (checked against nodejs.org&rsquo;s published checksums) and the watcher into Library › Application Support › Bottega
        Watcher, signs this Mac in with its own token kept in the keychain, and starts the watcher at login. Nothing needs administrator rights.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(shown.command).then(() => setCopied(true));
          }}
          className={BUTTON_PRIMARY}
        >
          {copied ? 'Copied' : 'Copy the command'}
        </button>
        <button onClick={onDone} className={BUTTON}>
          Done
        </button>
      </div>
    </div>
  );
}

function MacStatus({ mac, report }: { mac: WatcherMac; report: WatcherReport | undefined }) {
  if (mac.tokenId === null) {
    return (
      <p className="text-[12px] text-muted">
        Not installed yet.{' '}
        {mac.codeExpiresAt ? `Its setup code works until ${formatWhen(mac.codeExpiresAt)}.` : 'Its setup code has expired: use New code to install.'}
      </p>
    );
  }
  if (!report) return <p className="text-[12px] text-muted">Installed; its watcher has not reported yet.</p>;
  return <ReportLine report={report} />;
}

function ReportLine({ report: r }: { report: WatcherReport }) {
  return (
    <div className="text-[12px] text-muted">
      Watcher {r.version} on {r.host || 'a Mac'} · last heard {formatWhen(r.reportedAt)}
      {r.rootFound === false && (
        <span className="text-rust"> · the sessions folder is not there (is the drive mounted, or the path right?)</span>
      )}
      {r.pending > 0 && (
        <span className="text-ink">
          {' '}
          · {r.pending} {r.pending === 1 ? 'set waits' : 'sets wait'} to be sent
        </span>
      )}
      {r.unmatched.length > 0 && (
        <div className="mt-1">
          <span className="text-ink">Folders with no project:</span> {r.unmatched.join(' · ')}. Make the project (its canonical id is the date at the
          start of the folder name), or drop the folder once on the project&rsquo;s State tab, and the watcher picks it up.{' '}
          <Link href="/projects" className={TEXT_LINK}>
            Projects
          </Link>
        </div>
      )}
    </div>
  );
}
