# Bottega — architecture

**Version:** 0.20
**Date:** 2026-10-24
**Status:** draft
**Scope:** How Bottega is built. What it has to do is in `REQUIREMENTS.md`;
story IDs below (S-3, W-6 and so on) refer to it.

---

## Changelog

- **0.20** (2026-10-24) — Watcher Macs (REQUIREMENTS A-10 to A-12):
  migration 027 adds `watcher_macs` (name, sessions folder, current token, the
  hash and expiry of a one-time setup code) with `mac_add()`, `mac_update()`,
  `mac_new_code()`, `mac_remove()`, `mac_claim()` (called before anyone is
  known: trades a code for a new personal token for that Mac, revoking its
  previous one) and `mac_config()`; `watcher_reports.root_found`, and a
  seven-argument `watcher_report()` (the six-argument form stays as a wrapper
  for code deployed before 027). `lib/macs.ts`; routes `/api/account/macs`,
  `/api/watcher/claim` (unauthenticated, exempt in `scripts/check-access.mjs`)
  and `/api/watcher/config`; `app/account/WatcherMacs.tsx` replaces
  `WatcherTokens.tsx`. The watcher (1.1.0) gains `claim` and reads its folder
  from `/api/watcher/config`. `scripts/watcher-bundle.mjs` joins the compiled
  CommonJS into `public/watcher/bottega-watcher.cjs` (ignored by git), built by
  `npm run watcher:build`, which `npm run build` now runs first;
  `public/watcher/install.sh` installs Node.js and the watcher in the user's
  Library. Both are served as static files, outside the sign-in redirect.

- **0.19** (2026-10-23) — The Mac watcher: `watcher/main.ts`, compiled with
  the repository's TypeScript (`npm run watcher:build`, `watcher/tsconfig.json`,
  CommonJS into `watcher/dist`, ignored by git and lint) together with
  `lib/als/parse.ts`, `xml.ts` and `types.ts`; runs under a LaunchAgent; keeps
  its token in the login keychain and its queue in `state.json`. Migration
  026: `personal_tokens` (hash only, no grant on it), `token_create()`,
  `token_revoke()`, `token_verify()`, `watcher_reports`, `watcher_report()`.
  `lib/tokens.ts` (`tokenAccount`, the watcher routes' guard, added to
  `scripts/check-access.mjs`); routes under `/api/watcher` (projects, a
  project's sets, its folder, report), left out of `proxy.ts`'s sign-in;
  `lib/als/input.ts` shared with the State tab's routes; `/api/account/tokens`
  and `app/account/WatcherTokens.tsx` under Security.
- **0.18** (2026-10-23) — Migration 025: track structures
  (`structure_templates`, `structure_elements` with `prefixes` and
  `group_names`, `structure_copy()`, `account_structure()`), each project's
  copy in `elements` (new columns) and `project_structure`,
  `structure_start()` called by `workflow_start()` for music,
  `project_zones()`, `structure_template_status()`,
  `structure_template_elements()`, `structure_apply()`. Zones are decided at
  read time by `lib/als/zones.ts` (`applyZones`, `zoneOfName`); `coverage`
  and `diff` take the project's zones; `getSessionState` returns `zones` with
  colours. Preferences › Track structure: `lib/structure.ts`,
  `lib/structureTypes.ts`, `GET`/`POST /api/account/structure`,
  `app/account/StructureEditor.tsx`. The Workflow tab offers structure
  changes (`structureChanges`, op `structure`). `lib/elementTemplate.ts` now
  serves collections only.
- **0.17** (2026-10-23) — Migration 024: workflow templates, each project's
  own stages, the re-entry note, the work log and the board (§4, Workflow).
  `lib/workflow.ts` reads a project's stages through `project_stage_list()`;
  `workflow_stages` is no longer read. The Workflow tab rebuilt to W-24:
  `POST /api/projects/:id/workflow` gains `next`, `end-session` and
  `pull-next` (contribute) and `template` (edit); `parseSessionLine()` in
  `lib/workflowInput.ts` reads a loose line's #tags and "--". The board:
  `lib/board.ts` and `lib/boardTypes.ts`, `GET`/`POST /api/board` (place,
  swap, remove), `app/_board/BoardView.tsx` at `/`; the projects list moved
  from `/` to `/projects`. A project's last touch is the latest of its work
  log, cards, met criteria, stage moves, mixes and saved sets. Preferences:
  `lib/templates.ts`, `lib/templateTypes.ts`, `GET`/`POST
  /api/account/template` (board settings, choosing, copying, renaming and
  deleting a template, stages and criteria), `app/account/TemplateEditor.tsx`.
  The platform default is read only; editing starts from one's own copy. A
  new stage's key comes from its name. Likely done: `lib/workflowChecks.ts`
  runs the checks the project's criteria name against the newest saved set of
  the main mix (and the count of references); `getWorkflow` returns them as
  `setReading`. The `.als` parser (version 2) reads the set's key and scale
  from `LiveSet/ScaleInformation` (`Root`, or `RootNote`; `Name`, a number
  in Live 12, named through `SCALE_NAMES`) and Scale
  Mode from `LiveSet/InKey` (confirmed on Khione's sets, 23 October); saves read by version 1 are read again when the
  folder is dropped. `DetailGrid` takes an `outline` (left, kept in view;
  the work in the middle; context right), used by the Learning group's
  Syllabus tab and lessons (`app/_learning/Contents.tsx`). The player bar's
  "Note at" offers the moment to the open project page (`requestNote` /
  `onNoteRequest` in `deck.ts`), which opens its Mixes tab and note box
  itself; with no page to take it, the bar navigates. Waveform marks carry the
  note's author and text. Connector 0.9.0: `get_session` adds `next_move`,
  `blocker` (with sessions since), `latest_sessions`, each stage's criteria
  met, `finished`, criteria `hint` and `likely_done`, `set_read` and
  `template`; `list_projects` adds `board` and `next_move`; `draft_criteria`
  takes `{ criterion, hint }` as well as text; the instructions describe
  templates, the default stages, the next move and the board.
- **0.16** (2026-10-14) — Terms: project (an Ableton project folder) and set
  (an `.als` file); code, tables and connector tool names keep `session`
  where they had it (§1, Terms). Migration 023: a project's `bpm` follows its
  newest set (§4, Audio). Connector 0.8.0: instructions and descriptions say
  project.
- **0.15** (2026-10-14) — The site's one player (S-17): `app/_ui/audio/deck.ts`
  holds the audio element and queue in a module, `SitePlayer.tsx` is its bar in
  the root layout, `Player.tsx` controls it; `PlayerBar.tsx` and
  `usePlayer.ts` go (§4, Audio).
- **0.14** (2026-10-14) — The page reader's PDF drawn with PDF.js
  (`pdfjs-dist`) one page at a time from byte ranges, with its own page and
  zoom controls. The Library page in tabs; library manuals by
  type from their catalogue model's group (`groupOfModel()` in
  `lib/gearGroups.ts`), then manufacturer and model (§11, The library).
- **0.13** (2026-10-13) — Every action drawn as a button, all at one size:
  `BUTTON`, `BUTTON_PRIMARY`, `BUTTON_DANGER` and `TEXT_LINK` replace
  `TEXT_ACTION` and `TEXT_DANGER`, and one-off button classes go (§13).
- **0.12** (2026-10-12) — `auth_attempts` (021); `document_page_labels` and
  `document_sections` (022), read with PDF.js through unpdf during
  processing; the search page.

- **0.11** (2026-10-12) — Study resources (migration 020): videos and links,
  notes at moments, YouTube's IFrame Player API in the app; connector tool
  `add_study_resource` (§6).

- **0.10** (2026-10-12) — `study_group_documents` becomes a group's reading
  list and takes approved library manuals (migration 019); corpus search
  takes a study group as its scope (§6).

- **0.9** (2026-10-12) — `document_set_home()` (migration 018, §11 The
  library): the administrator moves a document between the library and
  private documents.

- **0.8** (2026-10-12) — Study sessions and notes (migration 017, §4 Study);
  connector tools `record_study_session`, `list_study_notes`,
  `get_study_history` (§6).

- **0.7** (2026-10-12) — Study groups as built in migration 016 (§4 Study,
  §11 Study groups): groups, members and invitations, the syllabus with
  Claude's proposals, progress, documents shared with a group (which widens
  `document_rank()`); lesson citations (`lib/citations.ts`); the Learning
  pages; connector tools `get_study_group`, `draft_topic`, `draft_lesson`,
  `draft_exercise` (§6).

