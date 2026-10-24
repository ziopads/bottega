// Artists' templates and sharing (REQUIREMENTS W-30 to W-32, db/028), shared
// by server and client. No imports, so client components can use them.

export type ArtistShare = { id: number; granteeName: string; level: 'view' | 'edit' };

export type ArtistSetting = {
  id: number;
  code: string;
  name: string;
  /** The person's own, or one shared with them. */
  mine: boolean;
  ownerName: string;
  /** What the person may do: 'owner', 'edit' (credit and choose templates) or 'view'. */
  level: 'owner' | 'edit' | 'view';
  /** null: the account's from Preferences. */
  workflowTemplateId: number | null;
  structureTemplateId: number | null;
  /** Who it is shared with; the owner's own artists only. */
  shares: ArtistShare[];
};

export type TemplateOption = { id: number; name: string; note: string };

export type ArtistSettingsData = {
  artists: ArtistSetting[];
  /** Every music workflow template and track structure the person can choose. */
  workflowTemplates: TemplateOption[];
  structures: TemplateOption[];
};
