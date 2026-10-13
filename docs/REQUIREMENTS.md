# Bottega — requirements

**Version:** 0.22
**Date:** 2026-10-12
**Status:** draft
**Scope:** What the application has to do, by layer and by phase. How it is
built is in `ARCHITECTURE.md`.

---

## Changelog

- **0.22** (2026-10-12) — Printed page numbers and a document's contents
  (K-13, K-14); searching from the app (K-15); a limit on sign-in and
  sign-up attempts (AC-14).

- **0.21** (2026-10-12) — Videos and links in a study group (L-23 built):
  YouTube videos played in the app, notes at moments in them.

- **0.20** (2026-10-12) — A study group's reading list (L-24): library
  manuals and members' documents the group studies from, which Claude's
  searches for the group are limited to.

- **0.19** (2026-10-12) — Adding many documents at once by drop or folder
  (K-11), and the administrator moving a document between the library and
  private documents (K-12).

- **0.18** (2026-10-12) — Study sessions and notes (L-18 to L-22): a
  member's sittings and notes, Claude documenting a conversation as a draft
  the member publishes, private entries, the group page in tabs, and first
  figures of progress. Resources are next (L-23, planned).

- **0.17** (2026-10-12) — Learning, first slice (L-12 to L-17): study
  groups with a custodian and invitations; a syllabus of topics, lessons and
  exercises that the custodian writes and Claude proposes into; lessons cite
  the corpus by PDF page, with quotations checked; each member's progress on
  each exercise; a private document shared with a group. Asking to join,
  handing over custodianship, questions and answers (L-4) and each member's
  instrument (L-6) come later.

- **0.16** (2026-10-12) — Session variants (S-14, S-16): a session's
  variants are a list kept on the session, chosen by chips in its header;
  each variant has its own mixes and its own saved sets, sorted by a name
  rule or by hand. The State tab lists the chosen variant's saves and shows
  any one of them. The workflow, references and notes on the whole session
  stay common. A note's moment can be typed (S-4).

- **0.15** (2026-10-11) — Session analysis built (A-6 to A-8): the State
  tab reads a dropped project folder's saved sets in the browser and shows
  zone coverage, an arrangement map, maintenance findings and the changes
  between saves. Files only older saves use are listed apart from unused
  ones. The person's own read of each element (S-15) and automatic updates
  (A-9) remain.

- **0.14** (2026-10-11) — Mix variants (S-14): a radio edit or an extended
  mix kept beside the main mix, numbered within its variant; remixes are
  their own sessions. Parked cards stay folded away until opened (W-8).
  Planned: the State tab (S-15) and session analysis from `.als` files
  (A-6 to A-9), with automatic updates from the Mac later.

- **0.13** (2026-10-11) — The workflow designed with the mentor scenarios
  (§7, §11): music stages are sketch, arrange, mix and master, and sound
  design is a kind of card; elements follow the zones of the studio's Live
  template; who may do what at each level; settled decisions are cards, and
  a note becomes one; the Workflow tab's layout (W-11). The connector's first
  tools read a session's state for Claude (M-5); account holders see and
  revoke their connected apps. Open decisions 1 and 3 closed.

- **0.12** (2026-10-11) — The session page in tabs (S-13) with a slim player
  that draws the mix's waveform (S-10), notes pinned to a moment in a mix
  (S-11), and one volume for the whole app (S-12). A grid and type scale for
  every page (ARCHITECTURE §13).
- **0.11** (2026-10-11) — The gear page has a map of the studio by group,
  beside the filterable list (G-11); signal processors are a catalogue
  category of their own.
- **0.10** (2026-10-11) — Images are stored as web versions made in the
  browser, without the original or its location data, and uploaded by
  dropping several at once (G-10). The account page shows storage and
  processing against the allowances (O-7). Plans are recorded under Later.
- **0.9** (2026-10-11) — Gear files are public or private (G-9), replacing
  the rule that photos follow a share and everything else is private; images
  can be turned. A public showcase page is recorded under Later.
- **0.8** (2026-10-11) — Gear fitted to the subject before importing James's
  hardware list: models name their manufacturer and the years they were made;
  more categories; power, rack units and effect types as capabilities; an
  estimated value on the insurance record; a unit moves between owned and
  wishlist in one click (G-1 to G-5, G-8). Documents gain service manuals,
  firmware notes and reference material; the library takes manufacturers'
  documents only (K-4, K-6).
- **0.7** (2026-10-10) — Documents are processed in the app, in batches that
  resume (K-9). Every account has an allowance of storage and of pages
  processed each month, and the platform has a monthly ceiling that stops
  processing for everyone, the administrator included (K-10). Bottega uses
  an embedding account of its own (O-6). Open decision 5 closed.
- **0.6** (2026-10-10) — The library is contributed to by its users (K-6,
  K-8): anyone uploads a manual, it serves them at once, and others see it
  once the platform administrator approves it. The same file is stored and
  embedded once. Files are kept per account and deleted with it, apart from
  library contributions (O-4, O-5).
