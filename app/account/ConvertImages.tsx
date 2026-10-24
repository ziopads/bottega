'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { convertImage } from '@/app/_gear/uploads';
import { BUTTON_PRIMARY } from '@/app/_ui/styles';

// Older photos, stored as their full-size originals, turned into web
// versions in this browser one at a time (REQUIREMENTS G-10). The original is
// deleted once its web versions are recorded.

export default function ConvertImages({ images }: { images: { id: number; filename: string }[] }) {
  const router = useRouter();
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    setFailed([]);
    let ok = 0;
    for (const img of images) {
      try {
        await convertImage(img.id, img.filename);
        ok++;
        setDone(ok);
      } catch (err) {
        setFailed((f) => [...f, `${img.filename}: ${err instanceof Error ? err.message : 'failed'}`]);
      }
    }
    setRunning(false);
    router.refresh();
  }

  return (
    <div className="rounded border border-line p-3 t-body">
      <p>
        {images.length} older {images.length === 1 ? 'photo is' : 'photos are'} stored at full size. Converting makes the web
        versions here in your browser, removes location data, and deletes the original.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button onClick={run} disabled={running} className={BUTTON_PRIMARY}>
          {running ? `Converting… ${done} of ${images.length}` : 'Convert them'}
        </button>
        <span className="t-small text-muted">Keep this page open while it runs.</span>
      </div>
      {failed.length > 0 && (
        <ul className="mt-2 t-small text-rust">
          {failed.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
