from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
APP = (ROOT / "app.js").read_text(encoding="utf-8")
CSS = (ROOT / "styles.css").read_text(encoding="utf-8")
SW = (ROOT / "service-worker.js").read_text(encoding="utf-8")


def test_redundant_map_header_and_toolbar_are_removed():
    assert 'page-heading page-heading--map' not in HTML
    assert 'id="locateButton"' not in HTML
    assert 'id="clearMapButton"' not in HTML
    assert 'Recorrido claro y navegable' not in HTML
    assert 'Modo demostración' not in HTML
    assert 'id="mapRouteSelect"' in HTML and 'hidden' in HTML


def test_latest_route_selection_controls_map_and_zoom():
    assert 'mapDrawRequestId: 0' in APP
    assert 'const drawRequestId = ++state.mapDrawRequestId' in APP
    assert 'if (drawRequestId !== state.mapDrawRequestId) return;' in APP
    assert 'state.map.stop();' in APP
    assert 'state.map.fitBounds' in APP
    assert 'focused ? 470 : 400' not in APP


def test_route_suggestion_panel_is_larger_and_wraps_details():
    assert 'grid-template-columns:minmax(480px,520px)' in CSS
    assert '.map-planner-results { max-height:520px' in CSS
    assert 'white-space:normal' in CSS
    assert 'font-size:.67rem' in CSS


def test_cache_v31_compatibility():
    assert 'trb-web-v35-transmetro-visible' in SW
    assert 'app.js?v=35' in HTML
