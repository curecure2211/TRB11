from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = (ROOT / "app.js").read_text(encoding="utf-8")
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
SW = (ROOT / "service-worker.js").read_text(encoding="utf-8")


def test_removed_home_sections_are_optional():
    assert "const container = $('#factsGrid');" in APP
    assert "const container = $('#featuredRoutes');" in APP
    assert APP.count("if (!container) return;") >= 2
    assert 'id="factsGrid"' not in HTML
    assert 'id="featuredRoutes"' not in HTML


def test_v28_cache_busts_old_broken_javascript():
    assert "app.js?v=35" in HTML
    assert "service-worker.js?v=33" in APP
    assert "trb-web-v35-transmetro-visible" in SW
