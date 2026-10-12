# Bottega — handoff

**Date:** 2026-10-12
**Read first, then `REQUIREMENTS.md` (0.16) and `ARCHITECTURE.md` (0.6).**

Bottega is James's studio platform for Sirsinate Sound Labs: a service with
separate accounts holding sessions, gear, manuals and the work in progress,
reachable from Claude through a connector so Claude can act as a production
collaborator and teacher. This file replaces the 11 October handoff. It
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
| `2790d3e` | Corpus search: `search`, `read_pages`, `list_documents` on the connector; the page reader with the PDF beside the text |
| `237c3fb` | `pipeline/document_home.py`: move a library document into its contributor's private documents |
| `31d988d` | Documents get their own upload limit, 150 MB (gear files stay at 50 MB) |
| `fe7e1bd` | Variant chips: Main always shown, and a visible "+ Add variant" |
| `225094a` | Session variants (015): chips in the header, saves sorted into variants, any save inspectable on the State tab |
| `fe32104` | Notes: a typed moment field on both note boxes |
| `f97f745` | The 11 October handoff |
| `dd04d36` | One type scale; `PageHeader` and shared control styles |
| `b25d313` | State tab: Live sets read from a dropped project folder (014) |
| `b1b7cba` | Mix variants numbered within each variant (013) |

**Not yet committed** at the end of 12 October (in the working tree, checked
with type check and lint): the upload form asking "private or library" first
(`app/_library/Library.tsx`), the reader's page navigation
(`app/_library/PageNav.tsx`, `app/library/[id]/read/page.tsx`,
`app/globals.css`), and this handoff. The commit command is in §7.

Migrations `db/001`–`015`, with test suites in `db/test/` for 002–015.
001–015 are applied on Neon.

Confirmed working on production: sign-in and accounts, gear, document upload
and processing, the session page and its tabs, the workflow, the connector
from Claude Desktop (sessions, proposals, and now corpus search: James asked
about the MPC and got cited answers), the State tab's folder drop (all 20
Khione saves read), variant chips and adding a variant, the MPC Bible
(document 15) processed and moved to James's private documents.

Not yet seen in a browser: the page reader and its scrubber, the PDF pane,
the new upload form, saving a note at a typed moment, moving a save between
variants by hand.

## 2. How James works, and how to work with him

- Read the code before proposing a change. For anything beyond a small fix:
  understand first, list three or more approaches with their tradeoffs, and
  get his approval before building. Once he says "go", build the whole agreed
  slice.
- **James runs every install, migration, commit and push himself.** Give each
  command in a code block he can copy. Git commands name every file
  explicitly (never `git add -A`) and quote paths with brackets:
  `'app/api/cards/[id]/route.ts'`. Migrations go before the push when the new
  code needs them.
- After a build: say what was checked (type check, lint, access check,
  database tests) and what was not (anything not seen in a browser).
- Writing style for everything written to him: no "not X but Y" or "rather
  than" framings, no machine metaphors, no flourish sentences, abbreviations
  expanded at first use, concise.
- Never print secret values from `.env` files; name the variables only.
- He sends screenshots for anything visual; ask for them.

## 3. The working setup

- Claude reaches the Mac through a Linux VM with the connected folders
  mounted (`$HOME/mnt/bottega`; `$HOME/mnt/scriptorium` was connected
  read-only for porting). It can read, edit and run `npx tsc --noEmit -p .`,
  `npx eslint <files>` and `node scripts/check-access.mjs` there, and
  Ghostscript, qpdf and poppler are installed. It cannot install npm packages,
  reach Neon, or delete files.
- **Do not run git from the VM**, not even read-only commands. To see a
  committed file, read the loose object under `.git/objects` with Python's
  zlib (done once on 12 October to recover `Library.tsx`).
- **No code formatter.** The repo has no Prettier config and its files are
  not Prettier-formatted; running one rewrites whole files. Edit in the
  house style (single quotes, long lines).
- Database work is tested in the cloud workspace on a local Postgres 16:
  `/tmp/t4/fresh.sh N` starts the server (socket `/tmp`, port 5433, user
  `owner`) and builds `bottega_test` with migrations up to N. The workspace
  is reclaimed between conversations, so a new one rebuilds this: stage
  `db/*.sql` and `db/test/*.sql` from the Mac, run `initdb` as a `postgres`
  user, create the role `bottega_app`, and replace 004's pgvector parts with
  a stand-in (drop `create extension vector`, `halfvec(1024)` → `real[]`,
  drop the HNSW index). pgvector itself cannot be installed there, so search
  SQL is tested with a `<=>` operator defined over `real[]`.
