#!/usr/bin/env python3
"""Copy the studio from Vivarium's Sirsinate database (Supabase) into Bottega
(Neon). Phase 0, step 3; run once, then retire.

    pipeline/.venv/bin/python3 scripts/migrate_from_vivarium.py
    pipeline/.venv/bin/python3 scripts/migrate_from_vivarium.py --email owner@example.com=new@example.com
    pipeline/.venv/bin/python3 scripts/migrate_from_vivarium.py --email ... --apply

Without --apply it reads both sides, prints what it would write, and writes
nothing. With --apply everything is written in ONE transaction on Neon, the
counts are checked inside that transaction, and any mismatch rolls the whole
copy back. Vivarium is only ever read.

Refuses to run against a Bottega database that already holds projects: this is
a copy into an empty database, never a merge.

SOURCE AND TARGET

    VIVARIUM_DB_URL        the Sirsinate instance's Postgres connection string
                           (its SUPABASE_DB_URL). Put it in .env.local for the
                           run and remove it afterwards.
    DATABASE_URL_UNPOOLED  Bottega, as for every pipeline script.

    Nothing here prints either string.

WHAT GOES WHERE (ARCHITECTURE.md §7)

    studio_artists         -> artists
    studio_members         -> members            (emails remapped by --email)
    studio_genres          -> genres
    studio_projects        -> projects (music) + music_projects
    studio_project_names   -> project_titles
    studio_tracks          -> audio (role 'mix'); R2 keys unchanged
    studio_notes           -> notes
    studio_releases        -> projects (collection) + collections ('album' -> 'lp')
    studio_release_tracks  -> project_parts

    Ids are new on the Bottega side; old ids are mapped as rows are written.
    Every email column (created_by, set_by, uploaded_by, author, members) goes
    through the same --email map, so a person keeps their history under the
    address they now sign in with.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
from dbconn import connect, env_value  # noqa: E402

FORMS = {"album": "lp", "ep": "ep", "single": "single", "compilation": "compilation", "other": "other"}

SOURCE_COUNTS = {
    "artists": "select count(*) from studio_artists",
    "members": "select count(*) from studio_members",
    "genres": "select count(*) from studio_genres",
    "music projects": "select count(*) from studio_projects",
    "titles": "select count(*) from studio_project_names",
    "mixes": "select count(*) from studio_tracks",
    "notes": "select count(*) from studio_notes",
    "collections": "select count(*) from studio_releases",
    "parts": "select count(*) from studio_release_tracks",
}

TARGET_COUNTS = {
    "artists": "select count(*) from artists",
    "members": "select count(*) from members",
    "genres": "select count(*) from genres",
    "music projects": "select count(*) from music_projects",
    "titles": "select count(*) from project_titles",
    "mixes": "select count(*) from audio where role = 'mix'",
    "notes": "select count(*) from notes",
    "collections": "select count(*) from collections",
    "parts": "select count(*) from project_parts",
}


def parse_emails(pairs: list[str]) -> dict[str, str]:
    out = {}
    for pair in pairs:
        if "=" not in pair:
            sys.exit(f"--email takes OLD=NEW, got {pair!r}")
        old, new = (s.strip().lower() for s in pair.split("=", 1))
        if not old or not new:
            sys.exit(f"--email takes OLD=NEW, got {pair!r}")
        out[old] = new
    return out


def source_connect():
    url = env_value("VIVARIUM_DB_URL")
    if not url:
        sys.exit("VIVARIUM_DB_URL is not set and was not found in .env.local")
    import psycopg
    return psycopg.connect(url)


def counts(cur, queries: dict[str, str]) -> dict[str, int]:
    out = {}
    for name, query in queries.items():
        cur.execute(query)
        out[name] = cur.fetchone()[0]
    return out


def read_source(cur) -> dict[str, list[tuple]]:
    q = {
        "artists": "select id, code, name from studio_artists order by id",
        "members": "select email, artist_id from studio_members order by email",
        "genres": "select name from studio_genres order by name",
        "projects": """select id, artist_id, canonical_id, working_name, rating, genre, bpm,
                              created_by, created_at
                       from studio_projects order by id""",
        "titles": "select project_id, name, set_by, set_at from studio_project_names order by id",
        "tracks": """select id, project_id, version, r2_key, original_filename, bytes, duration_s,
                            uploaded_by, uploaded_at
                     from studio_tracks order by id""",
        "notes": """select project_id, track_id, author, body, created_at, edited_at
                    from studio_notes order by id""",
        "releases": """select id, title, kind, artist_id, year, notes, created_by, created_at
                       from studio_releases order by id""",
        "release_tracks": "select release_id, project_id, position from studio_release_tracks",
    }
    data = {}
    for name, query in q.items():
        cur.execute(query)
        data[name] = cur.fetchall()
    return data


def write(cur, data: dict[str, list[tuple]], email) -> None:
    artist = {}
    for old_id, code, name in data["artists"]:
        cur.execute(
            "insert into artists (code, name) values (%s, %s) returning id",
            (code.strip().upper(), name.strip()),
        )
        artist[old_id] = cur.fetchone()[0]

    for addr, old_artist in data["members"]:
        cur.execute(
            "insert into members (email, artist_id) values (%s, %s)",
            (email(addr), artist[old_artist]),
        )

    for (name,) in data["genres"]:
        cur.execute("insert into genres (name) values (%s)", (name,))

    project = {}
    for (old_id, old_artist, canonical, working, rating, genre, bpm,
         created_by, created_at) in data["projects"]:
        cur.execute(
            """insert into projects (kind, title, rating, created_by, created_at)
               values ('music', %s, %s, %s, %s) returning id""",
            ((working or "").strip(), rating, email(created_by), created_at),
        )
        new_id = cur.fetchone()[0]
        project[old_id] = new_id
        cur.execute(
            """insert into music_projects (project_id, artist_id, canonical_id, genre, bpm)
               values (%s, %s, %s, %s, %s)""",
            (new_id, artist[old_artist], canonical, genre, bpm),
        )

    for old_project, name, set_by, set_at in data["titles"]:
        cur.execute(
            "insert into project_titles (project_id, title, set_by, set_at) values (%s, %s, %s, %s)",
            (project[old_project], name, email(set_by), set_at),
        )

    track = {}
    for (old_id, old_project, version, key, filename, size, duration,
         uploaded_by, uploaded_at) in data["tracks"]:
        cur.execute(
            """insert into audio (project_id, role, version, r2_key, original_filename, bytes,
                                  duration_s, uploaded_by, uploaded_at)
               values (%s, 'mix', %s, %s, %s, %s, %s, %s, %s) returning id""",
            (project[old_project], version, key, filename, size, duration,
             email(uploaded_by), uploaded_at),
        )
        track[old_id] = cur.fetchone()[0]

    for old_project, old_track, author, body, created_at, edited_at in data["notes"]:
        cur.execute(
            """insert into notes (project_id, audio_id, author, body, created_at, edited_at)
               values (%s, %s, %s, %s, %s, %s)""",
            (project[old_project], track.get(old_track) if old_track else None,
             email(author), body, created_at, edited_at),
        )

    release = {}
    for (old_id, title, kind, old_artist, year, notes,
         created_by, created_at) in data["releases"]:
        cur.execute(
            """insert into projects (kind, title, created_by, created_at)
               values ('collection', %s, %s, %s) returning id""",
            (title, email(created_by), created_at),
        )
        new_id = cur.fetchone()[0]
        release[old_id] = new_id
        cur.execute(
            """insert into collections (project_id, form, artist_id, year, notes)
               values (%s, %s, %s, %s, %s)""",
            (new_id, FORMS[kind], artist.get(old_artist) if old_artist else None, year, notes),
        )

    for old_release, old_project, position in data["release_tracks"]:
        cur.execute(
            "insert into project_parts (parent_id, child_id, position) values (%s, %s, %s)",
            (release[old_release], project[old_project], position),
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", action="append", default=[], metavar="OLD=NEW",
                        help="sign-in address changes; repeatable")
    parser.add_argument("--apply", action="store_true", help="write to Bottega")
    args = parser.parse_args()
    emails = parse_emails(args.email)

    def email(addr: str | None) -> str | None:
        if addr is None:
            return None
        key = addr.strip().lower()
        return emails.get(key, key)

    with source_connect() as src, src.cursor() as cur:
        expected = counts(cur, SOURCE_COUNTS)
        data = read_source(cur)
        seen = sorted({email(r[0]) for r in data["members"]}
                      | {email(r[7]) for r in data["projects"]}
                      | {email(r[7]) for r in data["tracks"]}
                      | {email(r[2]) for r in data["notes"]})

    print("  Vivarium (Sirsinate):")
    for name, n in expected.items():
        print(f"    {name:<15} {n}")
    print("\n  Addresses as they will be written:")
    for addr in seen:
        print(f"    {addr}")
    for old in emails:
        if old not in {r[0].lower() for r in data["members"]}:
            print(f"\n  ! --email {old}=... names an address that is not a Vivarium member")

    with connect() as dst:
        with dst.cursor() as cur:
            cur.execute("select count(*) from projects")
            if cur.fetchone()[0]:
                sys.exit("\n  Bottega already holds projects. This copies into an empty database only.")

        if not args.apply:
            print("\n  Dry run: nothing written. Add --apply to copy.")
            return

        with dst.transaction():
            with dst.cursor() as cur:
                write(cur, data, email)
                got = counts(cur, TARGET_COUNTS)
                wrong = {k: (expected[k], got[k]) for k in expected if expected[k] != got[k]}
                if wrong:
                    for k, (want, have) in wrong.items():
                        print(f"  ! {k}: Vivarium {want}, Bottega {have}")
                    raise SystemExit("\n  Counts differ; the transaction is rolled back. Nothing was written.")

    print("\n  Copied. Bottega now holds:")
    for name, n in got.items():
        print(f"    {name:<15} {n}")


if __name__ == "__main__":
    main()
