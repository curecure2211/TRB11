from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
required = [
    'index.html', 'styles.css', 'app.js', 'trb_motor_rutas.js', 'serve_trb.py',
    'data/transit_data.json', 'data/trb_catalogo_rutas.json', 'vendor/jszip.min.js',
    'manifest.webmanifest', 'service-worker.js', 'maps/trb-map-style.json', 'vendor/maplibre/maplibre-gl.js', 'vendor/maplibre/maplibre-gl.css', 'vendor/maplibre/leaflet-maplibre-gl.js'
]
for name in required:
    path = ROOT / name
    assert path.exists() and path.stat().st_size > 0, f'Falta {name}'

catalog = json.loads((ROOT / 'data/trb_catalogo_rutas.json').read_text(encoding='utf-8'))
transit = json.loads((ROOT / 'data/transit_data.json').read_text(encoding='utf-8'))
assert catalog['total_rutas'] == 93
assert catalog['total_empresas'] == 23
assert len(catalog['rutas']) == 93
assert len({route['id'] for route in catalog['rutas']}) == 93
assert len({route['kmz'] for route in catalog['rutas']}) == 93
assert len({route['empresa'] for route in catalog['rutas']}) == 23
assert all(route['localKmz'] == 'kmz/' + route['kmz'] for route in catalog['rutas'])
assert all(route['url_oficial'].startswith('https://www.ambq.gov.co/ruta-de-buses/') for route in catalog['rutas'])

main_routes = {(op['name'], route['code']) for op in transit['operators'] for route in op['routes']}
motor_routes = {(route['empresa'], route['ruta']) for route in catalog['rutas']}
assert main_routes == motor_routes, 'El catálogo visual y el motor no contienen las mismas 93 rutas'

html = (ROOT / 'index.html').read_text(encoding='utf-8')
assert html.index('vendor/jszip.min.js') < html.index('trb_motor_rutas.js') < html.index('app.js')
assert 'cdn.jsdelivr.net/npm/jszip' not in html
assert 'Motor KMZ · 93 rutas' in html
for element_id in ['mapTransportTabs','mapOperatorSelect','mapRouteQuickSelect','mapRouteQuickSearch','mapRouteQuickList','mapJourneyForm','mapJourneyOrigin','mapJourneyDestination','mapJourneyPickOrigin','mapJourneyPickDestination','mapJourneyUseLocation','mapJourneySubmit','mapJourneyResults','mapPickHint']:
    assert f'id="{element_id}"' in html, f'Falta control interactivo {element_id}'
assert 'styles.css?v=35' in html and 'app.js?v=35' in html

app = (ROOT / 'app.js').read_text(encoding='utf-8')
assert 'TRBRouteEngine.findBestRoutesDetailed' in app
assert 'routequilla' not in app.lower()
assert 'data/trb_catalogo_rutas.json' in app
assert 'handleMapJourneySubmit' in app
assert 'routeFamilyColorHex' in app
assert 'initializeMapRouteExplorer' in app
assert 'activateExplorerRoute' in app
assert len(transit['routes']) == 34

print('OK: estructura, 23 empresas, 93 rutas, enlaces y orden de scripts validados.')

assert 'render.yaml' in [p.name for p in ROOT.iterdir()]
assert 'Dockerfile' in [p.name for p in ROOT.iterdir()]
assert 'mapBootPlaceholder' in html
assert 'data-retry-map' in (ROOT / 'app.js').read_text(encoding='utf-8')

style = json.loads((ROOT / 'maps/trb-map-style.json').read_text(encoding='utf-8'))
assert style['version'] == 8
assert style['sources']['vector']['url'] == 'https://tiles.openfreemap.org/planet'
assert len(style['layers']) >= 80
assert 'helsinki' not in json.dumps(style.get('layers', [])).lower()
assert set(style['sources']) == {'vector'}
assert 'vendor/maplibre/maplibre-gl.js?v=33' in html
assert 'vendor/maplibre/leaflet-maplibre-gl.js?v=33' in html
assert 'https://unpkg.com/maplibre-gl' not in html
