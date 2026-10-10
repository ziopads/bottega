# Bottega — requirements

**Version:** 0.2
**Date:** 2026-10-09
**Status:** draft
**Scope:** What the application has to do, by layer and by phase. How it is
built is in `ARCHITECTURE.md` (not yet written).

---

## Changelog

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

Bottega is the working platform for an artist's practice: the tools, the work
in progress, what has been learned about both, and eventually the business
around them. The name is the Renaissance workshop that took commissions, kept
the tools and materials, trained apprentices by working beside them, and moved
each piece through stages from drawing to finish.

Its first instance serves Sirsinate Sound Labs, a music studio. It holds:

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

## 2. Users

- **Studio members.** Three producers, each signing in as one artist on the
  roster: VIG (Vigorish), KR (Kamikaze Rabbit) and KJI (Kawaji). A fourth roster
  entry, ASU (All-Star Underachievers), is a collaboration with no sign-in of its
  own. Any member may create sessions under their own artist and upload to any
  session.
- **Study group.** The three studio members, each with their own MPC,
  learning the instrument together.
- **The administrator.** VIG. Deletes, migrations and gear documentation.
- **Claude**, through the connector, acting for whichever person connected it.

Access is by allowlist. Anyone not on it sees nothing.

## 3. Layers

| Layer | Holds | Built in |
|---|---|---|
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
- **G-4** A manual attached to a piece of gear enters the corpus (§8) and stays
  linked to it, so a passage found by search names the instrument it describes.
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

- **S-1** Each session has an artist, a permanent canonical ID (the date prefix
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
- **K-4** Sources are private. Files and text are visible only to signed-in
  users and never published.
- **K-5** Storage is measured from the first load, and the health page reports
  use against the database plan's limits (Scriptorium reached its limit and had
  to drop its vector index; §8 of `ARCHITECTURE.md` will carry the estimate).

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

## 11. Connector (M)

- **M-1** One remote connector, authorized per person by OAuth behind the
  ordinary sign-in.
- **M-2** Read tools across the layers: search the corpus, read pages, query
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
| 1 | Gear catalogue, corpus, first connector tools | G-1 to G-5, K-1 to K-5, M-1 to M-4, O-2 |
| 2 | Workflow and board for every kind; study group | P-5, P-6, W-1 to W-10, L-1 to L-6 |
| 3 | Analysis | A-1 to A-5 |

## 15. Open decisions

1. **Stage order for music.** Whether sound design is a stage between sketch
   and arrange, or a kind of card that can appear in any stage.
2. **Stages for collections.** Whether select, sequence, master, artwork and
   release is the right list.
3. **Element template.** To be supplied from the track-components work.
4. **Gear data in Vivarium.** Whether the Sirsinate instance holds any gear
   records yet; if so they migrate in Phase 0.
5. **Embedding size.** Dimensions chosen against a measured estimate of the
   corpus, recorded in `ARCHITECTURE.md`.
6. **Domain.** The platform's own address, separate from
   studio.sirsinate.com.
