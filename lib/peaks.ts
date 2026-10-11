// Browser only. A file's loudness outline, for the waveform the player draws
// (REQUIREMENTS S-10, db/009): the audio is decoded once, cut into PEAK_COUNT
// stretches, and each stretch's loudest sample across channels is kept,
// scaled so the loudest in the file is 255. A few kilobytes per mix, measured
// when the file is uploaded or, for older files, from the backfill page.

export const PEAK_COUNT = 1000;

export async function measurePeaks(data: ArrayBuffer, count = PEAK_COUNT): Promise<number[]> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buffer = await ctx.decodeAudioData(data);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const size = Math.max(1, Math.floor(buffer.length / count));
    const raw: number[] = [];
    for (let b = 0; b < count; b++) {
      const start = b * size;
      if (start >= buffer.length) break;
      const end = Math.min(buffer.length, start + size);
      let max = 0;
      for (const ch of channels) {
        // Every fourth sample is plenty to find a stretch's peak.
        for (let i = start; i < end; i += 4) {
          const v = Math.abs(ch[i]);
          if (v > max) max = v;
        }
      }
      raw.push(max);
    }
    const top = Math.max(...raw, 1e-6);
    return raw.map((v) => Math.min(255, Math.round((v / top) * 255)));
  } finally {
    void ctx.close();
  }
}

/** Measures a file and stores the result; errors are swallowed (the player falls back to a plain bar). */
export async function measureAndStore(audioId: number, data: ArrayBuffer): Promise<number[] | null> {
  try {
    const peaks = await measurePeaks(data);
    const res = await fetch(`/api/audio/${audioId}/peaks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peaks }),
    });
    return res.ok ? peaks : null;
  } catch {
    return null;
  }
}
