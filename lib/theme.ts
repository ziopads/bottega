// The site's themes (REQUIREMENTS O-9; app/themes.css draws them). A plain
// module: the layout, the account page and the preferences route import it.

export const THEMES = [
  { key: 'minimal', label: 'Minimal', blurb: 'Black on white: the original look.' },
  { key: 'console', label: 'Console', blurb: 'Studio hardware: charcoal or aluminium, a lime signal, boxed panels.' },
  { key: 'riso', label: 'Riso', blurb: 'Underground print: newsprint, pink and blue inks.' },
  { key: 'gallery', label: 'Gallery', blurb: 'Editorial: bone and ink, Bodoni names, brass.' },
  { key: 'rack', label: 'Rack', blurb: 'Channel strips: grey and white panels, amber, teal for what Live reports.' },
] as const;

export type Theme = (typeof THEMES)[number]['key'];

export const MODES = [
  { key: 'system', label: 'As the computer' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
] as const;

export type Mode = (typeof MODES)[number]['key'];

export function isTheme(x: unknown): x is Theme {
  return typeof x === 'string' && THEMES.some((t) => t.key === x);
}

export function isMode(x: unknown): x is Mode {
  return typeof x === 'string' && MODES.some((m) => m.key === x);
}
