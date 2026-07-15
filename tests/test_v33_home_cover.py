from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
CSS = (ROOT / "styles.css").read_text(encoding="utf-8")
SW = (ROOT / "service-worker.js").read_text(encoding="utf-8")


def test_new_home_cover_is_installed():
    image_path = ROOT / "assets" / "trb-home-hero.jpg"
    assert image_path.exists()
    with Image.open(image_path) as image:
        assert image.size == (1672, 941)
    assert "Muévete por Barranquilla con facilidad" in HTML
    assert 'fetchpriority="high"' in HTML
    assert "home-feature-copy" not in HTML


def test_cover_is_responsive_and_cache_is_new():
    assert "object-fit:contain" in CSS
    assert "aspect-ratio:1672 / 941" in CSS
    assert "app.js?v=35" in HTML
    assert "styles.css?v=35" in HTML
    assert "trb-web-v35-transmetro-visible" in SW
