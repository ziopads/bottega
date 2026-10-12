#!/usr/bin/env python3
"""Move a library document into its contributor's private documents.

    pipeline/.venv/bin/python3 pipeline/document_home.py --list
    pipeline/.venv/bin/python3 pipeline/document_home.py ID --private --kind book
    ... add --apply to write; without it, nothing is changed.

WHY THIS EXISTS

    A document's home (the platform library, or one account's private
    documents) cannot change in the app: db/004's documents_guard refuses it,
    so that an approved manual can never be taken out of the library by its
    contributor. A book uploaded to the library by mistake therefore needs the
    owner role, which the guard lets through. Its pages and chunks stay as
    they are, so nothing is processed again.

--list
    The library's documents: id, title, kind, contributor, state.

ID --private [--kind KIND]
    Makes document ID a private document of the account that contributed it,
    approved (private documents always are), with kind KIND if given (book,
    reference, other, or a library kind). Removes what only library documents
    may have: other accounts' picks of it (K-7) and its links to catalogue
    models. The move is written to the access log with actor
    'document_home'.

Reads DATABASE_URL_UNPOOLED (the owner role) like every pipeline script.
"""

from __future__ import annotations

import argparse
import sys

from dbconn import connect

KINDS = ("manual", "service", "firmware", "reference", "book", "other")


def list_library(cur) -> None:
    cur.execute(
        """select d.id, d.title, d.kind, coalesce(a.display_name, a.email, '?'), d.review_status, d.state, d.page_count
             from documents d left join accounts a on a.user_id = d.contributed_by
            where d.library order by d.id"""
    )
    rows = cur.fetchall()
    if not rows:
        print("The library is empty.")
    for r in rows:
        print(f"{r[0]:>5}  {r[1]}  [{r[2]}]  by {r[3]}  · {r[4]} · {r[5]} · {r[6] or '?'} pages")


def move(cur, doc_id: int, kind: str | None, apply: bool) -> None:
    cur.execute(
        "select id, title, kind, library, contributed_by, sha256 from documents where id = %s for update",
        (doc_id,),
    )
    row = cur.fetchone()
    if not row:
        sys.exit(f"No document {doc_id}.")
    _, title, old_kind, library, owner, sha = row
    if not library:
        sys.exit(f"Document {doc_id} ({title}) is already private.")
    if not owner:
        sys.exit(f"Document {doc_id} ({title}) has no contributor on record, so it has no one to belong to.")
    cur.execute("select id from documents where not library and owner_id = %s and sha256 = %s", (owner, sha))
    twin = cur.fetchone()
    if twin:
        sys.exit(f"The contributor already has this file as private document {twin[0]}; delete one of the two instead.")
    new_kind = kind or old_kind

    cur.execute("select count(*) from library_picks where document_id = %s", (doc_id,))
    picks = cur.fetchone()[0]
    cur.execute(
        "select m.manufacturer || ' ' || m.model from model_documents md join gear_models m on m.id = md.model_id where md.document_id = %s",
        (doc_id,),
    )
    links = [r[0] for r in cur.fetchall()]

    print(f"Document {doc_id}: {title}")
    print(f"  library -> private document of {owner}; kind {old_kind} -> {new_kind}")
    print(f"  picks by other accounts removed: {picks}")
    print(f"  links to catalogue models removed: {', '.join(links) if links else 'none'}")
    if not apply:
        print("Nothing changed. Add --apply to write.")
        return

    cur.execute("select set_config('app.actor', 'document_home', true)")
    cur.execute("delete from library_picks where document_id = %s", (doc_id,))
    cur.execute("delete from model_documents where document_id = %s", (doc_id,))
    cur.execute(
        """update documents set library = false, owner_id = contributed_by, review_status = 'approved', kind = %s
            where id = %s""",
        (new_kind, doc_id),
    )
    cur.execute(
        """select log_access('document_moved', %s, 'document', %s,
                  jsonb_build_object('library', true, 'kind', %s::text),
                  jsonb_build_object('library', false, 'kind', %s::text),
                  'uploaded to the library by mistake')""",
        (owner, doc_id, old_kind, new_kind),
    )
    print("Moved.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id", nargs="?", type=int)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--kind", choices=KINDS)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    if not args.list and not (args.id and args.private):
        ap.error("give --list, or an ID with --private")

    with connect() as conn:
        with conn.cursor() as cur:
            if args.list:
                list_library(cur)
            else:
                move(cur, args.id, args.kind, args.apply)
        if args.apply:
            conn.commit()
        else:
            conn.rollback()


if __name__ == "__main__":
    main()
