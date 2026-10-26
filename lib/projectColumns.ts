// The Projects list's columns (db/033): which show and in what order, chosen
// per person and kept with the account. A plain module for server and client.

export const PROJECT_COLUMNS = [
  { key: 'rating', label: 'Rating' },
  { key: 'artist', label: 'Artist' },
  { key: 'owner', label: 'Owner' },
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Working name' },
  { key: 'genre', label: 'Genre' },
  { key: 'bpm', label: 'BPM' },
  { key: 'versions', label: 'Ver.' },
  { key: 'length', label: 'Length' },
  { key: 'collections', label: 'Collections' },
  { key: 'date', label: 'Project' },
  { key: 'upload', label: 'Uploaded' },
  { key: 'board', label: 'Board' },
] as const;

export type ProjectColumn = (typeof PROJECT_COLUMNS)[number]['key'];

export const DEFAULT_COLUMNS: ProjectColumn[] = PROJECT_COLUMNS.map((c) => c.key);

/** With the default (no choice saved), minor columns appear only on wider windows. */
export const RESPONSIVE: Partial<Record<ProjectColumn, string>> = {
  collections: 'hidden 2xl:table-cell',
  date: 'hidden xl:table-cell',
  upload: 'hidden 2xl:table-cell',
};

export function isProjectColumn(x: unknown): x is ProjectColumn {
  return typeof x === 'string' && PROJECT_COLUMNS.some((c) => c.key === x);
}

export function columnLabel(k: ProjectColumn): string {
  return PROJECT_COLUMNS.find((c) => c.key === k)?.label ?? k;
}
