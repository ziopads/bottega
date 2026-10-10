# Bottega — handoff

**Date:** 2026-10-10
**Read first, then `REQUIREMENTS.md` (0.2) and `ARCHITECTURE.md` (0.1).**

Bottega began in a design conversation held inside the Vivarium project on
9–10 October 2026. This file carries everything that conversation settled, so
work can continue in a project of its own.

---

## 1. What exists

Phase 0 is built, committed and deployed. The repository is
`github.com/ziopads/bottega`, local at `~/Desktop/_PROJECTS/bottega`.

| Commit | What it did |
|---|---|
| `6c0f1d3` | Next 16 scaffold, Neon sign-in and allowlist, migration runner, `db/001-foundation.sql`, the Vivarium copy script, the two design docs |
| `97b56c3` | The studio ported from Vivarium: sessions list, project pages, mixes, notes, collections |
| `7020b05` | Sign-in logs Neon Auth's real refusal (`[sign-in] refused` in the server log) |
| `dc12c03` | Step 0.5: references, choosing the current mix, a Length column, `/admin/lengths`, "collection" wording |

Running services:

- **Vercel** project `bottega` (team ziopads, Hobby), building `main`.
  studio.sirsinate.com was being moved to it from Vivarium's Sirsinate project
  at the end of the conversation; confirm it serves Bottega.
- **Neon** project `bottega-sirsinate`, in its own organization, separate from
  the organization that holds Scriptorium. Migration 001 applied. Neon Auth on.
- **Cloudflare R2**: the audio bucket Vivarium's studio already used. Same
  account, token and bucket; object keys unchanged. Its CORS rule already
  allowed studio.sirsinate.com.

Data: copied from Vivarium's Sirsinate Supabase database on 10 October and
checked by row counts on both sides: 4 artists, 3 members, 5 genres, 182 music
projects, 194 titles, 261 mixes, 1 note, 0 collections. James decided no
second copy is needed; Vivarium's studio is no longer the place to work.

## 2. Settled decisions

- **Its own repository on Neon.** The studio left Vivarium because it needs
  layers Vivarium will never have (embeddings, a Claude connector, analysis).
  Vivarium's library and catalogue raisonné stay metadata holders.
- **Gear and manuals live in Bottega**, with the sessions. Gear moves out of
  Vivarium's Sirsinate instance in Phase 1 (it held no gear records yet; check).
- **Neon, one project per app.** Free-plan limits are per project (1 GB storage
  and 100 compute-hours a month on the current page; Scriptorium's own records
  say 512 MB for its project). A shared corpus database would pool every app
  into one allowance; shared code with separate projects does not.
- **Sign-in copied from Scriptorium**: Neon Auth for identity, `ALLOWED_EMAILS`
  for access, checked in every page and route. `ADMIN_EMAILS` decides who may
  delete mixes and other people's notes.
- **Projects are one shared table plus a table per kind** (`music_projects`,
  `collections`; installation and multimedia later), with `project_parts`
  holding ordered membership. The name `project_parts` is provisional:
  `members` already names the people table.
- **Kinds**: music, installation, multimedia, collection. A collection is a
  meta project: EP, LP, single, compilation, multi-part composition. Vivarium's
  releases became collections ('album' became 'lp').
- **Mixes and references share the `audio` table** with a `role` column. Mixes
  are numbered per project; references are credited and unnumbered.
- **The current mix** is `music_projects.current_mix_id`; null means the newest.
  A trigger refuses a reference or another project's mix.
- **Study group**: Phase 2, the three studio members (VIG, KR, KJI).
- **Name**: Bottega, the Renaissance workshop that took commissions, kept the
  tools, trained apprentices and worked in stages. Chosen over Officina,
  Atelier, Athanor, Taller and Opificio.

## 3. Lessons from the build

