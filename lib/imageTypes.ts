// Web versions of an image (REQUIREMENTS G-10, db/007), shared by the browser
// code that makes them, the routes that accept them and the pages that show
// them. No server imports, so client components can use it.
//
// Each image is a folder in R2 holding these three files. The original is
// not kept: `full` is the master, and every smaller size can be remade from
// it. The browser writes WebP; where it cannot (older Safari), JPEG.

export type VariantName = 'thumb' | 'view' | 'full';

export const IMAGE_VARIANTS: { name: VariantName; edge: number; quality: number; maxBytes: number }[] = [
  // Lists and galleries: covers a 160×128 box at twice the pixel density.
  { name: 'thumb', edge: 480, quality: 0.8, maxBytes: 1_000_000 },
  // The edit screen and a larger view.
  { name: 'view', edge: 1600, quality: 0.85, maxBytes: 4_000_000 },
  // Download and zoom; enough to read a serial plate.
  { name: 'full', edge: 2560, quality: 0.88, maxBytes: 12_000_000 },
];

export const VARIANT_TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg' };

/** 'thumb.webp' and the like; nothing else is a variant file name. */
export const VARIANT_FILE = /^(thumb|view|full)\.(webp|jpg)$/;

export type ImageUrls = Record<VariantName, string>;

/** Images the browser can turn into web versions (HEIC through a decoder loaded on demand). */
export function isConvertibleImage(file: { type: string; name: string }): boolean {
  return /^image\/(jpeg|png|webp|heic|heif|gif|avif)$/.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(file.name);
}