- **0.5** (2026-10-10) — Gear in two levels: a platform catalogue of makes and
  models holding capabilities and manuals, and each account's own units holding
  the insurance record (G-1 to G-7). Sharing a unit shows its model,
  capabilities, firmware and photos; serial, price, receipts, location and
  licence keys stay with the owner.
- **0.4** (2026-10-10) — Bottega becomes a platform of separate accounts.
  Each person's account holds their own projects, gear and documents. Nobody
  sees another account's work unless its owner shares it, item by item, at
  view, contribute or edit. New sign-ups wait for approval. Only an owner
  deletes. Every change to accounts and access is logged. Access is enforced
  in the database as well as in the application. §2 rewritten with stories
  AC-1 to AC-13; §1, S-1, M-1, M-2, §14 and §15 follow. The access layer
  opens Phase 1. Decisions 7 to 9 closed: genres and the capability list are
  platform-wide; manuals live in one platform library that accounts pick from
  for their gear (G-4, K-4, K-6, K-7); study groups are forum-like spaces with
  a custodian, joined by invitation or request, deleted only by the platform
  administrator (L-7 to L-11).
- **0.3** (2026-10-10) — Open decisions 4 and 6 closed: Vivarium holds no gear
  records (the inventory is in a spreadsheet, to be imported in Phase 1), and
  studio.sirsinate.com is the platform's address for now.
- **0.2** (2026-10-09) — Project kinds added (§5): music, installation,
  multimedia, and collection, a meta project made of other projects (EP, LP,
  single, compilation, multi-part composition). Releases become collections.
  Sessions are now music projects. Study group settled: Phase 2, the three
  studio members. Open decisions 1, 2 and 6 of 0.1 resolved.
- **0.1** (2026-10-09) — Initial draft, from the design conversation of
  9 October 2026: the studio leaves Vivarium for its own repository on Neon,
  gear and manuals move with it, and Scriptorium's sign-in, connector and
  ingest pipeline are copied in as a starting point.

---

## 1. Purpose

Bottega is a working platform for artists' practices: the tools, the work in
progress, what has been learned about both, and eventually the business around
them. It is run as a service with separate accounts. Each artist's account
holds their own work and gear, and they share particular items with
particular people. The name is the Renaissance workshop that took commissions, kept
the tools and materials, trained apprentices by working beside them, and moved
each piece through stages from drawing to finish.

Its first account is James's, for Sirsinate Sound Labs, a music studio. An
account holds:

- the studio's gear, with manuals and private documentation;
- every Ableton Live session, with its mixes, references and notes;
- where each session stands in the production process, and what remains to do
  in each part of the track;
- the text of manuals and reference books, searchable by meaning;
- measurements of sessions and audio, taken on the studio machine;
- a study group's shared notes on learning the MPC.

All of it is reachable from Claude through a Model Context Protocol (MCP)
connector — the interface through which an assistant calls an application's
tools — so that Claude can act as a production collaborator and teacher. Claude
proposes; people decide. Nothing Claude writes counts until a person accepts it.

The problem the workflow layer addresses is stated plainly: in production it is
easy to lose track of where a track stands, to reopen decisions already made,
and to reach ahead into a later stage to avoid the work of the current one.
After a month away, the application should return the producer to the exact
place they left.

## 2. Users and accounts

- **Account holders.** One person, one account. Each account owns its artists
  (the names its work is credited to), projects, gear and documents. The first
  three: James (artists VIG and ASU, a collaboration), Chris (KR) and Gordon
  (KJI). The account holder is the administrator of everything in it.
- **Collaborators.** An account holder seen from someone else's account: a
  person an owner has shared items with.
- **The platform administrator.** James. Approves new accounts, disables
  them, reads the access log, and may open any account's content read-only.
- **Study group.** Chris, Gordon and James, each with their own MPC (Phase 2).
- **Claude**, through the connector, acting as whichever person connected it
  and seeing exactly what that person sees.

### Accounts and access (AC)

- **AC-1** Anyone can sign up (the identity service cannot prevent it). A new
  sign-up is **pending**: they see a page saying their account awaits
  approval, and nothing else.
- **AC-2** The platform administrator approves a pending person, which opens
  an empty account for them, or leaves them pending. An account can be
  disabled and re-enabled; a disabled person sees what a pending one sees.
- **AC-3** Every item belongs to exactly one account. Top-level items
  (projects of every kind, gear, documents) carry their owner; everything
  beneath them (mixes, references, notes, gear files, pages, passages)
  belongs to its parent's owner.
- **AC-4** By default an account sees only its own items. Chris does not see
  Gordon's work, nor Gordon Chris's, nor either of them James's.
- **AC-5** An owner shares one item with one person at one level:
  - **view** — see it, play and download its audio, read its notes;
  - **contribute** — view, and upload mixes and references and add notes;
  - **edit** — contribute, and change its fields (title, rating, genre, BPM,
    current mix).
  The owner changes or revokes a share at any time.
- **AC-6** Sharing a collection shares each of its parts at view, so an
  invited collaborator hears the tracks of the EP. A share made directly on a
  part takes precedence when it is higher.
