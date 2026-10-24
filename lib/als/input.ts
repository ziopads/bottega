import { looksLikeSet } from './store';
import type { AlsSet, FolderFile } from './types';

// The bodies that carry a saved set and a folder listing, shared by the
// State tab's routes and the Mac watcher's (REQUIREMENTS A-6, A-9). Server only.

export type SetInput = { fileName: string; savedAt: string; sha256: string; bytes: number; set: AlsSet };

export function readSetInput(body: Record<string, unknown>): SetInput | { error: string } {
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim().slice(0, 255) : '';
  const savedAt = typeof body.savedAt === 'string' && !Number.isNaN(Date.parse(body.savedAt)) ? body.savedAt : '';
  const sha256 = typeof body.sha256 === 'string' && /^[0-9a-f]{64}$/.test(body.sha256) ? body.sha256 : '';
  const bytes = Number(body.bytes);
  if (!fileName.endsWith('.als') || !savedAt || !sha256 || !(bytes > 0)) {
    return { error: 'A set needs its file name, save time, fingerprint and size.' };
  }
  if (!looksLikeSet(body.set)) return { error: 'That is not a set this parser wrote.' };
  return { fileName, savedAt, sha256, bytes, set: body.set };
}

export function readFolderInput(body: Record<string, unknown>): { folderName: string; files: FolderFile[] } | { error: string } {
  const folderName = typeof body.folderName === 'string' ? body.folderName.slice(0, 255) : '';
  if (!Array.isArray(body.files) || body.files.length > 50000) return { error: 'The folder listing is missing or too long.' };
  const files: FolderFile[] = [];
  for (const f of body.files as unknown[]) {
    const x = f as FolderFile;
    if (typeof x?.path !== 'string' || !x.path || x.path.length > 1024 || !(Number(x.bytes) >= 0)) {
      return { error: 'A file in the listing is malformed.' };
    }
    files.push({ path: x.path, bytes: Number(x.bytes) });
  }
  return { folderName, files };
}
