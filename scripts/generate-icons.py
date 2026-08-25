#!/usr/bin/env python3
# Generates the Progress Checker app icons from a simple checkmark mark on
# the app's dark background, using cairosvg (pip install cairosvg).
import os
import cairosvg

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")
os.makedirs(OUT_DIR, exist_ok=True)

BG = "#0f1109"
FG = "#5ba3c0"

FAVICON_SVG = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="{BG}"/><path d="M14 34 L26 46 L50 18" fill="none" stroke="{FG}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>'

ICON_SVG = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="{BG}"/><path d="M112 272 L208 368 L400 144" fill="none" stroke="{FG}" stroke-width="56" stroke-linecap="round" stroke-linejoin="round"/></svg>'

favicon_path = os.path.join(OUT_DIR, "favicon.svg")
with open(favicon_path, "w") as f:
    f.write(FAVICON_SVG)

for name, size in [("icon-192.png", 192), ("icon-512.png", 512), ("icon-512-maskable.png", 512), ("apple-touch-icon.png", 180)]:
    cairosvg.svg2png(bytestring=ICON_SVG.encode(), write_to=os.path.join(OUT_DIR, name), output_width=size, output_height=size)

print("Icons written to", OUT_DIR)
print(os.listdir(OUT_DIR))
