#!/usr/bin/env python3
"""1ファイル完結版を生成する。

CSS・JS・Leaflet・避難所/行政界データをすべて index.html に埋め込み、
dist/bousai-cop.html を出力する。サーバー不要＝ダブルクリックで開ける。

使い方: python3 scripts/build_single.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
OUT = DIST / "bousai-cop.html"

html = (ROOT / "index.html").read_text(encoding="utf-8")

leaflet_css = (ROOT / "vendor/leaflet/leaflet.css").read_text(encoding="utf-8")
style_css = (ROOT / "css/style.css").read_text(encoding="utf-8")
leaflet_js = (ROOT / "vendor/leaflet/leaflet.js").read_text(encoding="utf-8")
config_js = (ROOT / "js/config.js").read_text(encoding="utf-8")
app_js = (ROOT / "js/app.js").read_text(encoding="utf-8")

shelters = json.loads((ROOT / "data/shelters.geojson").read_text(encoding="utf-8"))
boundaries = json.loads((ROOT / "data/boundaries.geojson").read_text(encoding="utf-8"))

# sourceMappingURL は同梱しないので外す（コンソールの404ノイズ防止）
leaflet_js = leaflet_js.replace("//# sourceMappingURL=leaflet.js.map", "")

data_js = (
    "window.INLINE_SHELTERS = " + json.dumps(shelters, ensure_ascii=False, separators=(",", ":")) + ";\n"
    "window.INLINE_BOUNDARIES = " + json.dumps(boundaries, ensure_ascii=False, separators=(",", ":")) + ";"
)

replacements = [
    ('<link rel="stylesheet" href="vendor/leaflet/leaflet.css">', f"<style>\n{leaflet_css}\n</style>"),
    ('<link rel="stylesheet" href="css/style.css">', f"<style>\n{style_css}\n</style>"),
    ('<script src="vendor/leaflet/leaflet.js"></script>', f"<script>\n{leaflet_js}\n</script>"),
    ('<script src="js/config.js"></script>', f"<script>\n{config_js}\n</script>\n<script>\n{data_js}\n</script>"),
    ('<script src="js/app.js"></script>', f"<script>\n{app_js}\n</script>"),
]
for old, new in replacements:
    if old not in html:
        raise SystemExit(f"埋め込み対象が見つからない: {old}")
    html = html.replace(old, new)

DIST.mkdir(exist_ok=True)
OUT.write_text(html, encoding="utf-8")
print(f"generated: {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
