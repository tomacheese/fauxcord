#!/usr/bin/env python3
"""Regenerates coverage-matrix.md from results/*.json.

Not part of the CI pipeline (manual/local use only); kept alongside the
harness so future contributors can re-run it after adding a verifier.
"""
import json
import sys
from pathlib import Path

COMPAT_DIR = Path(__file__).parent
STATUS_CELL = {
    "pass": "✅",
    "n-a": "N/A",
    "blocked": "⛔blocked",
    "fauxcord-fix": "❌→fix",
    "lib-issue": "❌→lib",
}


def main() -> None:
    endpoints = json.loads((COMPAT_DIR / "common" / "endpoints.json").read_text())
    libs = []
    for result_file in sorted((COMPAT_DIR / "results").glob("*.json")):
        data = json.loads(result_file.read_text())
        rows = {r["endpoint"]: r for r in data["results"]}
        libs.append((data["library"], rows))

    lines = []
    lines.append("# Library Compatibility Coverage Matrix")
    lines.append("")
    lines.append(
        "Generated from `results/*.json` by `gen-matrix.py`. "
        "Cell vocabulary: ✅ pass / N/A no high-level API / "
        "❌→fix Fauxcord bug fixed / ❌→lib library-side issue / "
        "⛔blocked cannot target Fauxcord at all."
    )
    lines.append("")
    header = "| Endpoint | " + " | ".join(name for name, _ in libs) + " |"
    sep = "| --- | " + " | ".join("---" for _ in libs) + " |"
    lines.append(header)
    lines.append(sep)
    for ep in endpoints:
        key = f"{ep['method']} {ep['path']}"
        cells = []
        for _, rows in libs:
            row = rows.get(key)
            if row is None:
                cells.append("-")
            else:
                cells.append(STATUS_CELL.get(row["status"], row["status"]))
        lines.append(f"| `{key}` | " + " | ".join(cells) + " |")

    lines.append("")
    lines.append("## Evidence notes")
    lines.append("")
    for name, rows in libs:
        notable = [
            (ep, r)
            for ep, r in rows.items()
            if r["status"] in ("n-a", "blocked", "lib-issue", "fauxcord-fix")
            and r.get("note")
        ]
        if not notable:
            continue
        lines.append(f"### {name}")
        lines.append("")
        for ep, r in notable:
            lines.append(f"- `{ep}` ({r['status']}): {r['note']}")
        lines.append("")

    out = COMPAT_DIR / "coverage-matrix.md"
    out.write_text("\n".join(lines) + "\n")
    print(f"wrote {out} ({len(endpoints)} rows x {len(libs)} libraries)")


if __name__ == "__main__":
    sys.exit(main())
