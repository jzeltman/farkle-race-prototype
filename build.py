#!/usr/bin/env python3
"""Bundle src/ into one self-contained index.html at the repo root (served by GitHub Pages).

Usage: python3 build.py
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"

page = (SRC / "index.html").read_text()
inlines = {
    '<link rel="stylesheet" href="style.css">': "<style>\n" + (SRC / "style.css").read_text() + "</style>",
    '<script src="engine.js"></script>': "<script>\n" + (SRC / "engine.js").read_text() + "</script>",
    '<script src="game.js"></script>': "<script>\n" + (SRC / "game.js").read_text() + "</script>",
}
for tag, inline in inlines.items():
    if tag not in page:
        raise SystemExit(f"build.py: expected {tag!r} in src/index.html")
    page = page.replace(tag, inline)

banner = "<!-- Built from src/ by build.py. Edit the files in src/, then run: python3 build.py -->\n"
(ROOT / "index.html").write_text(page.replace("<!doctype html>\n", "<!doctype html>\n" + banner, 1))
print("wrote index.html")