- pip has no registry access in the cloud workspace (no psycopg), so pipeline
  scripts are tested by running their SQL through psql.
- Files written in the cloud go to the Mac with the commit tool; then the
  checks run in the VM.
- The Khione Ableton project folder: `/Volumes/VIGORISH/AUDIO   ABL VIGORISH
  SESSIONS/2025 0727 new studio config euf dp4 Project` (three spaces after
  AUDIO; James adds such folders with Add folder).

Environment variables (names only): `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
(pipeline), `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_AUDIO_BUCKET`,
`R2_FILES_BUCKET`, `VOYAGE_API_KEY`.

## 4. What is built

**Accounts and access** (REQUIREMENTS §2, AC-1 to AC-13). Separate accounts;
new sign-ups wait for approval; items shared one at a time at view,
contribute or edit; only owners delete; every access change in an
append-only log. Enforced in the database (`project_rank`, `gear_rank`,
`document_rank`, policies on every table) and in the app (`lib/access.ts`;
`scripts/check-access.mjs`). Account page tabs: Profile, Usage, Sharing,
Security, Preferences, Billing and Data ("Coming soon…").

**Gear** (§4). Catalogue of models and each account's units; WebP images; a
gear map by studio group.

**Corpus** (§8). Documents processed in the app in resumable batches (text in
300-page steps, then embedding 40 pages at a time against the allowance).
Upload limit 150 MB (`DOCUMENT_MAX_BYTES`). The upload form asks first
whether a document is private or a library manual, with no default; the
library takes manufacturers' manuals only, books are private. A document's
home cannot change in the app (004's `documents_guard`);
`pipeline/document_home.py ID --private --kind book [--apply]` moves one with
the owner role, removing picks and model links, and logs it. Only library
documents can be linked to catalogue models.

**Corpus search and the page reader** (K-2, K-3, K-7). `lib/search.ts`:
keyword (`websearch_to_tsquery`) and meaning (Voyage query embedding,
cosine) each take 40 candidates, combined by reciprocal rank fusion (k = 60)
in one statement. Default scope: the person's private and shared documents,
their library picks, and library manuals linked to models of gear they own;
`all` adds the library. The query lists the documents in scope first and
searches only their chunks, so row-level security never empties the
nearest-neighbour candidates; pgvector 0.8's iterative scan is switched on
where it exists. Without an embedding the search runs on words alone and
says so. The reader, `/library/[id]/read?page=N&q=…`: a page's extracted
text with the query's words marked, Scriptorium's navigation (‹ ›, arrow
keys, a page field, a scrubber that moves on release), and the PDF at that
page on request (`/api/documents/[id]/file?inline=1`). Pages are PDF pages
from 1; printed numbers may differ. Documents with text show "Read the
pages".

**Sessions** (§6). Tabs: Overview, Mixes, State, Workflow, Notes, History.
Notes take a moment typed as "1:35" on both note boxes (beside a mix it is
filled from the player when you start writing, and "now" fills it again).

**Session variants** (S-14, S-16, 015). `session_variants`: a session's named
variants beside the main mix (the empty name, no row), each with a name rule
(text in a save's file name). Chips in the session header (Main, each
variant, "+ Add variant", Edit) choose what the Mixes and State tabs show;
`?variant=` in the address. Edit access adds and renames (renaming carries
mixes and saves, through `rename_session_variant()`); the owner removes an
empty variant (`delete_session_variant()`). A mix's variant must be one of
the session's (trigger, spelling normalised). Saves are sorted by the
database: the longest rule found in the file name wins, none means main,
re-sorted whenever variants change; `variant_by_hand` keeps a save a person
moved. The workflow, references and notes about the whole session stay
common; notes on a mix follow it; the Notes tab filters by variant.

**State tab** (A-6 to A-8, 014, 015). Dropping the Ableton project folder
reads every saved `.als` in the browser (`lib/als/`) and stores one snapshot
per save. The left column lists the chosen variant's saves, newest first,
with a one-line summary of changes; choosing one shows the set at that save
(zones, arrangement map, maintenance) with "Since the save before" at the
top. A variant's first save is compared with the main save just before it.
"This save" can move a save to another variant or hand it back to the rules.

**Workflow** (§7, 011). Stages, exit criteria, elements, cards, settled
decisions, Claude's proposals in a review band.

**Connector** (§11, 012). `https://studio.sirsinate.com/api/mcp`. Tools:
`list_projects`, `get_session`, `draft_criteria`, `draft_card`,
`list_documents`, `search`, `read_pages` (server 0.3.0). Results carry links
back into the app (`appOrigin` in `mcp/context.ts`, from the request's
origin). The instructions tell Claude to read pages before quoting, cite
"PDF p." with the link, and keep the corpus apart from its own knowledge.

