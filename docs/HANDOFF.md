# Bottega — handoff

**Date:** 2026-10-13
**Read first, then `REQUIREMENTS.md` (0.22) and `ARCHITECTURE.md` (0.13).**

Bottega is James's studio platform for Sirsinate Sound Labs: a service with
separate accounts holding sessions, gear, manuals and the work in progress,
reachable from Claude through a connector so Claude can act as a production
collaborator and teacher. This file replaces the 12 October handoff and was
brought up to date on 13 October, after the button pass. It records what is
built, how the work is done, and what comes next.

---

## 1. Where it stands

Repository `github.com/ziopads/bottega`, local `~/Desktop/_PROJECTS/bottega`,
deployed on Vercel to studio.sirsinate.com. Neon Postgres (project
`bottega-sirsinate`) with row-level security under the role `bottega_app`;
Cloudflare R2 for audio and files; Voyage for embeddings.

Latest commits, newest first (`main` and `origin/main` both at `c819354` on
13 October, read from `.git` without running git):

| Commit | What it did |
|---|---|
| `c819354` | Document page: choosing a gear model links it at once, no Link button |
| `a03a944` | Reading lists (019), videos and links (020), sign-in attempt limit (021), printed page numbers and contents (022), search page |
| `ef50708`, `300b683` | Study group reading list, Claude's search limited to it; videos and links played in the app |
| `bbcc6ff` | Library: many documents by drop or folder; the administrator moves a document's home (018) |
| `f1a04af` | Auth proxy passes only `get-session` to Neon Auth |
| `a4193c4` | Study sessions and notes (017), group page tabs, connector tools |
| `a41e987` | Sign-up page: anyone creates an account, which waits for approval |
| `599870e` | Page reader: the PDF pane in the reader's layout, so it survives page turns |
| `003a43c` | Page reader: PDF loaded once, pages by `#page`; reader links signed for a fixed window |
| `86c9696` | Learning, first slice: study groups, syllabus, cited lessons, progress, group documents (016) |

**Not yet committed** (13 October):

- The button pass (§4, "Controls"): `app/_ui/styles.ts`, 37 files under
  `app/`, and `docs/ARCHITECTURE.md` 0.13. Type check and access check pass;
  lint finds only the earlier errors in `StudioProjects.tsx`. Not yet seen in
  a browser.
- `package.json` and `package-lock.json`: `pdfjs-dist` 6.4.299, installed for
  the PDF.js reader and held to go in with it.
- This handoff.

Migrations `db/001`–`022`, with test suites in `db/test/` for 002–022; all
applied on Neon with `a03a944` (check with `pipeline/migrate.py --status`).

Confirmed working on production: sign-in and accounts, gear, document upload
and processing, the session page and its tabs, the workflow, the connector
from Claude Desktop (sessions, proposals, corpus search with cited answers),
the State tab's folder drop, variant chips, the MPC Bible (document 15)
processed and in James's private documents, and (13 October) reading printed
page numbers and contents from a manual's PDF. The R2 files bucket's CORS
rule for range requests is in place (13 October).

Not yet seen in a browser: whether the PDF pane still reloads on a page turn
after `599870e`, the button pass, videos, the reading list, the search page,
sign-in under the attempt limit, and most of Learning.

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
anyone creates one at `/auth/sign-up` (linked from sign-in; added 12 October:
a user added in the Neon Console has no password and cannot sign in), and
new sign-ups wait for approval at Accounts. `/api/auth/[...path]` passes
only `GET get-session` to Neon Auth and answers 404 to every other path (12
October): all sign-in, sign-up, sign-out and password calls run server-side
straight to Neon Auth, and so does the middleware's session check. Neon
Auth's own address (`NEON_AUTH_BASE_URL`) still answers anyone who finds it,
so approval stays the control; and Neon Auth sees Vercel's address, not the
person's, on every server-side call, so its per-address limit on sign-in
attempts does not single out one guesser (Bottega keeps its own count,
migration 021); items shared one at a time at view,
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
home changes only through the administrator's move (018, below) or
`pipeline/document_home.py ID --private --kind book [--apply]` moves one with
the owner role, removing picks and model links, and logs it. Only library
documents can be linked to catalogue models.

