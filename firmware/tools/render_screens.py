#!/usr/bin/env python3
"""Render every screen the terminal can show, as PNG, for the README.

Reproduces ui_task.cpp pixel for pixel: 240x320 display (rotation 2), the
200x200 BMP centred above a 40 px footer, TFT_eSPI GLCD font (font 1,
5x7 in a 6x8 cell, text size 1 or 2), RGB565 colours, and the footer
rules of drawFooter(). Output is scaled 2x (nearest neighbour).

usage: render_screens.py <TFT_eSPI dir> [out dir]       (needs Pillow)
   e.g. render_screens.py ~/Arduino/libraries/TFT_eSPI
"""

import os
import re
import sys

from PIL import Image

W, H = 240, 320
FOOTER_H = 40                       # DISPLAY_FOOTER_HEIGHT
BRAND = "github.com/0leg19"         # FOOTER_BRAND
IP = "192.168.1.50"
NO_IP = "0.0.0.0"
SCALE = 2

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
IMAGES = os.path.join(ROOT, "images")


def c565(v):
    r, g, b = (v >> 11) & 0x1F, (v >> 5) & 0x3F, v & 0x1F
    return (r << 3 | r >> 2, g << 2 | g >> 4, b << 3 | b >> 2)


BLACK, WHITE = c565(0x0000), c565(0xFFFF)
CYAN, DARKGREY = c565(0x07FF), c565(0x7BEF)

# (file, icon, status text, ip shown in the footer, or None = no footer)
SCREENS = [
    # normal operation
    ("01_boot", "boot_logo", None, None),
    ("02_ready", "status_tap_card", IP, IP),
    ("03_checking", "status_waiting", "Checking access...", IP),
    ("04_granted", "status_success", "Access Granted", IP),
    ("05_denied", "status_fail", "Access Denied", IP),
    ("06_busy", "status_unknown", "Busy - tap again", IP),
    # network
    ("10_no_link", "status_no_internet", "No Network (check cable)", NO_IP),
    ("11_no_ip", "status_no_ip", "No IP (waiting for DHCP)", NO_IP),
    ("12_server_unreachable", "status_no_server", "Server unreachable - retrying", IP),
    ("13_connection_error", "status_no_server", "Connection Error", IP),
    ("14_tls_error", "status_no_server", "TLS Error (certificate?)", IP),
    ("15_server_error", "status_no_server", "Server Error (500)", IP),
    ("16_https_required", "status_no_server", "HTTPS required - reconfigure", IP),
    ("17_no_api_url", "status_no_server", "No API URL", IP),
    ("18_invalid_api_url", "status_no_server", "Invalid API URL", IP),
    # setup and maintenance
    ("20_needs_config", "status_setup", "Needs Config (App)", IP),
    ("21_setup_code", "status_unknown", "Setup code: 482913 (117s)", IP),
    ("22_wifi_setup", "status_unknown", "Wi-Fi setup: press BOOT, use app", "192.168.4.1"),
    ("23_reset_hint", "status_unknown", "Keep holding: factory reset", IP),
    ("24_factory_reset", "status_progress", "Factory reset - restarting", IP),
    ("25_ota", "status_progress", "Updating firmware...", IP),
    ("26_nfc_error", "status_fail", "NFC Error", IP),
]


def load_font(tft_dir):
    src = open(os.path.join(tft_dir, "Fonts", "glcdfont.c")).read()
    body = src[src.index("{") + 1:src.index("};")]
    return [int(x, 16) for x in re.findall(r"0x[0-9A-Fa-f]{2}", body)]


class Screen:
    def __init__(self, font):
        self.img = Image.new("RGB", (W, H), BLACK)
        self.px = self.img.load()
        self.font = font

    def fill(self, x, y, w, h, colour):
        for yy in range(max(0, y), min(H, y + h)):
            for xx in range(max(0, x), min(W, x + w)):
                self.px[xx, yy] = colour

    def text(self, s, x, y, size, fg, bg=BLACK):
        """TFT_eSPI drawChar for font 1 with a background colour."""
        for ch in s:
            code = ord(ch)
            self.fill(x, y, 6 * size, 8 * size, bg)
            for i in range(5):
                line = self.font[code * 5 + i]
                for j in range(8):
                    if line & 1:
                        self.fill(x + i * size, y + j * size, size, size, fg)
                    line >>= 1
            x += 6 * size

    def icon(self, name):
        bmp = Image.open(os.path.join(IMAGES, name + ".bmp")).convert("RGB")
        area_h = H - FOOTER_H
        scale = max(1, min(W // bmp.width, area_h // bmp.height))   # AUTO_SCALE_BMP
        if scale > 1:
            bmp = bmp.resize((bmp.width * scale, bmp.height * scale), Image.NEAREST)
        x0, y0 = (W - bmp.width) // 2, (area_h - bmp.height) // 2
        src = bmp.load()
        for y in range(bmp.height):
            for x in range(bmp.width):
                r, g, b = src[x, y]
                self.px[x0 + x, y0 + y] = c565(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))

    def footer(self, status, ip):
        """drawFooter() from ui_task.cpp."""
        top = H - FOOTER_H
        self.fill(0, top, W, FOOTER_H, BLACK)
        large, small = (W - 10) // 12, (W - 10) // 6
        if len(status) <= large:
            self.text(status, (W - len(status) * 12) // 2, top + 4, 2, WHITE)
        else:
            self.text(status[:small], 5, top + 3, 1, WHITE)
            if len(status) > small:
                self.text(status[small:2 * small], 5, top + 13, 1, WHITE)
        status_is_ip = status == ip
        if not status_is_ip:
            self.text("IP: " + ip, 5, top + 28, 1, CYAN)
        brand_w = len(BRAND) * 6
        self.text(BRAND, (W - brand_w) // 2 if status_is_ip else W - 5 - brand_w, top + 28, 1, DARKGREY)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    font = load_font(os.path.expanduser(sys.argv[1]))
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "docs", "display")
    os.makedirs(out, exist_ok=True)
    for name, icon, status, ip in SCREENS:
        scr = Screen(font)
        scr.icon(icon)
        if status is not None:
            scr.footer(status, ip)
        path = os.path.join(out, name + ".png")
        scr.img.resize((W * SCALE, H * SCALE), Image.NEAREST).save(path, optimize=True)
        print("wrote", path)


if __name__ == "__main__":
    main()
