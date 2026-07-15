#!/usr/bin/env python3
"""Genera TRB-Web-Demo.html usando los recursos actuales del proyecto."""
from __future__ import annotations
import base64, json, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
html = (ROOT / 'index.html').read_text(encoding='utf-8')
css = (ROOT / 'styles.css').read_text(encoding='utf-8')
app = (ROOT / 'app.js').read_text(encoding='utf-8')
engine = (ROOT / 'trb_motor_rutas.js').read_text(encoding='utf-8')
jszip = (ROOT / 'vendor/jszip.min.js').read_text(encoding='utf-8')
data = json.loads((ROOT / 'data/transit_data.json').read_text(encoding='utf-8'))
catalog = json.loads((ROOT / 'data/trb_catalogo_rutas.json').read_text(encoding='utf-8'))
icon = base64.b64encode((ROOT / 'icons/icon-192.png').read_bytes()).decode()
hero = base64.b64encode((ROOT / 'assets/trb-home-hero.jpg').read_bytes()).decode()
html = re.sub(r'\s*<link rel="manifest"[^>]+>\s*', '\n', html, count=1)
html = re.sub(r'<link rel="stylesheet" href="styles\.css\?v=\d+"\s*/?>', f'<style>\n{css}\n</style>', html, count=1)
html = html.replace('src="icons/icon-192.png"', f'src="data:image/png;base64,{icon}"')
html = html.replace('src="assets/trb-home-hero.jpg"', f'src="data:image/jpeg;base64,{hero}"')
html = html.replace('<link rel="apple-touch-icon" href="icons/icon-192.png" />', f'<link rel="apple-touch-icon" href="data:image/png;base64,{icon}" />')
html = html.replace('<link rel="icon" href="icons/icon-192.png" />', f'<link rel="icon" href="data:image/png;base64,{icon}" />')
embedded_data = json.dumps(data, ensure_ascii=False).replace('</', '<\\/')
embedded_catalog = json.dumps(catalog, ensure_ascii=False).replace('</', '<\\/')
html = re.sub(r'\s*<script src="vendor/jszip\.min\.js\?v=\d+"></script>', lambda _m: f'\n  <script>window.TRB_EMBEDDED_DATA={embedded_data};window.TRB_EMBEDDED_CATALOG={embedded_catalog};</script>\n  <script>{jszip}</script>', html, count=1)
html = re.sub(r'\s*<script src="trb_motor_rutas\.js\?v=\d+"></script>', lambda _m: f'\n  <script>{engine}</script>', html, count=1)
html = re.sub(r'\s*<script src="app\.js\?v=\d+" defer></script>', lambda _m: f'\n  <script>{app}</script>', html, count=1)
(ROOT / 'TRB-Web-Demo.html').write_text(html, encoding='utf-8')
print('Generado:', ROOT / 'TRB-Web-Demo.html')
