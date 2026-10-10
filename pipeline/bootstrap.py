#!/usr/bin/env python3
"""Give accounts their administrator and their existing work (ARCHITECTURE §11).

    pipeline/.venv/bin/python3 pipeline/bootstrap.py --status
    pipeline/.venv/bin/python3 pipeline/bootstrap.py --admin EMAIL --artists VIG,ASU
    pipeline/.venv/bin/python3 pipeline/bootstrap.py --assign EMAIL --artists KR
    ... add --apply to write; without it, nothing is changed.

WHY THIS EXISTS

    Migration 002 gives every project an owner column, but the projects copied
    from Vivarium have none, and the first platform administrator cannot be
    approved through a page that needs an administrator. This script does both
    from James's machine, as the owner role, which row-level security does not
    restrict.

--admin EMAIL
    Activates the account with that email and makes it platform administrator.
    The account must exist, which it does once that person has signed in after
    the code reading accounts was deployed (they will have seen the pending
    page). Then does everything --assign does.

--assign EMAIL --artists CODES
    Gives the named artists to that account (it must be active: approve it at
    /admin/accounts first), and with them every project credited to those
    artists, and every collection credited to them or created by that email
    with no artist. Projects already owned by someone are left alone.

Both also fill the account columns that record who did what (created_by_id,
uploaded_by_id, author_id, set_by_id) wherever the Phase 0 email column holds
that account's email.

Every change is written to the access log with actor 'bootstrap': account
changes by the trigger on accounts, ownership by this script.

Reads DATABASE_URL_UNPOOLED (the owner role) like every pipeline script.
"""

from __future__ import annotations

import argparse
import json
import sys

from dbconn import connect


def account_by_email(cur, email: str):
    cur.execute("select user_id, status, is_platform_admin from accounts where email = %s", (email,))
    return cur.fetchone()


def status(cur) -> None:
    cur.execute("select email, status, is_platform_admin, user_id from accounts order by created_at")
    rows = cur.fetchall()
    print("accounts:")
    for email, st, admin, uid in rows or []:
        print(f"  {email:40} {st:9} {'admin' if admin else '':6} {uid}")
    if not rows:
        print("  (none: nobody has signed in since the accounts code was deployed)")
    cur.execute(
        """select a.code, coalesce(acc.email, '(no account)')
           from artists a left join accounts acc on acc.user_id = a.account_id order by a.code"""
    )
    print("artists:")
    for code, email in cur.fetchall():
        print(f"  {code:6} {email}")
    cur.execute(
        """select p.kind, coalesce(acc.email, '(no owner)'), count(*)
           from projects p left join accounts acc on acc.user_id = p.owner_id
           group by 1, 2 order by 1, 2"""
    )
    print("projects:")
    for kind, email, n in cur.fetchall():
        print(f"  {kind:11} {email:40} {n}")


def fill_attribution(cur, user_id: str, email: str) -> dict[str, int]:
    counts = {}
    for table, email_col, id_col in (
        ("projects", "created_by", "created_by_id"),
        ("audio", "uploaded_by", "uploaded_by_id"),
        ("notes", "author", "author_id"),
        ("project_titles", "set_by", "set_by_id"),
    ):
        cur.execute(
            f"update {table} set {id_col} = %s where {id_col} is null and lower({email_col}) = %s",
            (user_id, email),
        )
        counts[table] = cur.rowcount
    return counts


def assign(cur, user_id: str, email: str, codes: list[str]) -> dict:
    cur.execute("select code from artists where code = any(%s)", (codes,))
    found = {r[0] for r in cur.fetchall()}
    missing = [c for c in codes if c not in found]
    if missing:
        sys.exit(f"no artist with code {', '.join(missing)}")

    cur.execute(
        "select code from artists where code = any(%s) and account_id is not null and account_id <> %s",
        (codes, user_id),
    )
    taken = [r[0] for r in cur.fetchall()]
    if taken:
        sys.exit(f"artist {', '.join(taken)} already belongs to another account; change it by hand if that is intended")

    cur.execute("update artists set account_id = %s where code = any(%s)", (user_id, codes))
    artists = cur.rowcount

    cur.execute(
        """update projects p set owner_id = %s
           from music_projects m join artists a on a.id = m.artist_id
           where m.project_id = p.id and a.code = any(%s) and p.owner_id is null
           returning p.id""",
        (user_id, codes),
    )
    music = [r[0] for r in cur.fetchall()]

    cur.execute(
        """update projects p set owner_id = %s
           from collections c left join artists a on a.id = c.artist_id
           where c.project_id = p.id and p.owner_id is null
             and (a.code = any(%s) or (c.artist_id is null and lower(p.created_by) = %s))
           returning p.id""",
        (user_id, codes, email),
    )
    collections = [r[0] for r in cur.fetchall()]

    attribution = fill_attribution(cur, user_id, email)
    summary = {
        "artists": codes,
        "music_projects": len(music),
        "collections": len(collections),
        "attribution": attribution,
    }
    cur.execute(
        "select log_access('ownership_assigned', %s, null, null, null, %s::jsonb, %s)",
        (user_id, json.dumps(summary), "pipeline/bootstrap.py"),
    )
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    who = ap.add_mutually_exclusive_group()
    who.add_argument("--admin", metavar="EMAIL")
    who.add_argument("--assign", metavar="EMAIL")
    ap.add_argument("--artists", default="", help="comma-separated artist codes, e.g. VIG,ASU")
    ap.add_argument("--status", action="store_true")
    ap.add_argument("--apply", action="store_true", help="write the changes; without it, roll back")
    args = ap.parse_args()

    with connect() as conn, conn.cursor() as cur:
        # The access log's actor for everything this script changes.
        cur.execute("select set_config('app.actor', 'bootstrap', true)")

        if args.status or not (args.admin or args.assign):
            status(cur)
            conn.rollback()
            return

        email = (args.admin or args.assign).strip().lower()
        codes = [c.strip().upper() for c in args.artists.split(",") if c.strip()]
        row = account_by_email(cur, email)
        if not row:
            sys.exit(f"no account for {email}. Sign in once at the deployed site, then run this again.")
        user_id, st, _ = row

        if args.admin:
            cur.execute(
                """update accounts set status = 'active', is_platform_admin = true,
                          approved_at = coalesce(approved_at, now())
                   where user_id = %s""",
                (user_id,),
            )
            print(f"{email}: active, platform administrator")
        elif st != "active":
            sys.exit(f"{email} is {st}. Approve the account at /admin/accounts first.")

        if codes:
            summary = assign(cur, user_id, email, codes)
            print(f"{email}: {json.dumps(summary)}")
        else:
            print(f"{email}: no --artists given, so no work assigned")
            print(f"  attribution: {json.dumps(fill_attribution(cur, user_id, email))}")

        if args.apply:
            conn.commit()
            print("applied")
        else:
            conn.rollback()
            print("dry run: nothing written (add --apply)")
        status(cur)


if __name__ == "__main__":
    main()
