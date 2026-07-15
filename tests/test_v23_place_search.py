from __future__ import annotations

import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
app = (ROOT / 'app.js').read_text(encoding='utf-8')
server_text = (ROOT / 'serve_trb.py').read_text(encoding='utf-8')
manifest = (ROOT / 'manifest.webmanifest').read_text(encoding='utf-8')

assert 'Universidad del Atlántico — Sede Norte' in app
assert 'Uniatlantico' in app and 'Ciudadela Universitaria' in app
assert 'fetchOnlinePlaceSuggestions' in app
assert 'api/place-suggestions' in app
assert 'loadOnlineLocationSuggestions' in app
assert 'locationSuggestionOnlineTimer' in app
assert "$('#journeyOrigin'), $('#journeyDestination')" in app
assert 'journeyOriginSuggestions' in (ROOT / 'index.html').read_text(encoding='utf-8')
assert 'trb-v35' in manifest
assert 'PHOTON_URL' in server_text
assert 'photon_feature_to_item' in server_text
assert 'decoded_path == "/api/place-suggestions"' in server_text

import importlib.util
spec = importlib.util.spec_from_file_location('serve_trb_v23', ROOT / 'serve_trb.py')
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

payload = {
    'features': [
        {
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [-74.8737, 11.0189]},
            'properties': {
                'name': 'Universidad del Atlántico',
                'city': 'Puerto Colombia',
                'state': 'Atlántico',
                'osm_key': 'amenity',
                'osm_value': 'university',
            },
        },
        {
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [-74.806, 10.99]},
            'properties': {
                'name': 'Hospital de prueba',
                'city': 'Barranquilla',
                'osm_key': 'amenity',
                'osm_value': 'hospital',
            },
        },
    ]
}

class FakeResponse:
    status = 200
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self):
        return json.dumps(payload).encode('utf-8')

with tempfile.TemporaryDirectory() as temp_dir:
    module.GEOCODER_CACHE_ROOT = Path(temp_dir)
    with patch.object(module.urllib.request, 'urlopen', return_value=FakeResponse()):
        result = module.place_suggestions('Universidad del Atlantico', 8)

assert result['ok'] is True
assert result['items']
first = result['items'][0]
assert first['label'] == 'Universidad del Atlántico'
assert first['type'] == 'Universidad'
assert first['icon'] == '▤'
assert abs(first['lat'] - 11.0189) < 1e-6
assert abs(first['lng'] + 74.8737) < 1e-6
print('OK: buscador v23 reconoce lugares, categorías y Universidad del Atlántico.')
