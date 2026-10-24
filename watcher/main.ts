// Bottega's Mac watcher (REQUIREMENTS A-9; docs/watcher.md). Runs on the
// Mac at login, watches the Ableton sessions folder, and sends every set Live
// saves to Bottega with the project folder's file list, as the person whose
// personal access token it holds: the same as dropping the folder on the
// project's State tab, without the drop.
//
//   node watcher/dist/watcher/main.js setup       server, sessions folder, token (kept in the keychain)
//   node watcher/dist/watcher/main.js run         watch and send (what launchd runs)
//   node watcher/dist/watcher/main.js once        one sweep of every folder, then stop
//   node watcher/dist/watcher/main.js status      what waits, what failed, folders with no project
//   node watcher/dist/watcher/main.js install     start at login (a LaunchAgent), and now
//   node watcher/dist/watcher/main.js uninstall   stop, and no longer start at login
//
// Sets are read here with Bottega's own reader (lib/als/parse.ts); only the
// description goes up, never audio. Nothing is lost offline: what has not
// been sent waits in state.json and goes when Bottega answers again. A folder
// whose project cannot be found is listed (in status and under Account ›
// Security), never guessed or created.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { gunzipSync } from 'node:zlib';

import { parseSet } from '../lib/als/parse';
import { PARSER_VERSION } from '../lib/als/types';

const VERSION = '1.0.0';
const LABEL = 'com.sirsinate.bottega-watcher';
const KEYCHAIN_SERVICE = 'Bottega Watcher';
// BOTTEGA_WATCHER_HOME and BOTTEGA_WATCHER_TOKEN stand in for the folder and
// the keychain when trying the watcher away from a Mac.
const DIR = process.env.BOTTEGA_WATCHER_HOME || join(homedir(), 'Library', 'Application Support', 'Bottega Watcher');
const CONFIG = join(DIR, 'config.json');
const STATE = join(DIR, 'state.json');
const LOG = join(DIR, 'watcher.log');
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

const SETTLE_MS = 10_000; // quiet time after the last change in a folder before reading it
const SWEEP_MS = 10 * 60_000; // every folder looked at again, and anything waiting retried
const RETRY_MS = 60_000; // while sets wait, try sending again this often
// As the State tab's drop: Live's own clutter, and files of no use.
const IGNORED = /(^|\/)(\.DS_Store|Icon\r?|\._[^/]*)$|\.asd$/;

type Config = { server: string; root: string };
type Pending = { project: number; folder: string; file: string; sha256: string; tries: number; error?: string };
type State = {
  /** By absolute path: the version of each set already sent or found stored. */
  sent: Record<string, { size: number; mtimeMs: number; sha256: string }>;
  /** Sets read and waiting to be sent, by absolute path. */
  pending: Record<string, Pending>;
  /** Sets Bottega refused, by absolute path, with why; tried again only when the file changes. */
  failed: Record<string, { size: number; mtimeMs: number; error: string }>;
  /** By folder name: the fingerprint of the file list last sent. */
  listings: Record<string, string>;
  unmatched: string[];
  /** The projects as Bottega last listed them, so folders are matched offline too. */
  projects: Project[];
  lastSweep: string | null;
  lastContact: string | null;
  lastError: string | null;
};
type Project = { id: number; canonicalId: string; title: string; folderName: string | null };

// ── Files and the log ─────────────────────────────────────────────────────────

function log(message: string): void {
  mkdirSync(DIR, { recursive: true });
  try {
    if (existsSync(LOG) && statSync(LOG).size > 5_000_000) renameSync(LOG, `${LOG}.1`);
  } catch {
    // a log that cannot roll keeps growing; not a reason to stop
  }
  const line = `${new Date().toISOString()} ${message}\n`;
  appendFileSync(LOG, line);
  if (process.stdout.isTTY) process.stdout.write(line);
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

const emptyState = (): State => ({ sent: {}, pending: {}, failed: {}, listings: {}, unmatched: [], projects: [], lastSweep: null, lastContact: null, lastError: null });
const loadState = () => readJson<State>(STATE, emptyState());
const saveState = (s: State) => writeJson(STATE, s);

function loadConfig(): Config {
  if (!existsSync(CONFIG)) throw new Error('Not set up yet. Run: node watcher/dist/watcher/main.js setup');
  return readJson<Config>(CONFIG, { server: '', root: '' });
}

// ── The keychain ─────────────────────────────────────────────────────────────

function accountOf(server: string): string {
  return new URL(server).host;
}

function readToken(server: string): string {
  if (process.env.BOTTEGA_WATCHER_TOKEN) return process.env.BOTTEGA_WATCHER_TOKEN;
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', accountOf(server), '-w'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('No token in the keychain. Run: node watcher/dist/watcher/main.js setup');
  }
}

