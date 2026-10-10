# Bottega — requirements

**Version:** 0.4
**Date:** 2026-10-10
**Status:** draft
**Scope:** What the application has to do, by layer and by phase. How it is
built is in `ARCHITECTURE.md`.

---

## Changelog

- **0.4** (2026-10-10) — Bottega becomes a platform of separate accounts.
  Each person's account holds their own projects, gear and documents. Nobody
  sees another account's work unless its owner shares it, item by item, at
  view, contribute or edit. New sign-ups wait for approval. Only an owner
  deletes. Every change to accounts and access is logged. Access is enforced
  in the database as well as in the application. §2 rewritten with stories
  AC-1 to AC-12; §1, S-1, M-1, M-2, §14 and §15 follow. The access layer
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

- **G-1** Catalogue each piece of gear: kind (hardware, software, book, cable,
  other), maker, model, serial, purchase date and price, condition, location.
- **G-2** Attach private files: photographs, receipts, serial plates, manuals.
  Nothing in gear is public. The record must be sufficient to support an
  insurance claim.
- **G-3** Record capabilities as structured facts that can be queried: polyphony,
  synthesis method, inputs and outputs, MIDI and CV, alternate tuning and just
  intonation support, sync, effects. The question the catalogue must answer is
  of the form "which of my sound sources can hold a non-equal-tempered scale?"
- **G-4** A piece of gear is linked to the manuals that describe it, chosen
  from the platform library (K-6), so a passage found by search names the
  instrument it describes. Linking a manual adds it to that account's
  searchable corpus; nothing is copied.
- **G-5** A wishlist: gear not yet owned, with the same fields, convertible to an
  owned record.

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
- **S-4** Notes per session, newest first, optionally attached to one mix,
  filterable by person, mix and date.
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

## 7. Workflow (W)

- **W-1** Stages are defined per kind. Music: sketch, sound design, arrange,
  mix, master; the order and whether sound design is a stage or a kind of card
  are open (§15). Collection: select, sequence, master, artwork, release, to
  be confirmed. Installation and multimedia: to be defined.
- **W-2** Each project is in exactly one stage at a time.
- **W-3** Entering a stage means writing its exit criteria: the conditions under
  which the stage is finished. Advancing means confirming each one.
- **W-4** Moving back to an earlier stage requires a reason, which is kept.
- **W-5** Elements: a tree of the parts of a work (for a track, Low end ›
  Kick, Bass). One template per kind, copied to each project and editable
  there. The template comes from the track-components work done separately;
  it is to be supplied.
- **W-6** Cards. A card belongs to a project, one element and one stage, and has
  two required fields: what needs to happen, and how it will be known to be
  done. Status: proposed, accepted, in progress, done, rejected.
- **W-7** The board: columns by status, swimlanes by element, filtered to the
  current stage.
- **W-8** Parked cards. A card for a later stage can be written at any time and
  is held out of view until that stage begins.
- **W-9** Settled decisions. A card or note can be marked settled. Reopening it
  is an explicit act with a reason, and the count of reopenings is visible.
- **W-10** Resume view: on opening a project, the current stage and its exit
  criteria, open cards by element, settled decisions, the latest notes and the
  current mix, on one page.

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
  and embedded once. A person browsing it picks the manuals they want and links
  them to their gear (G-4). The platform administrator adds library documents
  and decides what belongs there; any account may suggest one.
- **K-7** A search runs over the library documents the person has linked plus
  their private documents and those shared with them, unless they ask for the
  whole library.

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

## 12. Operations (O)

- **O-1** Every schema change is a numbered migration, applied before the code
  that reads it is deployed.
- **O-2** A health page shows database size, compute use and embedding service
  status against their limits.
- **O-3** A documented, repeatable migration from Vivarium's Sirsinate database,
  verified by row counts, before studio.sirsinate.com is pointed at Bottega.

## 13. Later

Recorded so that early decisions do not close them off; none is designed yet.

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
| 1 | Accounts and access first; then gear catalogue, corpus, first connector tools | AC-1 to AC-12, G-1 to G-5, K-1 to K-5, M-1 to M-4, O-2 |
| 2 | Workflow and board for every kind; study group | P-5, P-6, W-1 to W-10, L-1 to L-6 |
| 3 | Analysis | A-1 to A-5 |

## 15. Open decisions

1. **Stage order for music.** Whether sound design is a stage between sketch
   and arrange, or a kind of card that can appear in any stage.
2. **Stages for collections.** Whether select, sequence, master, artwork and
   release is the right list.
3. **Element template.** To be supplied from the track-components work.
4. ~~**Gear data in Vivarium.**~~ Closed 10 October 2026: nothing to migrate.
   The gear inventory is in a spreadsheet, imported in Phase 1 (G-1).
5. **Embedding size.** Dimensions chosen against a measured estimate of the
   corpus, recorded in `ARCHITECTURE.md`.
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
10. **What the library holds.** Manufacturers' manuals are published for
    owners and are normally fine to keep in a shared library. Commercial books
    (an MPC guide bought by one person, for example) are another matter:
    putting one account's copy in front of every account is redistribution.
    Proposed: books go in as private documents, shared with named people or
    with a study group's members, and the library holds manuals only.
