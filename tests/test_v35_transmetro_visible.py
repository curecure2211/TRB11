from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
SW = (ROOT / "service-worker.js").read_text(encoding="utf-8")


def test_transmetro_has_immediate_visible_preview():
    assert "Vista previa inmediata: la ruta nunca desaparece" in APP
    assert "trb-transmetro-preview" in APP
    assert "fallbackPoints.length > 1" in APP


def test_transmetro_planner_uses_stop_sequence_fallback():
    assert "function fallbackBusLegGeometry" in APP
    assert "stop-sequence-preview" in APP
    assert "stop-sequence-fallback" in APP
    assert "Nunca dejar un tramo de Transmetro sin línea" in APP


def test_maplibre_failure_returns_leaflet_control():
    assert "se usará Leaflet como respaldo" in APP
    assert "return false;" in APP
    assert "Mientras la hoja de estilo termina de cargar" in APP


def test_v35_cache_is_fresh():
    assert "app.js?v=35" in HTML
    assert "styles.css?v=35" in HTML
    assert "trb-web-v35-transmetro-visible" in SW
