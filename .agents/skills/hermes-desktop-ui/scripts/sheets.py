#!/usr/bin/env python3
"""Build review sheets: uv run --no-project --with pillow python sheets.py <dir> <screen> [screen ...] [--phase after]."""
import sys
from pathlib import Path

from PIL import Image

CELL_WIDTH = 660
PER_SHEET = 3


def main() -> None:
    args = sys.argv[1:]
    phase = "after"
    if "--phase" in args:
        at = args.index("--phase")
        phase = args[at + 1]
        del args[at : at + 2]
    root, names = Path(args[0]), args[1:]
    out = root / "sheets"
    out.mkdir(exist_ok=True)
    for start in range(0, len(names), PER_SHEET):
        group = names[start : start + PER_SHEET]
        sheet = None
        for column, name in enumerate(group):
            for row, mode in enumerate(("light", "dark")):
                image = Image.open(root / f"{name}-{mode}-{phase}.png").convert("RGB")
                height = image.height * CELL_WIDTH // image.width
                image = image.resize((CELL_WIDTH, height))
                if sheet is None:
                    sheet = Image.new("RGB", ((CELL_WIDTH + 5) * PER_SHEET, (height + 6) * 2), (255, 0, 255))
                sheet.paste(image, (column * (CELL_WIDTH + 5), row * (height + 6)))
        target = out / f"sheet-{start // PER_SHEET:02d}.png"
        sheet.save(target)
        print(target, group)


if __name__ == "__main__":
    main()
