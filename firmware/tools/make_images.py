#!/usr/bin/env python3
"""Generate the display images in images/ (200x200, 24-bit BMP).

  * boot_logo.bmp: the "0leg19" wordmark.
  * Brand: every status_*.bmp gets the "0leg19" mark below the disc.
  * Network / setup screens, drawn in the style of the other images (dark
    disc, coloured ring, white glyph). The glyphs are technology-neutral,
    so they fit both the Ethernet and the Wi-Fi build:
        status_no_internet.bmp  no link (cable unplugged / no Wi-Fi)
        status_no_ip.bmp        link up, no IP address yet (DHCP)
        status_setup.bmp        network up, terminal not configured

usage: make_images.py [images-dir]      (needs Pillow)
"""

import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

S = 4                      # supersampling factor
SIZE = 200
CX, CY, R = 100, 67.5, 62  # disc centre and outer radius (matches the set)
RING = 6                   # ring width
DISC = (11, 18, 32)
WHITE = (255, 255, 255)

ORANGE = (249, 115, 22)
PINK = (236, 72, 153)
YELLOW = (234, 179, 8)
CYAN = (6, 182, 212)

BRAND = "0leg19"
BRAND_TOP = 140            # everything below the disc belongs to the brand

FONTS = [
    "/run/host/fonts/rsms-inter-fonts/InterDisplay-Bold.ttf",
    "/usr/share/fonts/rsms-inter-fonts/InterDisplay-Bold.ttf",
    "/usr/share/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf",
    "/run/host/fonts/liberation-sans-fonts/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def s(v):
    return v * S


def canvas():
    img = Image.new("RGB", (s(SIZE), s(140)), (0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([s(CX - R), s(CY - R), s(CX + R), s(CY + R)], fill=DISC)
    return img, d


def ring(d, colour):
    """Drawn last, so glyph ends (e.g. the slash) disappear under it."""
    d.ellipse([s(CX - R), s(CY - R), s(CX + R), s(CY + R)], outline=colour, width=s(RING))


def line(d, p, q, width, colour=WHITE):
    d.line([(s(p[0]), s(p[1])), (s(q[0]), s(q[1]))], fill=colour, width=round(s(width)))
    for x, y in (p, q):  # round caps
        d.ellipse([s(x - width / 2), s(y - width / 2), s(x + width / 2), s(y + width / 2)], fill=colour)


def node(d, cx, cy, w, h, colour=WHITE):
    d.rounded_rectangle([s(cx - w / 2), s(cy - h / 2), s(cx + w / 2), s(cy + h / 2)],
                        radius=s(3.5), fill=colour)


def network(d, ox=0.0, oy=0.0):
    """Three connected nodes: a generic network symbol."""
    top, bottom, left, right = CY - 22 + oy, CY + 22 + oy, CX - 27 + ox, CX + 27 + ox
    mid = CY + oy
    line(d, (CX + ox, top), (CX + ox, mid), 5)
    line(d, (left, mid), (right, mid), 5)
    line(d, (left, mid), (left, bottom), 5)
    line(d, (right, mid), (right, bottom), 5)
    node(d, CX + ox, top, 24, 18)
    node(d, left, bottom, 24, 18)
    node(d, right, bottom, 24, 18)


def slash(d, colour):
    a = math.radians(45)
    r = R - RING / 2
    p = (CX - r * math.cos(a), CY - r * math.sin(a))
    q = (CX + r * math.cos(a), CY + r * math.sin(a))
    line(d, p, q, 12, DISC)   # gap around the slash
    line(d, p, q, 6.5, colour)


def gear(d, colour=WHITE):
    teeth, r_out, r_in, hole = 8, 36, 27, 11
    pts = []
    for i in range(teeth * 4):
        ang = 2 * math.pi * i / (teeth * 4) - math.pi / 2
        r = r_out if i % 4 in (1, 2) else r_in
        pts.append((s(CX + r * math.cos(ang)), s(CY + r * math.sin(ang))))
    d.polygon(pts, fill=colour)
    d.ellipse([s(CX - r_in + 4), s(CY - r_in + 4), s(CX + r_in - 4), s(CY + r_in - 4)], fill=colour)
    d.ellipse([s(CX - hole), s(CY - hole), s(CX + hole), s(CY + hole)], fill=DISC)


def font(px):
    for path in FONTS:
        if os.path.exists(path):
            return ImageFont.truetype(path, s(px))
    sys.exit("no bold sans-serif font found; edit FONTS")


def ip_question(d):
    f = font(44)
    d.text((s(CX - 4), s(CY + 1)), "IP", font=f, fill=WHITE, anchor="rm")
    d.text((s(CX + 4), s(CY + 1)), "?", font=f, fill=PINK, anchor="lm")
    # dots: "waiting"
    for i in range(3):
        x = CX - 12 + 12 * i
        d.ellipse([s(x - 3.5), s(CY + 33 - 3.5), s(x + 3.5), s(CY + 33 + 3.5)], fill=WHITE)


def brand_strip():
    """The area below the disc: black with the centred brand mark."""
    img = Image.new("RGB", (s(SIZE), s(SIZE - BRAND_TOP)), (0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((s(CX), s(184 - BRAND_TOP)), BRAND, font=font(20), fill=WHITE, anchor="mm")
    return img.resize((SIZE, SIZE - BRAND_TOP), Image.LANCZOS)


def boot_logo():
    img = Image.new("RGB", (s(SIZE), s(SIZE)), (0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((s(CX), s(88)), BRAND, font=font(54), fill=WHITE, anchor="mm")
    d.rounded_rectangle([s(CX - 26), s(140), s(CX + 26), s(145)], radius=s(2.5), fill=CYAN)
    return img.resize((SIZE, SIZE), Image.LANCZOS)


def finish(top, base, out):
    # Nothing may stick out of the disc (e.g. the gap around the slash).
    mask = Image.new("L", top.size, 0)
    ImageDraw.Draw(mask).ellipse([s(CX - R), s(CY - R), s(CX + R), s(CY + R)], fill=255)
    top = Image.composite(top, Image.new("RGB", top.size, (0, 0, 0)), mask)
    small = top.resize((SIZE, 140), Image.LANCZOS)
    img = base.copy()
    img.paste(small, (0, 0))
    img.save(out, format="BMP")
    print("wrote", out)


def main():
    images = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..", "images")
    strip = brand_strip()
    base = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
    base.paste(strip, (0, BRAND_TOP))

    boot_logo().save(os.path.join(images, "boot_logo.bmp"), format="BMP")
    print("wrote", os.path.join(images, "boot_logo.bmp"))

    # Re-brand the hand-made status screens: replace everything below the disc.
    for name in sorted(os.listdir(images)):
        if name.startswith("status_") and name.endswith(".bmp"):
            path = os.path.join(images, name)
            img = Image.open(path).convert("RGB")
            img.paste(strip, (0, BRAND_TOP))
            img.save(path, format="BMP")

    img, d = canvas()
    network(d)
    slash(d, ORANGE)
    ring(d, ORANGE)
    finish(img, base, os.path.join(images, "status_no_internet.bmp"))

    img, d = canvas()
    ip_question(d)
    ring(d, PINK)
    finish(img, base, os.path.join(images, "status_no_ip.bmp"))

    img, d = canvas()
    gear(d)
    ring(d, YELLOW)
    finish(img, base, os.path.join(images, "status_setup.bmp"))


if __name__ == "__main__":
    main()
