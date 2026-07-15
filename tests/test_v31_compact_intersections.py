from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / 'app.js').read_text(encoding='utf-8')
CSS = (ROOT / 'styles.css').read_text(encoding='utf-8')
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
SW = (ROOT / 'service-worker.js').read_text(encoding='utf-8')


def load_server():
    spec = importlib.util.spec_from_file_location('serve_trb_v31', ROOT / 'serve_trb.py')
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def test_intersection_parser_accepts_barranquilla_style():
    server = load_server()
    parts = server.colombian_intersection_parts('calle 27C con carrera 41')
    assert parts
    assert parts['canonical'] == 'Calle 27C con Carrera 41'
    assert server.colombian_intersection_parts('CL 27c / CRA 41')['canonical'] == 'Calle 27C con Carrera 41'


def test_intersection_variants_and_osm_resolver_exist():
    server = load_server()
    variants = [value for value, _ in server.address_query_variants('Calle 27C con Carrera 41')]
    assert any('Calle 27C con Carrera 41' in value for value in variants)
    assert any('Calle 27C y Carrera 41' in value for value in variants)
    assert 'def overpass_intersection_suggestion' in (ROOT / 'serve_trb.py').read_text(encoding='utf-8')
    assert 'osm-intersection' in (ROOT / 'serve_trb.py').read_text(encoding='utf-8')


def test_client_normalizes_intersections():
    assert 'function intersectionQueryParts' in APP
    assert "const cacheKey = `v31:${normalize(clean)}`" in APP
    assert 'intersection.road' in APP


def test_suggestion_panel_is_compact_and_cannot_overflow():
    assert 'grid-template-columns:minmax(440px,480px)' in CSS
    assert '.route-operations, .map-planner-card, .map-planner-results { overflow-x:hidden; }' in CSS
    assert '.route-strip-segment { min-width:30px' in CSS
    assert 'font-size:.56rem' in CSS
    assert 'white-space:normal' in CSS


def test_cache_v32():
    assert 'app.js?v=35' in HTML
    assert 'styles.css?v=35' in HTML
    assert 'trb-web-v35-transmetro-visible' in SW
