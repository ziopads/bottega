#!/usr/bin/env python3
"""Turn the Vivarium-era hardware sheet into Bottega's gear import format.

    python3 pipeline/gear_clean.py ~/Desktop/sirsinate-hardware.csv
        writes ~/Desktop/sirsinate-hardware.bottega.csv beside it

    python3 pipeline/gear_clean.py IN.csv --out OUT.csv

The sheet was shaped for Vivarium's library schema (the author column holds
the manufacturer, the notes column holds "Type: … Category: … Market est. …").
This script maps it onto Bottega's two levels of gear (REQUIREMENTS §4,
db/003 and db/005) and writes one row per unit, in the format
pipeline/gear_import.py loads. Review the output in a spreadsheet first: the
`review` column says where a value was guessed or could not be read.

Nothing here touches the database. Standard library only.

THE IMPORT FORMAT (one row per unit; list cells are separated by ";")

    status              owned | wishlist | gone
    manufacturer        required
    model               required
    category            gear_models.category (db/005)
    kind                hardware | software | book | cable | other
    year_introduced     four digits
    year_discontinued   four digits; empty while still made
    form_factor         list: keyboard; desktop; rack; eurorack; pedal; …
    power               list: iec; fixed cord grounded; dc adapter; …
    rack_units          integer
    polyphony           integer (1 for monophonic)
    synthesis           list: analog subtractive; fm; sample playback; …
    effect_types        list: reverb; spring reverb; delay; …
    nickname            the unit's own name, if any
    serial              owner-only from here down
    purchased_from
    purchase_price      in US dollars
    estimated_value     in US dollars
    notes               anything else about the unit
    documents_folder    where its manuals are, for the document import
    documents           the files there, tagged [manual] [service] [firmware] [ref]
    review              why a person should look at this row; empty when clean
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

COLUMNS = [
    "status", "manufacturer", "model", "category", "kind", "year_introduced", "year_discontinued",
    "form_factor", "power", "rack_units", "polyphony", "synthesis", "effect_types",
    "nickname", "serial", "purchased_from", "purchase_price", "estimated_value", "notes",
    "documents_folder", "documents", "review",
]

FORM = {"rackmount": "rack", "keyboard": "keyboard", "desktop": "desktop", "pedal": "pedal"}

POWER = {
    "iec": "iec",
    "fixed, grounded": "fixed cord grounded",
    "fixed, ungrounded": "fixed cord ungrounded",
    "fixed,": "fixed cord",
    "fixed": "fixed cord",
    "dc": "dc adapter",
    "dc,": "dc adapter",
    "wall wart": "dc adapter",
    "custom, ungrounded": "custom",
    "iec, custom": "iec;custom",
}

# Category text (lowercased pieces) to effect types.
EFFECTS = {
    "delay": "delay", "reverb": "reverb", "spring reverb": "spring reverb", "chorus": "chorus",
    "phaser": "phaser", "ring modulator": "ring modulator", "filter": "filter",
    "analog delay": "analog delay", "tape": "tape delay", "slicer": "slicer", "gate": "gate",
    "vocal processor": "vocal processor", "3d spatializer": "spatializer", "multi-effects": "multi-effects",
}

# "Type:" values to categories, before the Category text refines them.
TYPES = {
    "fx": "effect", "signal processor": "effect", "fx, signal processor": "effect", "outboard": "effect",
    "utility device": "utility", "monitor speaker": "monitor", "sequencer": "sequencer",
    "patchbay": "patchbay", "midi patchbay": "midi utility", "midi utility": "midi utility",
    "tape machine": "recorder", "audio interface": "interface", "power": "power",
}

# Rows with no Type or Category on the sheet: category from what the thing
# is. Flagged for review all the same.
KNOWN = {
    ("arturia", "beatstep pro"): "sequencer",
    ("arturia", "keystep"): "controller",
    ("akai", "apc40"): "controller",
    ("akai", "mpc live ii"): "sampler",
    ("arturia", "spark"): "drum machine",
    ("behringer", "mono/poly"): "synthesizer",
    ("iconnectivity", "mioxl"): "midi utility",
    ("native instruments", "kontrol s8"): "controller",
    ("red sound", "soundbite micro"): "sampler",
    ("roland", "alpha juno 2"): "synthesizer",
    ("shure", "51s sonodyne"): "microphone",
    ("soma laboratory", "cosmos"): "effect",
    ("soma laboratory", "lyra-8"): "synthesizer",
    ("soma laboratory", "terra"): "synthesizer",
    ("strymon", "bigsky"): "effect",
    ("universal audio", "apollo x4"): "interface",
    ("universal audio", "apollo x8"): "interface",
    ("instruo", "troika"): "synthesizer",
}

# Names that say what a thing is when the sheet does not.
BY_NAME = [
    (r"oscilloscope|signal generator", "test equipment"),
    (r"cassette|reel|tape recorder", "recorder"),
    (r"power transformer|power conditioner", "power"),
    (r"patchbay|patching system", "patchbay"),
]


def lst(values) -> str:
    seen = []
    for v in values:
        for part in v.split(";"):
            part = part.strip()
            if part and part not in seen:
                seen.append(part)
    return ";".join(seen)


def parse_notes(notes: str) -> tuple[str, list[str], str, str]:
    """(type, category pieces, market estimate, anything else) from the notes column."""
    # "Type: X. Category: Y. Market est. Z. Anything else". The estimate can
    # be "?" or "???", so the fields are read by label, not split on full stops.
    m_type = re.search(r"Type:\s*([^.]*)", notes)
    m_cat = re.search(r"Category:\s*([^.]*)", notes)
    m_est = re.search(r"Market est\.\s*(\?+|[\d.,$]+)?\.?", notes)
    rest = notes
    for m in (m_type, m_cat, m_est):
        if m:
            rest = rest.replace(m.group(0), "")
    rest = re.sub(r"^[\s.]+|[\s.]+$", "", rest)
    rest = re.sub(r"\s*\.\s*\.\s*", ". ", rest)
    kind = m_type.group(1).strip() if m_type else ""
    cat = m_cat.group(1).strip() if m_cat else ""
    est = (m_est.group(1) or "").strip() if m_est else ""
    pieces = [c.strip() for c in cat.split(",") if c.strip()]
    return kind, pieces, est, rest


def category_for(type_: str, pieces: list[str], manufacturer: str, model: str, review: list[str]) -> str:
    low = [p.lower() for p in pieces]
    if (manufacturer.lower(), model.lower()) in KNOWN:
        review.append("category from what it is (no sheet data)")
        return KNOWN[(manufacturer.lower(), model.lower())]
    synthish = any(w in p for p in low for w in ("synthesizer", "drum machine", "sampler"))
    if type_.lower() == "sound module" or (not type_ and synthish):
        if any("drum machine" in p for p in low) and not any("synthesizer" in p for p in low):
            return "drum machine"
        if "sampler" in low:
            return "sampler"
        if "sequencer" in low and not any("synthesizer" in p for p in low):
            return "sequencer"
        return "synthesizer"
    if type_:
        if "pre-amp" in low:
            return "preamp"
        if "di" in low:
            return "utility"
        if "line mixer" in low:
            return "mixer"
        if "headphone amplifier" in low:
            return "amplifier"
        if "midi-cv converter" in low:
            return "midi utility"
        if type_.lower() in TYPES:
            return TYPES[type_.lower()]
    if any("headphone amplifier" in p for p in low):
        return "amplifier"
    if "line mixer" in low:
        return "mixer"
    if "midi-cv converter" in low:
        return "midi utility"
    for pattern, cat in BY_NAME:
        if re.search(pattern, f"{manufacturer} {model}", re.I):
            return cat
    review.append("category unknown")
    return "other"


def years(value: str, review: list[str]) -> tuple[str, str]:
    v = value.strip()
    if not v or v == "?":
        return "", ""
    m = re.fullmatch(r"(\d{4})-(\d{4}|current)", v)
    if m:
        return m.group(1), "" if m.group(2) == "current" else m.group(2)
    if re.fullmatch(r"\d{4}", v):
        return v, ""
    review.append(f"year '{v}' not read (a purchase date?)")
    return "", ""


def source(value: str) -> str:
    v = value.strip()
    if not v:
        return ""
    m = re.fullmatch(r"CL:?\s*(.*)", v)
    if m:
        return f"Craigslist ({m.group(1)})" if m.group(1) else "Craigslist"
    m = re.fullmatch(r"New:\s*(.*)", v)
    if m:
        return f"{m.group(1)} (new)"
    return v


def money(value: str, what: str, review: list[str], notes: list[str]) -> str:
    v = value.strip().lstrip("$").replace(",", "")
    if not v.strip("?"):
        return ""
    try:
        return f"{float(v):g}"
    except ValueError:
        notes.append(f"{what}: {value.strip()}")
        return ""


def clean(row: dict) -> dict:
    review: list[str] = []
    notes: list[str] = []
    manufacturer = row["author"].strip()
    model = row["title"].strip()
    folder = row["folder"].strip()
    status = "wishlist" if row["matchStatus"].startswith("sheet only - no data") else "owned"

    if not manufacturer and not model and folder:
        model = re.sub(r"[\[\]]", "", folder).strip().title()
        review.append("no manufacturer or model on the sheet: name it, or delete the row")
    elif not manufacturer:
        review.append("no manufacturer")
    if "pending" in row["matchStatus"]:
        review.append("serial and purchase details pending")

    type_, pieces, estimate, rest = parse_notes(row["notes"])
    # "One drive folder holds both units" was bookkeeping for the old sheet.
    rest = re.sub(r"One drive folder holds both units\.?\s*", "", rest).strip()
    if rest:
        notes.append(rest)
    low = [p.lower() for p in pieces]

    category = category_for(type_, pieces, manufacturer, model, review)
    y_from, y_to = years(row["year"], review)

    form = lst(FORM.get(f.strip().lower(), "") for f in row["format"].split(","))
    power_raw = row["power"].strip().lower()
    power = POWER.get(power_raw, "")
    if power_raw and not power:
        review.append(f"power '{row['power']}' not read")
    if power_raw == "custom, ungrounded":
        notes.append("power: custom, ungrounded")

    m = re.fullmatch(r"(\d+)U", row["dimensions"].strip())
    rack_units = m.group(1) if m else ""
    if rack_units and "rack" not in form:
        form = lst([form, "rack"])

    polyphony = "1" if "mono" in low else ""
    synthesis = lst(
        s
        for p, s in (("analog", "analog subtractive"), ("fm", "fm"), ("rompler", "sample playback"))
        if p in low and (category == "synthesizer" or (category == "drum machine" and p == "rompler"))
    )
    effects = lst(EFFECTS[p] for p in low if p in EFFECTS) if category == "effect" or any(p in EFFECTS for p in low) else ""

    estimated = money(estimate, "market estimate", review, notes)
    price = money(row["pricePaid"], "price paid", review, notes)

    return {
        "status": status,
        "manufacturer": manufacturer,
        "model": model,
        "category": category,
        "kind": "hardware",
        "year_introduced": y_from,
        "year_discontinued": y_to,
        "form_factor": form,
        "power": power,
        "rack_units": rack_units,
        "polyphony": polyphony,
        "synthesis": synthesis,
        "effect_types": effects,
        "nickname": "",
        "serial": row["serialNumber"].strip(),
        "purchased_from": source(row["source"]),
        "purchase_price": price,
        "estimated_value": estimated,
        "notes": ". ".join(notes),
        "documents_folder": folder,
        "documents": row["documentation"].strip(),
        "review": "; ".join(review),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    out = args.out or args.source.with_suffix(".bottega.csv")
    if out.resolve() == args.source.resolve():
        sys.exit("The output would overwrite the source.")

    with args.source.open(encoding="utf-8-sig", newline="") as f:
        rows = [clean(r) for r in csv.DictReader(f)]
    rows.sort(key=lambda r: (r["status"] != "owned", r["manufacturer"].lower() or "~", r["model"].lower()))
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)

    flagged = sum(1 for r in rows if r["review"])
    owned = sum(1 for r in rows if r["status"] == "owned")
    print(f"{len(rows)} units ({owned} owned, {len(rows) - owned} wishlist) written to {out}")
    print(f"{flagged} rows have something in the review column.")


if __name__ == "__main__":
    main()