**Adding documents** (12 October). The Library's "Add documents" box asks
private or library first (no default), then takes PDFs by drop (several
files, or folders, read to the bottom) or by "Choose PDFs" / "Choose a
folder" (`app/_library/Upload.tsx`). Non-PDFs and files over 150 MB are
skipped and named; each file goes through fingerprint, duplicate check,
signed upload and record, one at a time, with its status in a list (added,
already here, skipped, failed; retry by pressing Add again). One kind for the
batch, an optional manufacturer for all, titles from file names (editable
before adding). Nothing is processed: library uploads land submitted, the
administrator's too, under "Your submissions", to open one by one. A single
file still opens its page.

**A study group's reading list** (L-24, migration 019). The Resources tab
shows the list (title, manufacturer and model, library manual or shared by
its owner, how far searchable, lessons citing it), an "Add a document…"
picker (library manuals for the custodian; one's own documents for any
member, which shares them), Remove, and the documents cited but not listed.
The aside shows the count. A document's page has the "Study groups" box for
its owner (private) or for a custodian (approved library manual). Search
takes `groupId` (`lib/search.ts`); the connector's `search` takes `group`,
`get_study_group` returns `reading_list` and `cited_not_on_list`, and the
instructions say to search with the group when working on it (server 0.6.0).
Moving a document into the library keeps its listings; moving it out removes
them (018's function, replaced in 019).

**Videos and links** (L-23, migration 020). The Resources tab lists them
above the reading list, grouped by topic ("Not filed" last), with Claude's
drafts for the viewer at the top (Publish, Discard); "+ Add" takes a YouTube
link or any https address (a title is needed for a link), why, and topics.
`/learning/[id]/resources/[resourceId]` is the watch page: the video played
in the page (`VideoPlayer.tsx`, IFrame Player API, youtube-nocookie.com),
notes on it ordered by moment with the moment as a button that seeks the
player, and a note form whose moment fills from the player ("now"); `?t=`
starts the video there, which is how a note's moment links from the Notes
tab. The adder edits why and topics; the adder or the custodian removes it.
A session can name the video it was spent on. Connector (0.7.0):
`add_study_resource` (a draft), `videos_and_links` in `get_study_group`,
notes with `resource_id` and `at` in `record_study_session`, which also takes
the session's `resource_id`.

**Printed page numbers and contents** (K-13, K-14, migration 022). Read
from the PDF on its first processing batch; "Read page numbers and contents
from the PDF" on a document's page does it for one processed before; "Set
printed numbers by hand" sets a range (arabic or roman from a number) or
clears it. The reader's title shows "PDF page 824 · printed p. 812", the
meta line "in <section>", and a Contents list; lesson, session and note
citations show "p. 812 (PDF p. 824)"; the connector's `read_pages` gives
`printed` and `section` per page, `search` gives `printed_page`.

**Search page** (K-15). `/library/search?q=&scope=mine|all|group:ID`, with a
search field on the Library page; the same `searchCorpus` as the connector,
20 passages, each linking to the reader with the words marked.

**Sign-in attempt limit** (AC-14, migration 021). The sign-in and sign-up
actions ask `auth_attempt_wait()` first and record each attempt.

**Moving a document's home** (migration 018). The administrator sees "Where
it lives" on a document's page: library to private (to its contributor, or
the administrator if that account is gone; picks and model links removed) or
private to library (approved, former owner kept as contributor, shares with
people and groups removed), with the kind chosen. `document_set_home()` is
the only way, logged as `document_moved`; the same file is never held twice.
The administrator can only move a private document they can see (their own,
or one shared with them). `pipeline/document_home.py` still works.

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
page on request. The PDF pane lives in the reader's `layout.tsx`, which
stays mounted across page turns, and reads the page from the address. It asks `/api/documents/[id]/file?reader=1` once
for a link signed for a fixed six-hour window (`signReaderGet()` in
`lib/files.ts`, valid twelve hours, `Cache-Control: private`), so repeated
requests get the same address and the browser can cache the file; turning the
page changes only the frame's `#page=` and the viewer moves without
refetching. The viewer's toolbar is hidden (`toolbar=0`); a link opens the
PDF in a new tab with its tools. Pages are PDF pages
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
`list_documents`, `search`, `read_pages`, and from 016 `get_study_group`,
`draft_topic`, `draft_lesson`, `draft_exercise` (016), the study session and
resource tools (017, 020); server 0.7.0. Results carry links
back into the app (`appOrigin` in `mcp/context.ts`, from the request's
origin). The instructions tell Claude to read pages before quoting, cite
"PDF p." with the link, and keep the corpus apart from its own knowledge.

