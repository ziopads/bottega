// Reading a dropped Ableton project folder in the browser (REQUIREMENTS A-6).
// Nothing here uploads audio: the sets are read and parsed in the page, and
// the rest of the folder is listed by path and size.

import type { FolderFile } from './types';

export type PickedFile = { path: string; file: File };

// Live's own clutter, and files the State tab has no use for.
const IGNORED = /(^|\/)(\.DS_Store|Icon\r?|\._[^/]*)$|\.asd$/;

/** Files from a drop, walking into folders; paths are relative to the dropped folder. */
export async function filesFromDrop(items: DataTransferItemList): Promise<{ folderName: string; files: PickedFile[] }> {
  const entries = Array.from(items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  const files: PickedFile[] = [];
  let folderName = '';
  for (const entry of entries) {
    if (entry.isDirectory) {
      folderName ||= entry.name;
      await walk(entry as FileSystemDirectoryEntry, '', files);
    } else {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      files.push({ path: entry.name, file });
    }
  }
  return { folderName, files };
}

async function walk(dir: FileSystemDirectoryEntry, prefix: string, out: PickedFile[]): Promise<void> {
  const reader = dir.createReader();
  // readEntries returns at most about a hundred at a time.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory) await walk(e as FileSystemDirectoryEntry, path, out);
      else out.push({ path, file: await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)) });
    }
  }
}

/** Files from an <input webkitdirectory>, with the top folder's name taken off their paths. */
export function filesFromInput(list: FileList): { folderName: string; files: PickedFile[] } {
  const files: PickedFile[] = [];
  let folderName = '';
  for (const file of Array.from(list)) {
    const rel = file.webkitRelativePath || file.name;
    const slash = rel.indexOf('/');
    if (slash > 0) folderName ||= rel.slice(0, slash);
    files.push({ path: slash > 0 ? rel.slice(slash + 1) : rel, file });
  }
  return { folderName, files };
}

/** The saved sets at the top of the folder; Live's Backup folder is left out. */
export function savedSets(files: PickedFile[]): PickedFile[] {
  return files.filter((f) => !f.path.includes('/') && f.path.toLowerCase().endsWith('.als'));
}

/** Everything else, by path and size. */
export function listing(files: PickedFile[]): FolderFile[] {
  return files
    .filter((f) => !IGNORED.test(f.path) && !f.path.toLowerCase().endsWith('.als') && !f.path.startsWith('Backup/'))
    .map((f) => ({ path: f.path, bytes: f.file.size }));
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function gunzipText(buf: ArrayBuffer): Promise<string> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
