#!/usr/bin/env python3
"""
fetch_sprites.py — pull the Might & Magic 7 sprite sheets from
The Spriters Resource into ~/openworld/sprites/ as local placeholders.

Personal/hobby use behind bub's auth wall. We parse the section listing to map
each asset id -> human name, then grab each sheet PNG from /media/assets/.
Writes sprites/manifest.json (slug, name, file) for the app to consume.
"""

import html
import json
import re
import time
import urllib.request
from pathlib import Path

UA = ("Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")
SECTION = "https://www.spriters-resource.com/pc_computer/mnmvii/"
ORIGIN = "https://www.spriters-resource.com"
OUT = Path(__file__).resolve().parent / "sprites"


def get(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": SECTION})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read() if binary else r.read().decode("utf-8", "replace")


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def main():
    OUT.mkdir(exist_ok=True)
    page = get(SECTION)

    # Each tile: <a .../asset/ID/"> ... title="Name" ... <img src="/media/asset_icons/F/ID.png">
    # The full sheet lives at the same path with asset_icons -> assets.
    tiles = re.findall(
        r'/pc_computer/mnmvii/asset/(\d+)/".*?'
        r'iconheader"\s+title="([^"]*)".*?'
        r'<img src="(/media/asset_icons/[^"]+\.png)',
        page, re.DOTALL)
    seen, assets = set(), []
    for aid, name, icon in tiles:
        if aid in seen:
            continue
        seen.add(aid)
        img_path = icon.split("?")[0].replace("/asset_icons/", "/assets/")
        assets.append((aid, html.unescape(name).strip(), img_path))
    print(f"found {len(assets)} sheets")

    manifest = []
    for i, (aid, name, img_path) in enumerate(assets, 1):
        slug = slugify(name)
        dest = OUT / f"{slug}.png"
        try:
            data = get(ORIGIN + img_path, binary=True)
            dest.write_bytes(data)
            manifest.append({"slug": slug, "name": name,
                             "file": f"sprites/{slug}.png", "bytes": len(data)})
            print(f"  [{i}/{len(assets)}] {name} -> {dest.name} ({len(data)//1024} KB)")
        except Exception as e:
            print(f"  [{i}/{len(assets)}] {name}: ERROR {e}")
        time.sleep(0.4)  # be polite

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nwrote {len(manifest)} sheets + manifest.json to {OUT}")


if __name__ == "__main__":
    main()