- **AC-7** Only an owner deletes, and only their own items. A collaborator
  deletes nothing, including notes they wrote on someone else's project.
  Collaborators may edit their own notes.
- **AC-8** On signing in, a person lands in their own account: their sessions,
  gear and documents first. Items shared with them appear in a second section,
  "Shared with me", each naming its owner and the level granted.
- **AC-9** The platform administrator may open any account's content
  read-only. Each such view is written to the access log. They cannot change
  or delete another account's items.
- **AC-10** Every request is authorized against the person making it, reads
  included: a page, an API route, a Server Action or a connector tool returns
  an item only if its owner is the person, or it is shared with them at a
  sufficient level, or the platform administrator is viewing read-only. The
  database enforces the same rule, so a query that forgets to filter returns
  nothing from other accounts.
- **AC-11** The access log records every change to accounts and access: sign-up
  seen, approval, disabling and re-enabling, administrator changes, each share
  granted, changed or revoked, password changes, connector tokens issued and
  revoked, and administrator read-only views. Each entry names who acted, whom
  or what it concerned, what changed (before and after), when, and an optional
  reason. Entries cannot be edited or deleted.
- **AC-12** Owners see the log entries that concern their own items and
  account; the platform administrator sees all of it.
- **AC-14** Sign-in and sign-up attempts are limited by Bottega itself:
  after 5 failed sign-ins for one email, or 20 from one address, within 15
  minutes, or 5 sign-ups from one address within an hour, further attempts
  wait. Only hashes of emails and addresses are kept, for a day. Built 12
  October 2026 (migration 021).
- **AC-13** A person manages their own account from the account page: the
  display name others see (the change is logged), their artists (add,
  rename, delete one nothing is credited to), every share they have granted
  in one list to change or revoke, what is shared with them, their recent
  activity from the access log (AC-12), and preferences, starting with the
  artist new sessions are credited to.

## 3. Layers

| Layer | Holds | Built in |
|---|---|---|
| Accounts | People, accounts, shares, the access log | Phase 1, first |
| Gear | Hardware, software and books; images, serials, receipts, manuals | Phase 1 |
| Projects | Projects of every kind; collections (EP, LP and so on) | Phase 0 |
| Music | Ableton sessions, mixes, references, notes, ratings | Phase 0 |
| Workflow | Stages, exit criteria, elements, cards, settled decisions | Phase 2 |
| Corpus | Manual and book text, chunked and embedded | Phase 1 |
| Analysis | Measurements of `.als` files and audio | Phase 3 |
| Study | MPC topics, sources, notes, progress | Phase 2 |
| Connector | Read access to every layer; proposals into the review queue | Phase 1, growing each phase |

## 4. Gear (G)

- **G-1** Two levels. The platform keeps one **catalogue** of models (a
  Sequential Prophet-6, Ableton Live 12): kind (hardware, software, book,
  cable, other), category (synthesizer, sequencer, sampler, effect, preamp,
  recorder, interface, test equipment and so on), manufacturer, model, and
  the years it was made (introduced, and discontinued unless still made). Each account keeps its own **units**: which model, a
  nickname, firmware, status (owned, wishlist, gone), notes. A unit whose model
  is not in the catalogue can name itself until it is.
- **G-2** Each unit has an insurance record: serial, purchase date and price,
  seller, estimated value and when it was estimated, condition, location,
  service history, and for software the licence
  key, seats, activation and renewal. Files attach to the unit: photographs,
  receipts, serial plates, documents. The record must be sufficient to support
  an insurance claim. Nothing in gear is public.
- **G-3** Capabilities are structured facts from a platform vocabulary
  (polyphony, synthesis method, microtuning and tuning methods, MPE,
  aftertouch, MIDI, CV and gate, sync, inputs and outputs, sampling,
  sequencer, effects and effect types, form factor, power, rack units), each
  typed and checked. They are set on
  the model and overridden on a unit where the unit differs (a modded voice
  card, newer firmware). The question the catalogue must answer is of the form
  "which of my sound sources can hold a non-equal-tempered scale?", in one
  query.
- **G-4** Manuals belong to models: the platform administrator links library
  manuals (K-6) to a model in the catalogue, and every account's unit of that
  model has them, so a passage found by search names the instrument it
  describes. A person can also pick further library documents for their own
  search. Nothing is copied.
- **G-5** A wishlist: gear not yet owned, with the same fields. A unit moves
  between owned and wishlist in one action from the gear list.
- **G-6** Anyone may suggest a model for the catalogue; the platform
  administrator approves it and keeps its facts. A suggestion is visible to
  whoever made it until then.
- **G-7** A unit is shared like a project (AC-5). A share shows the unit's
  model, capabilities, firmware and public photos (G-9); contribute adds
  photos; edit changes nickname, firmware and capability overrides. The
  insurance record and every private file stay with the owner at every level,
  and the platform administrator's read-only view does not reach them.
- **G-8** An account's gear can be imported from a spreadsheet: one row per
  unit, in a documented format, checked by the database in a dry run before
  anything is kept. The first import is James's hardware list.
