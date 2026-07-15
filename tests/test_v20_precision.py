from pathlib import Path
import importlib.util

root = Path(__file__).resolve().parents[1]
js = (root / 'app.js').read_text(encoding='utf-8')
engine = (root / 'trb_motor_rutas.js').read_text(encoding='utf-8')
server_path = root / 'serve_trb.py'

assert 'const MAX_TRANSFER_WALK = 320;' in js
assert 'function officialGeometryForLeg' in js
assert 'async function ensureBusLegGeometry' in js
assert "networkRoute('car'" in js
assert "networkRoute('walk'" in js
assert "networkRoute('bike'" in js
assert 'leg.geometry = null;' in js
assert 'Trazado ajustado a la vía' in js
assert 'toleranceMeters = 60' in engine
assert '/api/network-route' in server_path.read_text(encoding='utf-8')

spec = importlib.util.spec_from_file_location('serve_trb_precision', server_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
points = module.parse_routing_points('-74.80,10.98;-74.79,10.99')
assert points == [(-74.8, 10.98), (-74.79, 10.99)]
try:
    module.parse_routing_points('-10,50;-74.79,10.99')
except ValueError:
    pass
else:
    raise AssertionError('Se aceptó un punto fuera de Barranquilla')
print('OK: geometrías oficiales, red vial, transbordos estrictos y protección contra líneas sobre edificios.')