function storeToken(server: string, token: string): void {
  execFileSync('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', accountOf(server), '-w', token]);
}

// ── Bottega ───────────────────────────────────────────────────────────────────

class Offline extends Error {}
class Refused extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(cfg: Config, token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${cfg.server}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': `bottega-watcher/${VERSION}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new Offline((err as Error).message);
  }
  if (res.status >= 500) throw new Offline(`Bottega answered ${res.status}`);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? (res.status === 413 ? 'the set is too large to send' : text.slice(0, 200));
    throw new Refused(res.status, `${res.status}: ${msg}`);
  }
  return data as T;
}

// ── Folders and sets ──────────────────────────────────────────────────────────

/** The project folders: the folders directly in the sessions folder. */
function projectFolders(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

/** Every file in a project folder, by path inside it and size, walking into subfolders. */
function walk(dir: string, prefix = '', out: { path: string; bytes: number }[] = []): { path: string; bytes: number }[] {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) walk(join(dir, d.name), path, out);
    else if (d.isFile()) out.push({ path, bytes: statSync(join(dir, d.name)).size });
  }
  return out;
}

/** The project a folder belongs to: the folder name last dropped on it, else the date its name starts with; null when not exactly one. */
function matchFolder(folder: string, projects: Project[]): Project | null {
  const byName = projects.filter((p) => p.folderName && p.folderName.toLowerCase() === folder.toLowerCase());
  if (byName.length === 1) return byName[0];
  const date = folder.match(/^(\d{4} \d{4})(\b|$)/)?.[1];
  if (!date) return null;
  const byDate = projects.filter((p) => p.canonicalId === date);
  return byDate.length === 1 ? byDate[0] : null;
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** A file is settled when its size and time have not moved for two seconds. */
async function settled(path: string): Promise<boolean> {
  const a = statSync(path);
  await new Promise((r) => setTimeout(r, 2000));
  const b = statSync(path);
  return a.size === b.size && a.mtimeMs === b.mtimeMs && Date.now() - b.mtimeMs > 2000;
}

// ── The watcher ───────────────────────────────────────────────────────────────

class Watcher {
  state = loadState();
  projects: Project[] = this.state.projects ?? [];
  projectsAt = 0;
  online = true;
  known = new Map<number, Map<string, number>>(); // project → sha → parser version stored
  timers = new Map<string, NodeJS.Timeout>();
  fsWatcher: FSWatcher | null = null;
  busy = Promise.resolve();

  constructor(
    public cfg: Config,
    public token: string,
  ) {}

  /** One thing at a time: sweeps, folders and retries queue behind each other. */
  serial(fn: () => Promise<void>): Promise<void> {
    this.busy = this.busy.then(fn).catch((err) => {
      this.state.lastError = (err as Error).message;
      log(`error: ${(err as Error).message}`);
    });
    return this.busy;
  }

  async loadProjects(force = false): Promise<void> {
    if (!force && Date.now() - this.projectsAt < 60_000) return;
    const r = await call<{ projects: Project[] }>(this.cfg, this.token, 'GET', '/api/watcher/projects');
    this.projects = r.projects;
    this.state.projects = r.projects;
    this.projectsAt = Date.now();
    this.known.clear();
    this.online = true;
    this.state.lastContact = new Date().toISOString();
  }

  async storedSets(project: number): Promise<Map<string, number>> {
    let m = this.known.get(project);
    if (!m) {
      const r = await call<{ snapshots: { sha256: string; parserVersion: number }[] }>(this.cfg, this.token, 'GET', `/api/watcher/projects/${project}/sets`);
      m = new Map(r.snapshots.map((s) => [s.sha256, s.parserVersion]));
      this.known.set(project, m);
    }
    return m;
  }

  /** Reads one project folder: queues its new or changed sets, and sends its file list when it changed. */
  async folder(name: string): Promise<void> {
    const dir = join(this.cfg.root, name);
    if (!existsSync(dir)) return;
    let project: Project | null;
    try {
      await this.loadProjects();
      project = matchFolder(name, this.projects);
      if (!project) {
        await this.loadProjects(true);
        project = matchFolder(name, this.projects);
      }
    } catch (err) {
      if (!(err instanceof Offline)) throw err;
      // Offline: match with the projects as last listed, and let the sets wait.
      if (this.online) log(`offline (${err.message}); sets wait and go when Bottega answers`);
      this.online = false;
      project = matchFolder(name, this.projects);
    }
    const unmatched = new Set(this.state.unmatched);
    // Offline and never matched: wait for Bottega before calling it unmatched.
    if (!project && !this.online) return;
    if (!project) {
      if (!unmatched.has(name)) log(`no project for the folder “${name}”: listed under Account › Security`);
      unmatched.add(name);
      this.state.unmatched = [...unmatched].sort();
      return;
    }
    unmatched.delete(name);
    this.state.unmatched = [...unmatched].sort();

    const files = walk(dir).filter((f) => !IGNORED.test(f.path));
    for (const f of files.filter((x) => !x.path.includes('/') && x.path.toLowerCase().endsWith('.als'))) {
      const path = join(dir, f.path);
      const st = statSync(path);
      const sent = this.state.sent[path];
      if (sent && sent.size === st.size && sent.mtimeMs === st.mtimeMs) continue;
      const failed = this.state.failed[path];
      if (failed && failed.size === st.size && failed.mtimeMs === st.mtimeMs) continue;
      if (!(await settled(path))) continue; // Live is still writing it; the next change brings us back
      const buf = readFileSync(path);
      const sha = sha256(buf);
      let stored: Map<string, number>;
      try {
        stored = await this.storedSets(project.id);
      } catch (err) {
        if (!(err instanceof Offline)) throw err;
        stored = new Map();
      }
      if ((stored.get(sha) ?? 0) >= PARSER_VERSION) {
        this.state.sent[path] = { size: st.size, mtimeMs: st.mtimeMs, sha256: sha };
        delete this.state.pending[path];
        continue;
      }
      this.state.pending[path] = { project: project.id, folder: name, file: f.path, sha256: sha, tries: 0 };
      delete this.state.failed[path];
    }
    saveState(this.state);
    await this.flush();

    const listing = files.filter((x) => !x.path.toLowerCase().endsWith('.als') && !x.path.startsWith('Backup/'));
    const print = createHash('sha256').update(JSON.stringify([project.id, listing])).digest('hex');
    if (this.state.listings[name] !== print) {
      try {
        await call(this.cfg, this.token, 'PUT', `/api/watcher/projects/${project.id}/folder`, { folderName: name, files: listing });
        this.state.listings[name] = print;
        log(`file list of “${name}” sent (${listing.length} files)`);
      } catch (err) {
        if (!(err instanceof Offline)) throw err;
      }
    }
    saveState(this.state);
  }

  /** Sends what waits, oldest save first; stops at the first sign of being offline. */
  async flush(): Promise<void> {
    const waiting = Object.entries(this.state.pending).sort(([a], [b]) => {
      const ta = existsSync(a) ? statSync(a).mtimeMs : 0;
      const tb = existsSync(b) ? statSync(b).mtimeMs : 0;
      return ta - tb;
    });
    for (const [path, p] of waiting) {
      if (!existsSync(path)) {
        delete this.state.pending[path];
        continue;
      }
      const st = statSync(path);
      const buf = readFileSync(path);
      const sha = sha256(buf);
      let set;
      try {
        set = parseSet(gunzipSync(buf).toString('utf8'));
      } catch (err) {
        this.state.failed[path] = { size: st.size, mtimeMs: st.mtimeMs, error: `could not be read: ${(err as Error).message}` };
        delete this.state.pending[path];
        log(`could not read “${p.folder}/${p.file}”: ${(err as Error).message}`);
        continue;
      }
      try {
        const r = await call<{ result: string }>(this.cfg, this.token, 'POST', `/api/watcher/projects/${p.project}/sets`, {
          fileName: p.file,
          savedAt: new Date(st.mtimeMs).toISOString(),
          sha256: sha,
          bytes: st.size,
          set,
        });
        this.state.sent[path] = { size: st.size, mtimeMs: st.mtimeMs, sha256: sha };
        delete this.state.pending[path];
        this.known.get(p.project)?.set(sha, PARSER_VERSION);
        if (!this.online) log('Bottega answers again');
        this.online = true;
        this.state.lastContact = new Date().toISOString();
        log(`sent “${p.folder}/${p.file}” (${r.result})`);
      } catch (err) {
        if (err instanceof Offline) {
          p.tries++;
          if (this.online) log(`offline (${err.message}); ${Object.keys(this.state.pending).length} waiting`);
          this.online = false;
          break;
        }
        const refused = err as Refused;
        this.state.failed[path] = { size: st.size, mtimeMs: st.mtimeMs, error: refused.message };
        delete this.state.pending[path];
        log(`Bottega refused “${p.folder}/${p.file}”: ${refused.message}`);
        if (refused.status === 401) throw new Error('The token was refused: make a new one under Account › Security and run setup again.');
      }
      saveState(this.state);
    }
    saveState(this.state);
  }

  async report(): Promise<void> {
    try {
      await call(this.cfg, this.token, 'POST', '/api/watcher/report', {
        version: VERSION,
        host: hostname(),
        root: this.cfg.root,
        pending: Object.keys(this.state.pending).length,
        unmatched: this.state.unmatched,
      });
    } catch (err) {
      if (!(err instanceof Offline)) throw err;
    }
  }

  async sweep(): Promise<void> {
    if (!existsSync(this.cfg.root)) {
      log(`the sessions folder is not there (is the drive mounted?): ${this.cfg.root}`);
      return;
    }
    try {
      await this.loadProjects(true);
    } catch (err) {
      if (!(err instanceof Offline)) throw err;
    }
    // Folders that are gone are no longer listed as unmatched.
    const present = new Set(projectFolders(this.cfg.root));
    this.state.unmatched = this.state.unmatched.filter((f) => present.has(f));
    for (const name of present) await this.folder(name);
    await this.flush();
    this.state.lastSweep = new Date().toISOString();
    saveState(this.state);
    await this.report();
  }

  /** A change somewhere in the sessions folder: read its project folder once things go quiet. */
  changed(rel: string | null): void {
    if (!rel) return;
    const folder = rel.split('/')[0];
    if (!folder || folder.startsWith('.') || IGNORED.test(rel)) return;
    clearTimeout(this.timers.get(folder));
    this.timers.set(
      folder,
      setTimeout(() => {
        this.timers.delete(folder);
        void this.serial(async () => {
          await this.folder(folder);
          await this.report();
        });
      }, SETTLE_MS),
    );
  }

  /** Watches the sessions folder; when the drive is away, tries again at each sweep. */
  watchRoot(): void {
    if (this.fsWatcher || !existsSync(this.cfg.root)) return;
    try {
      this.fsWatcher = watch(this.cfg.root, { recursive: true }, (_event, rel) => this.changed(rel ? String(rel) : null));
      this.fsWatcher.on('error', (err) => {
        log(`stopped watching (${err.message}); trying again at the next sweep`);
        this.fsWatcher?.close();
        this.fsWatcher = null;
      });
      log(`watching ${this.cfg.root}`);
    } catch (err) {
      log(`cannot watch ${this.cfg.root}: ${(err as Error).message}`);
    }
  }

  async run(): Promise<void> {
    log(`Bottega watcher ${VERSION} starting, sending to ${this.cfg.server}`);
    this.watchRoot();
    await this.serial(() => this.sweep());
    setInterval(() => {
      this.watchRoot();
      void this.serial(() => this.sweep());
    }, SWEEP_MS);
    setInterval(() => {
      if (Object.keys(this.state.pending).length) void this.serial(async () => {
        await this.flush();
        await this.report();
      });
    }, RETRY_MS);
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function setup(): Promise<void> {
  const old = existsSync(CONFIG) ? loadConfig() : { server: 'https://studio.sirsinate.com', root: '/Volumes/VIGORISH/AUDIO   ABL VIGORISH SESSIONS' };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const server = ((await rl.question(`Bottega address [${old.server}]: `)).trim() || old.server).replace(/\/+$/, '');
  const root = (await rl.question(`Sessions folder [${old.root}]: `)).trim() || old.root;
  const token = (await rl.question('Token from Account › Security › Mac watcher (blank keeps the one stored): ')).trim();
  rl.close();
  const cfg = { server, root };
  if (token) storeToken(server, token);
  const t = token || readToken(server);
  const r = await call<{ projects: Project[] }>(cfg, t, 'GET', '/api/watcher/projects');
  writeJson(CONFIG, cfg);
  console.log(`Signed in: ${r.projects.length} projects you can send sets to.`);
  if (!existsSync(root)) console.log(`The sessions folder is not there now (${root}); the watcher waits for it.`);
  else {
    const folders = projectFolders(root);
    const matched = folders.filter((f) => matchFolder(f, r.projects));
    console.log(`${folders.length} project folders, ${matched.length} matched to a project.`);
  }
  console.log('Next: node watcher/dist/watcher/main.js install');
}

function status(): void {
  const cfg = existsSync(CONFIG) ? loadConfig() : null;
  const s = loadState();
  let loaded = false;
  try {
    execFileSync('launchctl', ['print', `gui/${process.getuid?.() ?? 501}/${LABEL}`], { stdio: 'ignore' });
    loaded = true;
  } catch {
    loaded = false;
  }
  console.log(`Bottega watcher ${VERSION}`);
  console.log(cfg ? `Sending to ${cfg.server}, watching ${cfg.root}${existsSync(cfg.root) ? '' : ' (not there now)'}` : 'Not set up.');
  console.log(`Starts at login: ${existsSync(PLIST) ? 'yes' : 'no'} · running now: ${loaded ? 'yes' : 'no'}`);
  console.log(`Last sweep: ${s.lastSweep ?? 'never'} · last heard from Bottega: ${s.lastContact ?? 'never'}`);
  const pending = Object.values(s.pending);
  console.log(`Waiting to be sent: ${pending.length}`);
  for (const p of pending) console.log(`  ${p.folder}/${p.file}`);
  const failed = Object.entries(s.failed);
  if (failed.length) {
    console.log(`Refused (tried again when the file changes): ${failed.length}`);
    for (const [path, f] of failed) console.log(`  ${path}: ${f.error}`);
  }
  if (s.unmatched.length) {
    console.log(`Folders with no project: ${s.unmatched.length}`);
    for (const f of s.unmatched) console.log(`  ${f}`);
  }
  if (s.lastError) console.log(`Last error: ${s.lastError}`);
  console.log(`Log: ${LOG}`);
}

function install(): void {
  loadConfig();
  const script = __filename;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${process.execPath}</string><string>${script}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${join(DIR, 'launchd.out.log')}</string>
  <key>StandardErrorPath</key><string>${join(DIR, 'launchd.err.log')}</string>
</dict>
</plist>
`;
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(PLIST, plist);
  const domain = `gui/${process.getuid?.() ?? 501}`;
  try {
    execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' });
  } catch {
    // not running yet
  }
  execFileSync('launchctl', ['bootstrap', domain, PLIST]);
  console.log(`Installed: the watcher starts at login and is running now. Log: ${LOG}`);
}

function uninstall(): void {
  try {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid?.() ?? 501}/${LABEL}`], { stdio: 'ignore' });
  } catch {
    // not running
  }
  if (existsSync(PLIST)) unlinkSync(PLIST);
  console.log('Uninstalled: the watcher no longer runs. Its settings and log stay in', DIR);
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'status';
  if (cmd === 'setup') return setup();
  if (cmd === 'status') return status();
  if (cmd === 'install') return install();
  if (cmd === 'uninstall') return uninstall();
  const cfg = loadConfig();
  const w = new Watcher(cfg, readToken(cfg.server));
  if (cmd === 'once') {
    await w.serial(() => w.sweep());
    status();
    return;
  }
  if (cmd === 'run') return w.run();
  console.log('Commands: setup, run, once, status, install, uninstall');
}

main().catch((err) => {
  log(`stopped: ${(err as Error).message}`);
  console.error((err as Error).message);
  process.exit(1);
});
