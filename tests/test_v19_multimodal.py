from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
html=(root/'index.html').read_text(encoding='utf-8')
js=(root/'app.js').read_text(encoding='utf-8')
css=(root/'styles.css').read_text(encoding='utf-8')
manifest=(root/'manifest.webmanifest').read_text(encoding='utf-8')
assert '<h2>Sugerencias de ruta</h2>' in html
for value in ['buses','transmetro','combined','bike']:
    assert f'data-plan-filter="{value}"' in html
for fn in ['calculateMultimodalPlans','findUnifiedJourneyPlans','findLimitedTransferJourneyPlans','makeActiveJourneyPlan','planSegmentStripHTML']:
    assert f'function {fn}' in js or f'async function {fn}' in js
for class_name in ['route-suggestion-card','route-suggestion-modes','route-strip-segment']:
    assert f'.{class_name}' in css
assert 'trb-v35' in manifest
assert 'v=18' not in html
transit=json.loads((root/'data/transit_data.json').read_text(encoding='utf-8'))
catalog=json.loads((root/'data/trb_catalogo_rutas.json').read_text(encoding='utf-8'))
assert len(transit['routes']) == 34
assert len(catalog['rutas']) == 93
print('OK: panel v20, 4 filtros, red combinada, 34 rutas Transmetro y 93 rutas SIBUS.')
