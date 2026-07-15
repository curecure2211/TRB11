from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
app = (ROOT / 'app.js').read_text(encoding='utf-8')
styles = (ROOT / 'styles.css').read_text(encoding='utf-8')
manifest = (ROOT / 'manifest.webmanifest').read_text(encoding='utf-8')
service_worker = (ROOT / 'service-worker.js').read_text(encoding='utf-8')

assert 'function openTransitLineDetails' in app
assert 'function resolveTransitLine' in app
assert 'data-transit-line-code' in app
assert "setRouteFocusMode(true, 'line')" in app
assert 'lineInfoBackHeaderHTML' in app
assert 'data-back-from-line' in app
assert 'function multimodalPlanPriority' in app
assert "busLegs === 1 && (plan.walkMinutes || 0) <= 15" in app
assert "(plan.transfers || 0) === 1" in app
assert 'ordenadas de menor a mayor tiempo' in app
assert '.app-shell.is-line-details .line-info-navigation' in styles
assert '.transit-line-link' in styles
assert 'trb-v35' in manifest
assert 'trb-web-v35-transmetro-visible' in service_worker
print('OK: la ficha de línea sigue activa y v25 ordena por tiempo.')
