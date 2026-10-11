import type { Rotation } from '@/lib/gearTypes';

// An image turned by its stored rotation (db/006) inside a box of known size.
// A quarter turn swaps the image's width and height, so the image is laid
// out at the box's height by width and then turned into place; it covers or
// fits the box exactly as an unturned one would. The browser has already
// applied the file's own EXIF orientation; the rotation is on top of that.

export default function RotatedImage({
  src,
  alt,
  rotation,
  width,
  height,
  fit = 'cover',
  className = '',
}: {
  src: string;
  alt: string;
  rotation: Rotation;
  width: number;
  height: number;
  fit?: 'cover' | 'contain';
  className?: string;
}) {
  const quarter = rotation === 90 || rotation === 270;
  return (
    <span className={`relative block shrink-0 overflow-hidden ${className}`} style={{ width, height }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="absolute left-1/2 top-1/2 max-w-none"
        style={{
          width: quarter ? height : width,
          height: quarter ? width : height,
          objectFit: fit,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        }}
      />
    </span>
  );
}
