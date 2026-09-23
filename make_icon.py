"""Draw the Mashup Deck icon (the record from the favicon) as image files.

The installers call this with the app's own Python to give the launcher an
icon: icon.png for Linux, icon.icns for the Mac app, icon.ico for Windows.
Pure standard library, so it needs nothing extra installed.

    python make_icon.py OUTPUT_FOLDER
"""

import math
import os
import struct
import sys
import zlib

# same shapes and colours as the favicon in static/index.html (a 100x100 box)
DISC = (0x14, 0x0F, 0x0C)
RING = (0xFF, 0x7A, 0x2F)
DOT = (0xFF, 0xC2, 0x47)


def _clamp(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def _over(dst, rgb, a):
    """Paint colour rgb with coverage a over the premultiplied pixel dst."""
    r, g, b, da = dst
    return (rgb[0] * a + r * (1 - a), rgb[1] * a + g * (1 - a),
            rgb[2] * a + b * (1 - a), a + da * (1 - a))


def render(size):
    s = size / 100.0
    c = 50 * s
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter byte
        for x in range(size):
            d = math.hypot(x + 0.5 - c, y + 0.5 - c)
            px = (0.0, 0.0, 0.0, 0.0)
            px = _over(px, DISC, _clamp(48 * s - d + 0.5))
            px = _over(px, RING, _clamp(1.5 * s - abs(d - 32 * s) + 0.5)
                       * _clamp(48 * s - d + 0.5))
            px = _over(px, DOT, _clamp(10 * s - d + 0.5))
            r, g, b, a = px
            if a > 0:
                r, g, b = r / a, g / a, b / a
            row += bytes((int(r + 0.5), int(g + 0.5), int(b + 0.5), int(a * 255 + 0.5)))
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


def icns(pngs):
    # modern icns entries may hold PNG data directly
    kinds = {256: b'ic08', 512: b'ic09', 1024: b'ic10'}
    body = b''.join(kinds[n] + struct.pack('>I', len(p) + 8) + p for n, p in pngs.items() if n in kinds)
    return b'icns' + struct.pack('>I', len(body) + 8) + body


def ico(pngs):
    # Windows Vista and later read PNG images inside .ico files
    sizes = [n for n in (16, 32, 48, 256) if n in pngs]
    head = struct.pack('<HHH', 0, 1, len(sizes))
    offset = 6 + 16 * len(sizes)
    entries, data = b'', b''
    for n in sizes:
        p = pngs[n]
        entries += struct.pack('<BBBBHHII', n % 256, n % 256, 0, 0, 1, 32, len(p), offset + len(data))
        data += p
    return head + entries + data


def main(out):
    os.makedirs(out, exist_ok=True)
    pngs = {n: render(n) for n in (16, 32, 48, 256, 512, 1024)}
    with open(os.path.join(out, 'icon.png'), 'wb') as fh:
        fh.write(pngs[512])
    with open(os.path.join(out, 'icon.icns'), 'wb') as fh:
        fh.write(icns(pngs))
    with open(os.path.join(out, 'icon.ico'), 'wb') as fh:
        fh.write(ico(pngs))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