- **G-9** Each file on a unit is public or private, set by its owner. Public
  files are shown to everyone the unit is shared with, and later on the
  owner's showcase page (§13); private files are the owner's alone. New
  photos start public; receipts, serial plates and documents start private.
  An image can be turned by quarter turns from its edit screen; the stored
  file is never rewritten.
- **G-10** Images are stored for the web. The browser makes three sizes of
  each image before upload (a thumbnail, a view size, and a full size of
  2560 pixels on the long edge), applies the camera's orientation, and drops
  all metadata, location included. The original is not kept; the full size
  is enough to read a serial plate. Several images, and PDFs, can be dropped
  onto a unit at once. Images uploaded before this are converted from the
  account page.
- **G-11** The gear page lays the studio out by group: Audio, Sound modules,
  Controllers and sequencers, Signal processors, Effects, Mics, Misc and
  Software. A unit's group follows from its model's category, so gear is
  never filed twice; signal processors (filters, dynamics, EQ, preamps) are
  a category apart from effects (reverb, delay, slicers, loopers). Two views,
  as tabs: the map, every group as a column with its units beneath and the
  wishlist after them; and the list, filterable by status, group and
  capability, with photos.

## 5. Projects (P)

A project is any piece of work that moves through stages. Each project has a
kind, and the kind decides its particular fields and its stages.

- **P-1** Kinds: **music** (an Ableton Live session, §6), **installation**,
  **multimedia**, and **collection**.
- **P-2** A collection is a meta project made of other projects in order: EP,
  LP, single, compilation, or multi-part composition (a piece in movements or
  parts). Collections replace Vivarium's releases.
- **P-3** A project can belong to several collections at once (a track on a
  single and on the LP), with its own position in each.
- **P-4** Installation and multimedia projects can also have parts, including
  music projects (a score, a soundtrack). Collections can contain collections
  (an LP containing a multi-part composition). No project can contain itself,
  directly or through others.
- **P-5** Every kind has its own list of stages (W-1). A collection's stages
  concern the whole: selecting, sequencing, mastering as a set, artwork,
  release.
- **P-6** Fields shared by every kind: title, artist or credit, rating, notes,
  files. Fields particular to a kind live with that kind: canonical ID, genre
  and BPM for music; site, dimensions and equipment for an installation; dates
  and venues for a performance.
- **P-7** Music projects and collections exist from Phase 0, because sessions
  and releases are already in use. Installation and multimedia projects arrive
  with the workflow in Phase 2.

## 6. Music projects (S)

Carried over from Vivarium's studio, which is in daily use; nothing that works
there may be lost in the move.

- **S-1** Each session belongs to an account and is credited to one of that
  account's artists. It has a permanent canonical ID (the date prefix
  of its Ableton folder, `YYYY MMDD`, unique per artist and never editable,
  because renaming breaks Ableton's file associations) and a working name that
  can change, with its history kept.
- **S-2** Rating 0–5 (0 unrated), genre from an extendable list, BPM.
- **S-3** Mixes: MP3s uploaded to private storage, numbered versions, streamed
  in the page and downloadable through signed links.
- **S-4** Notes per session, newest first, optionally attached to one mix
  and to a moment in it, typed as "1:35" (beside a mix, filled in from the
  player), filterable by person, mix, variant and date.
- **S-5** The session list: sortable columns, search, filters by artist, genre,
  rating and audio, multi-select bulk edit, and a shared player that auditions
  each session's current mix with keyboard shortcuts.
- **S-6** Vivarium's releases and their running orders migrate as collections
  (P-2).
- **S-7 (new)** References: one or more tracks by other artists attached to a
  session, stored and played like mixes but kept apart from them. The app
  currently calls the producer's own bounces "reference tracks"; in Bottega
  those are **mixes** and **references** means other people's music.
- **S-8 (new)** Current mix: each session points at one mix, defaulting to the
  newest and changeable by hand. The list plays and describes the current mix.
- **S-9 (new)** The session list shows the length of the current mix.
  `studio_tracks.duration_s` already exists in Vivarium; how many rows have it
  filled is to be checked before the migration.
- **S-10** Every mix and reference plays in one slim player that draws its
  waveform, measured in the browser when the file is uploaded (older files
  from a backfill page). Clicking the waveform plays from that point; one
  player sounds at a time.
- **S-11** A note on a mix can be pinned to a moment in it: written while the
  mix plays, it takes the playback time, shows as a tick on that mix's
  waveform, and plays the mix from there when clicked.
- **S-12** One volume for the whole app, set from the header or any player,
  kept between visits in the browser.
- **S-13** The session page has five tabs, under a one-line header (working
  name, canonical ID, artist, rating). Overview: its details and sharing in
  the narrow column on the left; the current mix, where the session stands
  and the latest notes beside them. Mixes: every version and reference with
  its waveform, and on the right the notes on the selected version, ordered
  by moment. Workflow: stages and cards (§7). Notes: every note, filterable
  by person, version and date from the left. History: versions and
  references uploaded and names changed, newest first.
- **S-14** Mix variants: a mix belongs to the main mix or to a named variant
  (radio edit, extended, instrumental…), and versions are numbered within it
  ("Radio edit v1"). A mix goes to the variant chosen in the session's
  header (S-16); the Mixes tab shows that variant's mixes. The session's
  current mix can be any version of any variant. A remix is its
  own session; a link between a remix and its original comes later.