- **0.6** (2026-10-10) — The corpus (migration 004): documents are extracted,
  chunked and embedded in the app, in resumable batches; allowances, the
  platform ceiling and the usage ledger (§11); `halfvec(1024)` confirmed (§5).
  Bottega has its own Voyage account.
- **0.5** (2026-10-10) — File storage (§12): buckets by access model, the key
  scheme, one credential per app and environment, a database row per object.
  The library is contributed to by users and approved by the administrator
  (§11).
- **0.4** (2026-10-10) — Gear as built in migration 003: model catalogue,
  units, the owner-only insurance record, files, typed capabilities with unit
  overrides, gear shares (§4, §11).
- **0.3** (2026-10-10) — Separate accounts with item-by-item sharing
  (REQUIREMENTS 0.4, AC-1 to AC-12, K-6, K-7, L-7 to L-11). New §11 sets out
  accounts, ownership, shares, the platform library, study groups, the access
  log and how access is enforced: row-level security in
  Postgres under a restricted role, with checks in the application above it.
  §1, §3, §4 (people and projects), §6 and §9 follow. The allowlists in the
  environment are retired.
- **0.2** (2026-10-10) — Phase 0 as built: accounts are created by a sign-up
  request, not in the Console (§3); audio, the current mix and the routes
  recorded as built (§4); environment variables as built, with `ADMIN_EMAILS`
  and the R2 names (§9); the account page.
- **0.1** (2026-10-09) — Initial draft. Hosting on Neon, sign-in and connector
  copied from Scriptorium, projects stored as one shared table plus a table per
  kind, parts as an ordered membership table.

---

## Terms

A music **project** is one Ableton project folder; its **sets** are the `.als`
files in it (REQUIREMENTS §1, Terms). The screens say so since 14 October
2026. Names in code and data keep the older word: `music_projects` and
`/projects/:id` already said project, while `SessionTab`, `getSessionState`,
`app/_studio/session/`, `session_variants`, `als_snapshots` (a stored set) and
the connector's `get_session`, `session_id` and `session` field mean a project
or its sets. `study_sessions` are study sessions (L-18).

## 1. Shape

```
  James's Mac                         Vercel                       Neon
  ───────────                         ──────                       ────
  pipeline/ (Python)                  Next.js application          Postgres + pgvector
    analyse .als + audio ── measurements ───────────────────────▶  analyses
                                      pages, server actions ◀───▶  every table
                                      process route ── batches ─▶  pages, chunks
                                        ├─ R2 (the PDF)  └─ Voyage (embeddings)
  Browser ── sign-in ───────────────▶ Neon Auth (identity) + accounts (access, §11)
          ── signed PUT/GET ────────────────────────────────────▶  Cloudflare R2 (audio, gear files, PDFs)
  Claude (Anthropic's cloud) ── OAuth ▶ /api/mcp ◀──────────────▶  read; proposals only
```

Remote MCP calls come from Anthropic's servers, never from the device the
person is using, so the connector must be reachable on the public internet and
cannot read anything on the Mac. Everything that needs the Mac (the projects
volume) runs in `pipeline/` and sends results to the database. Documents are
processed in the app (REQUIREMENTS K-9), since any account can load one.

## 2. What runs where

