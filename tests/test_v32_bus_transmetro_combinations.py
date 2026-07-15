from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / 'index.html').read_text(encoding='utf-8')
APP = (ROOT / 'app.js').read_text(encoding='utf-8')
CSS = (ROOT / 'styles.css').read_text(encoding='utf-8')
SW = (ROOT / 'service-worker.js').read_text(encoding='utf-8')


def test_four_requested_filters_exist():
    assert 'data-plan-filter="buses"' in HTML
    assert 'data-plan-filter="transmetro"' in HTML
    assert 'data-plan-filter="combined"' in HTML
    assert 'data-plan-filter="bike"' in HTML
    assert '>Buses<' in HTML
    assert '>Transmetro<' in HTML
    assert '>Rutas combinadas<' in HTML
    assert 'data-plan-filter="walk"' not in HTML


def test_cross_system_planner_is_explicit_and_bidirectional():
    assert 'function findCrossSystemJourneyPlans' in APP
    assert 'busToTransmetro' in APP
    assert 'transmetroToBus' in APP
    assert 'mixedOnly: true' in APP
    assert 'shortBusConnector' in APP


def test_filters_separate_networks():
    assert "return 'combined'" in APP
    assert "return 'transmetro'" in APP
    assert "return 'buses'" in APP
    assert "plannerFilter: 'buses'" in APP
    assert "plannerFilterKey(plan) === filter" in APP
    assert 'function activatePlannerFilter' in APP
    assert 'activatePlannerFilter(button.dataset.planFilter)' in APP


def test_quota_keeps_results_from_each_network():
    assert "const quotas = { buses: 9, transmetro: 7, combined: 10, bike: 1, walk: 1 }" in APP
    assert "combinedCount" in APP
    assert "transmetroCount" in APP


def test_v32_cache_and_assets():
    assert 'app.js?v=35' in HTML
    assert 'styles.css?v=35' in HTML
    assert 'trb-web-v35-transmetro-visible' in SW
    assert 'TRB v32' in CSS
