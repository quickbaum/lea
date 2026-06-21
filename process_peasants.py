#!/usr/bin/env python3
"""
process_peasants.py — turn the raw MnM7 peasant sheets into clean billboard
textures: take one front-standing cell, key out the cyan background, autocrop
to the character, and save RGBA PNGs + a manifest the app can read.

MnM7 town NPCs are always-face-camera billboards (no 8-direction rotation),
so a single front frame per peasant is the correct placeholder.
"""

import json
from pathlib import Path
import numpy as np
from PIL import Image

SRC = Path(__file__).resolve().parent / "sprites"
OUT = SRC / "billboards"
CELL = 256                       # sheet grid cell size
PEASANTS = [
    "male-peasant-human-a", "female-peasant-human-a",
    "male-peasant-human-b", "female-peasant-human-b",
    "male-peasant-dwarf",   "female-peasant-dwarf",
    "male-peasant-elf",     "female-peasant-elf",
    "male-peasant-goblin",  "female-peasant-goblin",
]


def keyed(cell):
    """Make the background transparent. Key colour = the cell's corner pixel
    (cyan/yellow/green vary per sheet); remove anything close to it."""
    arr = np.asarray(cell).astype(int)               # H x W x 4
    key = arr[0, 0, :3]
    dist = np.sqrt(((arr[:, :, :3] - key) ** 2).sum(2))
    arr[dist < 90, 3] = 0                             # transparent where near key
    return Image.fromarray(arr.astype("uint8"), "RGBA")


def main():
    OUT.mkdir(exist_ok=True)
    manifest = []
    contact_cols, thumbs = len(PEASANTS), []
    for slug in PEASANTS:
        sheet = Image.open(SRC / f"{slug}.png").convert("RGBA")
        cell = sheet.crop((0, 0, CELL, CELL))        # row 0, col 0 = front stand
        cell = keyed(cell)
        bbox = cell.getbbox()
        if bbox:
            cell = cell.crop(bbox)
        cell.save(OUT / f"{slug}.png")
        manifest.append({"slug": slug, "file": f"sprites/billboards/{slug}.png",
                         "w": cell.width, "h": cell.height})
        print(f"  {slug:24} -> {cell.width}x{cell.height}")
        thumbs.append(cell)

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))

    # contact sheet for a quick visual check
    cw = max(t.width for t in thumbs); ch = max(t.height for t in thumbs)
    contact = Image.new("RGBA", (cw*contact_cols, ch), (40, 40, 60, 255))
    for i, t in enumerate(thumbs):
        contact.paste(t, (i*cw + (cw-t.width)//2, ch-t.height), t)
    contact.save("/tmp/peasants_contact.png")
    print(f"\nwrote {len(manifest)} billboards + contact sheet")


if __name__ == "__main__":
    main()
