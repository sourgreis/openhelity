#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Generate the application icon with no external dependencies.

Draws the HE30 layout — five rows of keys — in orange on a dark background.
The PNG is assembled by hand through zlib so that a single picture does not
drag in a graphics library.

    python3 tools/make-icon.py [web/icons]
"""
from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

BG = (0x14, 0x17, 0x1D)
KEY = (0xFF, 0x8A, 0x1F)
ROWS = (7, 6, 6, 6, 4)          # keys per row, as on the HE30
WIDE = {(4, 0): 1.0, (4, 3): 2.6}  # Ctrl normal, Space wide


def rounded(x: int, y: int, left: float, top: float, width: float,
            height: float, radius: float) -> bool:
    """Whether a point lies inside a rounded rectangle."""
    if not (left <= x < left + width and top <= y < top + height):
        return False
    for corner_x, corner_y in ((left + radius, top + radius),
                               (left + width - radius, top + radius),
                               (left + radius, top + height - radius),
                               (left + width - radius, top + height - radius)):
        inside_x = x < left + radius or x >= left + width - radius
        inside_y = y < top + radius or y >= top + height - radius
        if inside_x and inside_y:
            near = (abs(x - corner_x) < radius + 1 and abs(y - corner_y) < radius + 1)
            if near and (x - corner_x) ** 2 + (y - corner_y) ** 2 > radius ** 2:
                return False
    return True


def render(size: int) -> bytes:
    scale = size / 512
    pad = 78 * scale
    gap = 12 * scale
    unit = (size - 2 * pad - 6 * gap) / 7
    row_height = unit
    radius = 7 * scale

    # The layout is narrower than seven keys across and shorter vertically,
    # so centre the whole block instead of using equal margins.
    block_height = len(ROWS) * row_height + (len(ROWS) - 1) * gap
    block_width = 7 * unit + 6 * gap
    top_offset = (size - block_height) / 2
    left_offset = (size - block_width) / 2

    keys = []
    for row, count in enumerate(ROWS):
        cursor = left_offset
        for column in range(count):
            width = unit * WIDE.get((row, column), 1.0)
            keys.append((cursor, top_offset + row * (row_height + gap), width, row_height))
            cursor += width + gap

    rows = []
    for y in range(size):
        line = bytearray([0])  # PNG filter: none
        for x in range(size):
            colour = BG
            for left, top, width, height in keys:
                if rounded(x, y, left, top, width, height, radius):
                    colour = KEY
                    break
            line += bytes(colour)
        rows.append(bytes(line))
    return b"".join(rows)


def png(size: int) -> bytes:
    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit truecolor
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(render(size), 9))
            + chunk(b"IEND", b""))


def main() -> int:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "web/icons")
    out.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        path = out / f"icon-{size}.png"
        path.write_bytes(png(size))
        print(f"{path} — {path.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
