from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
app = (ROOT / 'app.js').read_text(encoding='utf-8')
html = (ROOT / 'index.html').read_text(encoding='utf-8')
css = (ROOT / 'styles.css').read_text(encoding='utf-8')
manifest = (ROOT / 'manifest.webmanifest').read_text(encoding='utf-8')

assert 'buildLocationSuggestions' in app
assert 'setupLocationAutocomplete' in app
assert 'data-location-suggestion' in app
assert 'mapJourneyOriginSuggestions' in html
assert 'mapJourneyDestinationSuggestions' in html
assert 'instructionNavigatorHTML' in app
assert 'data-instruction-previous' in app
assert 'data-instruction-next' in app
assert 'data-instruction-plan' in app
assert 'fitMapToSelectedJourney' in app
assert 'routeBoundsDistanceKm' in app
assert 'bounds.push(...fullPath)' not in app
assert 'bounds.push(...ridePath)' in app
assert '.trip-plan-navigator' in css
assert '.location-suggestions' in css
assert 'trb-v35' in manifest

print('OK: autocompletado, navegación entre alternativas y zoom proporcional v21.')