**Learning** (REQUIREMENTS L-7 to L-17, migration 016, decided 12 October:
study groups; custodian curates; inline citation markers; group document
shares; `draft_topic` added). A **Learning** item in the navigation.
`/learning` lists the person's groups and their invitations, and starts a
group (its creator becomes custodian and first member). `/learning/[id]`: a
review band with Claude's proposed topics, lessons (expandable, rendered)
and exercises, for the custodian to accept or reject; the syllabus, topics
in order with their lessons (links) and exercises, each exercise with the
viewer's progress control (not started, practising, done, and a note) and
the other members' progress; an aside with members, invitations (invite by
email, withdraw, remove), and the documents the lessons cite with whether
each is shared with the group. The custodian edits names, summaries, titles,
the instrument (a catalogue model) and the order with ↑ ↓, and closes or
reopens the group; a member leaves. `/learning/[id]/lessons/[lessonId]`: the
lesson with numbered citation links to the page reader and a Sources list,
its exercises, the lessons before and after, and editing for the custodian.
A private document's page has a "Study groups" box for its owner to share it
with groups they belong to. Code: `lib/study.ts` (data layer and
`checkCitations()`), `lib/citations.ts` (marker grammar, quotation matching,
the light formatting), `lib/studyTypes.ts`, `lib/studyInput.ts`,
`lib/studyRoutes.ts`, routes under `app/api/study/` and
`app/api/documents/[id]/groups/`, components in `app/_learning/`, connector
tools in `mcp/tools/study.ts` (server 0.4.0). The account page's activity
describes the new log entries.

