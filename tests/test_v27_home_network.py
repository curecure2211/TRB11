from pathlib import Path
root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text(encoding='utf-8')
app = (root / 'app.js').read_text(encoding='utf-8')
css = (root / 'styles.css').read_text(encoding='utf-8')
sw = (root / 'service-worker.js').read_text(encoding='utf-8')
assert 'homeJourneyForm' in html
assert 'data-open-network="sibus"' in html
assert 'data-open-network="transmetro"' in html
assert 'networkBrowsePanel' in html
assert 'favoritePlaceModal' in html
assert 'assets/trb-home-hero.jpg' in html
assert 'function openNetworkExplorer' in app
assert 'function drawNetworkOverview' in app
assert 'function renderNetworkBrowseList' in app
assert 'function renderSavedPlaces' in app
assert 'is-network-browse' in css
assert 'home-hsl-layout' in css
assert 'trb-web-v35-transmetro-visible' in sw
assert (root / 'assets' / 'trb-home-hero.jpg').stat().st_size > 100000
print('OK: v27 portada, favoritos y explorador de red presentes.')
