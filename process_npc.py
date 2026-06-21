#!/usr/bin/env python3
"""
process_npc.py — turn the raw MnM7 peasant sheets into clean animation atlases.

Each raw sheet is an 18x6 grid of 256px cells:
  rows 0..4 = 5 viewing directions  (front, front-3/4, side, back-3/4, back)
  row  5    = death/extras (ignored)
  col  0    = stand,  cols 9..17 = 9-frame walk cycle

We emit, per character, ONE atlas PNG laid out as 5 rows (directions) x 10 cols
([stand, walk0..walk8]), every frame cropped to a single shared window so the
feet stay anchored across frames. Background is keyed to transparent (per-sheet
corner colour). manifest.json describes the layout for the app.

Halo note: we leave keyed pixels fully transparent; the app uses nearest
filtering with NO mipmaps, so the keyed RGB never bleeds into edges.
"""

import json
from pathlib import Path
import numpy as np
from PIL import Image

SRC = Path(__file__).resolve().parent / "sprites"
OUT = SRC / "npc"
CELL = 256
DIRS = [0, 1, 2, 3, 4]                 # the 5 direction rows
COLS_SRC = [0] + list(range(9, 18))    # stand + 9 walk  -> 10 frames
NCOLS = len(COLS_SRC)                  # 10
NROWS = len(DIRS)                      # 5
PEASANTS = [
    "male-peasant-human-a", "female-peasant-human-a",
    "male-peasant-human-b", "female-peasant-human-b",
    "male-peasant-dwarf",   "female-peasant-dwarf",
    "male-peasant-elf",     "female-peasant-elf",
    "male-peasant-goblin",  "female-peasant-goblin",
]


def keyed_alpha(sheet):
    """RGBA array with background (corner colour) made transparent."""
    arr = np.asarray(sheet).astype(int)
    key = arr[0, 0, :3]
    dist = np.sqrt(((arr[:, :, :3] - key) ** 2).sum(2))
    arr[dist < 90, 3] = 0
    return arr.astype("uint8")


def union_window(arr):
    """One crop window (in cell-local coords) covering all selected frames,
    so every frame shares an origin and the feet line up."""
    x1, y1, x2, y2 = CELL, CELL, 0, 0
    for r in DIRS:
        for c in COLS_SRC:
            sub = arr[r*CELL:(r+1)*CELL, c*CELL:(c+1)*CELL, 3]
            ys, xs = np.nonzero(sub)
            if len(xs) == 0:
                continue
            x1 = min(x1, xs.min()); x2 = max(x2, xs.max()+1)
            y1 = min(y1, ys.min()); y2 = max(y2, ys.max()+1)
    return x1, y1, x2, y2


def main():
    OUT.mkdir(exist_ok=True)
    sprites = []
    for slug in PEASANTS:
        sheet = Image.open(SRC / f"{slug}.png").convert("RGBA")
        if sheet.size != (4608, 1536):
            print(f"  {slug}: unexpected size {sheet.size}, skipped"); continue
        arr = keyed_alpha(sheet)
        img = Image.fromarray(arr, "RGBA")
        x1, y1, x2, y2 = (int(v) for v in union_window(arr))
        fw, fh = x2-x1, y2-y1

        atlas = Image.new("RGBA", (fw*NCOLS, fh*NROWS), (0, 0, 0, 0))
        for ri, r in enumerate(DIRS):
            for ci, c in enumerate(COLS_SRC):
                fx, fy = c*CELL + x1, r*CELL + y1
                frame = img.crop((fx, fy, fx+fw, fy+fh))
                atlas.paste(frame, (ci*fw, ri*fh), frame)
        atlas.save(OUT / f"{slug}.png")
        sprites.append({"slug": slug, "file": f"sprites/npc/{slug}.png",
                        "frameW": fw, "frameH": fh})
        print(f"  {slug:24} frame {fw}x{fh}  atlas {atlas.width}x{atlas.height}")

    manifest = {"cols": NCOLS, "rows": NROWS, "standCol": 0,
                "walkStart": 1, "walkLen": NCOLS-1, "sprites": sprites}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nwrote {len(sprites)} atlases + manifest.json")


if __name__ == "__main__":
    main()