| Piece | Where | Why there |
|---|---|---|
| Application and connector | Vercel, one Next.js app; the connector is a route | Same as Scriptorium |
| Database | Neon Postgres, its own project (not Scriptorium's) | Separate storage and compute allowance per project |
| Audio, gear files, source PDFs | Cloudflare R2, private buckets, signed links | The audio bucket already exists for Vivarium's studio and is reused |
| PDF extraction, chunking | the app: a processing route that handles one batch of pages per request (`unpdf`) | Any account can load a manual; batches fit Vercel's 300-second limit and resume |
| Embedding | `lib/embed.ts`, for documents and search queries; Voyage, on Bottega's own account | The only model calls; no text is generated by the app |
| Project and audio analysis | `pipeline/` on the Mac | The projects live on the VIGORISH volume |

## 3. Copied from Scriptorium

Copied as a starting point, then owned by Bottega; nothing is shared at run
time.

- **Sign-in.** Neon Auth (managed Better Auth) for identity only. Access is
  Bottega's own (§11): Neon Auth allows open sign-up, so a new sign-up lands
  as a pending account and sees nothing until approved. (Phase 0 used an
  `ALLOWED_EMAILS` list copied from Scriptorium; §11 replaces it.) Identities
  can still be created directly by a sign-up request to
  `/api/auth/sign-up/email` (the Console's "Create user" sets no password; see
  `HANDOFF.md` §3). A signed-in person changes their own password at
  `/account`; there is no reset by email. `lib/auth/`, `proxy.ts`.
- **Connector.** `mcp-handler` route at `app/api/mcp`, with the application as
  its own OAuth authorization server (`lib/oauth.ts`, `.well-known/`,
  `app/oauth/`), token hashes only in the database.
- **Proposals.** The `draft_note` pattern: everything the connector writes is
  marked `origin = 'assistant'`, `reviewed = false`, and waits for a person.
- **Retrieval.** Chunking, embedding (ported from `embed.py` to `lib/embed.ts`), hybrid search (keyword and meaning
  combined by reciprocal rank fusion in one statement), `read_pages`, and the
  quotation matcher.
- **Health page.** `lib/health.ts`: database size, Neon's own usage figures,
  and a live embedding check.

Left behind: page offsets, folio labels, Chicago citations, dossiers.

## 4. Data model

One numbered migration per change in `db/`. Tables are grouped by layer and
marked with the phase that creates them.

### People (Phase 0; changed in Phase 1)

- `artists` — code (VIG, KR, KJI, ASU), name. From Phase 1 each artist has an
  owning account (`account_id`); a project may be credited only to an artist
  of its owner's account.
- `members` — email, display name, artist. Phase 0's attribution table.
  Migration 002 restricts it to each person's own row; it is dropped once
  `lib/studio.ts` reads names from `accounts` instead.
- `accounts`, `shares`, `access_log` — Phase 1, §11.

### Projects (Phase 0)

One shared table and one table per kind, so that everything common to all
work (workflow, notes, files, parts) can point at a single `projects.id` with
a real foreign key.

- `projects` — id, kind (`music`, `installation`, `multimedia`,
  `collection`), title, rating 0–5, created by and when, and from Phase 1 the
  owning account (`owner_id`). Stage columns arrive in Phase 2.
- `project_titles` — history of titles, carried over from Vivarium's
  `studio_project_names`.
- `music_projects` — project id (primary key), artist, canonical ID (unique per
  artist, made permanent by trigger as in Vivarium), genre, BPM, current mix.
- `collections` — project id, form (`ep`, `lp`, `single`, `compilation`,
  `multipart`), year.
- `installation_projects`, `multimedia_projects` — Phase 2, fields to be
  defined.
- `project_parts` — parent, child, position. Which projects make up a larger
  one, in order: the tracks of an EP, the movements of a composition, the
  soundtrack of an installation. A project can be part of several parents. A
  trigger refuses any row that would make a project contain itself, directly
  or through others. The name is provisional (`members` is taken by people).
- `genres` — the extendable list.

### Audio (Phase 0, as built)

- BPM from sets (migration 023): a trigger on `als_snapshots` (after insert,
  or an update of `data` or `saved_at`) calls `project_bpm_from_saves()`,
  which sets `music_projects.bpm` to the newest set's `tempo`, rounded to two
  places, when it is between 20 and 400. It runs as the person storing the
  set, who already has edit access, so row-level security is unchanged. The
  State tab asks for the project again after a drop to show the new BPM.

- Playback (S-17, 14 October): one `Audio` element for the tab, made on first
  use and held in `app/_ui/audio/deck.ts` with what is loaded, the queue and
  whether it plays, read through `useSyncExternalStore` (`useDeck`, and
  `useDeckTime` for the position). A client module stays loaded across
  client-side navigation, so the sound continues from page to page; a full
  reload stops it, so in-app forms that only navigate use `next/form`. The bar
  (`SitePlayer.tsx`) is mounted in `app/layout.tsx` for active accounts. Its
  links go to `/projects/:id?tab=mixes&track=:trackId[&variant=][&at=s]`;
  the Mixes tab opens on that mix and, with `at`, opens the note box at that
  moment, then drops `at` from the address. A file with no length on record
  reports it once played (it used to on page load, from each row's own
  element).

- `audio` — project, `role` (`mix` or `reference`), `version`, `r2_key`
  (unique), original filename, bytes, `duration_s`, `credit`, uploaded by and
  when. A check ties the two roles apart: a mix has a version and a reference
  has none. Versions are unique per project. Mixes copied from Vivarium kept
  their R2 keys.
- `credit` is free text naming a reference's artist and title; it is empty on
  mixes.
- `music_projects.current_mix_id` points at one `audio` row; null means the
  newest mix is current. It is set to null if that row is deleted. A trigger
  refuses a reference or another project's mix.
- `duration_s` is read in the browser from the file's metadata at upload and
  sent with the record. Files uploaded without it (the older Vivarium uploads)
  are filled by the admin page `/admin/lengths`, which plays each file's
  metadata through the usual signed link and posts the length to
  `/api/audio/[id]/duration`. No server-side audio library is involved.

### Notes (Phase 0)

- `notes` — project, optional audio row, author, body, created, edited,
  `origin`, `reviewed`, `rejected_at`.

### Routes (Phase 0, as built)

Pages: `/` (own projects, then "Shared with me"), `/projects/[id]`,
`/collections`, `/collections/[id]`, `/admin/lengths` (fills lengths in the
viewer's own projects), `/admin/accounts` and `/admin/accounts/[id]` (platform
administrator), `/account`, `/auth/sign-in`, `/auth/pending`.

Route handlers under `app/api/`. Each calls `apiAccount()` and, for one
project, `projectRefusal()` with the level it needs (§11); the level is given
in brackets:

| Path | Methods | Does |
|---|---|---|
| `projects` | GET, POST | list what the viewer can see; create one in their own account |
| `projects/bulk` | POST | bulk edit from the project list [edit on each; owner to change artist] |
| `projects/[id]` | GET, PATCH | read [view]; change title, rating, genre, BPM, current mix [edit], artist [owner] |
| `projects/[id]/tracks/upload` | POST | sign an R2 upload for a mix or reference, step 1 of 2 [contribute] |
| `projects/[id]/tracks` | GET, POST | list mixes [view]; record an uploaded mix, step 2 [contribute] |
| `projects/[id]/references` | GET, POST | list references [view]; record an uploaded reference [contribute] |
| `projects/[id]/notes` | GET, POST | list notes [view]; add one [contribute] |
| `projects/[id]/shares` | GET, POST | who it is shared with; share by email [owner] |
| `shares/[id]` | PATCH, DELETE | change a share's level; revoke [owner] |
| `tracks/[trackId]` | DELETE | delete a mix [owner] |
| `tracks/[trackId]/audio` | GET | redirect to a short-lived signed link; `?download=1` names the file [view] |
| `references/[id]` | PATCH, DELETE | change a reference's credit [contribute]; delete [owner] |
| `audio/[id]/duration` | POST | store a length read in the browser [the database fills it at contribute] |
| `notes/[noteId]` | PATCH, DELETE | edit [author]; delete [owner] |
| `genres` | GET, POST | the platform's genre list; add one [any active account] |
| `collections` | GET, POST | list what the viewer can see; create one in their own account |
| `collections/[id]` | GET, PATCH, DELETE | read [view], edit [edit; owner for artist], delete [owner] |
| `collections/[id]/tracks` | POST, PUT, DELETE | add and reorder parts [edit]; remove one [owner] |
| `auth/[...path]` | GET, POST | Neon Auth's proxy |

The names `tracks` and `trackId` for mixes are carried over from Vivarium.

### Workflow (Phase 2)

Migrations 011 and 024. REQUIREMENTS W-1 to W-24.

- `workflow_templates`, `template_stages`, `template_criteria` (024) — a
  kind's stages (key, position, label, standard) and the criteria each starts
  with (body, hint, check, and a `uid` kept across copies). No owner: the
  platform default. `template_copy()` makes an account's copy; any change to
  stages or criteria raises the template's `version`. A stage key never
  changes.
- `workflow_checks` (024) — the fixed list of checks a criterion can name.
- `account_preferences` gains `music_template_id`, `rotation_limit`,
  `cold_days` (024).
- `project_stages` (024) — a project's own stages, copied at
  `workflow_start()`. `project_stage_list()` gives them, or the owner's
  template's before the start. `workflow_stages` (011) is kept, no longer
  read.
- `project_workflow` — the current stage, when entered, and (024) the
  template and version copied, `next_move`, `blocker`, `blocker_set_at`,
  `finished_at`. Written by functions only: `workflow_start`,
  `workflow_move`, `workflow_set_next`, `work_log_add`, `template_apply`;
  `workflow_check_finished()` keeps `finished_at` after every change to
  criteria or the stage.
- `stage_moves` — every move, with the reason a move back needs.
- `exit_criteria` — per project and stage; (024) `hint`, `check_key`,
  `template_uid`. `workflow_template_status()` and
  `workflow_template_criteria()` read the project's template for anyone who
  can see the project.
- `elements` — the element tree, copied per project from
  `lib/elementTemplate.ts`.
- `cards` — project, element, stage, what needs to happen, how it will be known
  to be done, status, settled, origin.
- `card_reopenings` — card, reason, who, when.
- `work_log` (024) — each ended session: what was done, the next move set.
- `board_places` (024) — each person's board: project, backlog or rotation.
  `board_place()` keeps rotation within `rotation_limit`, finished projects
  not counting; `board_swap()` exchanges two.

### Gear (Phase 1)

Migrations 003, 005 to 008. REQUIREMENTS G-1 to G-11. The studio groups on
the gear map are fixed in code (`lib/gearGroups.ts`), one per catalogue
category; 008 adds the `processor` category and moves effect models whose
effect types are all processing (filter, compressor, limiter, gate, EQ).

- `gear_models` — the platform catalogue: kind, category (a closed list, so
  `is_sound_source(category)` can answer "sound sources"), manufacturer,
  model, year introduced and year discontinued (null while still made),
  description, status (`suggested`, `approved`, `rejected`), suggested by. A
  trigger makes any non-administrator insert a suggestion and refuses their
  updates.
- `capability_defs` — the vocabulary: key, label, value type (`boolean`,
  `integer`, `number`, `text`, `enum`, `list`), unit, choices. Seeded with
  seventeen capabilities in 003 and three more in 005 (power, rack units,
  effect types); form factor became a list in 005. Any active account may add
  one; the administrator edits.
- `model_capabilities` — model, capability, value (JSON, checked against its
  definition by `capability_value_ok`). Administrator only.
- `gear` — the account's unit: owner, model (or its own manufacturer and name),
  nickname, status (`owned`, `wishlist`, `gone`), firmware, notes.
- `gear_private` — one row per unit, created with it: serial, purchase date,
  price and currency, seller, estimated value and the date of the estimate,
  condition, location, service history, licence
  key, seats, activation, renewal. A separate table because row-level security
  works on rows: a shared unit's row is visible to the grantee, so the
  insurance record must be a row they cannot see.
- `gear_capabilities` — the unit's overrides, checked like the model's.
- `gear_capabilities_effective` — a view, run as the caller: each visible
  unit's capabilities, its own where set, else its model's, with `overridden`.
- `gear_files` — unit, role (`photo`, `receipt`, `serial_plate`, `document`,
  `other`), R2 key in the private gear bucket, filename, type, bytes, caption.
  Migration 006 adds `public` (shown to grantees; photos default public,
  other roles private) and `rotation` (0, 90, 180, 270, applied when shown;
  the file is never rewritten).

Importing an account's gear (G-8): `pipeline/gear_clean.py` turns a
spreadsheet into the import format (one row per unit; its docstring lists the
columns) and marks rows a person should check; `pipeline/gear_import.py`
loads it as the owner role, finding or adding approved catalogue models,
adding capabilities a model lacks, and adding units with their private
records. Its dry run does everything in a transaction and rolls it back; a
second run adds nothing.

"Which of my sound sources can hold a non-equal-tempered scale?":

    select g.* from gear g
    join gear_models m on m.id = g.model_id
    join gear_capabilities_effective e on e.gear_id = g.id
    where g.status = 'owned' and is_sound_source(m.category)
      and e.capability = 'microtuning' and e.value = 'true';

### Corpus (Phase 1)

- `documents` — title, kind (manual, service, firmware, reference, book,
  other; the library takes the first three), manufacturer and model for
  manuals, `library` (platform-wide) or `owner_id` (private; exactly one of
  the two), contributor and review status, R2 key, size and SHA-256, page
  count, and processing state (`pending`, `processing`, `ready`,
  `needs_ocr`, `paused`, `failed`) with the number of pages done. Linked to
  gear through `model_documents` and `library_picks` (§11).
- `pages` — document, page number, text.
- `chunks` — document, first and last page, text, a generated full-text
  column (GIN index), embedding as `halfvec(1024)` (HNSW index, cosine),
  chunker version. Embedding model and dimension are recorded per document.
- `platform_settings`, `account_limits`, `processing_usage` — the allowances
  and the ledger behind them (§11).

Pages: `/library` (upload, the review queue for the administrator, the
person's submissions, their own and shared documents, the approved library)
and `/library/[id]` (one document: review, processing, model links). Route
handlers under `app/api/documents/`:

| Path | Methods | Does |
|---|---|---|
| `check` | POST | by fingerprint: does the library, or the person, already hold this file |
| `upload` | POST | a signed PUT for a PDF, after the duplicate and storage checks |
| (root) | GET, POST | list what the person can see; record an upload once it is in R2 |
| `[id]` | GET, PATCH, DELETE | read; edit details [edit]; review [administrator]; pick for one's search; delete [as the policy] |
| `[id]/process` | POST | one processing step [edit]; the page calls it until the document is ready |
| `[id]/file` | GET | a 10-minute download link [view] |
| `[id]/models` | POST, DELETE | link a library manual to a catalogue model; remove a link |

Processing, one step per call (`lib/pdf.ts`, `lib/chunk.ts`, `lib/embed.ts`):
the first steps download the PDF, check its SHA-256 against the one the
browser sent (a mismatch deletes the document and its file), refuse a
document longer than the person's limit, and store up to 300 pages of text a
call. Later steps each claim up to 40 pages, chunk them (about 2,000
characters with 300 of overlap), embed the chunks and commit them with
`pages_done` in one transaction that applies only if `pages_done` has not
moved, so two open pages cannot process the same pages twice.

### Study (Phase 2)

- Built (016): `study_groups`, `study_group_members`,
  `study_group_invitations` (§11); `study_topics` (group, title, summary,
  catalogue model, position), `study_lessons` (topic, title, body with
  citation markers, position), `study_exercises` (topic, optional lesson,
  task, done when, position), each with origin, reviewed and rejected as in
  the workflow; `study_progress` (exercise, member, status, note);
  `study_group_documents` (group, document, shared by).
- Built (017): `study_sessions` (group, author, started, minutes, kind,
  summary, private, origin, published), `study_session_topics`,
  `study_notes` (group, author, optional session, topic, lesson, exercise;
  body, private, origin, published). Claude's writing (origin `assistant`)
  is inserted unpublished; `study_session_publish()` publishes a session with
  its notes; an author may delete only their own unpublished rows. Read
  policy: members see their own, and others' published, non-private ones (a
  note in a session also needs the session visible: `study_session_visible()`).
  A session and its notes are written in one transaction, the notes taking
  the new session's id from `currval(pg_get_serial_sequence(...))`.
- Built (020): `study_resources` (group, kind video or link, https url,
  YouTube id unique per group, title, channel, thumbnail, why, added by,
  origin, published), `study_resource_topics`; `study_notes.resource_id` and
  `position_s` (a moment, cleared without a resource); `study_sessions.resource_id`.
  Claude's resources arrive unpublished; `study_resource_publish()`. Title,
  channel and thumbnail come from YouTube's oEmbed endpoint when added
  (`lib/youtube.ts`, no key); the watch page plays the video through the
  IFrame Player API from youtube-nocookie.com (`app/_learning/VideoPlayer.tsx`),
  reading the current time for "note at" and seeking to a note's moment.
- Later: question and answer notes, `instruments` (member, MPC model,
  firmware), join requests.
- Citations are not stored apart from the lesson body: `lib/citations.ts`
  parses the markers (`[15:p42]`, `[15:p42-43]`, `[15:p42 "words"]`) for the
  checker (`checkCitations()` in `lib/study.ts`, run on every save, by a
  person or the connector) and for the renderer (`app/_learning/LessonBody.tsx`).
  A quotation is compared with the page text ignoring case, curly quotes,
  dashes, soft hyphens, words broken across lines and runs of white space.

### Analysis (Phase 3)

- `analyses` — project, file path, file modification time, analyser version,
  kind (`als` or `audio`), measurements as JSON.
- `comparisons` — mix analysis, reference analysis, differences by band.

## 5. Storage budget

Scriptorium's measurement on 22 September is the only real figure available:
about 16.5 KB per chunk at 1024 dimensions, counting vector, text, folded text
and full-text column, plus about 8 KB per chunk for the vector index. At
roughly one chunk per manual page:

| Pages | Without index | With index |
|---|---|---|
| 1,000 | ~16 MB | ~24 MB |
| 5,000 | ~80 MB | ~120 MB |
| 10,000 | ~165 MB | ~245 MB |

Decided (open decision 5): embeddings are voyage-4 at 1024 dimensions, stored
as `halfvec(1024)` (half precision, half the bytes, indexable by HNSW), which
cuts the vector share of each chunk from about 4 KB to 2 KB with little loss
of retrieval quality. The health page measures the real size from the first
manuals; the size is revisited if the corpus grows past the plan. Documents
are embedded with Voyage's `input_type` `document` and queries with `query`.

The rest of the database (projects, notes, gear, cards) is small next to the
corpus. Audio and files never enter the database.

## 6. The connector

Tools arrive by phase. A connector token carries the person it was issued to
(`oauth_tokens.user_id`, where Scriptorium keys by email), and every tool runs
under that person exactly as a page would (§11): same database role, same
policies. All write tools propose.

Built (11 October 2026): `list_projects` and `get_session`, with the
authorization server ported from Scriptorium. Tokens live in `oauth_tokens`
(db/012), keyed by account; the application role cannot read the table and
goes through security-definer functions that check the account's status on
every exchange and request, so disabling an account ends its connector at
once. Each tool builds its query handle from the token's account
(`mcp/context.ts`). Account › Security lists connected clients and revokes
them.

| Phase | Tools |
|---|---|
| 1 | `list_documents` ✓, `search` ✓, `read_pages` ✓, `find_gear`, `get_gear`, `list_projects` ✓, `get_session` ✓ (named `get_project` in earlier drafts) |
| 2 | `get_board`, `draft_card` ✓, `draft_criteria` ✓, `get_study_group` ✓ (syllabus, proposals and progress), `draft_topic` ✓, `draft_lesson` ✓, `draft_exercise` ✓, `record_study_session` ✓, `list_study_notes` ✓, `get_study_history` ✓, `add_study_resource` ✓ |
| 3 | `get_analysis`, `compare_to_reference` |

A study group's reading list (019) is a search scope of its own:
`search({ group })`, for a member, searches only the documents on
`study_group_documents` for that group, ignoring the person's picks and gear.
The instructions tell Claude to use it whenever working on a group.

Corpus tools (`mcp/tools/corpus.ts`, `lib/search.ts`): search scopes to the
person's documents, picks and owned gear's manuals by default (K-7), lists
those documents first and searches only their chunks, so row-level security
never empties the nearest-neighbour candidates; pgvector's iterative scan is
turned on where available. Results and pages carry links to the page reader,
`/library/[id]/read?page=N&q=…`, which shows a page's extracted text with the
query marked and, beside it, the PDF at that page, drawn by PDF.js from byte
ranges of the signed reader link (`app/_library/PdfPane.tsx`), so a page of a
large book fetches only what that page needs. Pages are PDF pages from 1.

## 7. Migration from Vivarium (Phase 0)

A one-time script reads the Sirsinate Supabase database and writes Neon,
mapping:

| Vivarium | Bottega |
|---|---|
| `studio_artists` | `artists` |
| `studio_members` | `members` |
| `studio_projects` | `projects` (kind `music`) + `music_projects` |
| `studio_project_names` | `project_titles` |
| `studio_tracks` | `audio` (role `mix`), R2 keys unchanged |
| `studio_notes` | `notes` |
| `studio_genres` | `genres` |
| `studio_releases` | `projects` (kind `collection`) + `collections` |
| `studio_release_tracks` | `project_parts` |

Verified by row counts on both sides before studio.sirsinate.com moves. The
audio stays where it is in R2; only the database rows move. Vivarium's studio
code is retired after the switch.

## 8. Repository layout

```
app/            pages, server actions, api/mcp, oauth, .well-known
lib/            db, auth, oauth, embed, search, matcher, health
mcp/            server and tools
db/             numbered migrations
pipeline/       Python: bootstrap, analyse; its own venv
scripts/        one-time jobs (the Vivarium migration, duration backfill)
docs/           REQUIREMENTS, ARCHITECTURE, HANDOFF
```

## 9. Environment

| Variable | Used by |
|---|---|
| `DATABASE_URL` | the app. From Phase 1, the restricted role `bottega_app`, subject to row-level security (§11) |
| `DATABASE_URL_UNPOOLED` | `pipeline/` and `migrate.py`: the owner role, which bypasses row-level security |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | sign-in; required at build time |
| `ALLOWED_EMAILS`, `ADMIN_EMAILS` | Phase 0 only. Removed once §11 is deployed; accounts and the platform administrator live in the database |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | the R2 client |
| `R2_AUDIO_BUCKET` | mixes and references: signed uploads and links |
| `R2_FILES_BUCKET` | every other upload, library manuals included (§12) |
| `VOYAGE_API_KEY` | `lib/embed.ts`: processing and search. Bottega's own Voyage account, separate from every other project's |
| `NEON_API_KEY`, `NEON_PROJECT_ID` | health page |
| `VIVARIUM_DB_URL` (Vivarium's Sirsinate database) | `scripts/migrate_from_vivarium.py` only; removed after the copy |

## 10. Checked and recalled

Checked on 9 October 2026:

- Neon's free plan, per its FAQ: 1 GB per project, 100 projects, 20 GB across
  the account, 100 compute-hours per project per month, scale to zero after five
  minutes. Scriptorium's own records give 512 MB for its project; which figure
  applies to a new project is to be read from the Neon Console.
- Vivarium's `studio_tracks` already has a `duration_s` column.

Recalled from Scriptorium's records of September, to be checked before relying
on them: Voyage's free allowance (200 million tokens on the current model
generation), and `voyage-4` supporting 1024-dimension output.

## 11. Accounts and access (Phase 1)

Implements REQUIREMENTS §2, AC-1 to AC-12. Migration 002.

### Who someone is

Neon Auth proves identity and supplies a stable user id. Everything else is
Bottega's:

- `accounts` — `user_id` (Neon Auth's id, primary key), email (lower case,
  refreshed at each sign-in), display name, `status` (`pending`, `active`,
  `disabled`), `is_platform_admin`, created, approved at and by.
- On every request the guard reads the session. A user id with no `accounts`
  row is inserted as pending by a database function, which also writes the
  first log entry. This needs nothing from Neon Auth's own tables, so it holds
  whichever way they are laid out.
- A pending or disabled person is sent to `/auth/pending` and reaches nothing
  else.

### What belongs to whom

- Top-level items carry `owner_id` referencing `accounts`: `projects` (all
  kinds), `gear` (migration 003), and private `documents` (004).
- Platform-wide rows have no owner: `genres`, the capability vocabulary,
  library `documents` (`owner_id` null, `library = true`), and study groups
  (custodian, not owner; below).
- Everything else inherits through its parent: `music_projects`,
  `collections`, `audio`, `notes`, `project_titles` through the project;
  `gear_files`, `gear_capabilities` through the gear; `pages`, `chunks`
  through the document.
- People who act on others' items are recorded by account: `audio.uploaded_by_id`,
  `notes.author_id`, `projects.created_by_id`. The Phase 0 email columns stay
  as history.
- Migration 002 gives every existing project, and the artists VIG and ASU, to
  James's account. KR and KJI pass to Chris's and Gordon's accounts when
  those exist.

### Shares

- `shares` — one row per item, person and level: a nullable foreign key per
  kind of item (`project_id`; `gear_id` from 003; `document_id` with its
  table), exactly one set; `grantee_id`; `level` (`view`, `contribute`,
  `edit`); granted by and when. Unique per item and grantee.
- Only the item's owner can insert, change or delete a share.
- AC-6, collections: a share on a collection gives view on each part **owned
  by the same account**. A collection cannot pass on access to a track that
  belongs to someone else; that track's owner shares it themselves.

### Effective level

One SQL function per kind of item answers "what may the current person do
with this?": `project_level(project_id)` returns `owner`, `edit`,
`contribute`, `view`, or null (`gear_rank`/`gear_level` from 003 are the
same without collections). It considers ownership, a direct share, and
shares on collections above the project (walking `project_parts` upward,
same-owner parts only). It returns `view` for the platform administrator only
when the request is marked as an administrator's read-only view (below), and
never more. `gear_level` and `document_level` follow the same shape.

The current person comes from `current_setting('app.user_id', true)`. When it
is unset the functions return null, so a query run without a person sees
nothing.

### Enforcement: the database

- The app connects as `bottega_app`, a role that owns nothing and does not
  bypass row-level security. Tables belong to the owner role, which the
  pipeline and the migration runner use.
- Every table holding account data has row-level security enabled, with
  policies written against the level functions:

  | Table | Read | Insert | Update | Delete |
  |---|---|---|---|---|
  | `projects` and kind tables | level not null | `owner_id` is me, account active | `edit` or `owner` | `owner` |
  | `audio` | level of its project | `contribute` or above | `contribute` or above | `owner` |
  | `notes` | level of its project | `contribute` or above, `author_id` is me | author only | `owner` |
  | `project_parts` | parent readable | `edit` on parent, and the child readable | `edit` on parent | `owner` of parent |
  | `artists` | own, or credited on a readable project | own | own | own |
  | `shares` | owner of the item, or the grantee | owner of the item | owner | owner |
  | `accounts` | self; platform administrator | through functions only | through functions only | never |
  | `access_log` | entries concerning me or my items; administrator all | through triggers and functions only | never | never |

- `genres` and the capability vocabulary are one list each for the platform,
  readable and extendable by every active account.

### The library (Phase 1)

- Library documents are contributed by users (REQUIREMENTS K-6, K-8): an
  upload creates a `documents` row with `library = true`, `review_status =
  'submitted'`, `contributed_by` and the file's `sha256`; a trigger
  (`documents_guard`) sets those whatever the request says. The contributor
  edits and processes it at once (level `edit`); everyone active reads it once
  `review_status = 'approved'`, and from then on the contributor only reads it
  too; a rejected document stays readable by its contributor, who may delete
  it, as they may withdraw one under review. Only the administrator changes
  `review_status`, and each review is written to the access log. An upload
  whose `sha256` matches an existing library document is not stored: the
  person is linked to the existing one. `find_library_document(sha256)`
  answers by fingerprint alone, since the uploader may not be able to see a
  submission that is still under review.
- Library documents are never shared: once approved everyone reads them.
- `contributed_by` is kept for attribution but is not an owner: deleting that
  account leaves the document in the library, with `contributed_by` set to
  null.
- `model_documents` — model, document, who linked them. Anyone who can read a
  library manual may link it to a catalogue model (REQUIREMENTS K-6); every
  unit of that model then has it. A link is removed by the administrator or
  by whoever made it.
- `library_picks` — account, document: further library documents a person has
  chosen. An account's default search (K-7) covers the manuals of its units'
  models, its picks, its private documents and those shared with it.
- Private documents follow the ownership and sharing rules above, with
  `document_level()`.
- A document's home changes only through `document_set_home(document,
  library, kind)` (018), callable by the platform administrator only: it
  sets `app.document_home` for the transaction, which `documents_guard`
  honours for the administrator alone (the app role has no update grant on
  `library`, `owner_id` or `contributed_by`, so the setting cannot be used by
  hand). Library to private removes picks and model links; private to library
  approves and removes shares and group shares; both refuse a second copy of
  the same file and write `document_moved` to the access log.
- The Library page (`app/_library/Library.tsx`, K-16) files an approved
  manual by the catalogue models it is linked to: each model's kind and
  category (carried in `StudioDocument.models`) give its group through
  `groupOfModel()`, the gear map's rule, so a manual is never given a type of
  its own. A manual linked to two models stands under both; one with no link
  is under Not filed, by the manufacturer and model typed on the document.
  Manufacturers are one row whatever their case, spelled as the catalogue
  spells them.

### Study groups (Phase 2)

As built in migration 016 (12 October 2026):

- `study_groups` — name (unique, any case), description, custodian (an
  account), status (`open`, `closed`), created. Creating one makes the
  creator custodian and first member (a trigger).
- `study_group_members` — group, account, joined, and how (`created`,
  `invited`, `requested`). Written only by the functions below.
- `study_group_invitations` — group, account, invited by, status (`pending`,
  `accepted`, `declined`, `withdrawn`), kept after they are answered. Asking
  to join (`requested`) comes later.
- Functions, each refusing with a message the app shows:
  `study_group_invite(group, email)` (custodian; approved accounts only),
  `study_invitation_answer(invitation, accept)` (the invitee),
  `study_invitation_withdraw(invitation)` (custodian),
  `study_group_leave(group)` (a member, not the custodian),
  `study_group_remove(group, account)` (custodian),
  `study_group_set_status(group, status)` (custodian). Handover comes later;
  until then the custodian can neither leave nor be removed.
- `study_member()`, `study_custodian()`, `study_open()` answer for the
  current person. Syllabus rows are written by the custodian as their own
  (origin `human`, reviewed) or by any member as Claude's proposal (origin
  `assistant`, unreviewed), only while the group is open; only the custodian
  updates them (accepting, rejecting, editing, ordering). Progress rows are
  written by their member only, on accepted exercises, while the group is open.
- `study_group_documents`: the owner of a private document shares it with a
  group they belong to; `document_rank()` gives the group's current members
  view. Sharing and unsharing are logged (`document_shared_with_group`,
  `document_unshared_from_group`).
- Policies: every active account reads group names and descriptions; members
  read everything in a group; no delete is granted on any study table except
  `study_group_documents`, so groups and their contents are deleted only
  through the owner role, by the platform administrator.
- The access log records creation, invitations (sent, declined, withdrawn),
  joining, leaving, removal, closing and reopening; a custodian reads the
  entries about their group.

### Enforcement: the application

`lib/access.ts` sits above the policies, so a refusal is a clear answer
rather than an empty result:

- `requireAccount()` — the signed-in, active account, or a redirect to
  `/auth/pending` or `/auth/sign-in`. Replaces `getAllowedUser()`.
- `requireLevel(kind, id, minimum)` — 404 when the item is not visible at all
  (so its existence is not disclosed), 403 when visible below the level needed.
- Every page, route handler and Server Action calls one of them before
  touching data. `scripts/check-access.mjs` (run as `npm run check`, beside
  `tsc`) fails on any `page.tsx`, `route.ts` or `actions.ts` under `app/`
  that does not, apart from the sign-in, OAuth and `.well-known` paths.

### How a request carries its person

`lib/db.ts` gains `forUser(userId, { adminView })`, which returns the query
function the data layer uses. Each call is sent as one non-interactive
transaction: `select set_config('app.user_id', $1, true)` (and
`app.admin_view` when set), then the statement or statements. The setting is
local to that transaction, so nothing leaks between requests over the pooled
connection, and there is no extra round trip. All of `lib/studio.ts`'s SQL
already passes through one helper (`q`), so the change is made there once.
The connector builds the same query function from its token's user.

### The platform administrator

- Approves, disables and re-enables accounts at `/admin/accounts`, and reads
  the whole log there.
- Opens another account read-only from `/admin/accounts/[id]`. Only those
  requests set `app.admin_view`; the database honours it only if `accounts`
  marks the current person as platform administrator, and only for reads.
  Each such page view writes a log entry naming the account and path.
- Their own home shows their own account, like everyone else's.

### The access log

- `access_log` — id, at, actor (account, or `bootstrap` / `pipeline` for
  changes made outside the app), action, subject account, item (kind and id),
  `before` and `after` as JSON, reason.
- Written by triggers on `accounts` and `shares`, so a change cannot be made
  without its entry, whichever code path makes it. Password changes,
  connector tokens issued and revoked, and administrator views are written by
  functions the app calls at those moments.
- A trigger refuses every update and delete on the table, and the app role is
  granted insert through those functions only.

### Bootstrapping and cutover

The first administrator cannot be approved through a page that needs an
administrator, and the switch to the restricted role must not lock anyone
out. In order:

1. In the Neon Console, create the role `bottega_app` (it gets its own
   password there; nothing secret enters the repository).
2. Run migration 002: tables, columns, functions, policies, grants to
   `bottega_app`. Production still connects as the owner, which bypasses the
   policies, so nothing changes yet.
3. Deploy the code that uses `accounts` and `forUser`, still on the owner
   connection.
4. Sign in once, which creates James's account as pending, then run
   `pipeline/bootstrap.py`: it activates James's account, makes it platform
   administrator, and assigns existing projects and artists, all logged with
   actor `bootstrap`.
5. Point Vercel's `DATABASE_URL` at `bottega_app` and redeploy. From here the
   policies apply.
6. Remove `ALLOWED_EMAILS` and `ADMIN_EMAILS` from Vercel.

Audio keys in R2 stay as they are. Files are reached only through signed links
minted after authorization, so a key's prefix carries no access meaning.

### Gear in the policies (migration 003)

| Table | Read | Write | Delete |
|---|---|---|---|
| `capability_defs` | active accounts | insert: active accounts; update: administrator | never |
| `gear_models` | approved models; your own suggestions; models of units you can see; administrator all | insert: active (as a suggestion); update: administrator | administrator |
| `model_capabilities` | as its model | administrator | administrator |
| `gear` | own, or shared | insert: own; update: `edit` or `owner` | `owner` |
| `gear_private` | `owner` only, at every share level and in the administrator's view | `owner` | with the unit |
| `gear_capabilities` | as the unit | `edit` or `owner` | `edit` or `owner` |
| `gear_files` | public files as the unit; private files `owner` only (006) | photos from `contribute`, public; any file `owner`; public flag and rotation `owner` | `owner` |

003 also redefines `app_admin_viewing()` to answer false rather than null
where `app.admin_view` was never set, which scripts and tests rely on.

### The corpus in the policies (migration 004)

`document_rank()` gives a library document 4 for the administrator, 3 for its
contributor while it is under review, 1 for everyone active once approved (and
for the contributor if rejected); a private document takes the project rules:
4 for its owner, a share's level, 1 in the administrator's view.

| Table | Read | Write | Delete |
|---|---|---|---|
| `documents` | level `view` or above | insert: active, as above; update: `edit` or `owner`, not in the admin view; `review_status` only by the administrator | `owner`; the contributor of a library document not yet approved |
| `pages`, `chunks` | as the document | `edit` or `owner` of the document, not in the admin view | with the document, or `edit` |
| `model_documents` | as the document | anyone who can read the library document | the administrator, or whoever linked them |
| `library_picks` | your own | your own | your own |
| `platform_settings` | active accounts | update: the administrator | never |
| `account_limits` | your own; the administrator all | the administrator | the administrator |
| `processing_usage` | your own; the administrator all | only through `claim_pages()` and `record_tokens()` | never |

`shares` gains `document_id`, with the same rules as projects and gear.

### Printed page numbers and contents (migration 022)

- `document_page_labels` — document, PDF page, `pdf_label` (from the PDF's
  /PageLabels, kept only where it differs from the page's place) and
  `hand_label` (set for a range by `document_label_range()`); the hand label
  wins, `page_label()` answers for one page.
- `document_sections` — the outline, in order: level, title, start page.
- Both are read in one pass by `readPdfStructure()` (`lib/pdf.ts`, PDF.js's
  `getPageLabels` and `getOutline` through unpdf) on the first processing
  batch, and again on request (`POST /api/documents/[id]` `op: 'contents'`).
  Policies follow `document_rank`: read at 1, written at 3.

### Sign-in attempts (migration 021)

`auth_attempts` keeps, for a day, each sign-in or sign-up attempt with
SHA-256 hashes of the email and of the caller's address (`x-forwarded-for`).
`auth_attempt_wait()` and `auth_attempt_record()` are the only access; the
sign-in and sign-up actions call them as the application role with no
person set (`lib/authAttempts.ts`).

### Allowances and the usage ledger

The gate on what any account can spend (REQUIREMENTS K-10):

- `platform_settings` holds the defaults under the key `limits`: storage per
  account (5 GB), pages processed per account per calendar month (3,000),
  the longest document an account may load (1,500 pages), and the platform's
  monthly ceiling on pages processed by everyone (30,000). `account_limits`
  overrides any of the first three for one account; `effective_limits()`
  combines them. Changes to either table are written to the access log.
- `processing_usage` is the ledger: account, document, pages, embedding
  tokens, time. It is append-only apart from adding tokens; a deleted
  document leaves its rows, with the document set to null.
- `claim_pages(document, n)` is the only way to spend pages. It needs level
  `edit` or `owner` on the document, takes an advisory lock so two batches
  cannot both spend the last of an allowance, and grants up to `n` pages:
  fewer, or none, when the account's allowance or the platform ceiling runs
  out. The administrator has no account allowance but is stopped by the
  ceiling. A batch records its tokens afterwards with `record_tokens()`, on
  its own claim, within the hour.
- `storage_used(account)` sums the account's gear files, private documents,
  library submissions not yet approved, and the audio on its projects;
  approved library documents belong to the platform and count against
  nobody. `my_allowance()` returns the signed-in person's limits and use, for
  the app to check before it signs an upload or starts a batch; the longest
  document is checked when the page count is known.
- A processing batch: claim pages, extract that many pages' text, write
  `pages`, chunk, embed, write `chunks`, record tokens, advance `pages_done`.
  A batch granted no pages leaves the document `paused`, to resume next
  month or when the allowance is raised. A document whose first pages carry
  no text is set to `needs_ocr`.

## 12. File storage

Implements REQUIREMENTS O-4 and O-5.

### Buckets, by access model

A new bucket is warranted when files differ in who writes them, whether the
browser uploads to them, how long they are kept, or which credential reaches
them. Kind of content alone is not a reason.

| Variable | Bucket | Holds | Written by | Kept |
|---|---|---|---|---|
| `R2_AUDIO_BUCKET` | `sirsinate-audio` | mixes, references | browser, signed PUT | until deleted |
| `R2_FILES_BUCKET` | `sirsinate-files` | every other upload: gear photos, receipts and serial plates, project images, avatars, private documents, library manuals | browser, signed PUT | until deleted; library documents indefinitely |
| later | an exports bucket | each account's data export | the app | deleted after about 7 days by a lifecycle rule |
| later | a records bucket | invoices, contracts | the business layer | retention-locked, its own credential |

No bucket per account: R2 limits buckets per Cloudflare account, and tenancy
is the database's job.

### Keys

    a/<owner account id>/gear/<gear id>/<uuid>/thumb.webp, view.webp, full.webp
    a/<owner account id>/gear/<gear id>/<uuid>.pdf
    a/<owner account id>/audio/<project id>/<uuid>.mp3
    a/<owner account id>/projects/<project id>/<uuid>.<ext>
    a/<owner account id>/documents/<uuid>.pdf
    library/<uuid>.pdf

- An image is a folder of web versions made in the browser (REQUIREMENTS
  G-10, migration 007): 480, 1600 and 2560 pixels on the long edge, WebP
  (JPEG where the browser cannot write WebP), with no metadata. The original
  is not kept. `gear_files.r2_key` is the folder and `variants` names its
  files; `bytes` is their total. Images from before 007 are single files
  until the owner converts them from the account page.
- Pages sign each image's links while they render (`lib/images.ts`), so the
  browser fetches from R2 directly, with no request to the app per image.
  Links are signed as of the start of the hour and valid for two, so an
  image keeps the same link for the hour and the browser cache serves
  repeat views; the response carries a matching `Cache-Control`. Thumbnails
  load lazily.
- An upload is checked against the storage room of the item's owner
  (`storage_room()`), since files count against the owner whoever uploads.
- The account id is Neon Auth's opaque id. Keys hold no email, filename,
  serial or model name; the original filename is in the database and applied
  as `Content-Disposition` on download.
- The prefix is the item owner's, whoever uploaded: a collaborator's mix on
  your project is under your prefix, because it is your project's data.
- Prefixes are not a security boundary (R2 credentials are scoped to buckets,
  not prefixes). They make one account's files listable, exportable and
  deletable together.
- Documents carry no item id: their row is created only once the upload has
  landed and been read back, so a document has no id when its key is issued.
- Mixes uploaded before this scheme keep `studio/<project id>/<uuid>.mp3`;
  the routes accept both.

### What protects a file

1. Neither bucket has public access: no r2.dev address, no custom domain.
2. The credentials live only on the server, and belong to Bottega alone: one
   R2 API token per app and environment, limited to the buckets that app
   uses.
3. Every signed link is minted by a route that has already authorized the
   person (§11): `projectRefusal` for audio, `gear_level` and the gear file
   policies for gear files.
4. Keys are random UUIDs, so one key reveals nothing about another.
5. Links are short: uploads 15 minutes; gear files and documents 10 minutes;
   audio playback 6 hours, because a link must outlive a long listen (the
   trade-off: a copied playback link works for anyone until it expires).
6. An upload is recorded only after the app checks it landed: the key is one
   it issued for that item, and size and type are read from R2. Gear and
   document uploads accept JPEG, PNG, WebP, HEIC and PDF only; SVG and HTML
   are refused, and anything that is not an image downloads rather than
   opening inline.

### One row per object

Every object has a row naming its bucket, key, owner (or the library), item,
bytes and type: `audio`, `gear_files`, and `documents` as each arrives. So
storage per account is a sum, an export is a list, account deletion is a
query followed by deleting a prefix, and an orphan is a key under a prefix
with no row.

## 13. Layout and type

Every page is put together from the same few pieces (`app/_ui/layout.tsx`),
so pages differ in content and never in how they are built.

- **Grid.** Twelve columns inside the 1280-pixel page. Detail pages split 8
  and 4: the work itself on the left (players, lists, forms), an aside on the
  right (metadata, the notes for what is selected, filters). Below the `lg`
  breakpoint the aside follows the main column. Overview pages (the gear
  map) use all twelve. `DetailGrid` does this; pages do not lay out columns
  of their own.
- **Type.** Four sizes, as utilities in `globals.css`: `t-title` (18px, below the 20px app name in the header; the
  page title only), `t-lead` (15px, the main thing in a block, such as a
  mix's version), `t-body` (13px, everything else) and `t-label` (11px,
  uppercase, grey: labels and metadata). Medium weight is the only
  emphasis. Numbers that line up (codes, times, dates, BPM) add `t-num` for
  even-width digits; no monospace face.
- **Headers and controls.** Every page opens with `PageHeader` (the way
  back, the title, one line of facts joined by middle dots, the page's
  actions on the right). Buttons, links and fields take their classes from
  `app/_ui/styles.ts`, so a control looks the same on every page: `BUTTON`
  (outlined), `BUTTON_PRIMARY` (filled: the action a form is for, and
  confirmations) and `BUTTON_DANGER` (deleting and removing), all one size at
  11px; `SEGMENTS` and `SEGMENT(on)` for one choice from a set (a project's
  variants); `TEXT_LINK` for navigation set in text; and `FIELD`. In a row with
  fields a button stretches to the fields' height. Every action has an outline
  or a fill; plain text is for
  navigation, tabs and an underlined action inside a sentence. Player,
  scrubber and page-turn controls draw their own glyphs. No
  Tailwind type sizes (`text-sm`, `text-2xl`) and no serif outside the type
  scale; 11px (`text-[11px]`) is the size for secondary lines.
- **Sections.** A `t-label` heading over a hairline rule (`Section`), no
  boxes. Label and value pairs in an aside are a `MetaList`.
- **Tabs.** `TabBar`: links when each tab is its own page (gear's Map and
  List), buttons when tabs share state on one page (a project, where
  switching must not stop what is playing). The tab is in the address
  either way.
- **Audio.** One player (`app/_ui/audio/Player.tsx`): play, time, the
  waveform from `audio.peaks` (migration 009, measured by `lib/peaks.ts` in
  the browser), length, and ticks for notes at a moment. The volume is one
  store for the app (`volume.ts`), kept in the browser's storage and applied
  by every player, including the list page's bar.

