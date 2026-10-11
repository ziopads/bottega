// Gear shapes and input rules, shared by server and client (REQUIREMENTS §4,
// ARCHITECTURE §4 "Gear"). No imports from the database layer, so client
// components can use them.

import type { AccessLevel } from '@/lib/studioTypes';

export const GEAR_KINDS = ['hardware', 'software', 'book', 'cable', 'other'] as const;
export type GearKind = (typeof GEAR_KINDS)[number];

// gear_models.category (db/003, widened in db/005), a closed list so a query can name it.
export const GEAR_CATEGORIES = [
  'synthesizer', 'drum machine', 'sampler', 'groovebox', 'instrument', 'sequencer',
  'effect', 'mixer', 'interface', 'controller', 'monitor', 'microphone',
  'preamp', 'amplifier', 'recorder', 'patchbay', 'midi utility', 'utility', 'test equipment',
  'instrument plugin', 'effect plugin', 'host', 'sample library',
  'book', 'cable', 'power', 'other',
] as const;
export type GearCategory = (typeof GEAR_CATEGORIES)[number];

/** db/003 is_sound_source(). */
export const SOUND_SOURCES: readonly GearCategory[] = [
  'synthesizer', 'drum machine', 'sampler', 'groovebox', 'instrument', 'instrument plugin', 'sample library',
];

export const GEAR_STATUSES = ['owned', 'wishlist', 'gone'] as const;
export type GearStatus = (typeof GEAR_STATUSES)[number];
export const GEAR_STATUS_LABEL: Record<GearStatus, string> = { owned: 'Owned', wishlist: 'Wishlist', gone: 'Gone' };

export const FILE_ROLES = ['photo', 'receipt', 'serial_plate', 'document', 'other'] as const;
export type GearFileRole = (typeof FILE_ROLES)[number];
export const FILE_ROLE_LABEL: Record<GearFileRole, string> = {
  photo: 'Photo',
  receipt: 'Receipt',
  serial_plate: 'Serial plate',
  document: 'Document',
  other: 'Other',
};

export type CapabilityType = 'boolean' | 'integer' | 'number' | 'text' | 'enum' | 'list';
export type CapabilityValue = boolean | number | string | string[];

export type CapabilityDef = {
  key: string;
  label: string;
  valueType: CapabilityType;
  unit: string;
  choices: string[];
  description: string;
};

export type GearModel = {
  id: number;
  kind: GearKind;
  category: GearCategory;
  manufacturer: string;
  model: string;
  yearIntroduced: number | null;
  /** Null while still made. */
  yearDiscontinued: number | null;
  description: string;
  status: 'suggested' | 'approved' | 'rejected';
  /** Suggested by the viewer. */
  mine: boolean;
  suggestedByName: string;
  capabilities: Record<string, CapabilityValue>;
};

export type GearUnit = {
  id: number;
  ownerId: string;
  ownerName: string;
  level: AccessLevel;
  model: Pick<GearModel, 'id' | 'kind' | 'category' | 'manufacturer' | 'model' | 'status'> | null;
  /** For a unit with no catalogue model. */
  manufacturer: string;
  name: string;
  nickname: string;
  status: GearStatus;
  firmware: string;
  notes: string;
  createdAt: string;
  /** Effective capabilities: the unit's own where set, else its model's. */
  capabilities: Record<string, { value: CapabilityValue; overridden: boolean }>;
  /** The first photo, for the list. */
  photoId: number | null;
};

/** The owner-only insurance record (db/003 gear_private). */
export type GearPrivate = {
  serial: string;
  purchaseDate: string | null;
  purchasePrice: number | null;
  currency: string;
  purchasedFrom: string;
  condition: string;
  location: string;
  serviceHistory: string;
  licenseKey: string;
  licenseSeats: number | null;
  licenseActivation: string;
  licenseRenewal: string | null;
  /** What it would cost to replace, for insurance, and when that was judged. */
  estimatedValue: number | null;
  valuedOn: string | null;
};

export type GearFile = {
  id: number;
  gearId: number;
  role: GearFileRole;
  filename: string;
  contentType: string;
  bytes: number | null;
  caption: string;
  uploadedByName: string;
  uploadedAt: string;
};

/** "1972–1977", "2015–", "1981", or "" when unknown. */
export function modelYears(m: Pick<GearModel, 'yearIntroduced' | 'yearDiscontinued'>): string {
  const a = m.yearIntroduced, b = m.yearDiscontinued;
  if (a === null && b === null) return '';
  if (a !== null && b === a) return String(a);
  return `${a ?? '?'}–${b ?? ''}`;
}

/** "Sequential Prophet-6", or the unit's own manufacturer and name. */
export function unitTitle(u: Pick<GearUnit, 'model' | 'manufacturer' | 'name'>): string {
  return u.model ? `${u.model.manufacturer} ${u.model.model}` : [u.manufacturer, u.name].filter(Boolean).join(' ');
}

export function isSoundSource(u: Pick<GearUnit, 'model'>): boolean {
  return !!u.model && SOUND_SOURCES.includes(u.model.category);
}

export function formatCapability(def: CapabilityDef | undefined, value: CapabilityValue): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return def?.unit ? `${value} ${def.unit}` : String(value);
}

/**
 * Turns form input into a value of the capability's type, or an error. The
 * database checks again (capability_value_ok); this gives the message.
 */
export function parseCapabilityValue(def: CapabilityDef, raw: unknown): { value: CapabilityValue } | { error: string } {
  switch (def.valueType) {
    case 'boolean':
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true' || raw === 'false') return { value: raw === 'true' };
      return { error: `${def.label}: yes or no.` };
    case 'integer':
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
      if (!Number.isFinite(n) || (def.valueType === 'integer' && !Number.isInteger(n))) {
        return { error: `${def.label}: ${def.valueType === 'integer' ? 'a whole number' : 'a number'}.` };
      }
      return { value: n };
    }
    case 'text':
      if (typeof raw !== 'string' || !raw.trim()) return { error: `${def.label}: some text.` };
      return { value: raw.trim().slice(0, 500) };
    case 'enum':
      if (typeof raw !== 'string' || !def.choices.includes(raw)) return { error: `${def.label}: one of ${def.choices.join(', ')}.` };
      return { value: raw };
    case 'list': {
      const list = Array.isArray(raw) ? raw : [];
      if (!list.every((x) => typeof x === 'string' && def.choices.includes(x))) {
        return { error: `${def.label}: choose from ${def.choices.join(', ')}.` };
      }
      return { value: Array.from(new Set(list as string[])) };
    }
  }
}

export function parseShortText(raw: unknown, label: string, max = 200): { value: string } | { error: string } {
  if (raw === undefined || raw === null) return { value: '' };
  if (typeof raw !== 'string') return { error: `${label} must be text.` };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length > max) return { error: `Keep ${label.toLowerCase()} under ${max} characters.` };
  return { value };
}

/** A year field from a request: undefined when absent, null when cleared, else a year or an error. */
export function parseYear(v: unknown): number | null | undefined | { error: string } {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const y = Number(v);
  return Number.isInteger(y) && y >= 1900 && y <= 2200 ? y : { error: 'A year must be four digits.' };
}