**Layout system** (ARCHITECTURE §13). `DetailGrid`, `PageHeader`, `Section`,
`MetaList`, `TabBar`; control classes in `app/_ui/styles.ts`; four type
sizes.

## 5. Lessons from the build

- A server component importing a non-component value from a `'use client'`
  module gets a client reference: shared values live in plain modules.
- Tailwind 4's `divide-y` borders every child but the last.
- Neon's HTTP driver: one non-interactive transaction per call; bigint and
  numeric arrive as strings, timestamps as Dates.
- Live 12 names the main track `MainTrack`; track names Live gives itself
  start with a number that shifts.
- Changing a Postgres function's return type needs `drop function` first.
- React's lint forbids setState inside an effect: fetch on the event that
  causes it (choosing a variant fetches its state in `selectVariant`).
- Row-level security filters after an HNSW index picks candidates; scope the
  query to visible documents first.
- `gear_models.maker` was renamed `manufacturer` in 005; `documents` too.
- Controls nobody sees do not exist: "+ Variant" in grey at the far right of
  the header went unnoticed until it became a bordered chip.
- A 100 MB PDF compressed in Acrobat only reached 84 MB: its size was not in
  images.

## 6. Decisions waiting on James

1. **The Learning section ("Skills & Drills").** Proposed: study groups as
   planned in REQUIREMENTS L-7 to L-11 (a space belonging to no one account,
   a custodian, invitations), holding topics (each may name a catalogue
   model), lessons citing the corpus by PDF page, and exercises with progress
   per member; Claude proposes topics, lessons and exercises through the
   connector (`draft_lesson`, `draft_exercise`) into a review band.
   Alternatives offered: a course owned by James's account and shared like a
   session; or that now and groups later. Recommended: study groups. First
   slice: group, membership by invitation, topics, lessons, exercises with
   progress, a Learning item in the navigation, connector tools; migration
   016. Later: questions and answers (L-4), each member's MPC model and
   firmware (L-6), challenges built on sessions (a reference track, notes at
   moments, attempts as mixes), findings searchable by Claude beside the
   corpus.
2. **Bookmarks in the reader.** Proposed: read the PDF's outline with unpdf
   during extraction into `document_sections` (rebuildable), plus a "Read the
   contents" action for documents already processed; the reader gains a
   Contents list and "In: chapter"; the connector names chapters. Alternatives:
   read the outline in the browser only; or add Scriptorium's running-heads
   inference for PDFs without an outline. Recommended: the first. Open
   question: does the MPC Bible carry bookmarks?
3. **Search box in the app** (search option 3), on the same `lib/search.ts`.

## 7. Next, in order

0. Commit what is uncommitted (James):

       git add app/_library/Library.tsx app/_library/PageNav.tsx 'app/library/[id]/read/page.tsx' app/globals.css docs/HANDOFF.md
       git commit -m "Upload form asks private or library first; Scriptorium's page navigation in the reader; handoff for 12 October"
       git push

1. The decisions in §6, then build what is chosen (Learning first slice is
   the likely next build).
2. **State tab, your read** (S-15): a four-step scale per zone and part
   (empty, sketched, working, baked), each change dated.
3. **Connector analysis tool**: the latest snapshot, changes since the
   previous save, plugin use across sessions; Claude proposes maintenance
   cards. Also report variants and saves in `get_session`.
4. **Link each mix to the save it was bounced from** (variants, step 3).
5. **Automatic updates** (A-9): a program on the Mac watching the sessions
   folder.
6. **Layout follow-through**: Gear and Collection detail pages; and from
   the 11 October screenshots: Collections' stray "← Sessions", uneven title
   heights between pages, Library's narrower width, Collections' misaligned
   labels, raw JSON in the access log (show "approved" and the document's
   title).
7. Smaller:
   - State tab: "length" counts clips on switched-off tracks (Khione shows
     59:11); 2-MIDI appears in the map with no clips; every request reads
     every save's data (fine at 20 saves).
   - Khione's v1 and v2 are reversed; renumbering mix versions. Delete the
     test mix v3 (monhegan-windrose-vox-smpl.mp3) on Khione.
   - Linking a remix to its original; a "made for" field (DJ tool or
     listening); the bulk manual import from the HARDWARE folder; accounts for
     Gordon and Chris (needed before a study group is shared).
   - Unconfirmed: the R2 audio bucket's CORS rule allowing GET from the site.
   - Uploads over Vercel's 4.5 MB request limit: a parsed save that large
     would fail with "Could not store it (413)"; none of Khione's did.