- **S-16** Variants are a list on the session: chips in its header (Main,
  then each variant) choose what the Mixes and State tabs show. Edit access
  adds and renames a variant; the owner removes one that has no mixes. Each
  variant has a name rule, text in a saved set's file name ("radio edit"),
  that puts the save in the variant; the longest rule found wins, and no
  rule found means the main mix. A save can be moved by hand and handed
  back to the rules. The State tab lists the chosen variant's saves, newest
  first, each with what changed since the save before; choosing one shows
  the set as it was then. A variant's first save is compared with the main
  save just before it. The workflow, references and notes about the whole
  session are common to all variants; a note on a mix follows its mix.
- **S-15 (planned)** A State tab, between Mixes and Workflow: each element's
  state as the person reads it (empty, sketched, working, baked; each change
  dated) beside what the latest analysis shows (how much of the arrangement
  the element covers, its clips, devices and automation), and a map of the
  arrangement: elements down the side, time across, clips where they play,
  locators along the top, at any saved version of the set.

## 7. Workflow (W)

- **W-1** Stages are defined per kind. Music: sketch, arrange, mix, master;
  sound design is a kind of card (W-6), done in whichever stage needs it.
  Collection: select, sequence, master, artwork, release, to be confirmed.
  Installation and multimedia: to be defined.
- **W-2** Each project is in exactly one stage at a time.
- **W-3** Entering a stage means writing its exit criteria: the conditions under
  which the stage is finished. Advancing means confirming each one.
- **W-4** Moving back to an earlier stage requires a reason, which is kept.
- **W-5** Elements: a tree of the parts of a work, one template per kind,
  copied to each project when its workflow starts and editable there. For
  music the top level is the zones of the studio's Live template
  (`docs/ableton-session-template.md`): TACTUS, BASS, BACKGROUND, LEADS,
  TEXTURE, VOX, plus STRUCTURE (sections and transitions) and BUS (returns
  and the master chain) for the work that belongs to no single part. One
  default for the platform for now; a template per account comes later.
- **W-6** Cards. A card belongs to a project, one element and one stage, and has
  two required fields: what needs to happen, and how it will be known to be
  done. Kind, optional: sound design, writing, arrangement, mix, fix. Status:
  proposed (Claude's only), accepted, in progress, done, rejected. A card can
  name the note it came from and the mix and moment it is about.
- **W-7** The board: columns by status, swimlanes by element, filtered to the
  current stage.
- **W-8** Parked cards. A card for a later stage can be written at any time and
  is held out of view until that stage begins: folded away on the Workflow
  tab, opened from its section or from that stage in the stage strip, where
  it can be read and edited.
- **W-9** Settled decisions. A card can be marked settled, with a reason. A
  note marked settled becomes a settled card carrying its text, mix and
  moment, so decisions live in one list. Reopening one is an explicit act
  with a reason, kept, and the count of reopenings is visible.
- **W-10** Resume view: on opening a project, the current stage and its exit
  criteria, open cards by element, settled decisions, the latest notes and the
  current mix, on one page.
- **W-11** The Workflow tab: the stages across the top with the current one
  marked; Claude's proposals in a band above everything, to accept or reject;
  in the narrow left column the current stage, its exit criteria as a
  checklist, the move forward and the move back, and the history of moves;
  in the main column the open cards by element, the cards parked for later
  stages, the settled decisions and the element tree.
- **W-12** Who may do what, by level (AC-5): view reads the workflow;
  contribute adds cards and changes the cards they wrote; edit starts the
  workflow, moves the stage, writes exit criteria and elements, changes any
  card, accepts or rejects Claude's proposals and settles or reopens
  decisions; only the owner deletes (AC-7).

## 8. Corpus (K)

- **K-1** Load a PDF (a manual, a reference book) and extract its text by page.
  Scans are run through OCR first.
- **K-2** Chunk, embed and index the text; search by keyword, by meaning, and by
  both combined.
- **K-3** Every search result names its source and page, and the page can be read
  in full.
- **K-4** Two kinds of source. **Library documents** (K-6) are one copy for the
  whole platform, readable by every active account. **Private documents**
  belong to an account (AC-3, AC-4): visible to their owner and to the people
  they are shared with. Neither is ever published.
- **K-5** Storage is measured from the first load, and the health page reports
  use against the database plan's limits (Scriptorium reached its limit and had
  to drop its vector index; §5 of `ARCHITECTURE.md` carries the estimate).
- **K-6** The library: manuals for instruments and software, stored, extracted
  and embedded once for the whole platform. Its users build it: anyone may
  upload a manual, from a piece of gear's page or the library itself, and
  link it to a catalogue model. It serves the person who uploaded it at once.
  Others see it once the platform administrator approves it, from the same
  queue as model suggestions (G-6); the administrator approves rather than
  finds. A rejected upload stays private to its contributor.
- **K-7** A search runs over the library documents the person has linked plus
  their private documents and those shared with them, unless they ask for the
  whole library.
