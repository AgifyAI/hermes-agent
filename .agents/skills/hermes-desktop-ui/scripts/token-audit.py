#!/usr/bin/env python3
"""List --linear-* tokens used in apps/desktop/src but defined nowhere; such a class renders nothing and no test sees it."""
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[4] / "apps/desktop/src"
TOKEN = re.compile(r"--linear-[a-z0-9-]*[a-z0-9]")
DEFINED = re.compile(r"(--linear-[a-z0-9-]+)\s*:")


def main() -> int:
    defined: set[str] = set()
    used: dict[str, str] = {}
    for path in SRC.rglob("*"):
        if path.suffix not in {".css", ".ts", ".tsx"}:
            continue
        text = path.read_text(errors="ignore")
        if path.suffix == ".css":
            defined.update(DEFINED.findall(text))
        for number, line in enumerate(text.splitlines(), 1):
            for token in TOKEN.findall(line):
                used.setdefault(token, f"{path.relative_to(SRC)}:{number}")
    missing = sorted(set(used) - defined)
    for token in missing:
        print(f"{token}  first used at {used[token]}")
    print(f"{len(used)} tokens used, {len(missing)} undefined")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
