import type { AccessLevel } from '@/lib/studioTypes';

// Shared by the documents data layer, the routes and the pages
// (REQUIREMENTS §8, db/004).

export type DocumentKind = 'manual' | 'service' | 'firmware' | 'reference' | 'book' | 'other';
export type ReviewStatus = 'submitted' | 'approved' | 'rejected';
export type DocumentState = 'pending' | 'processing' | 'ready' | 'needs_ocr' | 'paused' | 'failed';

export const DOCUMENT_KINDS: DocumentKind[] = ['manual', 'service', 'firmware', 'reference', 'book', 'other'];
/** The library holds manufacturers' documents only (db/005); the rest are private. */
export const LIBRARY_KINDS: DocumentKind[] = ['manual', 'service', 'firmware'];
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  manual: 'Manual',
  service: 'Service manual',
  firmware: 'Firmware notes',
  reference: 'Reference',
  book: 'Book',
  other: 'Other',
};

export const STATE_LABEL: Record<DocumentState, string> = {
  pending: 'Not processed yet',
  processing: 'Processing',
  ready: 'Searchable',
  needs_ocr: 'Needs OCR (scanned pages)',
  paused: 'Paused',
  failed: 'Failed',
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  submitted: 'Awaiting review',
  approved: 'In the library',
  rejected: 'Not accepted',
};

/** Documents are PDFs only. */
export const DOCUMENT_CONTENT_TYPE = 'application/pdf';

export interface StudioDocument {
  id: number;
  library: boolean;
  ownerId: string | null;
  ownerName: string;
  contributedBy: string | null;
  contributorName: string;
  reviewStatus: ReviewStatus;
  kind: DocumentKind;
  title: string;
  manufacturer: string;
  model: string;
  filename: string;
  bytes: number;
  pageCount: number | null;
  /** Pages whose text is stored (extraction). */
  pagesExtracted: number;
  /** Pages embedded and searchable. */
  pagesDone: number;
  state: DocumentState;
  stateDetail: string;
  createdAt: string;
  level: AccessLevel | null;
  /** The viewer has picked this library document for their own search (K-7). */
  picked: boolean;
  /** Catalogue models this document is linked to. */
  models: { id: number; manufacturer: string; model: string }[];
}

/** What the signed-in person may still use (db/004 my_allowance). Nulls mean no limit. */
export interface Allowance {
  storageBytes: number | null;
  storageUsed: number;
  pagesPerMonth: number | null;
  pagesUsed: number;
  maxDocumentPages: number | null;
  platformPagesLeft: number;
}

/** The answer to "does Bottega already hold this file?" by fingerprint. */
export interface FingerprintMatch {
  /** A library document with this fingerprint, and whether the viewer can see it yet. */
  library: { id: number; reviewStatus: ReviewStatus; visible: boolean } | null;
  /** The viewer's own private document with this fingerprint. */
  own: { id: number; title: string } | null;
}

export function isSha256(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
}
