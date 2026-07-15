from pathlib import Path
root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text(encoding='utf-8')
js=(root/'app.js').read_text(encoding='utf-8')
css=(root/'styles.css').read_text(encoding='utf-8')
for token in ['mapJourneyInstructions','routeFocusExit','data-back-to-suggestions']:
    assert token in html or token in js
for fn in ['setRouteFocusMode','showRouteSuggestionsPanel','renderMapJourneyInstructions','instructionLegHTML']:
    assert f'function {fn}' in js
for cls in ['is-route-focus','trip-instructions-header','trip-instruction-list','trip-back-button']:
    assert cls in css
assert "drawJourneyPlan(state.mapSelectedPlanIndex, { showInstructions: false })" in js
assert "view !== 'map'" in js
print('OK: flujo HSL v20, sugerencias, instrucciones y navegación enfocada validados.')
