// The account page's tabs (REQUIREMENTS O-7, AC-12, AC-13). A plain module,
// so the server page reads the list as a value (see lib/sessionTabs.ts).

export const ACCOUNT_TABS = ['profile', 'usage', 'sharing', 'security', 'preferences', 'billing', 'data'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

export const ACCOUNT_TAB_LABEL: Record<AccountTab, string> = {
  profile: 'Profile',
  usage: 'Usage',
  sharing: 'Sharing',
  security: 'Security',
  preferences: 'Preferences',
  billing: 'Billing',
  data: 'Data',
};
