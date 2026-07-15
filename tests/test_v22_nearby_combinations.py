from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = (root / 'app.js').read_text(encoding='utf-8')
manifest = (root / 'manifest.webmanifest').read_text(encoding='utf-8')
service_worker = (root / 'service-worker.js').read_text(encoding='utf-8')

assert 'MAX_ACCESS_WALK_EXPANDED = 3400' in app
assert 'MAX_EGRESS_WALK_EXPANDED = 5200' in app
assert 'MAX_TRANSFER_WALK_EXPANDED = 520' in app
assert 'function geocodeResultScore' in app
assert 'async function fetchGeocodeCandidates' in app
assert '`v31:${normalize(clean)}`' in app
assert 'function makeDoubleTransferPlan' in app
assert 'function findTwoTransferJourneyPlans' in app
assert 'expandedDirect' in app
assert 'expandedTransfers' in app
assert 'twoTransfers' in app
assert 'maximum = 420' in app
assert 'pathMeters / 140' in app
assert 'Buscando rutas cercanas y combinaciones' in app
assert 'trb-v35' in manifest
assert 'trb-web-v35-transmetro-visible' in service_worker

print('OK: geocodificación específica, rutas cercanas, cobertura ampliada y hasta dos transbordos v22.')
