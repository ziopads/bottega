# Bottega — handoff

**Date:** 2026-10-11
**Read first, then `REQUIREMENTS.md` (0.15) and `ARCHITECTURE.md` (0.6).**

Bottega is James's studio platform for Sirsinate Sound Labs: a service with
separate accounts holding sessions, gear, manuals and the work in progress,
reachable from Claude through a connector so Claude can act as a production
collaborator and teacher. This file replaces the 10 October handoff. It
records what is built, how the work is done, and what comes next.

---

## 1. Where it stands

Repository `github.com/ziopads/bottega`, local `~/Desktop/_PROJECTS/bottega`,
deployed on Vercel to studio.sirsinate.com. Neon Postgres (project
`bottega-sirsinate`) with row-level security under the role `bottega_app`;
Cloudflare R2 for audio and files; Voyage for embeddings.

Latest commits, newest first:

| Commit | What it did |
|---|---|
| `dd04d36` | One type scale across the site; the document page in the layout system; `PageHeader` and shared control styles |
| `b25d313` | State tab: Live sets read in the browser from a dropped project folder, stored as snapshots (014) |
| `b1b7cba` | Mix variants numbered within each variant (013); parked cards folded away |
| `347d907` | Connector proposal tools `draft_criteria` and `draft_card` |
| `c5d9983` | Workflow tab (011); connector sign-in with `list_projects` and `get_session` (012) |
| `8716f1e` | Session header on one line; page titles below the app name |
| `fc6a891` | Session page columns; History as its own tab |
| `fa74b79` | Account page in tabs (010) |
| `36ca0bb` | Session tabs, waveform player, notes pinned to moments, one volume (009) |

Migrations `db/001`–`014`, with test suites in `db/test/` for 002–014.
001–013 are applied on Neon. **014
was committed; confirm it is applied** (`migrate.py --status`).

Confirmed working on production: sign-in and accounts, gear and its photos,
document upload and processing (the BeatStep Pro and Terra manuals are
searchable in the library), the session page and its tabs, the workflow, the
connector from Claude Desktop (asked "where was I on Khione?" and got a correct
answer, including spotting that its two mixes were numbered in the wrong order).

Not yet tried on production: the State tab's folder drop (the parser was
checked in Node against all 20 Khione saves, not in a browser), mix variants,
the proposal tools after their deploy, and the type pass of `dd04d36`, which
was never seen rendered.

## 2. How James works, and how to work with him

- Read the code before proposing a change. For anything beyond a small fix:
  understand first, list three or more approaches with their tradeoffs, and
  get his approval before building. Once he says "go", build the whole agreed
  slice.
- **James runs every install, migration, commit and push himself.** Give each
  command in a code block he can copy. Git commands name every file
  explicitly (never `git add -A`) and quote paths with brackets:
  `'app/api/cards/[id]/route.ts'`.
- After a build: say what was checked (type check, lint, access check,
  database tests) and what was not (anything not seen in a browser).
- Writing style for everything written to him: no "not X but Y" or "rather
  than" framings, no machine metaphors ("the heavy lifting", "load-bearing"),
  no flourish sentences, abbreviations expanded at first use, concise.
- Never print secret values from `.env` files; name the variables only.

## 3. The working setup

- Claude reaches the Mac through a Linux VM with the connected folders
  mounted (`$HOME/mnt/bottega`). It can read, edit and run `npx tsc`, `npx
  eslint` and `node scripts/check-access.mjs` there. It cannot install npm
  packages, cannot reach Neon, and cannot delete files: a `git` command run
  there leaves lock files under `.git`, so **do not run git from the VM**
  (it happened once; the lock was renamed aside).
- Database work is tested in the cloud workspace on a local Postgres 16
  (socket `/tmp`, port 5433, user `owner`, started by `/tmp/t4/pg.sh`), with
  a pgvector stand-in for 004 (`/tmp/t4/004.sql`). The cloud workspace is
  reclaimed between conversations, so a new one may need to rebuild this: a
  local Postgres, a `bottega_app` role, migrations 001–014 applied in order.
- Files written in the cloud go to the Mac with the commit tool, then the
  checks run in the VM.
- The cloud workspace has no npm registry access; a browser preview of pages
  has not been possible. Ask James for screenshots.
- The Khione Ableton project folder is connected for parser work:
  `/Volumes/VIGORISH/AUDIO   ABL VIGORISH SESSIONS/2025 0727 new studio
  config euf dp4 Project` (three spaces after AUDIO; remote folder prompts
  refuse that name, so James adds such folders with Add folder).

Environment variables (names only): `DATABASE_URL`, `NEON_AUTH_BASE_URL`,
`NEON_AUTH_COOKIE_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_AUDIO_BUCKET`, `R2_FILES_BUCKET`,
`VOYAGE_API_KEY`.

## 4. What is built

**Accounts and access** (REQUIREMENTS §2, AC-1 to AC-13). Separate accounts;
new sign-ups wait for approval; items shared one at a time at view,
contribute or edit; only owners delete; every access change in an
append-only log. Enforced in the database (`project_rank`, `gear_rank`,
`document_rank`, policies on every table) and in the app (`lib/access.ts`;
`scripts/check-access.mjs` fails the build if a page or route skips a guard).
The account page has tabs: Profile (display name, artists), Usage (storage by
kind, largest files), Sharing (everything shared, both directions), Security
(password, recent activity, connected apps with revoke), Preferences (default
artist), Billing and Data ("Coming soon…").

