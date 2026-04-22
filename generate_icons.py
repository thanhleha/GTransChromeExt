#!/usr/bin/env python3
"""Generate PNG icons for the extension. No external dependencies required."""
import struct, zlib, os

def make_png(size):
    """Create a Google-blue square PNG with a white 'G' hint."""
    w = h = size

    # Build RGBA pixels: blue background with simple white cross-like mark
    pixels = []
    cx, cy = w // 2, h // 2
    r_outer = int(w * 0.38)
    r_inner = int(w * 0.22)
    stroke = max(1, w // 16)

    for y in range(h):
        row = []
        for x in range(w):
            dx, dy = x - cx, y - cy
            dist = (dx*dx + dy*dy) ** 0.5
            # Blue circle background
            if dist <= r_outer:
                # White ring stripe at top-right (mimics translate arrows)
                if (dist >= r_inner and dist <= r_inner + stroke and dx >= 0 and dy <= 0):
                    row += [255, 255, 255, 255]  # white arc
                # White horizontal bar (right half, middle)
                elif (abs(dy) <= stroke and dx >= 0 and dist <= r_outer - stroke):
                    row += [255, 255, 255, 255]
                else:
                    row += [66, 133, 244, 255]   # Google blue
            else:
                row += [0, 0, 0, 0]              # transparent
        pixels.append(bytes(row))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    scanlines = b''.join(b'\x00' + row for row in pixels)
    sig   = b'\x89PNG\r\n\x1a\n'
    ihdr  = chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    idat  = chunk(b'IDAT', zlib.compress(scanlines, 9))
    iend  = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


os.makedirs('icons', exist_ok=True)
for size in [16, 48, 128]:
    path = f'icons/icon{size}.png'
    with open(path, 'wb') as f:
        f.write(make_png(size))
    print(f'Created {path}  ({size}x{size})')

print('Icons generated successfully.')
