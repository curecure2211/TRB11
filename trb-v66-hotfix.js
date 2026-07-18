/* TRB v66 hotfix - historial y corrección WebView */
(function () {
  const HISTORY_KEY = 'trb_route_history_v66';

  function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function readHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function writeHistory(items) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 20)));
  }

  function getVisibleText(selectorList) {
    for (const selector of selectorList) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const value = el.value || el.textContent || '';
      const text = cleanText(value);
      if (text) return text;
    }
    return '';
  }

  function getOrigin() {
    return getVisibleText([
      '#originInput',
      '#origin',
      '[name="origin"]',
      '[data-origin]',
      '[data-field="origin"]',
      '.origin-field',
      '.origin-value',
      '.from-value'
    ]);
  }

  function getDestination() {
    return getVisibleText([
      '#destinationInput',
      '#destination',
      '[name="destination"]',
      '[data-destination]',
      '[data-field="destination"]',
      '.destination-field',
      '.destination-value',
      '.to-value'
    ]);
  }

  function detectRouteText(card) {
    const text = cleanText(card ? card.textContent : document.body.textContent);
    const match =
      text.match(/\b[A-Z]{1,4}\d{1,2}[-–]\d{3,4}[A-Z]?\b/i) ||
      text.match(/\b(?:Transmetro|Alimentador|Bus|Ruta)\b.{0,60}/i);
    return match ? cleanText(match[0]) : 'Ruta consultada';
  }

  function saveRoute(card) {
    const origin = getOrigin() || 'Origen guardado';
    const destination = getDestination() || 'Destino guardado';
    const route = detectRouteText(card);
    const now = new Date();

    const item = {
      origin,
      destination,
      route,
      url: location.href,
      time: now.toLocaleString('es-CO')
    };

    const history = readHistory();
    const duplicated = history.find(
      h => h.origin === item.origin && h.destination === item.destination && h.route === item.route
    );

    if (!duplicated) {
      history.unshift(item);
      writeHistory(history);
      renderHistory();
    }
  }

  function renderHistory() {
    const moreView =
      document.querySelector('#view-more') ||
      document.querySelector('[data-view="more"]') ||
      document.querySelector('.view-more') ||
      document.querySelector('.more-view');

    if (!moreView) return;

    let card = document.querySelector('#trb-history-card');
    if (!card) {
      card = document.createElement('section');
      card.id = 'trb-history-card';
      card.className = 'trb-history-card';
      moreView.prepend(card);
    }

    const history = readHistory();

    if (!history.length) {
      card.innerHTML = `
        <h3>Historial de viajes</h3>
        <p class="trb-history-empty">Aquí aparecerán las rutas que consultes en TRB.</p>
      `;
      return;
    }

    card.innerHTML = `
      <h3>Historial de viajes</h3>
      ${history.map((item, index) => `
        <button class="trb-history-item" data-history-index="${index}">
          <strong>${item.origin} → ${item.destination}</strong>
          <span>${item.route} · ${item.time}</span>
        </button>
      `).join('')}
      <button class="trb-history-clear" type="button">Borrar historial</button>
    `;
  }

  document.addEventListener('click', function (event) {
    const clear = event.target.closest('.trb-history-clear');
    if (clear) {
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
      return;
    }

    const historyItem = event.target.closest('[data-history-index]');
    if (historyItem) {
      const history = readHistory();
      const item = history[Number(historyItem.dataset.historyIndex)];
      if (item && item.url) location.href = item.url;
      return;
    }

    const routeCard = event.target.closest([
      '[data-route-index]',
      '[data-plan-index]',
      '[data-alternative-index]',
      '.route-card',
      '.route-option',
      '.route-result',
      '.result-card',
      '.journey-card',
      '.itinerary-card',
      '.alternative-card',
      '.suggestion-card'
    ].join(','));

    if (routeCard) {
      setTimeout(() => saveRoute(routeCard), 400);
    }

    const backButton = event.target.closest('[data-back], .back-button, .route-back, .trip-back');
    if (backButton) {
      document.body.classList.remove('route-open');
    }
  });

  const observer = new MutationObserver(function () {
    renderHistory();

    const routeOpen =
      document.querySelector('.route-detail, .trip-panel, .route-sheet, .mobile-route-sheet, .instructions-panel');

    if (routeOpen && cleanText(routeOpen.textContent).length > 20) {
      document.body.classList.add('route-open');
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.addEventListener('hashchange', renderHistory);
  window.addEventListener('load', renderHistory);
  document.addEventListener('DOMContentLoaded', renderHistory);
})();
