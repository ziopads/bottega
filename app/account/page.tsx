import { DetailGrid, Section, TabBar } from '@/app/_ui/layout';
import {
  getPreferences,
  getProfile,
  listActivity,
  listIncomingShares,
  listMyArtists,
  listOutgoingShares,
} from '@/lib/account';
import { ACCOUNT_TAB_LABEL, ACCOUNT_TABS, type AccountTab } from '@/lib/accountTabs';
import { requireAccount } from '@/lib/access';
import { listConnections } from '@/lib/connections';
import { getAllowance } from '@/lib/documents';
import { listUnconvertedImages } from '@/lib/gear';
import { getStructureEditor } from '@/lib/structure';
import { getTemplateEditor } from '@/lib/templates';
import { getUsage } from '@/lib/usage';

import ChangePasswordForm from './ChangePasswordForm';
import ConnectedApps from './ConnectedApps';
import ConvertImages from './ConvertImages';
import { ComingSoon } from './parts';
import PreferencesTab from './PreferencesTab';
import ProfileTab from './ProfileTab';
import SharingTab from './SharingTab';
import UsageTab from './UsageTab';
import When from './When';

export const metadata = { title: 'Account · Bottega' };

// The account, in tabs (REQUIREMENTS O-7, AC-12, AC-13). Each tab is its own
// address (?tab=) and loads only its own data.
//
//   Profile      the name others see, email, the account's artists
//   Usage        storage by kind, largest files under each; pages processed
//   Sharing      every share granted, to change or revoke; what is shared in
//   Security     password, recent activity from the access log
//   Preferences  the artist new projects start with, the board's limits, the
//                workflow template
//   Billing      coming with plans
//   Data         coming: export and account deletion

type Props = { searchParams?: Promise<{ tab?: string }> };

export default async function AccountPage({ searchParams }: Props) {
  const user = await requireAccount();
  const asked = (await searchParams)?.tab;
  const tab: AccountTab = ACCOUNT_TABS.includes(asked as AccountTab) ? (asked as AccountTab) : 'profile';
  const { db } = user;

  let body: React.ReactNode;
  if (tab === 'profile') {
    const [profile, artists] = await Promise.all([getProfile(db), listMyArtists(db)]);
    body = (
      <ProfileTab
        initialName={profile?.displayName ?? ''}
        email={profile?.email ?? user.email}
        since={profile?.createdAt ?? null}
        initialArtists={artists}
      />
    );
  } else if (tab === 'usage') {
    const [usage, allowance, unconverted] = await Promise.all([getUsage(db), getAllowance(db), listUnconvertedImages(db)]);
    body = (
      <UsageTab usage={usage} allowance={allowance}>
        {unconverted.length > 0 && (
          <Section label="Older photos">
            <ConvertImages images={unconverted} />
          </Section>
        )}
      </UsageTab>
    );
  } else if (tab === 'sharing') {
    const [outgoing, incoming] = await Promise.all([listOutgoingShares(db), listIncomingShares(db)]);
    body = <SharingTab initialOutgoing={outgoing} incoming={incoming} />;
  } else if (tab === 'security') {
    const [activity, connections] = await Promise.all([listActivity(db), listConnections(db)]);
    body = (
      <DetailGrid
        main={
          <>
            <Section label="Recent activity">
              {activity.length === 0 ? (
                <p className="t-body text-muted">Nothing yet.</p>
              ) : (
                <ul className="t-body divide-y divide-line">
                  {activity.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-3 py-1.5">
                      <span className="min-w-0 flex-1">{a.text}</span>
                      <span className="shrink-0 text-[11px] text-muted">
                        {a.mine ? '' : `${a.actorName} · `}
                        <When iso={a.at} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-muted">
                The latest 50 entries about your account and your items. Entries are permanent.
              </p>
            </Section>
            <Section label="Signed-in devices">
              <ComingSoon>Where your account is signed in, with a way to sign each one out.</ComingSoon>
            </Section>
            <Section label="Connected apps">
              <ConnectedApps initial={connections} />
            </Section>
          </>
        }
        aside={
          <Section label="Change password">
            <ChangePasswordForm />
          </Section>
        }
      />
    );
  } else if (tab === 'preferences') {
    const [artists, preferences, editor, structure] = await Promise.all([
      listMyArtists(db),
      getPreferences(db),
      getTemplateEditor(db),
      getStructureEditor(db),
    ]);
    body = <PreferencesTab artists={artists} initialDefaultArtistId={preferences.defaultArtistId} editor={editor} structure={structure} />;
  } else if (tab === 'billing') {
    body = (
      <DetailGrid
        main={
          <Section label="Billing">
            <ComingSoon>Plans, invoices and payment details arrive with plans. Until then nothing is charged.</ComingSoon>
          </Section>
        }
      />
    );
  } else {
    body = (
      <DetailGrid
        main={
          <Section label="Your data">
            <ComingSoon>
              An export of everything the account holds (projects, audio, gear, documents and notes), and closing the
              account.
            </ComingSoon>
          </Section>
        }
      />
    );
  }

  return (
    <div className="mt-3">
      <h1 className="t-title">Account</h1>
      <p className="t-body mt-1 text-muted">{user.email}</p>
      <div className="mb-6 mt-3 border-b border-line">
        <TabBar
          current={tab}
          tabs={ACCOUNT_TABS.map((key) => ({
            key,
            label: ACCOUNT_TAB_LABEL[key],
            href: key === 'profile' ? '/account' : `/account?tab=${key}`,
          }))}
        />
      </div>
      {body}
    </div>
  );
}
