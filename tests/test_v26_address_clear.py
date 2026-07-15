from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
app = (ROOT / 'app.js').read_text(encoding='utf-8')
server_text = (ROOT / 'serve_trb.py').read_text(encoding='utf-8')
manifest = (ROOT / 'manifest.webmanifest').read_text(encoding='utf-8')
service_worker = (ROOT / 'service-worker.js').read_text(encoding='utf-8')

assert 'normalizeBarranquillaAddress' in app
assert 'fetchFinalGeocodeSuggestions' in app
assert 'clearSelectedJourneyFromMap' in app
assert "function showRouteSuggestionsPanel() {\n  clearSelectedJourneyFromMap();" in app
assert '/api/geocode' in server_text
assert 'normalize_colombian_address' in server_text
assert 'google_geocode_suggestions' in server_text
assert 'trb-v35' in manifest
assert 'trb-web-v35-transmetro-visible' in service_worker

spec = importlib.util.spec_from_file_location('serve_trb', ROOT / 'serve_trb.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.normalize_colombian_address('carreara 53 No. 64 - 28') == 'Carrera 53 # 64-28'
parts = module.colombian_address_parts('Cra 53 #64-28')
assert parts and parts['canonical'] == 'Carrera 53 # 64-28'
assert parts['intersection'] == 'Carrera 53 con Calle 64'
variants = module.address_query_variants('Carrera 53 No. 64 - 28')
assert any('Carrera 53 con Calle 64' in query and approximate for query, approximate in variants)
print('OK: v27 normaliza direcciones y limpia la ruta al volver.')