**Study sessions and notes** (L-18 to L-22, migration 017). The group page
has tabs (`?tab=`, switched in place like the session page): Syllabus (with
a Contents list in the aside: topics, lessons, the viewer's exercises done),
Sessions (the viewer's drafts in a band at the top with Publish, Edit,
Discard; "+ Log a session"; every visible session with its topics, summary
and notes; "+ Note" in one's own), Notes (filter by member and topic; add,
edit), Resources (placeholder for the next build), Progress (tables over 4,
8, 12 or 26 weeks: per member with a small bar per week, per topic with last
touched, exercises done; `studyHistory()` in `lib/studyTypes.ts`, shared with
the connector). The lesson page lists notes on the lesson and takes new ones.
Connector (server 0.5.0): `record_study_session` (summary, kind, minutes,
time, topics by id or title, notes; a draft), `list_study_notes`,
`get_study_history`; the instructions say to record only when asked, once,
at the end, and to tell the person it waits as a draft.

**Layout system** (ARCHITECTURE §13). `DetailGrid`, `PageHeader`, `Section`,
`MetaList`, `TabBar`; control classes in `app/_ui/styles.ts`; four type
sizes.

**Controls** (13 October, uncommitted). Every action is drawn as a button
with an outline or a fill, all at one size (11px text, tight padding; James
chose the look of the small Remove button for all of them): `BUTTON`
(outline at 30% ink, darker on hover), `BUTTON_PRIMARY` (filled: the action a
form is for, Accept, Confirm delete) and `BUTTON_DANGER` (Delete, Remove,
Revoke); `TEXT_LINK` (underlined) for navigation set in text. In a row with
fields a button stretches to the fields' height (`self-stretch` where the row
centres its items). `TEXT_ACTION` and `TEXT_DANGER` are gone, and so are the
one-off button classes (local `button` in `PhotoEditor.tsx`, local `BUTTON`
in `WorkflowTab.tsx`, the auth pages' outlined buttons). A session's variants are a segmented control (`SEGMENTS` and
`SEGMENT(on)`: joined, the chosen one filled), with "+ Add variant" and Edit
as buttons beside it. The Workflow tab's stage strip is a progress line with
no boxes (done stages muted with a tick, the current one in medium weight
over a black bar, later ones muted); a later stage with parked cards has a
"2 parked" button beside it. Left as they were:
tabs and filters, sort headers, player, volume and scrubber controls,
page-turn arrows, list rows and dropdown options, thumbnails, and an underlined action inside a sentence ("choose
a file", "Start it"). On a document's page, choosing a
gear model links it at once (`c819354`).

## 5. Lessons from the build

- A server component importing a non-component value from a `'use client'`
  module gets a client reference: shared values live in plain modules.
- Tailwind 4's `divide-y` borders every child but the last.
- Next.js keys a page by its search parameters too: `?page=824` and
  `?page=825` are different pages, and client state inside page.tsx is lost
  on every change. State that must survive (the reader's PDF pane) goes in a
  layout, which only remounts when the path changes.
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
- Grey text with no outline does not read as a button ("Read page numbers
  and contents from the PDF" on 13 October), and a second confirming click
  with no reason for it gets missed (the old Link button beside the model
  picker).

## 6. Decisions waiting on James

1. **Learning, later** (first slice 12 October; sessions, notes, reading
   list, videos and a first Progress tab since). Candidates: asking to join
   and the directory of groups (L-8, L-11); handing over custodianship;
   questions and answers (L-4); each member's MPC model and firmware (L-6);
   challenges built on sessions (a reference track, notes at moments,
   attempts as mixes); findings searchable by Claude beside the corpus;
   charts on the Progress tab.

## 7. Next, in order

0. **Commit the button pass** (James), after looking at it: run `npm run dev`
   or push, then send screenshots of a study group's Sessions tab, a
   session's Workflow tab, the gear list and the sign-in page (the document
   page was checked on 13 October, before the move to one size). Adjust from
   those, then commit:

   ```
   git add app/_ui/styles.ts app/_gear/CapabilityEditor.tsx app/_gear/CatalogueAdmin.tsx app/_gear/GearDetail.tsx app/_gear/GearList.tsx app/_gear/PhotoEditor.tsx app/_learning/Exercise.tsx app/_learning/GroupView.tsx app/_learning/Journal.tsx app/_learning/LearningHome.tsx app/_learning/LessonView.tsx app/_learning/Resources.tsx app/_library/DocumentDetail.tsx app/_library/Upload.tsx app/_studio/NewProject.tsx app/_studio/Notes.tsx app/_studio/ReleaseDetail.tsx app/_studio/ReleaseList.tsx app/_studio/Sharing.tsx app/_studio/StudioProjects.tsx app/_studio/session/MixesTab.tsx app/_studio/session/NotesTab.tsx app/_studio/session/OverviewTab.tsx app/_studio/session/VariantBar.tsx app/_studio/session/WorkflowTab.tsx app/account/ChangePasswordForm.tsx app/account/ConnectedApps.tsx app/account/ConvertImages.tsx app/account/ProfileTab.tsx app/account/SharingTab.tsx app/account/UsageTab.tsx app/admin/accounts/page.tsx app/admin/lengths/LengthBackfill.tsx app/admin/lengths/WaveformBackfill.tsx app/auth/pending/page.tsx app/auth/sign-in/page.tsx app/auth/sign-up/page.tsx app/oauth/authorize/page.tsx docs/ARCHITECTURE.md docs/HANDOFF.md
   git commit -m "Every action drawn as a button, all at one size: outlined, filled and danger buttons and a text link replace grey text actions; the 13 October handoff"
   git push
   ```
1. **The PDF reader, properly** (agreed 12 October; both prerequisites done
   13 October: `pdfjs-dist` 6.4.299 installed, the R2 CORS rule in place).
   Render pages with PDF.js from byte ranges, so opening page 824 of a 94 MB
   book fetches only what that page needs; our own zoom, page controls tied
   to the reader's `?page=`, no clipped toolbar. Keep the pane in
   `app/library/[id]/read/layout.tsx` and the signed reader link from
   `signReaderGet()`; check that R2 answers a `Range` request from the site
   with 206. Commit `package.json` and `package-lock.json` with it. First
   ask James whether the current pane still reloads on a page turn.
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
   - Try in the app: put the MPC Bible and the MPC manual on the MPC group's
     reading list and reconnect the connector so `search` shows `group`; log
     a session; whether the mobile app's voice mode calls the connector; drop
     the HARDWARE folder on "Add documents" and work through "Your
     submissions"; "Where it lives" on a document.
   - State tab: "length" counts clips on switched-off tracks (Khione shows
     59:11); 2-MIDI appears in the map with no clips; every request reads
     every save's data (fine at 20 saves).
   - Khione's v1 and v2 are reversed; renumbering mix versions. Delete the
     test mix v3 (monhegan-windrose-vox-smpl.mp3) on Khione.
   - Linking a remix to its original; a "made for" field (DJ tool or
     listening); accounts for Gordon and Chris (needed before a study group
     is shared).
   - `StudioProjects.tsx` lint errors (components made during render, unused
     expressions), there since before 12 October.
   - Unconfirmed: the R2 audio bucket's CORS rule allowing GET from the site.
   - Uploads over Vercel's 4.5 MB request limit: a parsed save that large
     would fail with "Could not store it (413)"; none of Khione's did.
