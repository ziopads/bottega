'use client';

import { formatDay, formatWhen } from './parts';

// A date in the viewer's own time zone. The server renders in its zone (UTC),
// the browser corrects it on hydration.
export default function When({ iso, day = false }: { iso: string; day?: boolean }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {day ? formatDay(iso) : formatWhen(iso)}
    </time>
  );
}