- **Neon Auth accounts are made by a sign-up request**, never by the Console's
  "Create user", which sets no password:

      curl -X POST <origin>/api/auth/sign-up/email \
        -H 'Content-Type: application/json' -H 'Origin: <origin>' \
        -d '{"email":"…","password":"…","name":"…"}'

  Type the password in the terminal; do not paste the response anywhere, since
  it carries a session token.
- **Neon Auth trusts `localhost` only.** Every other address (the `.vercel.app`
  one, studio.sirsinate.com) must be added under Auth → Configuration →
  domains, or sign-in fails with what looks like a wrong password.
- **The sign-in form shows one message for every refusal.** The real cause is
  in the server log as `[sign-in] refused`.
- **Next 16**: route and page `params` are Promises (`await ctx.params`); the
  middleware file is `proxy.ts`.
- **Vercel saw `pipeline/requirements.txt` as a second app** and chose the
  Services preset, which needs a `vercel.json`. Import as a single Next.js
  project.
- **Git pushes over SSH** (`git@github.com:ziopads/bottega.git`). Over HTTPS
  macOS supplied a saved login for a different GitHub account.
- **Neon's HTTP driver** returns bigint and numeric as strings and timestamps
  as Date objects; `lib/studio.ts` converts every row (`num`, `iso`). Multi-
  statement writes use `sql.transaction([...])` or one statement with CTEs.
- **Migrations**: `db/NNN-*.sql`, safe to run twice, applied with
  `pipeline/.venv/bin/python3 pipeline/migrate.py`, which records checksums
  and refuses an edited applied file. Run `--status` before every deploy that
  reads a new column.
- **Claude's tooling on James's Mac**: a shell in a Linux VM over the connected
  folders. It cannot install npm packages (no registry access, and it would
  fetch Linux binaries), cannot delete files, and cannot reach Neon. James runs
  installs, migrations and git. The type check (`tsc`) does run in the VM.

## 4. Where things are

```
app/page.tsx                    Sessions (home)
app/projects/[id]/page.tsx      one music project
app/collections/…               collections list and detail
app/admin/lengths/              fill in missing mix lengths (admins)
app/_studio/                    client components ported from Vivarium
app/api/…                       projects, notes, genres, tracks (audio),
                                references, audio/[id]/duration, collections
lib/studio.ts                   all studio SQL
lib/studioTypes.ts              shapes and input rules shared with the browser
lib/studioAudio.ts, storage.ts  R2 signing
lib/auth/                       Neon Auth client and the allowlist guard
db/001-foundation.sql           the schema
pipeline/migrate.py             migration runner
scripts/migrate_from_vivarium.py  the one-time copy (done; keep for the record)
```

## 5. Open items

Phase 0 remainder:

1. Confirm studio.sirsinate.com serves Bottega and sign-in works there (Neon
   Auth domain added).
2. Run `/admin/lengths` on production and check the Length column.
3. Create accounts for Kamikaze Rabbit and Kawaji; add both addresses to
   `ALLOWED_EMAILS` in Vercel; check their `members` rows point at KR and KJI.
4. Retire the studio pages in Vivarium (`app/studio`, `app/api/studio`,
   `lib/studio*.ts`, the `studio` switch in `lib/instance.ts`). The
   `studio_*` tables in Supabase can stay as an archive.
5. A change-password page (Neon Auth's SDK; no email delivery is set up, so
   there is no reset).
6. Styling pass: `app/globals.css` holds Vivarium's token names with the
   Sirsinate palette.

Documentation drift to fix:

- `ARCHITECTURE.md` §9 lacks `ADMIN_EMAILS`; §4 should record the `audio.role`
  split as built, `current_mix_id`, and the `/api` paths.
- `REQUIREMENTS.md` §15 open decision 4 (gear in Vivarium) and 6 (domain) can
  be closed once checked.

Phase 1 (gear, corpus, connector) and the open decisions in `REQUIREMENTS.md`
§15: stage order for music, stages for collections, the element template (to
come from the track-components work in James's music production project),
embedding size.