**Gear** (§4). A platform catalogue of models and each account's units;
browser-made WebP images in per-image folders; public and private files; a
gear map by studio group (`lib/gearGroups.ts`).

**Corpus** (§8). Documents processed in the app in resumable batches, with
storage and page allowances; one platform library of manufacturers' manuals,
private documents per account. Search over it is not built yet.

**Sessions** (§6). Tabs: Overview (details and sharing on the left; current
mix, where it stands, latest notes), Mixes (versions grouped by variant,
waveforms, notes on the selected version by moment), State, Workflow, Notes
(filters on the left), History. One player sounds at a time; one volume for
the app.

**Mix variants** (S-14, 013). A mix belongs to the main mix or a named
variant ("Radio edit"), chosen at upload, numbered within it; labels read
"Radio edit v1" everywhere (`mixLabel` in `lib/studioTypes.ts`). Remixes are
their own sessions; a link between them is not built.

**Workflow** (§7, W-1 to W-12, 011). Music stages: sketch, arrange, mix,
master; sound design is a card kind. Exit criteria per stage; advancing needs
every accepted criterion met; moving back needs a reason. Elements copied per
session from `lib/elementTemplate.ts` (the zones TACTUS, BASS, BACKGROUND,
LEADS, TEXTURE, VOX, plus STRUCTURE and BUS). Cards with kind, element, stage,
what and done-when; parked cards for later stages; settled decisions as
cards, reopened only with a reason. Claude's proposals wait in a review band.

**State tab and session analysis** (A-6 to A-8, 014). Dropping a session's
Ableton project folder reads every saved `.als` at its top in the browser
(`lib/als/`: `xml.ts` reader, `parse.ts`, `analyse.ts`, `readFolder.ts`;
the server side in `store.ts`). One snapshot per save, identified by
SHA-256, so dropping again adds only new saves; a newer `PARSER_VERSION`
re-reads old ones. The folder is listed by name and size; no audio is
uploaded. Shown: zone coverage (by track-name prefix TAC, BAS, BKG, LDS,
TEX, VOX, or the group's), an arrangement map, maintenance (plugins and
instances, Live devices, samples outside the folder, missing files, unused
files, files only older saves use, tracks off or empty, devices off), and the
changes between saves. `als_plugins` holds plugin instances per snapshot for
questions across sessions. The `.als` files themselves are not stored.

**Connector** (§11, M-1 to M-5, 012). Ported from Scriptorium: the app is its
own OAuth server (`lib/oauth.ts`, `app/oauth/`, `app/.well-known/`); tokens
in `oauth_tokens` behind security-definer functions that check the account's
status on every request. `app/api/mcp` with `mcp/server.ts`; every tool runs
as the token's account (`mcp/context.ts`). Tools: `list_projects`,
`get_session`, `draft_criteria`, `draft_card`. Connector address:
`https://studio.sirsinate.com/api/mcp`.

**Layout system** (ARCHITECTURE §13). Twelve columns, `DetailGrid` (main 8,
aside 4, aside left or right), `PageHeader`, `Section`, `MetaList`,
`TabBar` in `app/_ui/layout.tsx`; control classes in `app/_ui/styles.ts`;
four type sizes (`t-title` 18px, `t-lead` 15px, `t-body` 13px, `t-label`
11px uppercase) with the app name at 20px.

## 5. Lessons from the build

- A server component importing a non-component value from a `'use client'`
  module gets a client reference: shared values live in plain modules
  (`lib/sessionTabs.ts`, `lib/accountTabs.ts`).
- Tailwind 4's `divide-y` puts the border on the bottom of every child but
  the last; a coloured border on a list item colours that rule too.
- Neon's HTTP driver: one non-interactive transaction per call
  (`db.tx([...])`); no value passes between its statements. bigint and
  numeric arrive as strings, timestamps as Dates.
- Live 12 names the main track `MainTrack` (Live 11 `MasterTrack`).
  `RelativePathType` 3 is a project file, 5 a Live pack; preset references
  carry paths from Ableton's own machines and are not samples. Track names
  Live gives itself start with a number ("7-Trilian") that shifts when tracks
  move.
- Changing a Postgres function's return type needs `drop function` first;
  `create or replace` refuses it.
- The connector's OAuth needs `client_id_metadata_document_supported` and
  public clients, as in Scriptorium.

## 6. Next, in the order last discussed

1. **Check the last three deploys**: migration 014 applied; the State tab's
   folder drop on Khione in a browser; mix variants; the type pass
   (screenshots of Gear, Library, Collections, Sessions).
2. **State tab, your read** (S-15): a four-step scale per zone and part
   (empty, sketched, working, baked), each change dated, beside what the set
   shows.
3. **Connector analysis tool**: the latest snapshot, changes since the
   previous save, plugin use across sessions; Claude then proposes
   maintenance cards (kind "fix").
4. **Automatic updates** (A-9): a small program on the Mac watching the
   sessions folder, sending each new save with the same TypeScript parser and
   a personal token.
5. **Layout follow-through**: Gear and Collection detail pages into the
   two-column layout with `PageHeader`.
6. **Corpus search and the page reader**, then `search` and `read_pages` on
   the connector.
7. Smaller: renumbering mix versions (Khione's v1 and v2 are reversed);
   linking a remix to its original; a "made for" field (DJ tool or listening)
   that Claude asked about; the bulk manual import from the HARDWARE folder;
   accounts for Gordon and Chris.

Unconfirmed from earlier: the R2 audio bucket's CORS rule allowing GET from
the site (the waveform backfill needs it).