- **K-8** The same file is never stored twice. Each upload's SHA-256
  fingerprint is recorded; uploading a manual the library already holds links
  the existing copy instead. Every library document names its contributor, and
  a contribution stays in the library when its contributor's account is
  deleted, since once approved it belongs to the platform.
- **K-9** Documents are processed in the app, after upload, in batches small
  enough for one serverless request. Processing records how far it has got,
  so a batch that fails or runs out of allowance resumes where it stopped.
  A document whose pages carry no text is marked as needing OCR (K-1) and
  waits for that step.
- **K-10** Processing and storage are limited, so that no account can run up
  costs without bound. Each account has a storage allowance, a number of
  pages it may process each calendar month, and a longest document it may
  load; the platform administrator sets the defaults and may raise or lower
  them for one account. The platform has a monthly ceiling on pages
  processed by everyone together, which applies to the administrator too.
  Every page processed is recorded against the account that processed it,
  with the embedding tokens it used; that record cannot be edited. A library
  submission counts against its contributor until it is approved, and
  against nobody after. Changes to allowances are written to the access log
  (AC-11).

- **K-11** Many documents can be added at once: several PDFs or whole
  folders, dropped or chosen, with "private or library" and the kind asked
  once for the batch. Each file is checked for duplicates and uploaded as a
  single one would be; none is processed until someone opens it. Built 12
  October 2026.
- **K-12** The platform administrator moves a document between the library
  and an account's private documents, either way, choosing its kind. Moving
  out of the library returns it to its contributor and removes picks and
  model links; moving in approves it and removes its shares. Pages are kept,
  and every move is logged. Built 12 October 2026 (migration 018).

- **K-13** Printed page numbers. A page's printed number is read from the
  PDF's own page labels when it has them, or set by hand for a range of PDF
  pages (arabic or roman, starting at a given number), which takes precedence
  and can be cleared. The reader, lesson citations and the connector show it
  beside the PDF page: "p. 812 (PDF p. 824)". Citations stay by PDF page.
  Built 12 October 2026 (migration 022).
- **K-14** Contents. The PDF's outline (bookmarks) is read when the document
  is processed, or on request for one processed before; the reader lists it
  and names the section a page is in, and so does the connector's read_pages.
  Built 12 October 2026 (migration 022).
- **K-15** Searching from the app: the same search Claude uses, over the
  person's documents and gear manuals, the whole library, or a study group's
  reading list, each passage linking to the page reader. Built 12 October 2026.

## 9. Analysis (A)

Runs on the studio machine, where the sessions and audio live. Only the results
travel to the database.

- **A-1** Read an `.als` file (gzipped XML): tracks, device chains per track,
  tempo, length, sample references, automated parameters.
- **A-2** Measure a mix or reference: integrated loudness (LUFS), energy per
  frequency band, stereo width, dynamic range.
- **A-3** Compare a mix with a chosen reference band by band and store the
  differences.
- **A-4** Measurements are stamped with the file, its modification date and the
  analyser's version, so a stale reading can be told from a current one.
- **A-5** Analysis never changes a session file.
- **A-6** Dropping a session's Ableton project folder on its page
  reads every `.als` file in it in the browser, lists the folder's files by
  name and size without uploading the audio, and stores one snapshot per
  saved set (dated by the file, identified by its contents, so dropping the
  folder again adds only new saves) with a copy of the `.als` for re-reading
  when the parser improves. One parser, in TypeScript, serves the browser
  now and the Mac later.
