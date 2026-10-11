import { requireAccount } from '@/lib/access';
import { missingDurations, missingPeaks } from '@/lib/studio';
import LengthBackfill from './LengthBackfill';
import WaveformBackfill from './WaveformBackfill';

// Fills in the length of every mix and reference uploaded without one (the
// older Vivarium uploads). The browser reads each file's metadata through the
// usual signed link and reports the length, exactly as an upload does, so no
// server-side audio library is needed. Lists the files in the signed-in
// person's own projects only; safe to run more than once.

export const metadata = { title: 'Lengths and waveforms · Bottega' };

export default async function LengthsPage() {
  const { db } = await requireAccount();
  const [missing, noWaveform] = await Promise.all([missingDurations(db), missingPeaks(db)]);
  return (
    <div className="max-w-2xl space-y-4 py-4">
      <h1 className="t-title">Lengths and waveforms</h1>
      <p className="text-sm text-muted">
        {missing.length === 0
          ? 'Every file has its length.'
          : `${missing.length} ${missing.length === 1 ? 'file has' : 'files have'} no length on record.`}
      </p>
      {missing.length > 0 && <LengthBackfill items={missing} />}

      <h2 className="t-lead pt-6 font-medium">Waveforms</h2>
      <p className="t-body text-muted">
        {noWaveform.length === 0
          ? 'Every file has its waveform.'
          : `${noWaveform.length} ${noWaveform.length === 1 ? 'file has' : 'files have'} no waveform yet. New uploads are measured as they go up.`}
      </p>
      {noWaveform.length > 0 && <WaveformBackfill items={noWaveform} />}
    </div>
  );
}
