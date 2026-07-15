#!/usr/bin/env python3
from __future__ import annotations
import tempfile
import zipfile
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from serve_trb import extract_geometry  # noqa: E402

KML = '''<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
<Placemark><name>Ida</name><LineString><coordinates>
-74.84,11.01,0 -74.82,11.00,0 -74.80,10.99,0 -74.78,10.98,0
</coordinates></LineString></Placemark>
<Placemark><name>Regreso</name><LineString><coordinates>
-74.78,10.98,0 -74.80,10.99,0 -74.82,11.00,0 -74.84,11.01,0
</coordinates></LineString></Placemark>
</Document></kml>'''

with tempfile.TemporaryDirectory() as directory:
    kmz = Path(directory) / 'route.kmz'
    with zipfile.ZipFile(kmz, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('doc.kml', KML)
    result = extract_geometry(kmz, {'id':'test','empresa':'TEST','ruta':'T1','nombre':'Ruta prueba','kmz':'TEST/T1.kmz'})
    assert result['ok'] is True
    assert len(result['paths']) == 2
    assert {path['direction'] for path in result['paths']} == {'ida','regreso'}
    assert all(path['distanceMeters'] > 100 for path in result['paths'])
    assert result['bounds'][0][0] < result['bounds'][1][0]
    assert result['geojson']['type'] == 'FeatureCollection'
    assert len(result['geojson']['features']) == 2
    assert all(feature['geometry']['type'] == 'LineString' for feature in result['geojson']['features'])
print('OK: conversión KMZ→geometría JSON, sentidos, distancia y límites validados.')
