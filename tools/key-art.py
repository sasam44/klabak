#!/usr/bin/env python3
"""
Turn the generated concept art into game assets.

The image generator returns flat magenta plates, which is exactly what we want:
a chroma key with nothing to feather. Two things need care:

1. the drop shadow the generator bakes under an object is *magenta-tinted*, so a
   plain distance-to-key test keeps it and the sprite ends up with a pink halo;
2. the same tint bleeds into the object's rim.

So the key here is hue-based (magenta == red and blue far above green) and it is
followed by a despill pass that pulls surviving magenta toward neutral.

usage: python3 tools/key-art.py            (expects art-raw/*.png, writes public/art)
"""
from __future__ import annotations

import pathlib

import numpy as np
from PIL import Image, ImageFilter

def _find_raw() -> pathlib.Path:
    """art-raw/ sits next to the repo (it is generator output, not shipped)."""
    for candidate in (pathlib.Path("art-raw"), pathlib.Path("../art-raw"), pathlib.Path("../../art-raw")):
        if candidate.is_dir():
            return candidate
    raise SystemExit("art-raw/ not found — put the generated source images there first")


RAW = _find_raw()
OUT = pathlib.Path("examples/klabak/public/art")

# How magenta a pixel is: both red and blue well above green. The subject is teal
# (green-dominant) or metal (neutral), so this separates cleanly.
MAGENTA_STRONG = 55.0
MAGENTA_SOFT = 22.0


def key_magenta(name: str, out: str, max_side: int, crop_top: float = 0.0) -> None:
    im = Image.open(RAW / name).convert("RGB")
    a = np.asarray(im).astype(np.float32)

    magentaness = np.minimum(a[:, :, 0], a[:, :, 2]) - a[:, :, 1]
    alpha = np.clip((MAGENTA_STRONG - magentaness) / (MAGENTA_STRONG - MAGENTA_SOFT), 0, 1)

    # despill: whatever magenta survives on the rim is pulled toward grey
    spill = magentaness > 6
    pull = np.clip((magentaness - 6) / 60, 0, 0.75)
    grey = (a[:, :, 0] + a[:, :, 1] + a[:, :, 2]) / 3.0
    for channel in (0, 2):
        a[:, :, channel] = np.where(spill, a[:, :, channel] * (1 - pull) + grey * pull, a[:, :, channel])

    rgba = np.dstack([np.clip(a, 0, 255), alpha * 255]).astype(np.uint8)
    sprite = Image.fromarray(rgba, "RGBA")
    bbox = sprite.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    sprite = sprite.crop(bbox)
    if crop_top:
        sprite = sprite.crop((0, int(sprite.height * crop_top), sprite.width, sprite.height))
    ratio = max_side / max(sprite.size)
    sprite = sprite.resize((round(sprite.width * ratio), round(sprite.height * ratio)), Image.LANCZOS)

    OUT.mkdir(parents=True, exist_ok=True)
    sprite.save(OUT / out, quality=90, method=6)
    coverage = (np.asarray(sprite.getchannel("A")) > 12).mean() * 100
    print(f"  {out:18s} {sprite.size[0]:4d}x{sprite.size[1]:<4d} {(OUT / out).stat().st_size / 1024:6.1f} KB  isi {coverage:4.1f}%")


def backdrop(name: str, out: str, width: int, blur: float, darken: float) -> None:
    """Blur it into bokeh and darken it here, not in CSS: the art is decoration,
    the interface on top of it has to stay crisp and legible."""
    im = Image.open(RAW / name).convert("RGB")
    im = im.resize((width, round(width * im.height / im.width)), Image.LANCZOS)
    im = im.filter(ImageFilter.GaussianBlur(blur))
    im = Image.eval(im, lambda v: int(v * darken))
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / out, quality=76, optimize=True, progressive=True)
    print(f"  {out:18s} {im.size[0]:4d}x{im.size[1]:<4d} {(OUT / out).stat().st_size / 1024:6.1f} KB")


if __name__ == "__main__":
    print("sprites:")
    key_magenta("4-capsule-magenta.png", "capsule.webp", 240)
    key_magenta("3-claw-magenta.png", "claw.webp", 280, crop_top=0.10)
    key_magenta("2-cabinet-magenta.png", "cabinet.webp", 620)
    print("backdrop:")
    backdrop("1-bg-arcade.png", "bg-arcade.jpg", 1440, blur=9, darken=0.52)
    print(f"total: {sum(p.stat().st_size for p in OUT.iterdir()) / 1024:.0f} KB in {OUT}")
