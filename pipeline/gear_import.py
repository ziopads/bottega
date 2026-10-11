#!/usr/bin/env python3
"""Load gear from Bottega's import format into the catalogue and one account.

    pipeline/.venv/bin/python3 pipeline/gear_import.py ~/Desktop/sirsinate-hardware.bottega.csv --owner EMAIL
    ... add --apply to keep the result; without it everything is done inside a
    transaction and rolled back, so the database checks every row and nothing
    is kept.

The format is the one pipeline/gear_clean.py writes (its docstring lists the
columns): one row per unit. For each row:

  - The catalogue model (manufacturer + model, matched without regard to
    case) is found or added, approved. An existing model keeps what it has:
    the import only fills a category that is 'other' and years that are
    empty.
  - The row's capabilities are added to the model where the model has none
    for that key; existing values are left alone.
  - A unit is added to the owner's account, with its status, nickname and
    notes, and the owner-only record (serial, where bought, price paid,
    estimated value).

Run twice, it adds nothing the second time: for each model it adds only as
many units as the file has beyond those the owner already has. Rows without
a manufacturer or model are skipped and listed. documents_folder and
documents are for the document import and are not read here.

Runs as the owner role (DATABASE_URL_UNPOOLED), like every pipeline script.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

from dbconn import connect

STATUSES = {"owned", "wishlist", "gone"}
KINDS = {"hardware", "software", "book", "cable", "other"}
# Capability columns and how a cell becomes a value (db/003, db/005).
CAPABILITIES = {
    "form_factor": "list",
    "power": "list",
    "rack_units": "integer",
    "polyphony": "integer",
    "synthesis": "list",
    "effect_types": "list",
}


class RowError(Exception):
    pass


def year(v: str) -> int | None:
    v = v.strip()
    if not v:
        return None
    if not v.isdigit() or not 1900 <= int(v) <= 2200:
        raise RowError(f"year '{v}' is not four digits")
    return int(v)


def amount(v: str) -> float | None:
    v = v.strip()
    if not v:
        return None
    try:
        n = float(v)
    except ValueError:
        raise RowError(f"amount '{v}' is not a number") from None
    if n < 0:
        raise RowError(f"amount '{v}' is negative")
    return round(n, 2)


def capability(kind: str, cell: str):
    cell = cell.strip()
    if not cell:
        return None
    if kind == "list":
        return [p.strip() for p in cell.split(";") if p.strip()]
    if not cell.isdigit():
        raise RowError(f"'{cell}' is not a whole number")
    return int(cell)


def read(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("csv", type=Path)
    parser.add_argument("--owner", required=True, help="email of the account the units belong to")
    parser.add_argument("--apply", action="store_true", help="keep the result (otherwise roll back)")
    args = parser.parse_args()

    rows = read(args.csv)
    with connect() as conn, conn.cursor() as cur:
        added = run(cur, rows, args.owner.strip().lower())
        if args.apply and added == 0:
            conn.rollback()
            print("\nNothing to add; nothing was changed.")
        elif args.apply:
            conn.commit()
            print("\nApplied.")
        else:
            conn.rollback()
            print("\nDry run: nothing was kept. Add --apply to keep it.")


def run(cur, rows: list[dict], owner_email: str) -> int:
    # The format needs migration 005 (manufacturer, production years, estimated value).
    cur.execute(
        """select count(*) from information_schema.columns
           where (table_name, column_name) in (('gear_models', 'manufacturer'), ('gear_models', 'year_introduced'),
                                               ('gear_private', 'estimated_value'))"""
    )
    if cur.fetchone()[0] != 3:
        sys.exit("This database does not have migration 005 yet. Apply db/005-gear-fit.sql first.")

    cur.execute("select user_id, status from accounts where email = %s", (owner_email,))
    found = cur.fetchone()
    if not found:
        sys.exit(f"No account with the email {owner_email}.")
    owner, status = found
    if status != "active":
        sys.exit(f"{owner_email} is {status}; approve it first.")

    skipped: list[str] = []
    by_model: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for n, row in enumerate(rows, start=2):  # line 1 is the header
        manufacturer, model = row.get("manufacturer", "").strip(), row.get("model", "").strip()
        if not manufacturer or not model:
            skipped.append(f"line {n}: {manufacturer or '(no manufacturer)'} {model or '(no model)'}")
            continue
        row["_line"] = n
        by_model[(manufacturer.lower(), model.lower())].append(row)

    created_models = filled_models = added_caps = added_units = 0
    problems: list[str] = []

    for rows_for_model in by_model.values():
        first = rows_for_model[0]
        try:
            category = first["category"].strip() or "other"
            kind = first.get("kind", "").strip() or "hardware"
            if kind not in KINDS:
                raise RowError(f"kind '{kind}' is not one of {', '.join(sorted(KINDS))}")
            y_from, y_to = year(first["year_introduced"]), year(first["year_discontinued"])
            caps = {k: capability(t, first.get(k, "")) for k, t in CAPABILITIES.items()}
        except RowError as e:
            problems.append(f"line {first['_line']} ({first['manufacturer']} {first['model']}): {e}")
            continue

        # Each model in its own savepoint: a row the database refuses is
        # reported and skipped, and the rest of the import goes on.
        cur.execute("savepoint model")
        try:
            # The model: found, or added approved.
            cur.execute(
                """select id, category, year_introduced, year_discontinued from gear_models
                   where lower(manufacturer) = lower(%s) and lower(model) = lower(%s)""",
                (first["manufacturer"].strip(), first["model"].strip()),
            )
            existing = cur.fetchone()
            if existing:
                model_id, have_cat, have_from, have_to = existing
                if (have_cat == "other" and category != "other") or (have_from is None and y_from) or (have_to is None and y_to):
                    cur.execute(
                        """update gear_models set
                             category = case when category = 'other' then %s else category end,
                             year_introduced = coalesce(year_introduced, %s),
                             year_discontinued = coalesce(year_discontinued, %s)
                           where id = %s""",
                        (category, y_from, y_to, model_id),
                    )
                    filled_models += 1
            else:
                cur.execute(
                    """insert into gear_models (kind, category, manufacturer, model, year_introduced, year_discontinued, status)
                       values (%s, %s, %s, %s, %s, %s, 'approved') returning id""",
                    (kind, category, first["manufacturer"].strip(), first["model"].strip(), y_from, y_to),
                )
                model_id = cur.fetchone()[0]
                created_models += 1

            # Capabilities the model does not have yet.
            for key, value in caps.items():
                if value is None or value == []:
                    continue
                cur.execute(
                    """insert into model_capabilities (model_id, capability, value) values (%s, %s, %s::jsonb)
                       on conflict (model_id, capability) do nothing""",
                    (model_id, key, json.dumps(value)),
                )
                added_caps += cur.rowcount

            # Units beyond those the owner already has of this model.
            cur.execute("select count(*) from gear where owner_id = %s and model_id = %s", (owner, model_id))
            have = cur.fetchone()[0]
            for row in rows_for_model[have:]:
                try:
                    status = row["status"].strip() or "owned"
                    if status not in STATUSES:
                        raise RowError(f"status '{status}' is not owned, wishlist or gone")
                    price, value = amount(row.get("purchase_price", "")), amount(row.get("estimated_value", ""))
                except RowError as e:
                    problems.append(f"line {row['_line']} ({row['manufacturer']} {row['model']}): {e}")
                    continue
                cur.execute(
                    "insert into gear (owner_id, model_id, status, nickname, notes) values (%s, %s, %s, %s, %s) returning id",
                    (owner, model_id, status, row.get("nickname", "").strip(), row.get("notes", "").strip()),
                )
                gear_id = cur.fetchone()[0]
                # The private record exists already: db/003 creates it with the unit.
                cur.execute(
                    """update gear_private set serial = %s, purchased_from = %s, purchase_price = %s, estimated_value = %s
                       where gear_id = %s""",
                    (row.get("serial", "").strip(), row.get("purchased_from", "").strip(), price, value, gear_id),
                )
                added_units += 1
        except Exception as e:  # the database's refusal, worded by it
            cur.execute("rollback to savepoint model")
            problems.append(f"line {first['_line']} ({first['manufacturer']} {first['model']}): " + str(e).splitlines()[0])
            continue
        cur.execute("release savepoint model")

    print(f"models added: {created_models}; existing models filled in: {filled_models}")
    print(f"capabilities added: {added_caps}")
    print(f"units added to {owner_email}: {added_units}")
    if skipped:
        print(f"\nskipped, no manufacturer or model ({len(skipped)}):")
        for s in skipped:
            print(f"  {s}")
    if problems:
        print(f"\nnot imported ({len(problems)}):")
        for p in problems:
            print(f"  {p}")
    return created_models + filled_models + added_caps + added_units


if __name__ == "__main__":
    main()