- **A-7** Maintenance, from the snapshots: plugins and devices with
  their instances and tracks; samples outside the project folder ("collect
  all and save"); files the set expects in the folder that are missing; files
  in the folder no saved version uses (candidates to purge); frozen tracks,
  disabled devices, empty and muted tracks; and files in the folder that only
  older saves use, which the latest set has moved on from. Several instances
  of one effect are pointed out as candidates for a shared return.
- **A-8** Session history: the differences between consecutive
  snapshots (tracks, devices, clips, coverage per element, length) as a log
  of work sessions. Plugin use and sample references are also kept in tables
  of their own, for questions across sessions.
- **A-9 (planned)** Automatic updates: a small program on the Mac watches the
  sessions folder and sends each newly saved set, using the same parser and
  a token of the person's own, so Bottega follows the work in Live without an
  extra step.

## 10. Study (L)

- **L-1** Sources: PDFs into the corpus (the Akai manual, books), and videos as
  links with timestamped notes.
- **L-2** Topics as axes (for example sampling and chopping, programs,
  sequencing and song mode, effects and the mixer, MIDI and external control).
- **L-3** Notes by each member, attached to a topic and optionally to a source
  passage or video timestamp.
- **L-4** Questions as notes that other notes answer; the question stays.
- **L-5** Progress per member: a list of skills on each topic, checked off by
  the member.
- **L-6** Each member's MPC model and firmware are recorded, since manuals and
  features differ between them.
- **L-7** A study group is a forum-like space of its own, belonging to no one
  account. Any active account can create one and becomes its **custodian**.
- **L-8** People join by invitation from the custodian, or by asking to join,
  which the custodian accepts or declines. The custodian can remove members and
  hand custodianship to another member.
- **L-9** Every member reads everything in the group and writes their own
  notes, questions and answers there (L-3, L-4). Members edit their own
  writing; nothing in a group is deleted except by the platform administrator.
- **L-10** Only the platform administrator deletes a study group. A custodian
  can close one, which keeps it readable to its members and stops new writing.
- **L-11** Groups are listed by name for every active account to find and ask
  to join; their contents are visible to members only. Joining, leaving,
  removal and changes of custodian are written to the access log (AC-11).
- **L-12** The syllabus. A group's topics are ordered; each holds ordered
  lessons and exercises, and an exercise may belong to one of its topic's
  lessons. A topic may name a catalogue model. The custodian writes, edits
  and orders the syllabus. Built 12 October 2026.
- **L-13** Claude proposes topics, lessons and exercises through the
  connector for any member who asks; proposals wait in the group's review
  band until the custodian accepts or rejects them. A lesson or exercise under
  a topic still waiting is accepted only after its topic; rejecting a topic
  rejects what waits under it. Built 12 October 2026.
- **L-14** A lesson cites the corpus with markers in its body: `[15:p42]`,
  `[15:p42-43]`, or `[15:p42 "exact words"]`. Saving a lesson, by a person or
  by Claude, checks that each document is readable by the writer, that the
  pages exist and have been read, and that each quotation is on the pages
  cited (M-4). Readers see numbered links to the page reader and a list of
  sources. Built 12 October 2026.
- **L-15** Each member records their own progress on each accepted exercise:
  not started, practising or done, with a short note. Every member sees
  everyone's. This is L-5 for the first slice, with exercises as the skills.
  Built 12 October 2026.
- **L-16** A document's owner may share a private document with a study
  group they belong to: its current members read it (view), and lose that
  when they leave. Built 12 October 2026 (decision 10 in §15).
- **L-18** Study sessions. A member records a sitting in a group: when, how
  long, what kind (at the instrument, a conversation, reading, watching a
  video, other), a summary, and the topics it touched. Built 12 October 2026.
- **L-19** Notes (L-3 as built). A member writes notes, each with its author
  and time, standing alone or in one of their sessions, optionally on a
  topic, a lesson or an exercise. Notes and summaries may cite the corpus with
  the lessons' markers, checked the same way. Built 12 October 2026.
- **L-20** Claude documents a session through the connector when the member
  asks ("please document this"), summary and notes in one call. It arrives
  as a draft only that member sees, marked as documented by Claude, until
  they publish it (the session with its notes) or discard it. Built 12
  October 2026.
- **L-21** Sessions and notes are shared with the group by default; their
  author may mark one private. A note in a private session is private. Only
  the author changes their own; nothing published is deleted (L-9). Built 12
  October 2026.
- **L-22** Progress, drawn from sessions: sessions and minutes per member and
  per week, sessions and minutes per topic (a session's minutes split evenly
  over its topics) with when each was last touched, the topics not touched,
  and exercises done. First version built 12 October 2026 (tables; charts
  later).
- **L-24** A study group has a reading list: the documents its study draws
  on. The custodian adds and removes library manuals; a member adds or
  removes their own private documents, which shares them with the group (L-16).
  When Claude works on the group it searches the reading list only, unless
  asked to search more widely. Lesson citations may still cite any document
  the writer can read. Built 12 October 2026 (migration 019).
- **L-23** Resources: any member adds a YouTube video (played in the app;
  title, channel and thumbnail from YouTube) or another link, filed under
  topics, with why it is worth the time. Notes can point at a moment in a
  video, which opens it there; a session can name the video it was spent on.
  Claude adds one when asked, as a draft its member publishes. The member who
  added it, or the custodian, removes it; its notes stay. Built 12 October
  2026 (migration 020).
- **L-17** Joining is by invitation only in the first slice; invitations go
  to approved accounts by email, and the invitee accepts or declines on the
  Learning page. The custodian cannot leave or be removed until handover
  exists (L-8).

## 11. Connector (M)

- **M-1** One remote connector, authorized per person by OAuth behind the
  ordinary sign-in. A token carries its person; revoking a person's tokens is
  logged (AC-11).
- **M-2** Every tool sees what the connected person sees (AC-10), no more.
  Read tools across the layers: search the corpus, read pages, query
  gear capabilities, read a session's state (stage, cards, notes, analysis),
  list study notes and progress.
- **M-3** Write tools only propose. `draft_card` and `draft_note` create items
  marked as written by the assistant and unreviewed; a person accepts or rejects
  them in the application. No connector tool edits or deletes.
- **M-4** Quotations from the corpus in a proposal are checked against the page
  text, as in Scriptorium.
- **M-5** First tools, to test the mentor scenarios early: `list_projects`
  (the sessions a person can see, with each one's stage and current mix) and
  `get_session` (one session's details, stage, exit criteria, open, parked
  and settled cards, pending proposals, recent moves, elements, mixes,
  references and latest notes with their moments). The scenarios they serve:
  returning after a month ("where was I?"), getting unstuck on a passage,
  being kept in the current stage when reaching ahead, being shown a settled
  decision before reopening it, turning a collaborator's timed notes into
  cards, judging whether a stage is finished, and drafting a new stage's exit
  criteria. The proposal tools follow (M-3): `draft_criteria` proposes exit
  criteria for a stage and `draft_card` a card, optionally from a note and
  its moment; both wait in the Workflow tab's review band (W-11).

## 12. Operations (O)

- **O-1** Every schema change is a numbered migration, applied before the code
  that reads it is deployed.
- **O-2** A health page shows database size, compute use and embedding service
  status against their limits.
- **O-3** A documented, repeatable migration from Vivarium's Sirsinate database,
  verified by row counts, before studio.sirsinate.com is pointed at Bottega.
- **O-4** Files are private. Nothing has a public address; the browser only
  holds short-lived signed links, issued after the request is authorized
  (AC-10). Storage keys carry no personal information, and an account's files
  sit under its own prefix, so they can be listed, exported or deleted
  together.
- **O-5** Every stored file has a database row naming its owner (or the
  library), its item and its size, so per-account storage use, exports,
  deletion and the search for orphaned objects are queries, never scans of
  storage.
- **O-6** Bottega has its own accounts with outside services, its embedding
  service included, so that its use and costs are never mixed with another
  project's.
- **O-7** The account page shows what the account stores against its storage
  allowance, broken down by kind (audio, gear photos, gear documents,
  private documents, library submissions awaiting review) with file counts,
  and the pages processed this month against the monthly allowance. Each
  kind opens to its largest files, linked to where they live.

## 13. Later

Recorded so that early decisions do not close them off; none is designed yet.

- **Plans.** Named sets of allowances (storage, pages a month, longest
  document, keeping originals) that an account is on, with
  `account_limits` still overriding one account. Storage on R2 costs little
  (about 1.5 cents per GB a month); what grows with use is embedding and the
  corpus in the database, so plans would price pages processed first.
- **A showcase page.** A page anyone can open without signing in, showing
  the units an owner chooses and their public files (G-9). It needs a
  public flag on units, links that work without a session, and an exception
  to O-4, which keeps every file private today.
- Installation and multimedia projects in depth: their fields, stages and
  element templates.
- Residency and grant applications: deadlines, requirements, materials,
  submissions and outcomes.
- Business: contacts, commissions and contracts, invoices, income and expenses.
- Further instances for other practices.

## 14. Phases

| Phase | Delivers | Stories |
|---|---|---|
| 0 | Repository, Neon, sign-in, the studio moved across with parity as music projects and collections, plus references, current mix and length | P-1 to P-4, P-7, S-1 to S-9, O-1, O-3 |
| 1 | Accounts and access first; then gear catalogue, corpus, first connector tools | AC-1 to AC-13, G-1 to G-11, S-10 to S-13, K-1 to K-10, M-1 to M-5, O-2, O-4 to O-7 |
| 2 | Workflow and board for every kind; study group | P-5, P-6, W-1 to W-12, L-1 to L-6 |
| 3 | Analysis | A-1 to A-5 |

## 15. Open decisions

1. ~~**Stage order for music.**~~ Closed 11 October 2026: sound design is a
   kind of card; the stages are sketch, arrange, mix, master.
2. **Stages for collections.** Whether select, sequence, master, artwork and
   release is the right list.
3. ~~**Element template.**~~ Closed 11 October 2026: the zones of the
   studio's Live template, with STRUCTURE and BUS added (W-5).
4. ~~**Gear data in Vivarium.**~~ Closed 10 October 2026: nothing to migrate.
   The gear inventory is in a spreadsheet, imported in Phase 1 (G-1).
5. ~~**Embedding size.**~~ Closed 10 October 2026: voyage-4 at 1024
   dimensions, stored at half precision (§5 of `ARCHITECTURE.md`). Storage is
   measured from the first load (K-5) and the size revisited if it grows
   past the plan.
6. ~~**Domain.**~~ Closed for now, 10 October 2026: studio.sirsinate.com.
7. ~~**Shared vocabularies.**~~ Closed 10 October 2026: genres are one list
   for the platform, which any active account may add to. The gear capability
   list follows the same rule.
8. ~~**Shared documents.**~~ Closed 10 October 2026: one library for the
   platform (K-6), from which accounts pick manuals for their gear; private
   documents remain per account (K-4).
9. ~~**The study group's space.**~~ Closed 10 October 2026: a forum-like space
   of its own with a custodian, joined by invitation or request, deleted only
   by the platform administrator (L-7 to L-11).
10. ~~**What the library holds.**~~ Closed 10 October 2026, as proposed below.
    Manufacturers' manuals are published for
    owners and are normally fine to keep in a shared library. Commercial books
    (an MPC guide bought by one person, for example) are another matter:
    putting one account's copy in front of every account is redistribution.
    Decided: books go in as private documents, shared with named people or
    with a study group's members, and the library holds manuals only.
    Widened in 0.8 to manufacturers' documents: manuals, service manuals and
    firmware notes. Reference material is private, like books.
