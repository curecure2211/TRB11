from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
APP = (ROOT / 'app.js').read_text(encoding='utf-8')
CSS = (ROOT / 'styles.css').read_text(encoding='utf-8')
SW = (ROOT / 'service-worker.js').read_text(encoding='utf-8')


def test_home_planner_moves_to_map():
    assert "copyLocationInput(origin, $('#mapJourneyOrigin'))" in APP
    assert "copyLocationInput(destination, $('#mapJourneyDestination'))" in APP
    assert "showView('map')" in APP
    assert 'handleMapJourneySubmit()' in APP


def test_network_browser_does_not_draw_all_routes():
    open_start = APP.index("function openNetworkExplorer")
    open_end = APP.index("function closeNetworkExplorer", open_start)
    open_block = APP[open_start:open_end]
    assert 'clearMapForRouteSelection' in open_block
    assert 'drawNetworkOverview' not in open_block
    system_start = APP.index("function setNetworkSystem")
    system_end = APP.index("function openNetworkRoute", system_start)
    system_block = APP[system_start:system_end]
    assert 'clearMapForRouteSelection' in system_block
    assert 'drawNetworkOverview' not in system_block


def test_transmetro_uses_road_network_geometry():
    assert 'buildPreciseTransmetroGeometry' in APP
    assert "networkRoute('car', chunk)" in APP
    assert 'transmetroGeometryCache' in APP
    assert 'currentRoutePath' in APP


def test_map_uses_blue_top_navigation():
    assert 'top-primary-nav' in HTML
    assert "app?.classList.toggle('is-map-view', view === 'map')" in APP
    assert '.app-shell.is-map-view .topbar' in CSS
    assert '#mapRouteExplorer { display:none !important; }' in CSS


def test_new_cache_version():
    assert 'trb-web-v35-transmetro-visible' in SW
    assert 'app.js?v=35' in HTML
