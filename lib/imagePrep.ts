// Browser only. Turns a photo into its web versions before upload
// (REQUIREMENTS G-10): decoded with its camera orientation applied, scaled to
// each size in IMAGE_VARIANTS (never up), written as WebP (JPEG where the
// browser cannot write WebP). Drawing onto a canvas drops every piece of
// metadata, the camera's GPS position included, so nothing about where a
// photo was taken reaches storage.

import { IMAGE_VARIANTS, type VariantName } from '@/lib/imageTypes';

export interface PreparedImage {
  variants: { name: VariantName; file: string; blob: Blob; contentType: string }[];
  /** The full version's size, before any rotation the owner applies later. */
  width: number;
  height: number;
}

function isHeic(file: Blob & { name?: string }): boolean {
  return /^image\/hei[cf]$/.test(file.type) || /\.hei[cf]$/i.test(file.name ?? '');
}

async function decode(file: Blob & { name?: string }): Promise<ImageBitmap> {
  try {
    // Orientation from the file's EXIF is applied by default in current browsers.
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    if (!isHeic(file)) throw new Error('This image could not be read.', { cause: err });
    // Only Safari decodes HEIC itself. The decoder is large, so it loads only
    // when a HEIC file arrives.
    const { default: heic2any } = (await import('heic2any')) as unknown as {
      default: (o: { blob: Blob; toType: string; quality: number }) => Promise<Blob | Blob[]>;
    };
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.95 });
    return createImageBitmap(Array.isArray(out) ? out[0] : out);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await decode(file);
  try {
    const variants: PreparedImage['variants'] = [];
    let width = bitmap.width;
    let height = bitmap.height;
    for (const v of IMAGE_VARIANTS) {
      const scale = Math.min(1, v.edge / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('This browser cannot resize images.');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, w, h);
      let blob = await toBlob(canvas, 'image/webp', v.quality);
      // A browser that cannot write WebP returns PNG instead; use JPEG then.
      if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', v.quality);
      if (!blob) throw new Error('This image could not be resized.');
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      variants.push({ name: v.name, file: `${v.name}.${ext}`, blob, contentType: blob.type });
      if (v.name === 'full') {
        width = w;
        height = h;
      }
      canvas.width = canvas.height = 0; // release the pixels now, not at collection
    }
    return { variants, width, height };
  } finally {
    bitmap.close();
  }
}
