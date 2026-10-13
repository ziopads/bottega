// YouTube, for a study group's videos (REQUIREMENTS L-23, db/020): finding
// the video id in the forms of address people paste, and the title, channel
// and thumbnail from YouTube's oEmbed endpoint, which needs no key. Server
// only for oEmbed; parseYouTubeId and the time helpers are plain functions
// the browser uses too.

const ID = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character video id from a YouTube address, or null. */
export function parseYouTubeId(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
      id = m ? m[1] : null;
    }
  }
  return id && ID.test(id) ? id : null;
}

/** A moment in a YouTube address: t=272, t=4m32s, start=272. */
export function parseYouTubeStart(raw: string): number | null {
  try {
    const url = new URL(raw.trim());
    const t = url.searchParams.get('t') ?? url.searchParams.get('start');
    if (!t) return null;
    if (/^\d+$/.test(t)) return Number(t);
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!m) return null;
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  } catch {
    return null;
  }
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

/** "4:32", "1:02:05". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "4:32", "1:02:05", "272" → seconds; null when it is not a time. */
export function parseTime(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((n, p) => n * 60 + Number(p), 0);
}

export interface VideoDetails {
  title: string;
  channel: string;
  thumbnailUrl: string;
}

/**
 * Title, channel and thumbnail from YouTube's oEmbed endpoint. Null when
 * YouTube does not answer in time or does not know the video (private,
 * removed, or embedding switched off by its owner).
 */
export async function fetchVideoDetails(id: string): Promise<VideoDetails | null> {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`;
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: unknown; author_name?: unknown; thumbnail_url?: unknown };
    const thumb = typeof j.thumbnail_url === 'string' && j.thumbnail_url.startsWith('https://') ? j.thumbnail_url : '';
    return {
      title: typeof j.title === 'string' ? j.title.slice(0, 300) : '',
      channel: typeof j.author_name === 'string' ? j.author_name.slice(0, 200) : '',
      thumbnailUrl: thumb || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  } catch {
    return null;
  }
}
