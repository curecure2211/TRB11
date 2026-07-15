from pathlib import Path

root = Path(__file__).resolve().parents[1]
app = (root / "app.js").read_text(encoding="utf-8")
server = (root / "serve_trb.py").read_text(encoding="utf-8")
manifest = (root / "manifest.webmanifest").read_text(encoding="utf-8")
assert "Universidad del Atlántico — Sede Centro" in app
assert ".slice(0, 18)" in app
assert "aMinutes - bMinutes" in app
assert "TRB_GOOGLE_PLACES_API_KEY" in server
assert 'decoded_path == "/api/vehicles"' in server
assert 'decoded_path != "/api/vehicles/location"' in server
assert (root / "driver.html").exists()
assert "trb-v35" in manifest
print("OK: v25 ordena por tiempo, amplía lugares y habilita GPS real.")
