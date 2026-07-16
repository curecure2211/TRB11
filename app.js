'use strict';

const NAV_ITEMS = [
  { id: 'home', label: 'Inicio', icon: '⌂' },
  { id: 'routes', label: 'Rutas', icon: '⇄' },
  { id: 'map', label: 'Mapa', icon: '⌖' },
  { id: 'assistant', label: 'Asistente', icon: '✦' },
  { id: 'more', label: 'Más', icon: '•••' }
];

const storage = {
  get(key, fallback = null) { try { const value = window.localStorage.getItem(key); return value === null ? fallback : value; } catch { return fallback; } },
  set(key, value) { try { window.localStorage.setItem(key, value); } catch {} }
};

const TRANSPORT_SETTING_DEFAULTS = Object.freeze({ buses: true, transmetro: true, walk: true, bike: true, officialTransfers: false });

function normalizePlannerTransportSettings(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const normalized = { ...TRANSPORT_SETTING_DEFAULTS };
  Object.keys(TRANSPORT_SETTING_DEFAULTS).forEach(key => {
    if (typeof source[key] === 'boolean') normalized[key] = source[key];
  });
  const activeBaseModes = ['buses', 'transmetro', 'walk', 'bike'].filter(key => normalized[key] !== false);
  // TRB v60: evita que versiones anteriores o el localStorage dejen todos los
  // modos apagados. Eso provocaba “Calculando...” sin opciones visibles.
  if (!activeBaseModes.length) {
    normalized.buses = true;
    normalized.transmetro = true;
    normalized.walk = true;
    normalized.bike = true;
  }
  return normalized;
}

function ensurePlannerTransportSettings() {
  state.plannerTransportSettings = normalizePlannerTransportSettings(state.plannerTransportSettings);
  return state.plannerTransportSettings;
}

const state = {
  data: null,
  routes: [],
  operators: [],
  officialRoutes: [],
  stops: [],
  stopsById: new Map(),
  favorites: new Set(JSON.parse(storage.get('trb-favorites', '[]'))),
  currentView: 'home',
  map: null,
  allStopsLayer: null,
  routeLayer: null,
  busLayer: null,
  liveVehicleLayer: null,
  liveVehicleTimer: null,
  liveVehicles: [],
  busTimer: null,
  demoBuses: [],
  currentMapRoute: null,
  currentRouteStops: [],
  currentRoutePath: [],
  mapRouteInitialized: false,
  userLayer: null,
  selectedRoute: null,
  deferredPrompt: null,
  plannerCurrentPosition: null,
  plannerPlans: [],
  plannerAllPlans: [],
  plannerFilter: 'all',
  plannerTransportSettings: (() => {
    try { return normalizePlannerTransportSettings(JSON.parse(storage.get('trb-transport-settings', '{}'))); }
    catch { return normalizePlannerTransportSettings(); }
  })(),
  plannerLoading: false,
  officialPlannerNetwork: null,
  plannerOrigin: null,
  plannerDestination: null,
  geocodeLastAt: 0,
  geocodeCache: new Map(Object.entries(JSON.parse(storage.get('trb-geocode-cache', '{}')))),
  routeCatalog: null,
  routeCatalogValidation: null,
  routeEngineReady: false,
  kmzServerAvailable: false,
  kmzStatus: null,
  plannerDiagnostics: null,
  plannerSearchId: 0,
  mapPickTarget: null,
  mapPickerOriginLayer: null,
  mapPickerDestinationLayer: null,
  mapSelectedPlanIndex: -1,
  mapDrawRequestId: 0,
  lineDrawRequestId: 0,
  baseMapLayer: null,
  baseMapFallbackUsed: false,
  mapUnavailableRendered: false,
  mapLibreMap: null,
  mapEngine: 'leaflet-raster',
  mapLibreRoutePending: null,
  routeExplorerSystem: storage.get('trb-map-route-system', 'sibus') === 'transmetro' ? 'transmetro' : 'sibus',
  routeExplorerQuery: '',
  routeExplorerSelectedValue: '',
  mapPanelMode: 'default',
  lineReturnPlanIndex: -1,
  lineReturnMode: 'default',
  locationSuggestionTarget: null,
  locationSuggestionIndex: -1,
  locationSuggestions: [],
  locationSuggestionTimer: null,
  locationSuggestionOnlineTimer: null,
  locationSuggestionRequestId: 0,
  locationSuggestionRemote: new Map(),
  placeSearchMeta: null,
  networkExplorerMode: false,
  networkExplorerSystem: 'sibus',
  networkOverviewLayer: null,
  networkOverviewRequestId: 0,
  networkReturnSystem: null,
  networkRouteQuery: '',
  transmetroGeometryCache: new Map(),
  transmetroDrawRequestId: 0,
  favoritePlaceEditing: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const normalize = (text = '') => text.toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const escapeHTML = (value = '') => value.toString().replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const isMobileLayout = () => window.matchMedia?.('(max-width: 900px)').matches ?? false;


function setMapRuntimeStatus(message = '', type = 'info') {
  const element = $('#mapRuntimeStatus');
  if (!element) return;
  element.className = `map-runtime-status ${message ? '' : 'hidden'} is-${type}`.trim();
  element.textContent = message;
}

function renderMapUnavailable(message = 'No se pudo cargar el motor cartográfico.') {
  const container = $('#map');
  if (!container) return;
  state.mapUnavailableRendered = true;
  container.innerHTML = `<div class="map-unavailable-card">
    <img src="assets/mapa_esquematico_referencia.png" alt="Referencia visual del mapa de transporte de Barranquilla" />
    <div><span class="eyebrow">Mapa no disponible</span><h2>No pudimos iniciar el mapa interactivo</h2>
    <p>${escapeHTML(message)}</p>
    <p>Comprueba la conexión, desactiva temporalmente bloqueadores estrictos y recarga. La página intentará MapLibre con el estilo vectorial de TRB y después usará un mapa ráster de respaldo.</p>
    <button class="button button--primary" type="button" data-retry-map>Reintentar mapa</button></div>
  </div>`;
  setMapRuntimeStatus('El motor del mapa no cargó. Usa “Reintentar mapa” después de comprobar la conexión.', 'error');
}

function clearMapBootPlaceholder() {
  $('#mapBootPlaceholder')?.remove();
  setMapRuntimeStatus('', 'info');
}

function relativeAppUrl(path) {
  return new URL(path.replace(/^\//, ''), document.baseURI).toString();
}


function setMapJourneyOverlay(html = '') {
  const overlay = $('#mapJourneyOverlay');
  if (!overlay) return;
  overlay.innerHTML = html;
  overlay.classList.toggle('hidden', !html);
}


function setRouteFocusMode(active, mode = 'suggestions') {
  const app = $('#app');
  if (!app) return;
  const focused = Boolean(active);
  const instructions = focused && mode === 'instructions';
  const lineDetails = focused && mode === 'line';
  state.mapPanelMode = focused ? mode : 'default';
  app.classList.toggle('is-route-focus', focused);
  app.classList.toggle('is-route-details', instructions);
  app.classList.toggle('is-line-details', lineDetails);
  $('#mapJourneyForm')?.classList.toggle('hidden', instructions || lineDetails);
  $('#mapJourneyInstructions')?.classList.toggle('hidden', !instructions);
  $('.map-info-scroll')?.classList.toggle('hidden', focused && !lineDetails);
  window.setTimeout(() => state.map?.invalidateSize({ animate: false }), 80);
}

function clearSelectedJourneyFromMap({ resetSelection = true } = {}) {
  state.lineDrawRequestId += 1;
  stopDemoBusAnimation();
  if (state.map && state.routeLayer && state.map.hasLayer(state.routeLayer)) state.map.removeLayer(state.routeLayer);
  state.routeLayer = null;
  if (state.map && state.busLayer && state.map.hasLayer(state.busLayer)) state.map.removeLayer(state.busLayer);
  state.busLayer = null;
  clearMapLibreRoute();
  state.currentMapRoute = null;
  state.currentRouteStops = [];
  state.demoBuses = [];
  if (resetSelection) state.mapSelectedPlanIndex = -1;
  setMapJourneyOverlay('');
  $('#mapInfoDefault')?.classList.remove('hidden');
  $('#mapInfoContent')?.classList.add('hidden');
  if ($('#mapInfoContent')) $('#mapInfoContent').innerHTML = '';
  renderMapJourneyResults();
}

function exitRouteFocusMode() {
  clearSelectedJourneyFromMap();
  setRouteFocusMode(false, 'default');
  window.setTimeout(() => state.map?.invalidateSize({ animate: false }), 80);
}

function showRouteSuggestionsPanel(options = {}) {
  if (options.keepSelection) {
    setRouteFocusMode(true, 'suggestions');
    renderMapJourneyResults();
    return;
  }
  clearSelectedJourneyFromMap();
  setRouteFocusMode(true, 'suggestions');
  renderMapJourneyResults();
}

function transitLineDataAttributes(route = {}, extra = {}) {
  const system = plannerRouteSystem(route);
  const attrs = [
    `data-transit-line-id="${escapeHTML(String(route.id || ''))}"`,
    `data-transit-line-code="${escapeHTML(String(route.shortName || route.code || ''))}"`,
    `data-transit-line-operator="${escapeHTML(String(route.operator || ''))}"`,
    `data-transit-line-system="${escapeHTML(system)}"`
  ];
  if (extra.planIndex !== undefined && extra.planIndex !== null) attrs.push(`data-transit-plan-index="${escapeHTML(String(extra.planIndex))}"`);
  if (extra.legIndex !== undefined && extra.legIndex !== null) attrs.push(`data-transit-leg-index="${escapeHTML(String(extra.legIndex))}"`);
  return attrs.join(' ');
}

function transitLineCodeHTML(route = {}, className = 'transit-line-link', extra = {}) {
  const code = route.shortName || route.code || 'Ruta';
  const title = extra.legIndex !== undefined ? `Ver solo el tramo usado de ${code}` : `Ver solamente la ruta ${code} en el mapa`;
  return `<span class="${className}" role="button" tabindex="0" ${transitLineDataAttributes(route, extra)} title="${escapeHTML(title)}">${escapeHTML(code)}</span>`;
}

function resolveTransitLine(reference = {}) {
  const code = String(reference.code || reference.shortName || '').trim();
  const operator = normalize(reference.operator || '');
  const id = String(reference.id || '').trim();
  const system = reference.system || plannerRouteSystem(reference);
  if (system === 'transmetro') {
    const route = state.routes.find(item => String(item.id) === id || normalize(item.shortName) === normalize(code));
    return route ? { system: 'transmetro', route } : null;
  }
  const route = state.officialRoutes.find(item => {
    const idMatch = String(item.id) === id || String(item.catalogId || '') === id || id.includes(String(item.catalogId || '__none__'));
    const codeMatch = normalize(item.code) === normalize(code);
    const operatorMatch = !operator || normalize(item.operator) === operator;
    return idMatch || (codeMatch && operatorMatch);
  }) || state.officialRoutes.find(item => normalize(item.code) === normalize(code));
  return route ? { system: 'sibus', route } : null;
}

function lineInfoBackHeaderHTML(routeCode = 'Ruta') {
  const returnsToNetwork = Boolean(state.networkReturnSystem);
  const returnsToTrip = state.lineReturnPlanIndex >= 0 && state.plannerPlans[state.lineReturnPlanIndex];
  return `<div class="line-info-navigation"><button type="button" data-back-from-line aria-label="${returnsToNetwork ? 'Volver a todas las rutas' : returnsToTrip ? 'Volver a las instrucciones' : 'Volver al mapa'}">‹</button><div><span class="eyebrow">Información de la línea</span><b>${escapeHTML(routeCode)}</b></div></div>`;
}

function openTransitLineDetails(reference = {}) {
  const resolved = resolveTransitLine(reference);
  if (!resolved) {
    toast(`No encontré la geometría completa de ${reference.code || reference.shortName || 'esa ruta'}`);
    return;
  }
  const requestedPlanIndex = Number(reference.planIndex ?? state.mapSelectedPlanIndex);
  const requestedLegIndex = Number(reference.legIndex);
  const canReturnToPlanner = state.mapPanelMode === 'instructions' || state.mapPanelMode === 'suggestions';
  state.lineReturnPlanIndex = canReturnToPlanner && Number.isInteger(requestedPlanIndex) && requestedPlanIndex >= 0
    ? requestedPlanIndex
    : -1;
  state.lineReturnMode = canReturnToPlanner ? state.mapPanelMode : 'default';
  const plan = Number.isInteger(requestedPlanIndex) ? state.plannerPlans[requestedPlanIndex] : null;
  const leg = plan && Number.isInteger(requestedLegIndex) ? plan.legs?.[requestedLegIndex] : null;
  if (leg?.mode === 'bus') {
    drawTransitLegDetails(resolved.route, leg, { ...reference, planIndex: requestedPlanIndex, legIndex: requestedLegIndex, system: resolved.system });
    return;
  }
  setRouteFocusMode(true, 'line');
  setMapJourneyOverlay('');
  showView('map');
  if (resolved.system === 'transmetro') drawRoute(resolved.route);
  else drawOfficialRoute(resolved.route);
}

function returnFromTransitLine() {
  if (state.networkReturnSystem) {
    const system = state.networkReturnSystem;
    state.networkReturnSystem = null;
    state.lineReturnPlanIndex = -1;
    state.lineReturnMode = 'default';
    openNetworkExplorer(system);
    return;
  }
  const index = Number(state.lineReturnPlanIndex);
  const mode = state.lineReturnMode;
  state.lineReturnPlanIndex = -1;
  state.lineReturnMode = 'default';
  if (Number.isInteger(index) && index >= 0 && state.plannerPlans[index]) {
    drawJourneyPlan(index, { showInstructions: mode === 'instructions' });
    return;
  }
  if (mode === 'suggestions' && state.plannerPlans.length) {
    showRouteSuggestionsPanel();
    return;
  }
  exitRouteFocusMode();
}

function instructionLegHTML(leg, index, startOffset, planIndex = state.mapSelectedPlanIndex) {
  const minutes = Math.max(1, Math.ceil((leg.duration || 60) / 60));
  const start = formatSuggestionClock(startOffset);
  const end = formatSuggestionClock(startOffset + minutes);
  if (leg.mode === 'walk') {
    const target = leg.to?.stop?.name || leg.to?.label || 'el siguiente punto';
    return `<li class="trip-instruction-step is-walk"><span class="trip-step-time">${start}</span><span class="trip-step-node trip-step-node--walk">🚶</span><div><b>${leg.isTransfer ? 'Camina para hacer el transbordo' : 'Camina'} ${formatDistance(leg.distance || 0)}</b><small>${minutes} min · hacia ${escapeHTML(target)}</small></div><span class="trip-step-end">${end}</span></li>`;
  }
  if (leg.mode === 'bike') {
    const target = leg.to?.label || 'el destino';
    return `<li class="trip-instruction-step is-bike"><span class="trip-step-time">${start}</span><span class="trip-step-node trip-step-node--bike">🚲</span><div><b>Pedalea ${formatDistance(leg.distance || 0)}</b><small>${minutes} min · hacia ${escapeHTML(target)}</small></div><span class="trip-step-end">${end}</span></li>`;
  }
  const color = routeColor(leg.route);
  const fromName = leg.from?.stop?.name || leg.from?.label || 'punto de abordaje';
  const toName = leg.to?.stop?.name || leg.to?.label || 'punto de descenso';
  const operator = leg.route?.operator || (plannerRouteSystem(leg.route) === 'transmetro' ? 'Transmetro' : 'Bus urbano');
  return `<li class="trip-instruction-step is-transit" style="--step-color:${color}"><span class="trip-step-time">${start}</span><span class="trip-step-node trip-step-node--bus">${trbBusIconSVG('trb-bus-svg trb-bus-svg--step')}</span><div><b>Sube a ${transitLineCodeHTML(leg.route, 'transit-line-link transit-line-link--instruction', { planIndex, legIndex: index })}</b><small>${escapeHTML(operator)} · desde ${escapeHTML(fromName)}</small><span class="trip-step-ride">${escapeHTML(leg.route.longName || leg.route.shortName)} · ${minutes} min</span><small>Bájate en ${escapeHTML(toName)}</small></div><span class="trip-step-end">${end}</span></li>`;
}


function instructionVisiblePlanItems(index) {
  const currentIndex = Number(index);
  let items = plannerVisibleIndexedPlans(state.plannerFilter || 'all');
  if (!items.some(item => item.index === currentIndex)) items = plannerVisibleIndexedPlans('all');
  if (!items.length && state.plannerPlans.length) items = state.plannerPlans.map((plan, planIndex) => ({ plan, index: planIndex }));
  return items;
}

function instructionPlanWindow(index, maximum = 7) {
  const items = instructionVisiblePlanItems(index);
  const total = items.length;
  if (total <= maximum) return items.map(item => item.index);
  const currentPosition = Math.max(0, items.findIndex(item => item.index === Number(index)));
  const half = Math.floor(maximum / 2);
  let start = Math.max(0, currentPosition - half);
  start = Math.min(start, total - maximum);
  return items.slice(start, start + maximum).map(item => item.index);
}

function instructionNavigatorHTML(index) {
  const items = instructionVisiblePlanItems(index);
  const total = items.length;
  if (total <= 1) return '';
  const currentPosition = Math.max(0, items.findIndex(item => item.index === Number(index)));
  const positionByIndex = new Map(items.map((item, position) => [item.index, position]));
  const dots = instructionPlanWindow(index).map(planIndex => {
    const position = positionByIndex.get(planIndex) ?? planIndex;
    return `<button type="button" class="trip-plan-dot ${planIndex === Number(index) ? 'is-active' : ''}" data-instruction-plan="${planIndex}" aria-label="Ver alternativa ${position + 1}" aria-current="${planIndex === Number(index) ? 'true' : 'false'}"></button>`;
  }).join('');
  return `<div class="trip-plan-navigator" aria-label="Cambiar alternativa"><button type="button" data-instruction-previous aria-label="Alternativa anterior">‹</button><div class="trip-plan-dots">${dots}</div><button type="button" data-instruction-next aria-label="Alternativa siguiente">›</button><small>${currentPosition + 1} de ${total}</small></div>`;
}

function changeInstructionPlan(direction) {
  const items = instructionVisiblePlanItems(state.mapSelectedPlanIndex);
  const total = items.length;
  if (!total) return;
  const currentPosition = Math.max(0, items.findIndex(item => item.index === Number(state.mapSelectedPlanIndex)));
  const next = items[(currentPosition + direction + total) % total];
  if (next) drawJourneyPlan(next.index, { showInstructions: true });
}

function renderMapJourneyInstructions(plan, index) {
  const panel = $('#mapJourneyInstructions');
  if (!panel || !plan) return;
  let offset = 0;
  const steps = plan.legs.map((leg, legIndex) => {
    const html = instructionLegHTML(leg, legIndex, offset, Number(index));
    offset += Math.max(1, Math.ceil((leg.duration || 60) / 60));
    return html;
  }).join('');
  const transitLegs = plan.legs.filter(leg => leg.mode === 'bus');
  const fare = plan.fare?.value ? formatCurrency(plan.fare.value) : 'Consulta al abordar';
  const routeBadges = transitLegs.length ? plan.legs.map((leg, legIndex) => leg.mode === 'bus' ? `<span class="trip-route-badge" style="--instruction-color:${routeColor(leg.route)};--instruction-text-color:${routeTextColor(leg.route)}" role="button" tabindex="0" ${transitLineDataAttributes(leg.route, { planIndex: Number(index), legIndex })} title="Ver solo el tramo usado de ${escapeHTML(leg.route.shortName)}">${escapeHTML(leg.route.shortName)}</span>` : '').join('') : `<span style="--instruction-color:${mapPlanRouteColor(plan)}">${planCategory(plan) === 'bike' ? 'Bici' : 'Caminar'}</span>`;
  panel.innerHTML = `<div class="trip-instructions-header">
      <button class="trip-back-button" type="button" data-back-to-suggestions aria-label="Volver a sugerencias">‹</button>
      <div><span class="eyebrow">Ruta seleccionada</span><h2>Instrucciones</h2></div>
    </div>
    ${instructionNavigatorHTML(Number(index))}
    <div class="trip-instructions-summary">
      <div class="trip-summary-times"><b>${formatSuggestionClock(0)} – ${formatSuggestionClock(plan.totalMinutes)}</b><strong>${plan.totalMinutes} min</strong></div>
      <div class="trip-summary-stats"><span>🚶 <b>${plan.walkMinutes || 0} min</b><small>${formatDistance(plan.walkMeters || 0)}</small></span><span>⇄ <b>${plan.transfers || 0}</b><small>transbordos</small></span><span>🎫 <b>${fare}</b><small>tarifa estimada</small></span></div>
      <div class="trip-summary-routes">${routeBadges}</div>
      ${officialTransferNoteHTML(plan)}
      <div class="trip-summary-points"><span><i class="is-origin"></i>${escapeHTML(plan.origin.label)}</span><span><i class="is-destination"></i>${escapeHTML(plan.destination.label)}</span></div>
    </div>
    <ol class="trip-instruction-list">
      <li class="trip-instruction-terminal"><span class="trip-step-time">${formatSuggestionClock(0)}</span><span class="trip-terminal-dot is-origin"></span><div><b>Salida</b><small>${escapeHTML(plan.origin.label)}</small></div></li>
      ${steps}
      <li class="trip-instruction-terminal"><span class="trip-step-time">${formatSuggestionClock(plan.totalMinutes)}</span><span class="trip-terminal-dot is-destination"></span><div><b>Llegada</b><small>${escapeHTML(plan.destination.label)}</small></div></li>
    </ol>
    <div class="trip-instructions-note">Tiempos estimados. No incluyen espera, tráfico en vivo ni disponibilidad real de bicicletas.</div>`;
  setRouteFocusMode(true, 'instructions');
}

function formatRouteDistance(meters) {
  const value = Number(meters) || 0;
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km` : `${Math.round(value)} m`;
}

function drawTransitPath(group, points, color, options = {}) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const weight = options.weight || 8;
  const opacity = options.opacity ?? 1;
  L.polyline(points, {
    pane: 'routeCasing', color: '#ffffff', weight: weight + 6, opacity: Math.min(1, opacity + .04),
    lineCap: 'round', lineJoin: 'round', interactive: false
  }).addTo(group);
  return L.polyline(points, {
    pane: 'routeMain', color, weight, opacity, lineCap: 'round', lineJoin: 'round',
    dashArray: options.dashArray || null, className: options.className || 'trb-transit-line'
  }).addTo(group);
}

function drawWalkingPath(group, points, options = {}) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const color = options.color || '#5f6f82';
  const weight = options.weight || 5;
  L.polyline(points, {
    pane: 'routeCasing', color: '#ffffff', weight: weight + 5, opacity: .98,
    lineCap: 'round', lineJoin: 'round', interactive: false
  }).addTo(group);
  return L.polyline(points, {
    pane: 'routeMain', color, weight, opacity: .95,
    dashArray: options.dashArray || '2 10', lineCap: 'round', lineJoin: 'round',
    className: 'trb-walk-line'
  }).addTo(group);
}

function directionArrowIcon(color, bearing = 0) {
  return L.divIcon({
    className: 'trb-direction-arrow-wrap',
    html: `<span class="trb-direction-arrow" style="--arrow-color:${color};transform:rotate(${bearing}deg)">➤</span>`,
    iconSize: [24, 24], iconAnchor: [12, 12]
  });
}

function routeTerminalIcon(label, color) {
  return L.divIcon({
    className: 'trb-terminal-icon-wrap',
    html: `<div class="trb-terminal-icon" style="--terminal-color:${color};--terminal-text:${readableRouteTextColor(color)}">${escapeHTML(label)}</div>`,
    iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18]
  });
}

function routeLabelIcon(label, color) {
  return L.divIcon({
    className: 'trb-route-label-wrap',
    html: `<div class="trb-route-label" style="--route-badge:${color};--route-badge-text:${readableRouteTextColor(color)}">${escapeHTML(label)}</div>`,
    iconSize: [56, 24], iconAnchor: [28, 12]
  });
}

function bearingBetween(a, b) {
  const lat1 = a[0] * Math.PI / 180, lat2 = b[0] * Math.PI / 180;
  const delta = (b[1] - a[1]) * Math.PI / 180;
  const y = Math.sin(delta) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(delta);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function addDirectionArrows(group, points, color) {
  if (!Array.isArray(points) || points.length < 8) return;
  [0.24, 0.52, 0.78].forEach(fraction => {
    const index = Math.max(1, Math.min(points.length - 2, Math.round((points.length - 1) * fraction)));
    const bearing = bearingBetween(points[index - 1], points[index + 1]);
    L.marker(points[index], { pane: 'routeStops', icon: directionArrowIcon(color, bearing), interactive: false, zIndexOffset: 650 }).addTo(group);
  });
}

function sampleCoordinateIndexes(length, maximum = 70) {
  if (!Number.isFinite(length) || length <= 0) return [];
  const step = Math.max(1, Math.ceil(length / maximum));
  const indexes = [];
  for (let index = 0; index < length; index += step) indexes.push(index);
  if (indexes[indexes.length - 1] !== length - 1) indexes.push(length - 1);
  return indexes;
}

function sampleCoordinates(coords, maximum = 70) {
  if (!Array.isArray(coords) || !coords.length) return [];
  return sampleCoordinateIndexes(coords.length, maximum).map(index => coords[index]);
}

async function loadOfficialGeometry(route, catalogRoute) {
  if (state.kmzServerAvailable) {
    const apiUrl = new URL('api/route-geometry', document.baseURI);
    apiUrl.searchParams.set('route_id', catalogRoute.id);
    const response = await fetch(apiUrl, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok || !Array.isArray(payload.paths)) throw new Error(payload.error || `Servidor de geometría HTTP ${response.status}`);
    return {
      route: catalogRoute,
      source: payload.source || apiUrl.toString(),
      paths: payload.paths,
      geojson: payload.geojson || null,
      metrics: {
        directions: payload.paths.map(path => ({
          direction: path.direction || path.name || 'recorrido',
          distanceMeters: Number(path.distanceMeters) || window.TRBRouteEngine.lineDistanceMeters(path.coordinates),
          durationMinutes: Number(path.durationMinutes) || Math.max(1, Math.ceil(window.TRBRouteEngine.lineDistanceMeters(path.coordinates) / 330)),
          coordinatesCount: path.coordinates.length
        }))
      }
    };
  }
  // Respaldo para copias con geometrías previamente generadas.
  const staticPath = `route_geometry/${String(catalogRoute.kmz || '').replace(/\.kmz$/i, '.json')}`;
  try {
    const response = await fetch(relativeAppUrl(staticPath), { cache: 'no-store' });
    if (response.ok) {
      const payload = await response.json();
      if (payload?.ok && Array.isArray(payload.paths)) {
        return { route: catalogRoute, source: staticPath, paths: payload.paths, geojson: payload.geojson || null, metrics: { directions: payload.paths.map(path => ({ direction: path.direction || path.name || 'recorrido', distanceMeters: Number(path.distanceMeters) || window.TRBRouteEngine.lineDistanceMeters(path.coordinates), durationMinutes: Number(path.durationMinutes) || Math.max(1, Math.ceil(window.TRBRouteEngine.lineDistanceMeters(path.coordinates) / 330)), coordinatesCount: path.coordinates.length })) } };
      }
    }
  } catch (_) {}
  return window.TRBRouteEngine.loadKmzRoute(catalogRoute, { localKmzBase: 'kmz/', fetchTimeoutMs: 26000, allowRemoteFallback: true });
}


async function plannerMapWithConcurrency(items, worker, concurrency = 8) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (error) { results[index] = { error, item: items[index] }; }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, run));
  return results;
}

function routeMapOverlayHTML(route, color, metrics, source, pointCount) {
  const primary = metrics?.directions?.[0];
  return `<div class="map-overlay__header"><span class="map-overlay__route" style="--overlay-color:${color}">${escapeHTML(route.code)}</span><button class="map-overlay__close" type="button" data-map-overlay-close aria-label="Cerrar resumen">×</button></div>
    <strong>${escapeHTML(route.name)}</strong><small>${escapeHTML(route.operator)}</small>
    <div class="map-overlay__metrics"><span><b>${formatRouteDistance(primary?.distanceMeters || 0)}</b> recorrido</span><span><b>≈ ${primary?.durationMinutes || '—'} min</b> estimado</span><span><b>${pointCount}</b> puntos</span></div>
    <div class="map-overlay__legend"><i style="--overlay-color:${color}"></i> Línea del recorrido KMZ</div>
    <p>Sin GPS en vivo. La línea corresponde a la geometría disponible de la ruta.</p>`;
}

function routeType(route) {
  const code = route.shortName.toUpperCase();
  if (code === 'U30') return 'universitaria';
  if (/^[BRS]/.test(code)) return 'troncal';
  return 'alimentadora';
}

const ROUTE_FAMILY_COLORS = Object.freeze({
  A: '007AC3', B: '009A63', C: 'F57C00', D: '7246C7', PT: '00A6D6', TM: 'C8102E', DEFAULT: 'E83E8C'
});

// TRB v37 · colores oficiales por empresa y ruta tomados de las imágenes suministradas.
const ROUTE_OPERATOR_PALETTES = Object.freeze({
  "COOASOATLAN": [
    "3C24A4",
    "FCF414",
    "E43C14"
  ],
  "COOCHOFAL": [
    "C60A10"
  ],
  "COOLITORAL": [
    "007700"
  ],
  "COOTRAB": [
    "3CFF3C"
  ],
  "COOTRANSCO": [
    "800000"
  ],
  "COOTRANSNORTE": [
    "03A29E"
  ],
  "COOTRANSPORCAR": [
    "02629F"
  ],
  "COOTRANTICO": [
    "E15A00"
  ],
  "COOTRASOL": [
    "E45C04"
  ],
  "EMBUSA": [
    "162053"
  ],
  "FLOTA-ANGULO": [
    "EC1C24"
  ],
  "FLOTA-ROJA": [
    "FF0606"
  ],
  "LA-CAROLINA": [
    "955C3E"
  ],
  "LOLAYA": [
    "00AEAE"
  ],
  "MONTERREY": [
    "0ABDE6"
  ],
  "SOBUSA": [
    "25BC53"
  ],
  "SODETRANS": [
    "3039AF"
  ],
  "TRANSDIAZ": [
    "3039AF"
  ],
  "TRANSMECAR": [
    "FFC90E"
  ],
  "TRANSOLEDAD": [
    "04A4EC",
    "FC0404"
  ],
  "TRANSURBAR": [
    "00AEEF",
    "ED1C24",
    "FFC90E"
  ],
  "TRASALFA": [
    "27348B",
    "00AEEF",
    "E15A00"
  ],
  "TRASALIANCO": [
    "13A538",
    "3039AF",
    "FFC90E",
    "FF0606"
  ]
});
const ROUTE_OPERATOR_ROUTE_COLORS = Object.freeze({
  "COOASOATLAN": {
    "C1-4132": "3C24A4",
    "C1-B-4186": "FCF414",
    "C20-4181": "E43C14",
    "C20-B-4187": "3C24A4"
  },
  "COOCHOFAL": {
    "A15-4159": "C60A10",
    "C2-4133": "C60A10",
    "C2-B-4187": "C60A10",
    "C3-4134": "C60A10",
    "C4-4135": "C60A10",
    "C9-4140": "C60A10",
    "C18-4141": "C60A10",
    "D20-4185": "C60A10"
  },
  "COOLITORAL": {
    "A1-4106 A": "007700",
    "A1-4106 B": "007700",
    "A2-4107": "007700",
    "A3-4108": "007700",
    "A4-4109": "007700",
    "B1-4117": "007700",
    "B2A-4177": "007700",
    "B3-4119": "007700",
    "B17-4163": "007700",
    "C19-4178": "007700",
    "PT1-4101": "007700",
    "PT2-4102": "007700",
    "PT3-4103": "007700",
    "PT4-4104": "007700",
    "PT5-4105": "007700"
  },
  "COOTRAB": {
    "C5-4135": "3CFF3C",
    "C6-4137": "3CFF3C"
  },
  "COOTRANSCO": {
    "C7-4138": "800000"
  },
  "COOTRANSNORTE": {
    "A5-4110": "03A29E",
    "A6-4111": "03A29E"
  },
  "COOTRANSPORCAR": {
    "C8-4139": "02629F"
  },
  "COOTRANTICO": {
    "A18-4183": "E15A00",
    "B4-4120": "E15A00",
    "B5-4121": "E15A00",
    "B5-B-4190": "E15A00",
    "B6-4122": "E15A00",
    "B7-4123": "E15A00",
    "B20-4180": "E15A00",
    "B20-B-4191": "E15A00"
  },
  "COOTRASOL": {
    "D3-4147": "E45C04",
    "D4-4148": "E45C04",
    "D5-4149": "E45C04"
  },
  "EMBUSA": {
    "B9-4125": "162053"
  },
  "FLOTA-ANGULO": {
    "A7-4112": "EC1C24"
  },
  "FLOTA-ROJA": {
    "A8-4113": "FF0606"
  },
  "LA-CAROLINA": {
    "A16-4161 A": "955C3E",
    "A16-4161 B": "955C3E",
    "D6-4150": "955C3E",
    "D7-4151": "955C3E"
  },
  "LOLAYA": {
    "B10-4126": "00AEAE",
    "B10-B-4193": "00AEAE",
    "D8-4165": "00AEAE"
  },
  "MONTERREY": {
    "B8-4124": "0ABDE6",
    "B11-4166": "0ABDE6",
    "B11-B-4192": "0ABDE6",
    "B12-4127": "0ABDE6"
  },
  "SOBUSA": {
    "B18-4175 A": "25BC53",
    "B18-4175 B": "25BC53",
    "C11-4168": "25BC53",
    "C12-4169 A": "25BC53",
    "C12-4169 B": "25BC53",
    "C13-4143": "25BC53",
    "C14-4170": "25BC53",
    "C16-4167 A": "25BC53",
    "C16-4167 B": "25BC53"
  },
  "SODETRANS": {
    "B13-4128": "3039AF",
    "B13-B-4189": "3039AF",
    "B14-4174": "3039AF",
    "B15-4129 A": "3039AF",
    "B15-4129 B": "3039AF",
    "C21-4182 A": "3039AF",
    "C21-4182 B": "3039AF"
  },
  "TRANSDIAZ": {
    "A10-4114 A": "3039AF",
    "A10-4114 B": "3039AF",
    "A11-4115": "3039AF",
    "B16-4130": "3039AF"
  },
  "TRANSMECAR": {
    "C17-4160": "FFC90E",
    "D9-4152": "FFC90E",
    "D10-4172": "FFC90E",
    "D11-4153": "FFC90E"
  },
  "TRANSOLEDAD": {
    "D13-4155": "04A4EC"
  },
  "TRANSURBAR": {
    "A14-4116": "00AEEF",
    "D16-4173": "ED1C24",
    "D19-4184": "FFC90E"
  },
  "TRASALFA": {
    "B2-B-4118": "27348B",
    "D14-4156": "00AEEF",
    "D15-4157": "E15A00"
  },
  "TRASALIANCO": {
    "B19-4176": "13A538",
    "D12-4154": "3039AF",
    "D17-4158": "FFC90E",
    "D18-4179": "FF0606"
  }
});

function normalizeOperatorKey(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9-]/g, '');
}

function normalizeRouteCodeKey(value = '') {
  return String(value || '').toUpperCase().trim().replace(/\s+/g, ' ');
}

function routeOperatorKey(route = {}) {
  return normalizeOperatorKey(route.operator || route.empresa || route.company || route.operatorName || '');
}

function routeCodeKey(route = {}) {
  return normalizeRouteCodeKey(route.shortName || route.code || route.ruta || route.routeCode || '');
}

function officialRouteColorHex(route = {}) {
  const operator = routeOperatorKey(route);
  const code = routeCodeKey(route);
  const specific = ROUTE_OPERATOR_ROUTE_COLORS[operator]?.[code];
  if (specific) return specific;
  const palette = ROUTE_OPERATOR_PALETTES[operator];
  return Array.isArray(palette) && palette.length ? palette[0] : null;
}

function routeFamilyColorHex(value = '') {
  const code = String(value || '').trim().toUpperCase();
  if (code.startsWith('PT')) return ROUTE_FAMILY_COLORS.PT;
  if (code.startsWith('TM')) return ROUTE_FAMILY_COLORS.TM;
  return ROUTE_FAMILY_COLORS[code.charAt(0)] || ROUTE_FAMILY_COLORS.DEFAULT;
}

function routeColor(route) {
  const official = officialRouteColorHex(route);
  const explicit = String(route?.colorHex || '').replace('#','').trim();
  const raw = official || explicit || routeFamilyColorHex(route?.shortName || route?.code || route?.ruta);
  return `#${raw.padStart(6,'0')}`;
}

function readableRouteTextColor(color) {
  const raw = String(color || '').replace('#','').trim();
  if (!/^[0-9a-f]{6}$/i.test(raw)) return '#FFFFFF';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 165 ? '#102033' : '#FFFFFF';
}

function routeTextColor(route) {
  const explicit = String(route?.textColorHex || '').replace('#','').trim();
  if (/^[0-9a-f]{6}$/i.test(explicit)) return `#${explicit}`;
  return readableRouteTextColor(routeColor(route));
}

function routeColorStyle(route, colorVar = '--route-color', textVar = '--route-text-color') {
  return `${colorVar}:${routeColor(route)};${textVar}:${routeTextColor(route)}`;
}

function operatorColorHex(value = '') {
  const palette = ['1463E6', '0F766E', '7C3AED', 'C2410C', 'BE123C', '0369A1', '4D7C0F', 'A16207'];
  let hash = 0;
  for (const char of String(value)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

function formatCurrency(value) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function currentFare(route) {
  const sunday = new Date().getDay() === 0;
  const value = sunday ? Number(route?.tarifa_domingo_festivo || 3800) : Number(route?.tarifa_ordinaria || 3700);
  return { value, label: sunday ? 'Tarifa de domingo' : 'Tarifa ordinaria', note: 'Domingos y festivos: $3.800' };
}

const PLANNER_LANDMARKS = [
  { name: 'Centro de Barranquilla', lat: 10.9806, lng: -74.7885, type: 'Sector', aliases: ['centro', 'centro historico'] },
  { name: 'Portal del Prado', lat: 10.9878, lng: -74.7954, type: 'Centro comercial' },
  { name: 'Centro Comercial Buenavista', lat: 11.0134, lng: -74.8270, type: 'Centro comercial', aliases: ['Buenavista', 'CC Buenavista'] },
  { name: 'Universidad del Norte', lat: 11.0195, lng: -74.8502, type: 'Universidad', aliases: ['Uninorte', 'Universidad Norte'] },
  { name: 'Universidad del Atlántico — Sede Norte', lat: 11.0189, lng: -74.8737, type: 'Universidad', aliases: ['Universidad del Atlantico', 'Uniatlantico', 'UA', 'Ciudadela Universitaria', 'Sede Norte Universidad del Atlantico'] },
  { name: 'Universidad del Atlántico — Sede Centro (20 de Julio)', lat: 10.9876, lng: -74.7917, type: 'Universidad', aliases: ['Universidad del Atlantico sede centro', 'Uniatlantico sede centro', 'Universidad del Atlantico centro', 'Sede 20 de Julio', 'UA sede centro', 'Universidad del Atlantico Barranquilla centro'] },
  { name: 'Universidad del Atlántico — Edificio Julio Enrique Blanco', lat: 10.9878, lng: -74.7915, type: 'Universidad', aliases: ['Julio Enrique Blanco', 'Edificio Julio Enrique Blanco', 'Uniatlantico Julio Enrique Blanco'] },
  { name: 'Universidad del Atlántico — Consultorio Jurídico y Centro de Conciliación', lat: 10.9874, lng: -74.7919, type: 'Universidad', aliases: ['Consultorio Juridico Universidad del Atlantico', 'Centro de Conciliacion Universidad del Atlantico', 'Consultorio juridico Uniatlantico'] },
  { name: 'Universidad del Atlántico — Sede Bellas Artes', lat: 10.9985, lng: -74.7976, type: 'Universidad', aliases: ['Bellas Artes Universidad del Atlantico', 'Uniatlantico Bellas Artes', 'Facultad de Bellas Artes'] },
  { name: 'Universidad Autónoma del Caribe', lat: 10.9954, lng: -74.8066, type: 'Universidad', aliases: ['Autonoma del Caribe', 'UAC'] },
  { name: 'Universidad Simón Bolívar', lat: 10.9897, lng: -74.7920, type: 'Universidad', aliases: ['Simon Bolivar', 'Unisimon'] },
  { name: 'Universidad Libre — Barranquilla', lat: 10.9970, lng: -74.8232, type: 'Universidad', aliases: ['Universidad Libre'] },
  { name: 'Estadio Metropolitano Roberto Meléndez', lat: 10.9267, lng: -74.8011, type: 'Estadio', aliases: ['Estadio Metropolitano', 'Metro'] },
  { name: 'Terminal Metropolitana de Transportes', lat: 10.9317, lng: -74.7857, type: 'Terminal' },
  { name: 'Aeropuerto Ernesto Cortissoz', lat: 10.8896, lng: -74.7808, type: 'Aeropuerto', aliases: ['Aeropuerto de Barranquilla', 'Cortissoz'] },
  { name: 'Plaza de la Paz', lat: 10.9930, lng: -74.7882, type: 'Plaza' },
  { name: 'Catedral Metropolitana María Reina', lat: 10.9945, lng: -74.7882, type: 'Iglesia', aliases: ['Catedral Metropolitana'] },
  { name: 'Ventana al Mundo', lat: 11.0386, lng: -74.8178, type: 'Atracción' },
  { name: 'Gran Malecón del Río', lat: 11.0169, lng: -74.7934, type: 'Atracción', aliases: ['Malecon del Rio', 'Gran Malecon'] },
  { name: 'Alcaldía de Soledad', lat: 10.9184, lng: -74.7645, type: 'Entidad pública' },
  { name: 'Hospital Universidad del Norte', lat: 10.9263, lng: -74.8072, type: 'Hospital', aliases: ['Hospital Uninorte'] },
  { name: 'Clínica Portoazul Auna', lat: 11.0191, lng: -74.8482, type: 'Clínica', aliases: ['Portoazul'] }
];
const WALK_SPEED_MPS = 1.25;
const BUS_SPEED_MPS = 5.6;
const BIKE_SPEED_MPS = 4.4;
const MAX_ACCESS_WALK = 1800;
const MAX_ACCESS_WALK_EXPANDED = 3400;
const MAX_EGRESS_WALK_EXPANDED = 5200;
const MAX_TRANSFER_WALK = 320;
const MAX_TRANSFER_WALK_EXPANDED = 520;
const MAX_ROUTING_WAYPOINTS = 24;
// TRB v56: en buses urbanos SIBUS el abordaje/descenso puede ser sobre el recorrido,
// no necesariamente en un paradero fijo. 10 min caminando ≈ 800 m.
const BUS_FLEXIBLE_STOP_WALK_METERS = 800;
const BUS_FLEXIBLE_STOP_IDEAL_METERS = 360;
const BUS_FLEXIBLE_DESTINATION_WALK_METERS = 900;


// TRB v48 · empresas aliadas autorizadas para conexiones oficiales con Transmetro.
// Se usan todas sus rutas cuando el usuario activa Transbordos oficiales y trabaja con Transmetro.
const OFFICIAL_TRANSMETRO_ALLY_OPERATORS = Object.freeze(['COOASOATLAN', 'COOTRAB', 'COOTRANSNORTE', 'SOBUSA', 'TRANSOLEDAD']);

// TRB v42 · reglas oficiales de transbordo tomadas del resumen SIBUS/Transmetro.
const OFFICIAL_TRANSFER_RULES = Object.freeze([
  {
    id: 'coolitoral-a4-a2',
    title: 'Coolitoral A4-4109 → Coolitoral A2-4107',
    first: { system: 'sibus', operators: ['COOLITORAL'], codes: ['A4-4109'] },
    second: { system: 'sibus', operators: ['COOLITORAL'], codes: ['A2-4107'] },
    firstFareWeekday: 3700, firstFareHoliday: 3800, secondFare: 1300,
    totalWeekday: 5000, totalHoliday: 5100, maxTransferMinutes: 70
  },
  {
    id: 'sodetrans-b15-coolitoral-b17',
    title: 'Sodetrans B15-4129 A/B → Coolitoral B17-4163',
    first: { system: 'sibus', operators: ['SODETRANS'], codes: ['B15-4129 A', 'B15-4129 B'] },
    second: { system: 'sibus', operators: ['COOLITORAL'], codes: ['B17-4163'] },
    firstFareWeekday: 3700, firstFareHoliday: 3800, secondFare: 1300,
    totalWeekday: 5000, totalHoliday: 5100, maxTransferMinutes: 50
  },
  {
    id: 'flota-angulo-a7-coolitoral-pt',
    title: 'Flota Angulo A7-4112 → Coolitoral PT2/PT3',
    first: { system: 'sibus', operators: ['FLOTA-ANGULO', 'FLOTA ANGULO'], codes: ['A7-4112'] },
    second: { system: 'sibus', operators: ['COOLITORAL'], codes: ['PT2-4102', 'PT3-4103'] },
    firstFareWeekday: 3700, firstFareHoliday: 3800, secondFare: 1300,
    totalWeekday: 5000, totalHoliday: 5100, maxTransferMinutes: 70
  },
  {
    id: 'trasalfa-d14-d15-coolitoral-b17',
    title: 'Trasalfa D14/D15 → Coolitoral B17-4163',
    first: { system: 'sibus', operators: ['TRASALFA'], codes: ['D14-4156', 'D15-4157'] },
    second: { system: 'sibus', operators: ['COOLITORAL'], codes: ['B17-4163'] },
    firstFareWeekday: 3700, firstFareHoliday: 3800, secondFare: 1300,
    totalWeekday: 5000, totalHoliday: 5100, maxTransferMinutes: 70,
    note: 'Ruta Makro-Buenavista en alianza con Sodis.'
  },
  {
    id: 'coochofal-c4-c9-c18',
    title: 'Coochofal C4-4135 → Coochofal C9/C18',
    first: { system: 'sibus', operators: ['COOCHOFAL'], codes: ['C4-4135'] },
    second: { system: 'sibus', operators: ['COOCHOFAL'], codes: ['C9-4140', 'C18-4141'] },
    firstFareWeekday: 3700, firstFareHoliday: 3800, secondFare: 1300,
    totalWeekday: 5000, totalHoliday: 5100, maxTransferMinutes: 60
  },
  {
    id: 'transmetro-to-sibus-allies',
    title: 'Transmetro → buses aliados',
    first: { system: 'transmetro' },
    second: { system: 'sibus', operators: OFFICIAL_TRANSMETRO_ALLY_OPERATORS },
    firstFareWeekday: 3700, firstFareHoliday: 3800, secondFare: 2100,
    totalWeekday: 5800, totalHoliday: 5900, maxTransferMinutes: 105,
    note: 'Empresas aliadas: Cooasatlán, Cootrab, Cootransnorte, Sobusa y Transoledad. Se permiten todas sus rutas.'
  },
  {
    id: 'sibus-allies-to-transmetro',
    title: 'Buses aliados → Transmetro',
    first: { system: 'sibus', operators: OFFICIAL_TRANSMETRO_ALLY_OPERATORS },
    second: { system: 'transmetro' },
    firstFareWeekday: 3700, firstFareHoliday: 3800, secondFare: 2100,
    totalWeekday: 5800, totalHoliday: 5900, maxTransferMinutes: 105,
    note: 'Empresas aliadas: Cooasatlán, Cootrab, Cootransnorte, Sobusa y Transoledad. Se permiten todas sus rutas.'
  }
]);

function normalizeOfficialToken(value = '') {
  return normalize(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function routeMatchesOfficialSide(route = {}, side = {}) {
  const system = plannerRouteSystem(route);
  if (side.system && system !== side.system) return false;
  if (Array.isArray(side.operators) && side.operators.length) {
    const operator = normalizeOfficialToken(route.operator || route.empresa || route.company || '');
    if (!side.operators.some(item => normalizeOfficialToken(item) === operator)) return false;
  }
  if (Array.isArray(side.codes) && side.codes.length) {
    const routeCode = normalizeOfficialToken(route.shortName || route.code || route.ruta || '');
    if (!side.codes.some(code => normalizeOfficialToken(code) === routeCode)) return false;
  }
  return true;
}

function officialTransferRuleForPlan(plan = {}) {
  const legs = (plan.legs || []).filter(leg => leg.mode === 'bus');
  if (legs.length !== 2) return null;
  return OFFICIAL_TRANSFER_RULES.find(rule =>
    routeMatchesOfficialSide(legs[0].route, rule.first) && routeMatchesOfficialSide(legs[1].route, rule.second)
  ) || null;
}

function officialTransferFare(rule) {
  if (!rule) return null;
  const sunday = new Date().getDay() === 0;
  return {
    value: sunday ? rule.totalHoliday : rule.totalWeekday,
    label: 'Transbordo oficial',
    note: `Primer pasaje ${formatCurrency(rule.firstFareWeekday)} / ${formatCurrency(rule.firstFareHoliday)} · segundo pasaje con tarjeta ${formatCurrency(rule.secondFare)} · máximo ${formatOfficialMinutes(rule.maxTransferMinutes)}.`
  };
}

function formatOfficialMinutes(minutes = 0) {
  const value = Number(minutes) || 0;
  if (value >= 60) {
    const h = Math.floor(value / 60);
    const m = value % 60;
    return `${h} h${m ? ` ${m} min` : ''}`;
  }
  return `${value} min`;
}

function applyOfficialTransferMetadata(plan) {
  const rule = officialTransferRuleForPlan(plan);
  if (!rule) return plan;
  plan.officialTransfer = {
    id: rule.id,
    title: rule.title,
    firstFareWeekday: rule.firstFareWeekday,
    firstFareHoliday: rule.firstFareHoliday,
    secondFare: rule.secondFare,
    totalWeekday: rule.totalWeekday,
    totalHoliday: rule.totalHoliday,
    maxTransferMinutes: rule.maxTransferMinutes,
    note: rule.note || '',
    source: 'Resumen de transbordos SIBUS y Transmetro'
  };
  plan.fare = officialTransferFare(rule);
  plan.score = (Number(plan.score) || 0) - 750;
  plan.officialTransferRank = 0;
  return plan;
}

function officialTransferBadgeHTML(plan) {
  const info = plan?.officialTransfer;
  if (!info) return '';
  return `<span class="official-transfer-badge">✓ Transbordo oficial · 2.º pasaje ${formatCurrency(info.secondFare)} · total ${formatCurrency(info.totalWeekday)} / ${formatCurrency(info.totalHoliday)} · máx. ${formatOfficialMinutes(info.maxTransferMinutes)}</span>`;
}

function officialTransferNoteHTML(plan) {
  const info = plan?.officialTransfer;
  if (!info) return '';
  return `<div class="official-transfer-note"><span>✓</span><p><b>${escapeHTML(info.title)}</b><br>Con tarjeta SIBUS/Transmetro: primer pasaje ${formatCurrency(info.firstFareWeekday)} de lunes a sábado o ${formatCurrency(info.firstFareHoliday)} domingos/festivos; segundo pasaje ${formatCurrency(info.secondFare)}; total ${formatCurrency(info.totalWeekday)} / ${formatCurrency(info.totalHoliday)}. Tiempo máximo: ${formatOfficialMinutes(info.maxTransferMinutes)}.${info.note ? ` ${escapeHTML(info.note)}` : ''}</p></div>`;
}
const transferGridCache = new WeakMap();
const sleep = ms => new Promise(resolve => window.setTimeout(resolve, ms));

function plannerStopObjects(route) {
  return route.stopIds.map(id => state.stopsById.get(String(id))).filter(stop => stop && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));
}

function pointFromStop(stop) {
  return { lat: stop.latitude, lng: stop.longitude, label: stop.name, stop };
}

function geocodeCacheSave() {
  const entries = [...state.geocodeCache.entries()].slice(-80);
  storage.set('trb-geocode-cache', JSON.stringify(Object.fromEntries(entries)));
}


function locationSuggestionScore(label, query, aliases = []) {
  const q = normalize(query);
  if (!q) return 0;
  const values = [label, ...(aliases || [])].map(normalize).filter(Boolean);
  let best = 0;
  values.forEach(text => {
    if (text === q) best = Math.max(best, 140);
    else if (text.startsWith(q)) best = Math.max(best, 115);
    else if (text.split(/\s+/).some(word => word.startsWith(q))) best = Math.max(best, 92);
    else if (text.includes(q)) best = Math.max(best, 76);
    const tokens = q.split(/\s+/).filter(Boolean);
    const matched = tokens.filter(token => text.includes(token)).length;
    if (matched) best = Math.max(best, 34 + matched * 14);
  });
  return best;
}

function uniqueLocationSuggestions(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${normalize(item.label)}|${Number(item.lat).toFixed(5)}|${Number(item.lng).toFixed(5)}`;
    if (!Number.isFinite(Number(item.lat)) || !Number.isFinite(Number(item.lng)) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function placeSuggestionIcon(type = '') {
  const value = normalize(type);
  if (value.includes('universidad') || value.includes('colegio') || value.includes('escuela')) return '▤';
  if (value.includes('hospital') || value.includes('clinica') || value.includes('salud')) return '✚';
  if (value.includes('centro comercial') || value.includes('comercio')) return '▦';
  if (value.includes('barrio') || value.includes('sector') || value.includes('localidad')) return '⌂';
  if (value.includes('estacion') || value.includes('paradero') || value.includes('terminal')) return '▣';
  if (value.includes('aeropuerto')) return '✈';
  if (value.includes('playa') || value.includes('atraccion') || value.includes('parque')) return '◆';
  return '⌖';
}

function buildLocationSuggestions(query, remoteItems = []) {
  const q = normalize(query);
  if (!q) return [];
  const candidates = [];
  if (state.plannerCurrentPosition && /^(m|mi|ubi|ubicacion|aqui)/.test(q)) {
    candidates.push({ ...state.plannerCurrentPosition, label: 'Mi ubicación', type: 'Ubicación actual', icon: '◎', score: 160 });
  }
  PLANNER_LANDMARKS.forEach(item => {
    const score = locationSuggestionScore(item.name, q, item.aliases);
    if (score) candidates.push({ ...item, label: item.name, type: item.type || 'Lugar destacado', icon: placeSuggestionIcon(item.type), score: score + 18 });
  });
  state.stops.forEach(stop => {
    const score = locationSuggestionScore(stop.name, q);
    if (score) candidates.push({ lat: stop.latitude, lng: stop.longitude, label: stop.name, type: stop.locationType === 1 ? 'Estación' : 'Paradero', icon: stop.locationType === 1 ? '▣' : '●', score });
  });
  for (const value of state.geocodeCache.values()) {
    if (!value?.label) continue;
    const score = locationSuggestionScore(value.label, q);
    if (score) candidates.push({ ...value, type: 'Búsqueda reciente', icon: '↻', score: score + 5 });
  }
  remoteItems.forEach(item => {
    const score = Number(item.score) || locationSuggestionScore(item.label, q);
    candidates.push({ ...item, type: item.type || 'Lugar', icon: item.icon || placeSuggestionIcon(item.type), score: score + 12 });
  });
  return uniqueLocationSuggestions(candidates)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, 'es'))
    .slice(0, 18);
}

function remoteSuggestionKey(query) {
  return normalize(query).replace(/\s+/g, ' ');
}

function normalizeBarranquillaAddress(query = '') {
  let value = query.toString().trim();
  value = value.replace(/\bcarreara\b/gi, 'Carrera').replace(/\bkarrera\b/gi, 'Carrera');
  value = value.replace(/\b(?:cra|cr|kr)\.?\s*(\d)/gi, 'Carrera $1');
  value = value.replace(/\b(?:cl|cll)\.?\s*(\d)/gi, 'Calle $1');
  value = value.replace(/\bdiag\.?\s*(\d)/gi, 'Diagonal $1');
  value = value.replace(/\b(?:transv?|tv)\.?\s*(\d)/gi, 'Transversal $1');
  value = value.replace(/\b(?:no|nro|numero|número|núm|num)\.?\s*/gi, '# ');
  value = value.replace(/\b(?:esquina|cruce)(?:\s+de)?(?:\s+la)?\s+(?:con|entre)?\s*/gi, '');
  value = value.replace(/(Calle|Carrera|Diagonal|Transversal)\s*([0-9]+[A-Za-z]?)\s*(?:&|\/|\by\b|\bcon\b)\s*(Calle|Carrera|Diagonal|Transversal)\s*([0-9]+[A-Za-z]?)/gi, '$1 $2 con $3 $4');
  value = value.replace(/\s*#\s*/g, ' # ').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
  return value;
}

function intersectionQueryParts(query = '') {
  const clean = normalizeBarranquillaAddress(query);
  const match = clean.match(/\b(Carrera|Calle|Diagonal|Transversal)\s*([0-9]+[A-Za-z]?)\s+con\s+(Carrera|Calle|Diagonal|Transversal)\s*([0-9]+[A-Za-z]?)\b/i);
  if (!match) return null;
  const road = `${match[1]} ${match[2].toUpperCase()}`;
  const cross = `${match[3]} ${match[4].toUpperCase()}`;
  return { road, cross, canonical: `${road} con ${cross}` };
}

async function fetchFinalGeocodeSuggestions(query, limit = 12) {
  const params = new URLSearchParams({ q: normalizeBarranquillaAddress(query), limit: String(limit) });
  const response = await fetch(relativeAppUrl(`api/geocode?${params.toString()}`), { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error('El geocodificador preciso no respondió');
  const payload = await response.json();
  state.placeSearchMeta = payload;
  return Array.isArray(payload.items) ? payload.items : [];
}

async function fetchOnlinePlaceSuggestions(query, limit = 18) {
  const normalizedQuery = normalizeBarranquillaAddress(query);
  const key = remoteSuggestionKey(normalizedQuery);
  if (key.length < 2) return [];
  if (state.locationSuggestionRemote.has(key)) return state.locationSuggestionRemote.get(key);
  const params = new URLSearchParams({ q: normalizedQuery, limit: String(limit) });
  const response = await fetch(relativeAppUrl(`api/place-suggestions?${params.toString()}`), { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error('El buscador de lugares no respondió');
  const payload = await response.json();
  state.placeSearchMeta = payload;
  const items = Array.isArray(payload.items) ? payload.items : [];
  state.locationSuggestionRemote.set(key, items);
  return items;
}

function locationSuggestionContainer(input) {
  return input?.closest('.map-place-field, .journey-field, .home-journey-field, .favorite-place-field')?.querySelector('.location-suggestions') || null;
}

function closeLocationSuggestions(input = null) {
  const targets = input ? [input] : [$('#mapJourneyOrigin'), $('#mapJourneyDestination'), $('#journeyOrigin'), $('#journeyDestination'), $('#homeJourneyOrigin'), $('#homeJourneyDestination'), $('#favoritePlaceInput')];
  targets.forEach(field => {
    const container = locationSuggestionContainer(field);
    if (container) {
      container.classList.add('hidden');
      container.innerHTML = '';
    }
    field?.setAttribute('aria-expanded', 'false');
  });
  state.locationSuggestionTarget = null;
  state.locationSuggestionIndex = -1;
  state.locationSuggestions = [];
}

function renderLocationSuggestions(input, options = {}) {
  const container = locationSuggestionContainer(input);
  if (!container) return;
  const key = remoteSuggestionKey(normalizeBarranquillaAddress(input.value));
  const remoteItems = state.locationSuggestionRemote.get(key) || [];
  const items = buildLocationSuggestions(input.value, remoteItems);
  state.locationSuggestionTarget = input.id;
  state.locationSuggestions = items;
  state.locationSuggestionIndex = -1;
  if (!items.length) {
    const message = options.loading
      ? 'Buscando universidades, barrios, hospitales, colegios y otros lugares…'
      : input.value.trim().length < 2
        ? 'Escribe al menos dos letras para buscar direcciones o lugares.'
        : 'No hay coincidencias locales. Espera un momento o completa el nombre del lugar.';
    container.innerHTML = `<div class="location-suggestion-empty">${escapeHTML(message)}</div>`;
    container.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    return;
  }
  container.innerHTML = items.map((item, index) => {
    const precision = item.approximate ? 'Ubicación aproximada' : item.accuracy ? `Precisión: ${item.accuracy}` : '';
    const detail = [item.type || 'Lugar', item.detail || item.secondary || '', precision, item.source || ''].filter(Boolean).join(' · ');
    return `<div class="location-suggestion ${item.approximate ? 'is-approximate' : ''}" role="option" data-location-suggestion="${index}" aria-selected="false"><span class="location-suggestion-icon">${item.icon || '⌖'}</span><span><b>${escapeHTML(item.label)}</b><small>${escapeHTML(detail)}</small></span></div>`;
  }).join('');
  if (options.loading) container.insertAdjacentHTML('beforeend', '<div class="location-suggestion-searching">Buscando más lugares…</div>');
  container.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');
}

async function loadOnlineLocationSuggestions(input) {
  const query = input?.value.trim() || '';
  if (query.length < 2) return;
  const requestId = ++state.locationSuggestionRequestId;
  const targetId = input.id;
  renderLocationSuggestions(input, { loading: true });
  try {
    await fetchOnlinePlaceSuggestions(query, 18);
  } catch (error) {
    console.warn('[TRB] Autocompletado en línea no disponible:', error);
  }
  if (requestId !== state.locationSuggestionRequestId || input.id !== targetId || normalize(input.value) !== normalize(query)) return;
  renderLocationSuggestions(input, { loading: false });
}

function chooseLocationSuggestion(input, item) {
  if (!input || !item) return;
  input.value = item.label;
  const location = { lat: Number(item.lat), lng: Number(item.lng), label: item.label, source: item.source || item.type || 'suggestion', approximate: Boolean(item.approximate), accuracy: item.accuracy || '' };
  state.geocodeCache.set(normalize(item.label), location);
  geocodeCacheSave();
  input.dataset.selectedLocation = JSON.stringify(location);
  closeLocationSuggestions();
  if (input.id === 'mapJourneyOrigin' || input.id === 'mapJourneyDestination') {
    replaceMapPickerLayer(input.id === 'mapJourneyOrigin' ? 'origin' : 'destination', location.lat, location.lng);
  }
}

function moveLocationSuggestion(input, direction) {
  if (!state.locationSuggestions.length || state.locationSuggestionTarget !== input.id) return;
  state.locationSuggestionIndex = (state.locationSuggestionIndex + direction + state.locationSuggestions.length) % state.locationSuggestions.length;
  const container = locationSuggestionContainer(input);
  $$('.location-suggestion', container).forEach((button, index) => {
    const active = index === state.locationSuggestionIndex;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) button.scrollIntoView({ block: 'nearest' });
  });
}

async function updatePlaceSearchStatus() {
  const nodes = [$('#placeSearchStatus'), $('#mapPlaceSearchStatus')].filter(Boolean);
  if (!nodes.length) return;
  try {
    const response = await fetch(relativeAppUrl('api/search-status'), { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error('sin estado');
    const status = await response.json();
    const message = status.googlePlaces || status.googleGeocoding
      ? 'Buscador ampliado activo: direcciones, cruces de calles, negocios y lugares.'
      : 'Buscador OpenStreetMap activo: reconoce direcciones y cruces como Calle 27C con Carrera 41.';
    nodes.forEach(node => { node.textContent = message; node.classList.toggle('is-premium', Boolean(status.googlePlaces || status.googleGeocoding)); });
  } catch {
    nodes.forEach(node => { node.textContent = 'Buscador OpenStreetMap activo · admite direcciones, cruces de calles y lugares.'; });
  }
}

function setupLocationAutocomplete() {
  [$('#mapJourneyOrigin'), $('#mapJourneyDestination'), $('#journeyOrigin'), $('#journeyDestination'), $('#homeJourneyOrigin'), $('#homeJourneyDestination'), $('#favoritePlaceInput')].forEach(input => {
    if (!input) return;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.addEventListener('input', () => {
      delete input.dataset.selectedLocation;
      window.clearTimeout(state.locationSuggestionTimer);
      window.clearTimeout(state.locationSuggestionOnlineTimer);
      state.locationSuggestionTimer = window.setTimeout(() => renderLocationSuggestions(input), 45);
      state.locationSuggestionOnlineTimer = window.setTimeout(() => loadOnlineLocationSuggestions(input), 360);
    });
    input.addEventListener('focus', () => {
      if (!input.value.trim()) return;
      renderLocationSuggestions(input);
      window.clearTimeout(state.locationSuggestionOnlineTimer);
      state.locationSuggestionOnlineTimer = window.setTimeout(() => loadOnlineLocationSuggestions(input), 220);
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveLocationSuggestion(input, 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveLocationSuggestion(input, -1); }
      else if (event.key === 'Enter' && state.locationSuggestionTarget === input.id && state.locationSuggestionIndex >= 0) {
        event.preventDefault();
        chooseLocationSuggestion(input, state.locationSuggestions[state.locationSuggestionIndex]);
      } else if (event.key === 'Escape') closeLocationSuggestions(input);
    });
    const container = locationSuggestionContainer(input);
    container?.addEventListener('mousedown', event => event.preventDefault());
    container?.addEventListener('click', event => {
      const button = event.target.closest('[data-location-suggestion]');
      if (!button) return;
      chooseLocationSuggestion(input, state.locationSuggestions[Number(button.dataset.locationSuggestion)]);
    });
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.map-place-field, .journey-field')) closeLocationSuggestions();
  });
}

function selectedInputLocation(input) {
  try {
    const value = JSON.parse(input?.dataset?.selectedLocation || 'null');
    if (value && normalize(input.value) === normalize(value.label) && Number.isFinite(Number(value.lat)) && Number.isFinite(Number(value.lng))) return value;
  } catch {}
  return null;
}

function localLocationMatch(query) {
  const q = normalize(query);
  if (!q) return null;
  const coordinateMatch = String(query).trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lng = Number(coordinateMatch[2]);
    if (lat >= 10.70 && lat <= 11.25 && lng >= -75.15 && lng <= -74.50) return { lat, lng, label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, source: 'coordinates' };
  }
  if (/^(mi ubicacion|ubicacion actual|aqui)$/.test(q) && state.plannerCurrentPosition) {
    return { ...state.plannerCurrentPosition, label: 'Mi ubicación', source: 'device' };
  }
  const landmark = PLANNER_LANDMARKS.find(item => {
    const values = [item.name, ...(item.aliases || [])].map(normalize);
    return values.some(value => value === q || value.includes(q) || q.includes(value));
  });
  if (landmark) return { ...landmark, label: landmark.name, source: 'local' };
  const exactStop = state.stops.find(stop => normalize(stop.name) === q);
  if (exactStop) return { lat: exactStop.latitude, lng: exactStop.longitude, label: exactStop.name, source: 'stop' };
  if (q.length >= 6) {
    const fuzzyStop = state.stops.find(stop => normalize(stop.name).includes(q) || q.includes(normalize(stop.name)));
    if (fuzzyStop) return { lat: fuzzyStop.latitude, lng: fuzzyStop.longitude, label: fuzzyStop.name, source: 'stop' };
  }
  return null;
}

function geocodeResultScore(item, query) {
  const label = normalize(item?.display_name || '');
  const q = normalize(query);
  const tokens = q.split(/\s+/).filter(token => token.length > 2);
  let score = 0;
  if (label === q) score += 180;
  if (label.startsWith(q)) score += 120;
  if (label.includes(q)) score += 90;
  score += tokens.filter(token => label.includes(token)).length * 24;
  const type = normalize(item?.type || '');
  const category = normalize(item?.category || item?.class || '');
  const broad = ['state', 'county', 'department', 'administrative', 'region', 'province'];
  if (broad.includes(type) || (category === 'boundary' && type === 'administrative')) score -= 130;
  if (['house', 'residential', 'neighbourhood', 'suburb', 'quarter', 'station', 'stop', 'attraction', 'beach'].includes(type)) score += 45;
  const address = item?.address || {};
  if (address.city || address.town || address.municipality || address.suburb || address.neighbourhood) score += 18;
  return score;
}

async function fetchGeocodeCandidates(queryText) {
  const elapsed = Date.now() - state.geocodeLastAt;
  if (elapsed < 1050) await sleep(1050 - elapsed);
  state.geocodeLastAt = Date.now();
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: queryText,
    limit: '8',
    countrycodes: 'co',
    addressdetails: '1',
    'accept-language': 'es',
    viewbox: '-75.12,11.22,-74.55,10.72',
    bounded: '1'
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('El servicio de búsqueda de direcciones no respondió');
  return response.json();
}

async function geocodeAddress(query, input = null) {
  const clean = normalizeBarranquillaAddress(query);
  const selected = selectedInputLocation(input);
  if (selected) return selected;
  const local = localLocationMatch(clean);
  if (local) return local;
  const cacheKey = `v31:${normalize(clean)}`;
  if (state.geocodeCache.has(cacheKey)) return state.geocodeCache.get(cacheKey);
  if (!navigator.onLine) throw new Error(`No pude buscar “${clean}” sin conexión`);

  try {
    const exactItems = await fetchFinalGeocodeSuggestions(clean, 12);
    if (exactItems.length) {
      const best = exactItems.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))[0];
      const location = {
        lat: Number(best.lat), lng: Number(best.lng), label: best.label || clean,
        source: best.source || 'geocoder', approximate: Boolean(best.approximate), accuracy: best.accuracy || ''
      };
      state.geocodeCache.set(cacheKey, location);
      geocodeCacheSave();
      return location;
    }
  } catch (error) {
    console.warn('[TRB] Geocodificador preciso no disponible:', error);
  }

  try {
    const onlineItems = await fetchOnlinePlaceSuggestions(clean, 18);
    if (onlineItems.length) {
      const bestOnline = onlineItems.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))[0];
      const location = { lat: Number(bestOnline.lat), lng: Number(bestOnline.lng), label: bestOnline.label, source: bestOnline.source || 'place-search', approximate: Boolean(bestOnline.approximate) };
      state.geocodeCache.set(cacheKey, location);
      geocodeCacheSave();
      return location;
    }
  } catch (error) {
    console.warn('[TRB] Se usará la búsqueda final de respaldo:', error);
  }

  const queryVariants = [`${clean}, Barranquilla, Atlántico, Colombia`, `${clean}, Atlántico, Colombia`];
  const addressMatch = clean.match(/^(Carrera|Calle|Diagonal|Transversal)\s*([0-9]+[A-Za-z]?)\s*#\s*([0-9]+[A-Za-z]?)-([0-9]+[A-Za-z]?)$/i);
  if (addressMatch) {
    const road = `${addressMatch[1]} ${addressMatch[2]}`;
    const crossType = /^calle$/i.test(addressMatch[1]) ? 'Carrera' : 'Calle';
    queryVariants.push(`${road} con ${crossType} ${addressMatch[3]}, Barranquilla, Atlántico, Colombia`);
  }
  const intersection = intersectionQueryParts(clean);
  if (intersection) {
    queryVariants.push(
      `${intersection.road} con ${intersection.cross}, Barranquilla, Atlántico, Colombia`,
      `${intersection.road} y ${intersection.cross}, Barranquilla, Atlántico, Colombia`,
      `${intersection.road}, ${intersection.cross}, Barranquilla, Atlántico, Colombia`
    );
  }

  const collected = [];
  for (const variant of [...new Set(queryVariants)]) {
    const results = await fetchGeocodeCandidates(variant);
    results.forEach(item => {
      const lat = Number(item.lat), lng = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 10.70 || lat > 11.25 || lng < -75.15 || lng > -74.50) return;
      collected.push({ item, score: geocodeResultScore(item, clean), lat, lng });
    });
    const bestNow = collected.slice().sort((a, b) => b.score - a.score)[0];
    if (bestNow && bestNow.score >= 125) break;
  }

  const best = collected.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 15) throw new Error(`No encontré “${clean}” dentro del área metropolitana de Barranquilla. Elige una sugerencia o toca el punto en el mapa.`);
  const display = best.item.display_name || clean;
  const location = { lat: best.lat, lng: best.lng, label: display.split(',').slice(0, 4).join(',').trim(), source: 'Nominatim · OpenStreetMap' };
  state.geocodeCache.set(cacheKey, location);
  geocodeCacheSave();
  return location;
}

function adjustedWalkDistance(a, b) {
  return Math.max(0, haversine(a.lat, a.lng, b.lat, b.lng) * 1.18);
}

function nearestStopCandidates(point, stops, limit = 5) {
  return stops.map((stop, index) => ({ index, stop, distance: adjustedWalkDistance(point, { lat: stop.latitude, lng: stop.longitude }) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

function segmentDistance(stops, startIndex, endIndex) {
  let total = 0;
  for (let index = startIndex; index < endIndex; index++) {
    const a = stops[index], b = stops[index + 1];
    if (!a || !b) continue;
    total += haversine(a.latitude, a.longitude, b.latitude, b.longitude);
  }
  return total;
}

function finalizeJourneyPlan(plan) {
  const walkLegs = plan.legs.filter(leg => leg.mode === 'walk');
  const bikeLegs = plan.legs.filter(leg => leg.mode === 'bike');
  const busLegs = plan.legs.filter(leg => leg.mode === 'bus');
  plan.walkMeters = walkLegs.reduce((sum, leg) => sum + (Number(leg.distance) || 0), 0);
  plan.bikeMeters = bikeLegs.reduce((sum, leg) => sum + (Number(leg.distance) || 0), 0);
  plan.rideMeters = busLegs.reduce((sum, leg) => sum + (Number(leg.distance) || 0), 0);
  plan.walkMinutes = walkLegs.length ? Math.max(1, Math.ceil(walkLegs.reduce((sum, leg) => sum + (leg.duration || leg.distance / WALK_SPEED_MPS), 0) / 60)) : 0;
  plan.bikeMinutes = bikeLegs.length ? Math.max(1, Math.ceil(bikeLegs.reduce((sum, leg) => sum + (leg.duration || leg.distance / BIKE_SPEED_MPS), 0) / 60)) : 0;
  plan.rideMinutes = busLegs.length ? Math.max(1, Math.ceil(busLegs.reduce((sum, leg) => sum + (leg.duration || (leg.distance / BUS_SPEED_MPS + (leg.stopCount || 0) * 18)), 0) / 60)) : 0;
  plan.totalMinutes = plan.walkMinutes + plan.bikeMinutes + plan.rideMinutes;
  plan.transfers = Math.max(0, busLegs.length - 1);
  return applyOfficialTransferMetadata(plan);
}

function makeDirectPlan(route, stops, origin, destination, boarding, alighting) {
  const boardPoint = pointFromStop(boarding.stop);
  const alightPoint = pointFromStop(alighting.stop);
  const rideDistance = segmentDistance(stops, boarding.index, alighting.index);
  const isFlexibleBus = plannerRouteSystem(route) === 'sibus';
  let score = (boarding.distance + alighting.distance) * 1.4 + rideDistance * .075;
  if (isFlexibleBus) {
    // TRB v56: si el bus urbano pasa cerca, no castigues una caminata razonable
    // de 4-10 min ni fuerces transbordos innecesarios.
    score = (boarding.distance + alighting.distance) * .75 + rideDistance * .075;
    if (boarding.distance <= BUS_FLEXIBLE_STOP_WALK_METERS && alighting.distance <= BUS_FLEXIBLE_DESTINATION_WALK_METERS) score -= 2600;
    if (boarding.distance <= BUS_FLEXIBLE_STOP_IDEAL_METERS) score -= 500;
  }
  const plan = finalizeJourneyPlan({
    type: 'direct',
    score,
    flexibleBoarding: isFlexibleBus,
    origin,
    destination,
    legs: [
      { mode: 'walk', from: origin, to: boardPoint, distance: boarding.distance },
      { mode: 'bus', route, stops, startIndex: boarding.index, endIndex: alighting.index, from: boardPoint, to: alightPoint, distance: rideDistance, stopCount: isFlexibleBus ? null : alighting.index - boarding.index, flexibleBoarding: isFlexibleBus },
      { mode: 'walk', from: alightPoint, to: destination, distance: alighting.distance }
    ]
  });
  if (isFlexibleBus && boarding.distance <= BUS_FLEXIBLE_STOP_WALK_METERS && alighting.distance <= BUS_FLEXIBLE_DESTINATION_WALK_METERS) plan.reasonableDirectBus = true;
  return plan;
}

function makeTransferPlan(routeA, stopsA, routeB, stopsB, origin, destination, boarding, transferA, transferB, alighting) {
  const boardPoint = pointFromStop(boarding.stop);
  const transferAPoint = pointFromStop(transferA.stop);
  const transferBPoint = pointFromStop(transferB.stop);
  const alightPoint = pointFromStop(alighting.stop);
  const rideA = segmentDistance(stopsA, boarding.index, transferA.index);
  const rideB = segmentDistance(stopsB, transferB.index, alighting.index);
  const transferWalk = adjustedWalkDistance(transferAPoint, transferBPoint);
  return finalizeJourneyPlan({
    type: 'transfer',
    score: (boarding.distance + alighting.distance + transferWalk) * 1.42 + (rideA + rideB) * .075 + 1800,
    origin,
    destination,
    legs: [
      { mode: 'walk', from: origin, to: boardPoint, distance: boarding.distance },
      { mode: 'bus', route: routeA, stops: stopsA, startIndex: boarding.index, endIndex: transferA.index, from: boardPoint, to: transferAPoint, distance: rideA, stopCount: transferA.index - boarding.index },
      { mode: 'walk', from: transferAPoint, to: transferBPoint, distance: transferWalk, isTransfer: true },
      { mode: 'bus', route: routeB, stops: stopsB, startIndex: transferB.index, endIndex: alighting.index, from: transferBPoint, to: alightPoint, distance: rideB, stopCount: alighting.index - transferB.index },
      { mode: 'walk', from: alightPoint, to: destination, distance: alighting.distance }
    ]
  });
}

function makeDoubleTransferPlan(routeA, stopsA, routeB, stopsB, routeC, stopsC, origin, destination, boarding, transferA1, transferB1, transferB2, transferC2, alighting) {
  const boardPoint = pointFromStop(boarding.stop);
  const firstOut = pointFromStop(transferA1.stop);
  const middleIn = pointFromStop(transferB1.stop);
  const middleOut = pointFromStop(transferB2.stop);
  const lastIn = pointFromStop(transferC2.stop);
  const alightPoint = pointFromStop(alighting.stop);
  const rideA = segmentDistance(stopsA, boarding.index, transferA1.index);
  const rideB = segmentDistance(stopsB, transferB1.index, transferB2.index);
  const rideC = segmentDistance(stopsC, transferC2.index, alighting.index);
  const walk1 = adjustedWalkDistance(firstOut, middleIn);
  const walk2 = adjustedWalkDistance(middleOut, lastIn);
  return finalizeJourneyPlan({
    type: 'double-transfer',
    score: (boarding.distance + alighting.distance + walk1 + walk2) * 1.5 + (rideA + rideB + rideC) * .075 + 3200,
    origin,
    destination,
    legs: [
      { mode: 'walk', from: origin, to: boardPoint, distance: boarding.distance },
      { mode: 'bus', route: routeA, stops: stopsA, startIndex: boarding.index, endIndex: transferA1.index, from: boardPoint, to: firstOut, distance: rideA, stopCount: transferA1.index - boarding.index },
      { mode: 'walk', from: firstOut, to: middleIn, distance: walk1, isTransfer: true },
      { mode: 'bus', route: routeB, stops: stopsB, startIndex: transferB1.index, endIndex: transferB2.index, from: middleIn, to: middleOut, distance: rideB, stopCount: transferB2.index - transferB1.index },
      { mode: 'walk', from: middleOut, to: lastIn, distance: walk2, isTransfer: true },
      { mode: 'bus', route: routeC, stops: stopsC, startIndex: transferC2.index, endIndex: alighting.index, from: lastIn, to: alightPoint, distance: rideC, stopCount: alighting.index - transferC2.index },
      { mode: 'walk', from: alightPoint, to: destination, distance: alighting.distance }
    ]
  });
}

function findDirectJourneyPlans(origin, destination, routeData, options = {}) {
  const maxAccessWalk = options.maxAccessWalk ?? MAX_ACCESS_WALK;
  const maxEgressWalk = options.maxEgressWalk ?? maxAccessWalk;
  const maxTotalWalk = options.maxTotalWalk ?? Math.max(3000, maxAccessWalk + maxEgressWalk);
  const minRideMeters = options.minRideMeters ?? 350;
  const candidateCount = options.candidateCount ?? 6;
  const plans = [];
  routeData.forEach(({ route, stops }) => {
    const originCandidates = nearestStopCandidates(origin, stops, candidateCount);
    const destinationCandidates = nearestStopCandidates(destination, stops, candidateCount);
    let best = null;
    originCandidates.forEach(boarding => destinationCandidates.forEach(alighting => {
      if (alighting.index <= boarding.index || boarding.distance > maxAccessWalk || alighting.distance > maxEgressWalk) return;
      const plan = makeDirectPlan(route, stops, origin, destination, boarding, alighting);
      if (plan.walkMeters > maxTotalWalk || plan.rideMeters < minRideMeters) return;
      if (options.expanded) {
        plan.expandedSearch = true;
        plan.score += Math.max(0, plan.walkMeters - MAX_ACCESS_WALK * 2) * 0.35;
      }
      if (!best || plan.score < best.score) best = plan;
    }));
    if (best) plans.push(best);
  });
  return plans;
}

function transferStopGrid(stops) {
  if (transferGridCache.has(stops)) return transferGridCache.get(stops);
  const cell = 0.0042;
  const grid = new Map();
  stops.forEach((stop, index) => {
    const x = Math.floor(Number(stop.longitude) / cell);
    const y = Math.floor(Number(stop.latitude) / cell);
    const key = `${x}:${y}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ stop, index });
  });
  const value = { cell, grid };
  transferGridCache.set(stops, value);
  return value;
}

function bestTransferPair(stopsA, startA, stopsB, endB, maxWalk = MAX_TRANSFER_WALK) {
  let best = null;
  const { cell, grid } = transferStopGrid(stopsB);
  const radius = Math.max(1, Math.ceil((maxWalk / 110000) / cell));
  for (let indexA = startA + 1; indexA < stopsA.length; indexA++) {
    const a = stopsA[indexA];
    const x = Math.floor(Number(a.longitude) / cell);
    const y = Math.floor(Number(a.latitude) / cell);
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const bucket = grid.get(`${x + dx}:${y + dy}`) || [];
        for (const candidate of bucket) {
          if (candidate.index >= endB) continue;
          const b = candidate.stop;
          const distance = adjustedWalkDistance({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
          if (distance > maxWalk) continue;
          if (!best || distance < best.distance) best = { a: { index: indexA, stop: a }, b: { index: candidate.index, stop: b }, distance };
        }
      }
    }
  }
  return best;
}

function findTransferJourneyPlans(origin, destination, routeData, options = {}) {
  const maxAccessWalk = options.maxAccessWalk ?? MAX_ACCESS_WALK;
  const maxEgressWalk = options.maxEgressWalk ?? maxAccessWalk;
  const maxTransferWalk = options.maxTransferWalk ?? MAX_TRANSFER_WALK;
  const maxTotalWalk = options.maxTotalWalk ?? 3500;
  const candidateCount = options.candidateCount ?? 4;
  const plans = [];
  const access = routeData.map(item => ({ ...item, candidates: nearestStopCandidates(origin, item.stops, candidateCount) })).filter(item => item.candidates[0]?.distance <= maxAccessWalk);
  const egress = routeData.map(item => ({ ...item, candidates: nearestStopCandidates(destination, item.stops, candidateCount) })).filter(item => item.candidates[0]?.distance <= maxEgressWalk);

  access.forEach(first => egress.forEach(second => {
    if (first.route.id === second.route.id) return;
    let best = null;
    first.candidates.forEach(boarding => second.candidates.forEach(alighting => {
      if (boarding.distance > maxAccessWalk || alighting.distance > maxEgressWalk) return;
      const transfer = bestTransferPair(first.stops, boarding.index, second.stops, alighting.index, maxTransferWalk);
      if (!transfer || transfer.a.index <= boarding.index || alighting.index <= transfer.b.index) return;
      const plan = makeTransferPlan(first.route, first.stops, second.route, second.stops, origin, destination, boarding, transfer.a, transfer.b, alighting);
      if (plan.walkMeters > maxTotalWalk || plan.rideMeters < (options.minRideMeters ?? 600)) return;
      if (options.expanded) {
        plan.expandedSearch = true;
        plan.score += Math.max(0, plan.walkMeters - MAX_ACCESS_WALK * 2) * 0.35;
      }
      if (!best || plan.score < best.score) best = plan;
    }));
    if (best) plans.push(best);
  }));
  return plans;
}

function findJourneyPlans(origin, destination) {
  const routeData = state.routes.map(route => ({ route, stops: plannerStopObjects(route) })).filter(item => item.stops.length >= 3);
  const direct = findDirectJourneyPlans(origin, destination, routeData);
  const transfers = findTransferJourneyPlans(origin, destination, routeData);
  const unique = new Map();
  [...direct, ...transfers].sort((a, b) => a.score - b.score).forEach(plan => {
    const key = plan.legs.filter(leg => leg.mode === 'bus').map(leg => normalize(leg.route.shortName).replace(/[^a-z0-9]/g, '')).join('|');
    if (!unique.has(key)) unique.set(key, plan);
  });
  return [...unique.values()].sort((a, b) => a.score - b.score).slice(0, 3);
}


function plannerRouteSystem(route = {}) {
  if (route.system) return route.system;
  if (normalize(route.operator || '').includes('transmetro')) return 'transmetro';
  return route.kmzSource || route.operator ? 'sibus' : 'transmetro';
}

function makeActiveJourneyPlan(mode, origin, destination) {
  const factor = mode === 'bike' ? 1.12 : 1.18;
  const speed = mode === 'bike' ? BIKE_SPEED_MPS : WALK_SPEED_MPS;
  const distance = Math.round(haversine(origin.lat, origin.lng, destination.lat, destination.lng) * factor);
  const minutes = Math.max(1, Math.ceil(distance / speed / 60));
  return {
    engine: 'active', type: mode, origin, destination, route: null,
    walkMeters: mode === 'walk' ? distance : 0,
    walkMinutes: mode === 'walk' ? minutes : 0,
    bikeMeters: mode === 'bike' ? distance : 0,
    bikeMinutes: mode === 'bike' ? minutes : 0,
    rideMeters: 0, rideMinutes: 0, totalMinutes: minutes, transfers: 0,
    legs: [{ mode, from: origin, to: destination, distance, duration: minutes * 60, label: mode === 'bike' ? 'Recorrido en bicicleta' : 'Caminata completa' }]
  };
}

function plannerStopsFromPath(path, route, maximum = 420) {
  const coordinates = Array.isArray(path.coordinates) ? path.coordinates : [];
  if (coordinates.length < 2) return [];
  let pathMeters = 0;
  for (let index = 0; index < coordinates.length - 1; index++) {
    const [lngA, latA] = coordinates[index];
    const [lngB, latB] = coordinates[index + 1];
    pathMeters += haversine(latA, lngA, latB, lngB);
  }

  // TRB v56: para SIBUS los puntos del planificador son puntos flexibles sobre
  // el trazado oficial, porque el bus urbano puede recoger/dejar a la persona en
  // el trayecto. Transmetro conserva sus estaciones/paraderos reales en state.routes.
  const isFlexibleBus = plannerRouteSystem(route) === 'sibus';
  // TRB v61: baja la densidad de puntos flexibles para que el cálculo inicial
  // no se demore tanto. El bus sigue pudiendo recoger/dejar sobre el recorrido,
  // pero el planificador ya no crea cientos de puntos innecesarios por ruta.
  const intervalMeters = isFlexibleBus ? 115 : 140;
  const minSamples = isFlexibleBus ? 55 : 70;
  const maxSamples = isFlexibleBus ? Math.max(260, Math.min(320, maximum)) : maximum;
  const desired = Math.max(minSamples, Math.min(maxSamples, Math.ceil(pathMeters / intervalMeters)));
  const indexes = sampleCoordinateIndexes(coordinates.length, desired);
  return indexes.map((pathIndex, index) => {
    const [lng, lat] = coordinates[pathIndex];
    const flexibleName = index === 0
      ? `Inicio del recorrido ${route.shortName}`
      : index === indexes.length - 1
        ? `Final del recorrido ${route.shortName}`
        : `Punto del recorrido ${route.shortName}`;
    return {
      id: `${route.id}-p${index}`,
      name: isFlexibleBus ? flexibleName : (index === 0 ? `Inicio ${route.shortName}` : index === indexes.length - 1 ? `Final ${route.shortName}` : `${route.shortName} · punto ${index + 1}`),
      latitude: lat,
      longitude: lng,
      flexibleBoarding: isFlexibleBus,
      _pathIndex: pathIndex
    };
  });
}

function officialGeometryForLeg(leg) {
  const coordinates = leg?.route?._pathCoordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const start = Number(leg?.from?.stop?._pathIndex ?? leg?.stops?.[leg.startIndex]?._pathIndex);
  const end = Number(leg?.to?.stop?._pathIndex ?? leg?.stops?.[leg.endIndex]?._pathIndex);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return null;
  const segment = coordinates.slice(start, end + 1)
    .map(([lng, lat]) => [lat, lng])
    .filter(point => point.every(Number.isFinite));
  return segment.length > 1 ? segment : null;
}

async function loadOfficialPlannerRouteData(config) {
  if (state.officialPlannerNetwork) return state.officialPlannerNetwork;
  if (state.officialPlannerNetworkPromise) return state.officialPlannerNetworkPromise;
  state.officialPlannerNetworkPromise = (async () => {
    const items = [];
    const routes = state.routeCatalog?.rutas || [];
    const results = await plannerMapWithConcurrency(routes, async catalogRoute => {
      // TRB v61: en Render se usa /api/route-geometry, que aprovecha la caché del
      // servidor. Si falla, queda el respaldo local/remoto del motor KMZ.
      const loaded = await loadOfficialGeometry(null, catalogRoute)
        .catch(() => window.TRBRouteEngine.loadKmzRoute(catalogRoute, config));
      return { catalogRoute, loaded };
    }, 8);
    results.forEach(result => {
      if (!result || result.error || !result.loaded) return;
      const { catalogRoute, loaded } = result;
      (loaded.paths || []).forEach((path, pathIndex) => {
        const route = {
          id: `sibus::${catalogRoute.id}::${pathIndex}`,
          shortName: catalogRoute.ruta,
          longName: catalogRoute.nombre || `Ruta ${catalogRoute.ruta}`,
          operator: catalogRoute.empresa,
          colorHex: officialRouteColorHex(catalogRoute) || routeFamilyColorHex(catalogRoute.ruta),
          system: 'sibus',
          direction: path.direction,
          kmzSource: loaded.source,
          _pathCoordinates: path.coordinates
        };
        const stops = plannerStopsFromPath(path, route);
        if (stops.length >= 3) items.push({ route, stops });
      });
    });
    state.officialPlannerNetwork = items;
    state.officialPlannerNetworkPromise = null;
    return items;
  })();
  try { return await state.officialPlannerNetworkPromise; }
  catch (error) {
    state.officialPlannerNetworkPromise = null;
    throw error;
  }
}
function nearestRouteDistance(item, point) {
  return nearestStopCandidates(point, item.stops, 1)[0]?.distance ?? Infinity;
}

function findLimitedTransferJourneyPlans(origin, destination, routeData, limit = 18, options = {}) {
  const maxAccessWalk = options.maxAccessWalk ?? 2300;
  const maxEgressWalk = options.maxEgressWalk ?? 2300;
  const maxTransferWalk = options.maxTransferWalk ?? MAX_TRANSFER_WALK;
  const maxTotalWalk = options.maxTotalWalk ?? 3800;
  const candidateCount = options.candidateCount ?? 5;
  const access = routeData
    .map(item => ({ ...item, nearest: nearestRouteDistance(item, origin), candidates: nearestStopCandidates(origin, item.stops, candidateCount) }))
    .filter(item => item.nearest <= maxAccessWalk)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, limit);
  const egress = routeData
    .map(item => ({ ...item, nearest: nearestRouteDistance(item, destination), candidates: nearestStopCandidates(destination, item.stops, candidateCount) }))
    .filter(item => item.nearest <= maxEgressWalk)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, Math.max(limit, options.egressLimit ?? limit));
  const plans = [];
  access.forEach(first => egress.forEach(second => {
    if (first.route.id === second.route.id) return;
    let best = null;
    first.candidates.forEach(boarding => second.candidates.forEach(alighting => {
      const transfer = bestTransferPair(first.stops, boarding.index, second.stops, alighting.index, maxTransferWalk);
      if (!transfer || transfer.a.index <= boarding.index || alighting.index <= transfer.b.index) return;
      const plan = makeTransferPlan(first.route, first.stops, second.route, second.stops, origin, destination, boarding, transfer.a, transfer.b, alighting);
      if (plan.walkMeters > maxTotalWalk || plan.rideMeters < (options.minRideMeters ?? 700)) return;
      const systems = new Set(plan.legs.filter(leg => leg.mode === 'bus').map(leg => plannerRouteSystem(leg.route)));
      plan.engine = systems.size > 1 ? 'multimodal' : 'network';
      if (options.expanded) {
        plan.expandedSearch = true;
        plan.score += Math.max(0, plan.walkMeters - MAX_ACCESS_WALK * 2) * 0.35;
      }
      if (!best || plan.score < best.score) best = plan;
    }));
    if (best) plans.push(best);
  }));
  return plans.sort((a, b) => a.totalMinutes - b.totalMinutes || a.walkMeters - b.walkMeters).slice(0, options.resultLimit ?? 14);
}

function findTwoTransferJourneyPlans(origin, destination, routeData, options = {}) {
  const maxAccessWalk = options.maxAccessWalk ?? 2600;
  const maxEgressWalk = options.maxEgressWalk ?? 4600;
  const maxTransferWalk = options.maxTransferWalk ?? MAX_TRANSFER_WALK_EXPANDED;
  const maxTotalWalk = options.maxTotalWalk ?? 6800;
  const access = routeData
    .map(item => ({ ...item, nearest: nearestRouteDistance(item, origin), candidates: nearestStopCandidates(origin, item.stops, 2) }))
    .filter(item => item.nearest <= maxAccessWalk)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, options.accessLimit ?? 7);
  const egress = routeData
    .map(item => ({ ...item, nearest: nearestRouteDistance(item, destination), candidates: nearestStopCandidates(destination, item.stops, 2) }))
    .filter(item => item.nearest <= maxEgressWalk)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, options.egressLimit ?? 9);
  const midpoint = { lat: (origin.lat + destination.lat) / 2, lng: (origin.lng + destination.lng) / 2 };
  const middleRoutes = routeData
    .map(item => ({ ...item, midpointDistance: nearestRouteDistance(item, midpoint) }))
    .sort((a, b) => a.midpointDistance - b.midpointDistance)
    .slice(0, options.middleLimit ?? 20);
  const plans = [];
  access.forEach(first => {
    const boarding = first.candidates[0];
    if (!boarding) return;
    middleRoutes.forEach(middle => {
      if (middle.route.id === first.route.id) return;
      const transfer1 = bestTransferPair(first.stops, boarding.index, middle.stops, middle.stops.length, maxTransferWalk);
      if (!transfer1 || transfer1.a.index <= boarding.index) return;
      egress.forEach(last => {
        if (last.route.id === first.route.id || last.route.id === middle.route.id) return;
        const alighting = last.candidates[0];
        if (!alighting) return;
        const transfer2 = bestTransferPair(middle.stops, transfer1.b.index, last.stops, alighting.index, maxTransferWalk);
        if (!transfer2 || transfer2.a.index <= transfer1.b.index || alighting.index <= transfer2.b.index) return;
        const plan = makeDoubleTransferPlan(first.route, first.stops, middle.route, middle.stops, last.route, last.stops, origin, destination, boarding, transfer1.a, transfer1.b, transfer2.a, transfer2.b, alighting);
        if (plan.walkMeters > maxTotalWalk || plan.rideMeters < (options.minRideMeters ?? 1800)) return;
        const systems = new Set(plan.legs.filter(leg => leg.mode === 'bus').map(leg => plannerRouteSystem(leg.route)));
        if (options.mixedOnly && systems.size < 2) return;
        plan.engine = systems.size > 1 ? 'multimodal' : 'network';
        plan.expandedSearch = true;
        if (systems.size > 1) {
          const connectorMeters = plan.legs.filter(leg => leg.mode === 'bus' && plannerRouteSystem(leg.route) === 'sibus').reduce((sum, leg) => sum + (leg.distance || 0), 0);
          plan.shortBusConnector = connectorMeters > 0 && connectorMeters <= (options.shortConnectorMeters ?? 6500);
        }
        plans.push(plan);
      });
    });
  });
  const unique = new Map();
  plans.sort((a, b) => a.totalMinutes - b.totalMinutes || a.walkMeters - b.walkMeters).forEach(plan => {
    const key = plan.legs.filter(leg => leg.mode === 'bus').map(leg => leg.route.id).join('|');
    if (!unique.has(key)) unique.set(key, plan);
  });
  return [...unique.values()].slice(0, options.resultLimit ?? 8);
}

function findCrossSystemJourneyPlans(origin, destination, firstData, secondData, options = {}) {
  const maxAccessWalk = options.maxAccessWalk ?? 2600;
  const maxEgressWalk = options.maxEgressWalk ?? 3200;
  const maxTransferWalk = options.maxTransferWalk ?? 480;
  const maxTotalWalk = options.maxTotalWalk ?? 5400;
  const candidateCount = options.candidateCount ?? 3;
  const accessLimit = options.accessLimit ?? 24;
  const egressLimit = options.egressLimit ?? 28;
  const access = firstData
    .map(item => ({ ...item, nearest: nearestRouteDistance(item, origin), candidates: nearestStopCandidates(origin, item.stops, candidateCount) }))
    .filter(item => item.nearest <= maxAccessWalk)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, accessLimit);
  const egress = secondData
    .map(item => ({ ...item, nearest: nearestRouteDistance(item, destination), candidates: nearestStopCandidates(destination, item.stops, candidateCount) }))
    .filter(item => item.nearest <= maxEgressWalk)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, egressLimit);
  const plans = [];
  access.forEach(first => egress.forEach(second => {
    let best = null;
    first.candidates.forEach(boarding => second.candidates.forEach(alighting => {
      if (boarding.distance > maxAccessWalk || alighting.distance > maxEgressWalk) return;
      const transfer = bestTransferPair(first.stops, boarding.index, second.stops, alighting.index, maxTransferWalk);
      if (!transfer || transfer.a.index <= boarding.index || alighting.index <= transfer.b.index) return;
      const plan = makeTransferPlan(first.route, first.stops, second.route, second.stops, origin, destination, boarding, transfer.a, transfer.b, alighting);
      if (plan.walkMeters > maxTotalWalk || plan.rideMeters < (options.minRideMeters ?? 900)) return;
      const systems = new Set(plan.legs.filter(leg => leg.mode === 'bus').map(leg => plannerRouteSystem(leg.route)));
      if (systems.size < 2) return;
      plan.engine = 'multimodal';
      const connectorMeters = plan.legs
        .filter(leg => leg.mode === 'bus' && plannerRouteSystem(leg.route) === 'sibus')
        .reduce((sum, leg) => sum + (leg.distance || 0), 0);
      plan.shortBusConnector = connectorMeters > 0 && connectorMeters <= (options.shortConnectorMeters ?? 6500);
      plan.mixedRank = plan.totalMinutes - (plan.shortBusConnector ? 4 : 0) + Math.max(0, plan.walkMinutes - 12) * .25;
      if (!best || plan.mixedRank < best.mixedRank) best = plan;
    }));
    if (best) plans.push(best);
  }));
  const unique = new Map();
  plans.sort((a, b) => a.mixedRank - b.mixedRank || a.walkMeters - b.walkMeters).forEach(plan => {
    const key = plan.legs.filter(leg => leg.mode === 'bus').map(leg => `${plannerRouteSystem(leg.route)}:${leg.route.id}`).join('|');
    if (!unique.has(key)) unique.set(key, plan);
  });
  return [...unique.values()].slice(0, options.resultLimit ?? 12);
}


function findOfficialRuleTransferPlans(origin, destination, firstData, secondData, rule, options = {}) {
  const maxAccessWalk = options.maxAccessWalk ?? 3000;
  const maxEgressWalk = options.maxEgressWalk ?? 3800;
  const maxTransferWalk = options.maxTransferWalk ?? 680;
  const maxTotalWalk = options.maxTotalWalk ?? 7200;
  const candidateCount = options.candidateCount ?? 5;
  const access = firstData
    .map(item => ({ ...item, nearest: nearestRouteDistance(item, origin), candidates: nearestStopCandidates(origin, item.stops, candidateCount) }))
    .filter(item => item.nearest <= maxAccessWalk)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, options.accessLimit ?? 18);
  const egress = secondData
    .map(item => ({ ...item, nearest: nearestRouteDistance(item, destination), candidates: nearestStopCandidates(destination, item.stops, candidateCount) }))
    .filter(item => item.nearest <= maxEgressWalk)
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, options.egressLimit ?? 22);
  const plans = [];
  access.forEach(first => egress.forEach(second => {
    if (first.route.id === second.route.id) return;
    let best = null;
    first.candidates.forEach(boarding => second.candidates.forEach(alighting => {
      if (boarding.distance > maxAccessWalk || alighting.distance > maxEgressWalk) return;
      const transfer = bestTransferPair(first.stops, boarding.index, second.stops, alighting.index, maxTransferWalk);
      if (!transfer || transfer.a.index <= boarding.index || alighting.index <= transfer.b.index) return;
      const plan = makeTransferPlan(first.route, first.stops, second.route, second.stops, origin, destination, boarding, transfer.a, transfer.b, alighting);
      if (!plan.officialTransfer || plan.officialTransfer.id !== rule.id) return;
      if (plan.walkMeters > maxTotalWalk || plan.rideMeters < (options.minRideMeters ?? 650)) return;
      plan.engine = 'official-transfer';
      plan.mixedRank = plan.totalMinutes - 8 + Math.max(0, plan.walkMinutes - 14) * .2;
      if (!best || plan.mixedRank < best.mixedRank) best = plan;
    }));
    if (best) plans.push(best);
  }));
  return plans.sort((a, b) => a.mixedRank - b.mixedRank || a.walkMeters - b.walkMeters).slice(0, options.resultLimit ?? 8);
}

function findOfficialTransferJourneyPlans(origin, destination, officialData, transmetroData, options = {}) {
  const allData = [...officialData, ...transmetroData];
  const plans = [];
  OFFICIAL_TRANSFER_RULES.forEach(rule => {
    const firstData = allData.filter(item => routeMatchesOfficialSide(item.route, rule.first));
    const secondData = allData.filter(item => routeMatchesOfficialSide(item.route, rule.second));
    if (!firstData.length || !secondData.length) return;
    plans.push(...findOfficialRuleTransferPlans(origin, destination, firstData, secondData, rule, options));
  });
  const unique = new Map();
  plans.sort(compareMultimodalPlans).forEach(plan => {
    const key = `${plan.officialTransfer?.id || 'official'}:${plan.legs.filter(leg => leg.mode === 'bus').map(leg => `${plannerRouteSystem(leg.route)}:${leg.route.shortName}:${leg.route.id}`).join('|')}`;
    if (!unique.has(key)) unique.set(key, plan);
  });
  return [...unique.values()].slice(0, options.resultLimit ?? 18);
}

async function findUnifiedJourneyPlans(origin, destination, config, settings = {}) {
  const wantsTransmetro = settings.transmetro !== false;
  const wantsOfficial = settings.officialTransfers === true;
  const wantsRegularBus = settings.buses !== false;
  // Si Bus está apagado pero Transmetro + Especiales está activo, se cargan solo
  // para poder conectar Transmetro con las empresas oficiales aliadas.
  const wantsOfficialBusConnector = wantsOfficial && wantsTransmetro;
  const wantsBusData = wantsRegularBus || wantsOfficialBusConnector;

  const transmetroData = wantsTransmetro ? state.routes
    .map(route => ({ route: { ...route, system: 'transmetro', operator: route.operator || 'Transmetro' }, stops: plannerStopObjects(route) }))
    .filter(item => item.stops.length >= 3) : [];
  const officialData = wantsBusData ? await loadOfficialPlannerRouteData(config) : [];
  const all = [...transmetroData, ...officialData];

  const plans = [];

  if (wantsRegularBus) {
    plans.push(...findDirectJourneyPlans(origin, destination, officialData, {
      maxAccessWalk: 2200, maxEgressWalk: 2600, maxTotalWalk: 4300, candidateCount: 4
    }));
    plans.push(...findLimitedTransferJourneyPlans(origin, destination, officialData, 16, {
      maxAccessWalk: 2500, maxEgressWalk: 3000, maxTransferWalk: 420, maxTotalWalk: 5200,
      candidateCount: 3, resultLimit: 8
    }));
  }

  if (wantsTransmetro) {
    plans.push(...findDirectJourneyPlans(origin, destination, transmetroData, {
      maxAccessWalk: 2600, maxEgressWalk: 3100, maxTotalWalk: 5000, candidateCount: 6
    }));
    plans.push(...findLimitedTransferJourneyPlans(origin, destination, transmetroData, 18, {
      maxAccessWalk: 2800, maxEgressWalk: 3400, maxTransferWalk: 520, maxTotalWalk: 5800,
      candidateCount: 4, resultLimit: 10
    }));
  }

  if (wantsRegularBus && wantsTransmetro) {
    plans.push(...findCrossSystemJourneyPlans(origin, destination, officialData, transmetroData, {
      maxAccessWalk: 2800, maxEgressWalk: 3500, maxTransferWalk: 560, maxTotalWalk: 6100,
      accessLimit: 12, egressLimit: 14, candidateCount: 2, resultLimit: 7, shortConnectorMeters: 6500
    }));
    plans.push(...findCrossSystemJourneyPlans(origin, destination, transmetroData, officialData, {
      maxAccessWalk: 3000, maxEgressWalk: 3600, maxTransferWalk: 560, maxTotalWalk: 6300,
      accessLimit: 12, egressLimit: 14, candidateCount: 2, resultLimit: 7, shortConnectorMeters: 6500
    }));
  }

  if (wantsOfficial && wantsTransmetro) {
    plans.push(...findOfficialTransferJourneyPlans(origin, destination, officialData, transmetroData, {
      maxAccessWalk: 3100, maxEgressWalk: 4000, maxTransferWalk: 720,
      maxTotalWalk: 7600, candidateCount: 3, resultLimit: 10
    }));
  }

  // Búsqueda ampliada ligera: solo cuando no hay casi opciones. Evita que cada
  // consulta recorra miles de combinaciones antes de mostrar los primeros resultados.
  if (plans.length < 4 && all.length) {
    plans.push(...findDirectJourneyPlans(origin, destination, all, {
      maxAccessWalk: MAX_ACCESS_WALK_EXPANDED,
      maxEgressWalk: MAX_EGRESS_WALK_EXPANDED,
      maxTotalWalk: 6900,
      minRideMeters: 700,
      candidateCount: 4,
      expanded: true
    }));
  }

  return plans.map(plan => ({ ...plan, engine: plan.engine || 'network' }));
}
function plannerPlanSignature(plan) {
  const modes = plan.legs.map(leg => leg.mode === 'bus' ? `${plannerRouteSystem(leg.route)}:${leg.route.shortName}` : leg.mode).join('>');
  return `${modes}:${Math.round(plan.totalMinutes)}`;
}

function planSystems(plan) {
  return [...new Set(plan.legs.filter(leg => leg.mode === 'bus').map(leg => plannerRouteSystem(leg.route)))];
}

function planCategory(plan) {
  if (plan.type === 'walk' || (plan.legs.length === 1 && plan.legs[0].mode === 'walk')) return 'walk';
  if (plan.type === 'bike' || (plan.legs.length === 1 && plan.legs[0].mode === 'bike')) return 'bike';
  return 'transit';
}

function plannerFilterKey(plan) {
  const category = planCategory(plan);
  if (category === 'bike') return 'bike';
  if (category === 'walk') return 'walk';
  const systems = planSystems(plan);
  if (systems.includes('sibus') && systems.includes('transmetro')) return 'combined';
  if (systems.length === 1 && systems[0] === 'transmetro') return 'transmetro';
  if (systems.length === 1 && systems[0] === 'sibus') return 'buses';
  return 'combined';
}

function planModeLabel(plan) {
  const category = planCategory(plan);
  if (category === 'walk') return 'Solo caminar';
  if (category === 'bike') return 'Solo bicicleta';
  const systems = planSystems(plan);
  if (systems.length > 1) return 'Bus + Transmetro';
  if (systems[0] === 'transmetro') return plan.transfers ? 'Transmetro con transbordo' : 'Transmetro';
  return plan.transfers ? 'Buses con transbordo' : 'Bus directo';
}

function multimodalPlanPriority(plan) {
  const category = planCategory(plan);
  const busLegs = plan.legs.filter(leg => leg.mode === 'bus').length;
  if (category === 'transit' && busLegs === 1 && (plan.walkMinutes || 0) <= 15) return 0;
  if (category === 'transit' && busLegs === 1) return 1;
  if (category === 'walk') return 2;
  if (category === 'bike') return 3;
  if (category === 'transit' && (plan.transfers || 0) === 1) return 4;
  return 5;
}

function compareMultimodalPlans(a, b) {
  const aMinutes = Number.isFinite(Number(a.totalMinutes)) ? Number(a.totalMinutes) : Number.POSITIVE_INFINITY;
  const bMinutes = Number.isFinite(Number(b.totalMinutes)) ? Number(b.totalMinutes) : Number.POSITIVE_INFINITY;
  return aMinutes - bMinutes
    || (a.transfers || 0) - (b.transfers || 0)
    || (a.walkMeters || 0) - (b.walkMeters || 0)
    || multimodalPlanPriority(a) - multimodalPlanPriority(b)
    || (a.officialTransfer ? 0 : 1) - (b.officialTransfer ? 0 : 1);
}

function mergeMultimodalPlans(plans) {
  const unique = new Map();
  plans.filter(Boolean).sort(comparePlannerVisibleResults).forEach(plan => {
    const key = plannerPlanSignature(plan);
    if (!unique.has(key)) unique.set(key, plan);
  });
  const all = [...unique.values()].sort(comparePlannerVisibleResults);
  const quotas = { buses: 9, transmetro: 7, combined: 12, bike: 1, walk: 1 };
  const selected = [];
  const selectedKeys = new Set();
  all.filter(plan => plan.officialTransfer).slice(0, 12).forEach(plan => {
    selected.push(plan);
    selectedKeys.add(plannerPlanSignature(plan));
  });
  Object.entries(quotas).forEach(([filter, limit]) => {
    all.filter(plan => plannerFilterKey(plan) === filter).slice(0, limit).forEach(plan => {
      const key = plannerPlanSignature(plan);
      if (!selectedKeys.has(key)) { selected.push(plan); selectedKeys.add(key); }
    });
  });
  all.forEach(plan => {
    if (selected.length >= 30 || selectedKeys.has(plannerPlanSignature(plan))) return;
    selected.push(plan);
    selectedKeys.add(plannerPlanSignature(plan));
  });
  return selected.sort(comparePlannerVisibleResults).slice(0, 30);
}

async function calculateMultimodalPlans(origin, destination, onProgress) {
  const settings = ensurePlannerTransportSettings();
  const wantsBus = settings.buses !== false || (settings.officialTransfers === true && settings.transmetro !== false);
  const wantsTransmetro = settings.transmetro !== false;
  const wantsWalk = settings.walk !== false;
  const wantsBike = settings.bike !== false;
  const walk = wantsWalk ? makeActiveJourneyPlan('walk', origin, destination) : null;
  const bike = wantsBike ? makeActiveJourneyPlan('bike', origin, destination) : null;
  const transmetroFallback = wantsTransmetro ? findJourneyPlans(origin, destination).map(plan => ({ ...plan, engine: 'transmetro' })) : [];
  const config = {
    maxWalkMeters: 2400, minRideMeters: 300, busMetersPerMinute: 250,
    walkMetersPerMinute: 80, walkDistanceFactor: 1.18,
    localKmzBase: 'kmz/', allowRemoteFallback: !state.kmzServerAvailable, fetchTimeoutMs: 26000
  };

  let unified = [];
  if (!engineReadyMessage() && (wantsBus || wantsTransmetro)) {
    unified = await findUnifiedJourneyPlans(origin, destination, config, settings);
    state.plannerDiagnostics = {
      engine: 'optimized-v61',
      loadedCount: state.officialPlannerNetwork?.length || 0,
      totalCount: state.routeCatalog?.rutas?.length || 0,
      errorCount: 0,
      errors: []
    };
  }
  return mergeMultimodalPlans([walk, bike, ...unified, ...transmetroFallback].filter(Boolean));
}

function engineResultToPlan(result, origin, destination) {
  const route = {
    id: result.route.id,
    shortName: result.route.ruta,
    longName: result.route.nombre || `Ruta ${result.route.ruta}`,
    operator: result.route.empresa,
    colorHex: officialRouteColorHex(result.route) || routeFamilyColorHex(result.route.ruta),
    kmzSource: result.source,
    system: 'sibus'
  };
  const boardPoint = {
    lat: result.boardPoint.coordinates[1],
    lng: result.boardPoint.coordinates[0],
    label: 'Punto recomendado para tomar el bus'
  };
  const alightPoint = {
    lat: result.alightPoint.coordinates[1],
    lng: result.alightPoint.coordinates[0],
    label: 'Punto recomendado para bajarse'
  };
  const fare = currentFare(result.route);
  return {
    engine: 'kmz',
    type: 'direct',
    flexibleBoarding: true,
    reasonableDirectBus: result.walkBeforeDistance <= BUS_FLEXIBLE_STOP_WALK_METERS && result.walkAfterDistance <= BUS_FLEXIBLE_DESTINATION_WALK_METERS,
    origin,
    destination,
    route,
    direction: result.direction,
    source: result.source,
    fare,
    walkMeters: result.totalWalkDistance,
    walkMinutes: result.totalWalkMinutes,
    rideMeters: result.busDistance,
    rideMinutes: result.busMinutes,
    totalMinutes: result.totalMinutes,
    transfers: 0,
    boardPoint: result.boardPoint,
    alightPoint: result.alightPoint,
    fullPath: result.fullPath,
    ridePath: result.ridePath,
    legs: [
      { mode: 'walk', from: origin, to: boardPoint, distance: result.walkBeforeDistance, duration: result.walkBeforeMinutes * 60, label: 'Caminata inicial' },
      { mode: 'bus', route, from: boardPoint, to: alightPoint, distance: result.busDistance, duration: result.busMinutes * 60, direction: result.direction, path: result.ridePath, fullPath: result.fullPath, flexibleBoarding: true, stopCount: null },
      { mode: 'walk', from: alightPoint, to: destination, distance: result.walkAfterDistance, duration: result.walkAfterMinutes * 60, label: 'Caminata final' }
    ]
  };
}

function engineReadyMessage() {
  if (!window.JSZip) return 'No se cargó JSZip desde vendor/jszip.min.js.';
  if (!window.TRBRouteEngine) return 'No se cargó trb_motor_rutas.js.';
  if (!state.routeCatalog?.rutas?.length) return 'No se cargó el catálogo de 93 rutas.';
  if (!state.routeCatalogValidation?.valid) return 'El catálogo de rutas contiene errores de estructura.';
  return '';
}

function journeyStepHTML(leg) {
  if (leg.mode === 'walk') {
    const target = leg.to.stop?.name || leg.to.label || 'el recorrido';
    const minutes = Math.max(1, Math.ceil((leg.duration || leg.distance / WALK_SPEED_MPS) / 60));
    return `<li><span class="journey-step-icon">🚶</span><span class="journey-step-copy"><b>${escapeHTML(leg.label || 'Camina')} ${formatDistance(leg.distance)} · ≈ ${minutes} min</b><small>${leg.isTransfer ? 'Haz el transbordo' : 'Dirígete'} hacia ${escapeHTML(target)}</small></span></li>`;
  }
  if (leg.mode === 'bike') {
    const target = leg.to.label || 'el destino';
    const minutes = Math.max(1, Math.ceil((leg.duration || leg.distance / BIKE_SPEED_MPS) / 60));
    return `<li><span class="journey-step-icon">🚲</span><span class="journey-step-copy"><b>Pedalea ${formatDistance(leg.distance)} · ≈ ${minutes} min</b><small>Ruta ciclista estimada hacia ${escapeHTML(target)}</small></span></li>`;
  }
  const isBusUrbano = plannerRouteSystem(leg.route) === 'sibus';
  const fromName = leg.from.stop?.name || leg.from.label || (isBusUrbano ? 'punto más cercano del recorrido' : 'punto de abordaje');
  const toName = leg.to.stop?.name || leg.to.label || (isBusUrbano ? 'punto de descenso sobre la ruta' : 'punto de descenso');
  const details = !isBusUrbano && Number.isFinite(leg.stopCount)
    ? `${leg.stopCount} ${leg.stopCount === 1 ? 'parada' : 'paradas'}`
    : `${formatDistance(leg.distance)} · ≈ ${Math.max(1, Math.ceil((leg.duration || 0) / 60))} min en bus`;
  const operator = leg.route.operator ? `${escapeHTML(leg.route.operator)} · ` : '';
  const system = isBusUrbano ? 'Bus urbano · parada flexible' : 'Transmetro';
  return `<li><span class="journey-step-icon">🚌</span><span class="journey-step-copy"><b>Toma ${transitLineCodeHTML(leg.route)} · ${escapeHTML(leg.route.longName)}</b><small>${system} · ${operator}desde ${escapeHTML(fromName)} hasta ${escapeHTML(toName)} · ${details}${leg.direction ? ` · ${escapeHTML(leg.direction)}` : ''}</small></span></li>`;
}

function journeyStripHTML(plan) {
  return plan.legs.map((leg, index) => {
    let chip;
    if (leg.mode === 'walk') chip = `<span class="journey-walk-chip">🚶 ${formatDistance(leg.distance)}</span>`;
    else if (leg.mode === 'bike') chip = `<span class="journey-route-chip journey-route-chip--bike">🚲 ${formatDistance(leg.distance)}</span>`;
    else chip = `<span class="journey-route-chip transit-line-link" role="button" tabindex="0" ${transitLineDataAttributes(leg.route)} style="--chip-color:${routeColor(leg.route)};--chip-text-color:${routeTextColor(leg.route)}">🚌 ${escapeHTML(leg.route.shortName)}</span>`;
    return `${index ? '<span class="journey-strip-arrow">›</span>' : ''}${chip}`;
  }).join('');
}

function renderJourneyResults() {
  const container = $('#journeyResults');
  if (!state.plannerPlans.length) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }
  const diagnostic = state.plannerDiagnostics;
  const diagnosticCopy = diagnostic?.engine === 'optimized-v61'
    ? 'Resultados calculados con red optimizada de rutas.'
    : diagnostic?.engine === 'kmz'
      ? 'Resultados calculados con recorridos oficiales.'
      : 'Resultado de respaldo con el catálogo histórico disponible.';
  container.classList.remove('hidden');
  container.innerHTML = `<div class="journey-results__header"><div><span class="eyebrow">Opciones encontradas</span><h3>${escapeHTML(state.plannerOrigin.label)} → ${escapeHTML(state.plannerDestination.label)}</h3></div><p>${escapeHTML(diagnosticCopy)}<br>Buses urbanos: parada flexible sobre el recorrido; Transmetro: estaciones/paraderos.</p></div>` + state.plannerPlans.map((plan, index) => {
    const engineCard = plan.engine === 'kmz';
    const walkBefore = plan.legs.find(leg => leg.mode === 'walk');
    const walkAfter = [...plan.legs].reverse().find(leg => leg.mode === 'walk');
    const routeLeg = plan.legs.find(leg => leg.mode === 'bus');
    const summary = engineCard ? `
      <div class="journey-card__summary journey-card__summary--engine">
        <div class="journey-stat"><small>Empresa</small><b>${escapeHTML(plan.route.operator)}</b></div>
        <div class="journey-stat"><small>Ruta</small><b>${transitLineCodeHTML(plan.route)}</b></div>
        <div class="journey-stat"><small>Hasta el bus</small><b>${formatDistance(walkBefore.distance)} · ${Math.max(1, Math.ceil(walkBefore.duration / 60))} min</b></div>
        <div class="journey-stat"><small>En bus</small><b>${formatDistance(routeLeg.distance)} · ${plan.rideMinutes} min</b></div>
        <div class="journey-stat"><small>Después del bus</small><b>${formatDistance(walkAfter.distance)} · ${Math.max(1, Math.ceil(walkAfter.duration / 60))} min</b></div>
        <div class="journey-stat"><small>Tarifa</small><b>${formatCurrency(plan.fare.value)}</b></div>
      </div>` : `
      <div class="journey-card__summary">
        <div class="journey-stat"><small>Caminas</small><b>${formatDistance(plan.walkMeters)}</b></div>
        <div class="journey-stat"><small>A pie</small><b>≈ ${plan.walkMinutes} min</b></div>
        <div class="journey-stat"><small>En bus</small><b>≈ ${plan.rideMinutes} min</b></div>
      </div>`;
    return `<article class="journey-card ${index === 0 ? 'is-recommended' : ''}">
      <div class="journey-card__top">
        <div class="journey-card__labels">${index === 0 ? '<span class="journey-recommended">Recomendada</span>' : ''}<span class="journey-transfer-badge">${plan.officialTransfer ? 'Transbordo oficial' : engineCard ? 'KMZ oficial · sin transbordo' : (plan.transfers ? `${plan.transfers} transbordo` : 'Ruta directa')}</span></div>
        <div class="journey-card__time"><b>≈ ${plan.totalMinutes} min</b><small>sin espera ni tráfico en vivo</small></div>
      </div>
      <div class="journey-route-strip">${journeyStripHTML(plan)}</div>
      ${summary}
      ${officialTransferBadgeHTML(plan)}
      <ol class="journey-steps">${plan.legs.map(journeyStepHTML).join('')}</ol>
      ${officialTransferNoteHTML(plan)}
      ${engineCard ? `<div class="journey-source-note"><span>i</span><p>Sube y baja en el punto más cercano del recorrido publicado. ${escapeHTML(plan.fare.note)}.</p></div>` : ''}
      <div class="journey-card__actions"><button class="journey-map-button" type="button" data-journey-map-index="${index}">Ver recorrido en el mapa</button></div>
    </article>`;
  }).join('');
}

function setJourneyStatus(message, error = false) {
  const status = $('#journeyStatus');
  if (!message) {
    status.classList.add('hidden');
    status.classList.remove('is-error');
    status.textContent = '';
    return;
  }
  status.textContent = message;
  status.classList.remove('hidden');
  status.classList.toggle('is-error', error);
}

function routingPointsForLeg(leg, maximum = MAX_ROUTING_WAYPOINTS) {
  const raw = Array.isArray(leg?.stops) && Number.isInteger(leg.startIndex) && Number.isInteger(leg.endIndex)
    ? leg.stops.slice(leg.startIndex, leg.endIndex + 1).map(stop => ({ lat: stop.latitude, lng: stop.longitude }))
    : [leg?.from, leg?.to].filter(Boolean).map(point => ({ lat: point.lat, lng: point.lng }));
  const clean = raw.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (clean.length <= maximum) return clean;
  return sampleCoordinateIndexes(clean.length, maximum).map(index => clean[index]);
}

async function networkRoute(mode, points) {
  const clean = (points || []).filter(point => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
  if (clean.length < 2) throw new Error('insufficient routing points');
  const apiUrl = new URL('api/network-route', document.baseURI);
  apiUrl.searchParams.set('mode', mode);
  apiUrl.searchParams.set('points', clean.map(point => `${point.lng},${point.lat}`).join(';'));
  try {
    const response = await fetch(apiUrl, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.ok && Array.isArray(payload.geometry) && payload.geometry.length > 1) return payload;
  } catch (_) {}

  const profile = mode === 'walk' ? 'routed-foot' : mode === 'bike' ? 'routed-bike' : 'routed-car';
  const coordinateText = clean.map(point => `${point.lng},${point.lat}`).join(';');
  const directUrl = `https://routing.openstreetmap.de/${profile}/route/v1/driving/${coordinateText}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(directUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`${mode} route unavailable`);
  const data = await response.json();
  const route = data.routes?.[0];
  if (!route?.geometry?.coordinates?.length) throw new Error(`${mode} route empty`);
  return {
    ok: true,
    distance: route.distance,
    duration: route.duration,
    geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    source: 'routing.openstreetmap.de'
  };
}

async function footRouteBetween(from, to) {
  return networkRoute('walk', [from, to]);
}


function projectLatLngToLngLatSegment(anchor, a, b) {
  const pointLng = Number(anchor.lng), pointLat = Number(anchor.lat);
  const aLng = Number(a?.[0]), aLat = Number(a?.[1]);
  const bLng = Number(b?.[0]), bLat = Number(b?.[1]);
  if (![pointLng, pointLat, aLng, aLat, bLng, bLat].every(Number.isFinite)) return null;
  const R = 6371000;
  const lat0 = pointLat * Math.PI / 180;
  const scaleX = Math.max(1e-9, Math.cos(lat0) * Math.PI / 180 * R);
  const scaleY = Math.PI / 180 * R;
  const ax = (aLng - pointLng) * scaleX;
  const ay = (aLat - pointLat) * scaleY;
  const bx = (bLng - pointLng) * scaleX;
  const by = (bLat - pointLat) * scaleY;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
  const x = ax + t * dx;
  const y = ay + t * dy;
  const lng = pointLng + x / scaleX;
  const lat = pointLat + y / scaleY;
  return {
    t,
    lat,
    lng,
    coordinates: [lng, lat],
    distanceMeters: Math.hypot(x, y),
    segmentLengthMeters: Math.sqrt(lengthSq)
  };
}

function lngLatPathDistanceMeters(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < coords.length - 1; index++) {
    const a = coords[index], b = coords[index + 1];
    total += haversine(Number(a?.[1]), Number(a?.[0]), Number(b?.[1]), Number(b?.[0]));
  }
  return total;
}

function flexibleAccessCandidatesOnPath(anchor, coords, options = {}) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  const maxStraightMeters = options.maxStraightMeters ?? 1100;
  const minAlongMeters = options.minAlongMeters ?? 0;
  const maxAlongMeters = options.maxAlongMeters ?? Infinity;
  const hardLimit = options.limit ?? 24;
  const candidates = [];
  let distanceBefore = 0;
  for (let index = 0; index < coords.length - 1; index++) {
    const projected = projectLatLngToLngLatSegment(anchor, coords[index], coords[index + 1]);
    const segmentLength = haversine(Number(coords[index]?.[1]), Number(coords[index]?.[0]), Number(coords[index + 1]?.[1]), Number(coords[index + 1]?.[0]));
    if (projected) {
      const distanceAlongMeters = distanceBefore + segmentLength * projected.t;
      if (distanceAlongMeters >= minAlongMeters && distanceAlongMeters <= maxAlongMeters) {
        const straightWalk = projected.distanceMeters * 1.18;
        if (straightWalk <= maxStraightMeters) {
          candidates.push({
            ...projected,
            segmentIndex: index,
            distanceAlongMeters,
            straightWalk,
            point: { lat: projected.lat, lng: projected.lng, label: 'Punto flexible sobre el recorrido' }
          });
        }
      }
    }
    distanceBefore += segmentLength;
  }
  const unique = new Map();
  candidates
    .sort((a, b) => a.straightWalk - b.straightWalk || a.distanceAlongMeters - b.distanceAlongMeters)
    .forEach(candidate => {
      const key = `${candidate.segmentIndex}:${candidate.t.toFixed(2)}`;
      if (!unique.has(key)) unique.set(key, candidate);
    });
  return [...unique.values()].slice(0, Math.max(hardLimit, 24));
}

async function scoreFlexibleWalkCandidate(anchor, candidate, reverse = false) {
  const to = { lat: candidate.lat, lng: candidate.lng, label: candidate.point.label };
  try {
    const routed = reverse ? await footRouteBetween(to, anchor) : await footRouteBetween(anchor, to);
    return {
      ...candidate,
      walkDistance: routed.distance,
      walkDuration: routed.duration,
      walkGeometry: routed.geometry,
      score: routed.distance + candidate.straightWalk * 0.08,
      source: routed.source || 'network'
    };
  } catch {
    const fallback = candidate.straightWalk;
    return {
      ...candidate,
      walkDistance: fallback,
      walkDuration: fallback / WALK_SPEED_MPS,
      walkGeometry: null,
      score: fallback + 120,
      source: 'straight-fallback'
    };
  }
}

async function chooseFlexibleAccessPoint(anchor, coords, options = {}) {
  const candidates = flexibleAccessCandidatesOnPath(anchor, coords, options);
  if (!candidates.length) return null;
  const scored = [];
  for (const candidate of candidates) scored.push(await scoreFlexibleWalkCandidate(anchor, candidate, Boolean(options.reverseWalk)));
  return scored.sort((a, b) => a.score - b.score || a.straightWalk - b.straightWalk)[0] || null;
}

function sliceLngLatPathBetween(coords, start, end) {
  if (!Array.isArray(coords) || coords.length < 2 || !start || !end) return null;
  const totalDistance = lngLatPathDistanceMeters(coords);
  const closed = haversine(Number(coords[0]?.[1]), Number(coords[0]?.[0]), Number(coords[coords.length - 1]?.[1]), Number(coords[coords.length - 1]?.[0])) <= 1000;
  const wraps = end.distanceAlongMeters <= start.distanceAlongMeters;
  if (wraps && !closed) return null;
  const result = [start.coordinates];
  if (wraps) {
    for (let index = start.segmentIndex + 1; index < coords.length; index++) result.push(coords[index]);
    for (let index = 0; index <= end.segmentIndex; index++) result.push(coords[index]);
  } else {
    for (let index = start.segmentIndex + 1; index <= end.segmentIndex; index++) result.push(coords[index]);
  }
  const last = result[result.length - 1];
  if (!last || haversine(Number(last[1]), Number(last[0]), end.lat, end.lng) > 1) result.push(end.coordinates);
  const busDistance = wraps ? totalDistance - start.distanceAlongMeters + end.distanceAlongMeters : end.distanceAlongMeters - start.distanceAlongMeters;
  return { path: result, distance: busDistance };
}

function currentKmzCandidateFromPlan(plan, type = 'board') {
  const source = type === 'board' ? plan.boardPoint : plan.alightPoint;
  if (!source?.coordinates) return null;
  return {
    lat: Number(source.coordinates[1]),
    lng: Number(source.coordinates[0]),
    coordinates: source.coordinates,
    segmentIndex: Number(source.segmentIndex) || 0,
    distanceAlongMeters: Number(source.distanceAlongMeters) || 0,
    walkDistance: type === 'board' ? Number(plan.walkBeforeDistance || plan.legs?.[0]?.distance || 0) : Number(plan.walkAfterDistance || plan.legs?.[2]?.distance || 0),
    walkDuration: type === 'board' ? Number((plan.walkBeforeMinutes || 0) * 60 || plan.legs?.[0]?.duration || 0) : Number((plan.walkAfterMinutes || 0) * 60 || plan.legs?.[2]?.duration || 0),
    walkGeometry: null,
    score: type === 'board' ? Number(plan.walkBeforeDistance || plan.legs?.[0]?.distance || 0) : Number(plan.walkAfterDistance || plan.legs?.[2]?.distance || 0),
    point: { lat: Number(source.coordinates[1]), lng: Number(source.coordinates[0]), label: 'Punto flexible sobre el recorrido' }
  };
}

function applyFlexibleKmzAccess(plan, board, alight) {
  const coords = plan.fullPath || plan.legs?.find(leg => leg.mode === 'bus')?.fullPath;
  const sliced = sliceLngLatPathBetween(coords, board, alight);
  if (!sliced || sliced.distance < 300) return false;
  const busLeg = plan.legs.find(leg => leg.mode === 'bus');
  const walkLegs = plan.legs.filter(leg => leg.mode === 'walk');
  if (!busLeg || walkLegs.length < 2) return false;
  const boardPoint = { lat: board.lat, lng: board.lng, label: 'Punto flexible para tomar el bus' };
  const alightPoint = { lat: alight.lat, lng: alight.lng, label: 'Punto flexible para bajarse' };

  walkLegs[0].to = boardPoint;
  walkLegs[0].distance = Math.round(board.walkDistance || board.straightWalk || 0);
  walkLegs[0].duration = board.walkDuration || (walkLegs[0].distance / WALK_SPEED_MPS);
  walkLegs[0].geometry = Array.isArray(board.walkGeometry) && board.walkGeometry.length > 1 ? board.walkGeometry : null;
  walkLegs[0].label = 'Caminata inicial hasta punto flexible del bus';

  walkLegs[walkLegs.length - 1].from = alightPoint;
  walkLegs[walkLegs.length - 1].distance = Math.round(alight.walkDistance || alight.straightWalk || 0);
  walkLegs[walkLegs.length - 1].duration = alight.walkDuration || (walkLegs[walkLegs.length - 1].distance / WALK_SPEED_MPS);
  walkLegs[walkLegs.length - 1].geometry = Array.isArray(alight.walkGeometry) && alight.walkGeometry.length > 1 ? alight.walkGeometry : null;
  walkLegs[walkLegs.length - 1].label = 'Caminata final desde punto flexible del bus';

  busLeg.from = boardPoint;
  busLeg.to = alightPoint;
  busLeg.path = sliced.path;
  busLeg.ridePath = sliced.path;
  busLeg.fullPath = coords;
  busLeg.distance = Math.round(sliced.distance);
  busLeg.duration = sliced.distance / BUS_SPEED_MPS;
  busLeg.geometry = sliced.path.map(([lng, lat]) => [lat, lng]);
  busLeg.geometrySource = 'official-kmz-flexible-access';
  busLeg.flexibleBoarding = true;
  busLeg.stopCount = null;

  plan.boardPoint = { coordinates: board.coordinates, segmentIndex: board.segmentIndex, distanceAlongMeters: Math.round(board.distanceAlongMeters), walkDistance: walkLegs[0].distance, walkMinutes: Math.max(1, Math.ceil(walkLegs[0].duration / 60)) };
  plan.alightPoint = { coordinates: alight.coordinates, segmentIndex: alight.segmentIndex, distanceAlongMeters: Math.round(alight.distanceAlongMeters), walkDistance: walkLegs[walkLegs.length - 1].distance, walkMinutes: Math.max(1, Math.ceil(walkLegs[walkLegs.length - 1].duration / 60)) };
  plan.ridePath = sliced.path;
  plan.rideMeters = Math.round(sliced.distance);
  plan.rideMinutes = Math.max(1, Math.ceil(busLeg.duration / 60));
  plan.walkMeters = walkLegs.reduce((sum, leg) => sum + (Number(leg.distance) || 0), 0);
  plan.walkMinutes = Math.max(1, Math.ceil(walkLegs.reduce((sum, leg) => sum + (Number(leg.duration) || 0), 0) / 60));
  plan.totalMinutes = plan.walkMinutes + plan.rideMinutes;
  plan.flexibleAccessRefined = true;
  plan.score = (Number(plan.score) || 0) - 900 + plan.walkMeters * 0.35;
  return true;
}

async function refineFlexibleKmzAccessPlan(plan) {
  if (!plan || plan.engine !== 'kmz' || !plan.flexibleBoarding) return plan;
  const coords = plan.fullPath || plan.legs?.find(leg => leg.mode === 'bus')?.fullPath;
  if (!Array.isArray(coords) || coords.length < 2) return plan;
  const currentBoard = currentKmzCandidateFromPlan(plan, 'board');
  const currentAlight = currentKmzCandidateFromPlan(plan, 'alight');
  if (!currentBoard || !currentAlight) return plan;

  // TRB v57: para buses urbanos, el abordaje y la bajada se corrigen usando ruta peatonal real.
  // Así se evita recomendar el lado/calle contraria cuando otro punto del mismo recorrido es más caminable.
  const board = await chooseFlexibleAccessPoint(plan.origin, coords, {
    maxStraightMeters: BUS_FLEXIBLE_STOP_WALK_METERS + 260,
    minAlongMeters: 0,
    maxAlongMeters: Math.max(0, currentAlight.distanceAlongMeters - 350),
    limit: 18
  }) || currentBoard;
  const alight = await chooseFlexibleAccessPoint(plan.destination, coords, {
    maxStraightMeters: BUS_FLEXIBLE_DESTINATION_WALK_METERS + 260,
    minAlongMeters: board.distanceAlongMeters + 350,
    maxAlongMeters: Infinity,
    reverseWalk: true,
    limit: 18
  }) || currentAlight;
  const improvedStart = (board.walkDistance || Infinity) <= (currentBoard.walkDistance || Infinity) * 1.12;
  const improvedEnd = (alight.walkDistance || Infinity) <= (currentAlight.walkDistance || Infinity) * 1.12;
  if (improvedStart || improvedEnd) applyFlexibleKmzAccess(plan, improvedStart ? board : currentBoard, improvedEnd ? alight : currentAlight);
  return plan;
}

async function refineFlexibleBusAccessPlans(plans = []) {
  if (!Array.isArray(plans) || !plans.length || !navigator.onLine) return plans;
  const targets = plans.filter(plan => plan?.engine === 'kmz' && plan.flexibleBoarding).slice(0, 10);
  for (const plan of targets) {
    try { await refineFlexibleKmzAccessPlan(plan); }
    catch (error) { console.warn('[TRB] No se pudo refinar el punto flexible del bus:', error); }
  }
  return plans;
}

async function ensureWalkLegGeometry(leg) {
  if (!leg || leg.mode !== 'walk') return;
  if (Array.isArray(leg.geometry) && leg.geometry.length > 1) return;
  try {
    if (navigator.onLine) {
      const routed = await footRouteBetween(leg.from, leg.to);
      leg.distance = routed.distance;
      leg.duration = routed.duration;
      leg.geometry = routed.geometry;
      return;
    }
  } catch {
    leg.geometryUnavailable = true;
  }
  leg.geometry = null;
}


async function bikeRouteBetween(from, to) {
  return networkRoute('bike', [from, to]);
}

async function ensureBikeLegGeometry(leg) {
  if (!leg || leg.mode !== 'bike') return;
  if (Array.isArray(leg.geometry) && leg.geometry.length > 1) return;
  try {
    if (navigator.onLine) {
      const routed = await bikeRouteBetween(leg.from, leg.to);
      leg.distance = routed.distance;
      leg.duration = routed.duration;
      leg.geometry = routed.geometry;
      return;
    }
  } catch {
    leg.geometryUnavailable = true;
  }
  leg.geometry = null;
}

function fallbackBusLegGeometry(leg) {
  if (!leg || !Array.isArray(leg.stops) || !leg.stops.length) return [];
  const start = Number.isInteger(leg.startIndex) ? leg.startIndex : 0;
  const end = Number.isInteger(leg.endIndex) ? leg.endIndex : leg.stops.length - 1;
  const from = Math.max(0, Math.min(start, end));
  const to = Math.min(leg.stops.length - 1, Math.max(start, end));
  const selected = leg.stops.slice(from, to + 1)
    .map(stop => [Number(stop.latitude), Number(stop.longitude)])
    .filter(point => point.every(Number.isFinite));
  return start <= end ? selected : selected.reverse();
}

async function ensureBusLegGeometry(leg) {
  if (!leg || leg.mode !== 'bus') return;
  if (Array.isArray(leg.geometry) && leg.geometry.length > 1) return;
  const official = officialGeometryForLeg(leg);
  if (official) {
    leg.geometry = official;
    leg.geometrySource = 'official-kmz';
    leg.distance = official.slice(1).reduce((sum, point, index) => sum + haversine(official[index][0], official[index][1], point[0], point[1]), 0);
    leg.duration = leg.distance / BUS_SPEED_MPS + (leg.stopCount || 0) * 18;
    return;
  }
  const fallback = fallbackBusLegGeometry(leg);
  // Nunca dejar un tramo de Transmetro sin línea: la secuencia de paraderos queda lista desde el inicio.
  if (fallback.length > 1) {
    leg.geometry = fallback;
    leg.geometrySource = 'stop-sequence-preview';
  }
  try {
    const points = routingPointsForLeg(leg);
    const routed = await networkRoute('car', points);
    leg.distance = routed.distance;
    leg.duration = Math.max(routed.duration * 1.25, leg.distance / BUS_SPEED_MPS + (leg.stopCount || 0) * 18);
    leg.geometry = routed.geometry;
    leg.geometrySource = routed.source || 'road-network';
    leg.geometryUnavailable = false;
    return;
  } catch (error) {
    leg.geometryUnavailable = true;
    if (fallback.length > 1) {
      leg.geometry = fallback;
      leg.geometrySource = 'stop-sequence-fallback';
      leg.distance = fallback.slice(1).reduce((sum, point, index) => sum + haversine(fallback[index][0], fallback[index][1], point[0], point[1]), 0);
      leg.duration = Math.max(leg.duration || 0, leg.distance / BUS_SPEED_MPS + (leg.stopCount || 0) * 18);
    } else {
      leg.geometry = null;
    }
  }
}

async function enrichPlanForMap(plan) {
  const walkLegs = plan.legs.filter(leg => leg.mode === 'walk');
  const bikeLegs = plan.legs.filter(leg => leg.mode === 'bike');
  const busLegs = plan.legs.filter(leg => leg.mode === 'bus');
  for (const leg of walkLegs) await ensureWalkLegGeometry(leg);
  for (const leg of bikeLegs) await ensureBikeLegGeometry(leg);
  for (const leg of busLegs) await ensureBusLegGeometry(leg);
  if (plan.engine === 'active') {
    const leg = plan.legs[0];
    const minutes = Math.max(1, Math.ceil((leg.duration || 0) / 60));
    plan.totalMinutes = minutes;
    if (leg.mode === 'walk') { plan.walkMeters = leg.distance; plan.walkMinutes = minutes; }
    if (leg.mode === 'bike') { plan.bikeMeters = leg.distance; plan.bikeMinutes = minutes; }
  } else if (plan.engine !== 'kmz') finalizeJourneyPlan(plan);
}

function rideStopObjectsFromPath(path, prefix = 'ride') {
  const coords = Array.isArray(path) && path.length > 1 ? sampleCoordinates(path, 24) : [];
  return coords.map(([lng, lat], index, all) => ({
    id: `${prefix}-${index}`,
    name: index === 0 ? 'Inicio del tramo' : index === all.length - 1 ? 'Fin del tramo' : `Punto ${index + 1}`,
    latitude: lat,
    longitude: lng
  }));
}

async function refineRecommendedWalking() {
  const plan = state.plannerPlans[0];
  if (!plan || plan.engine === 'kmz' || !navigator.onLine) return;
  const walkLegs = plan.legs.filter(leg => leg.mode === 'walk');
  try {
    for (const leg of walkLegs) {
      const routed = await footRouteBetween(leg.from, leg.to);
      leg.distance = routed.distance;
      leg.duration = routed.duration;
      leg.geometry = routed.geometry;
    }
    plan.walkingNetwork = true;
    finalizeJourneyPlan(plan);
    renderJourneyResults();
  } catch {
    // The static prototype keeps the geometric estimate when the public walking router is unavailable.
  }
}

async function detectKmzServer() {
  if (window.location.protocol === 'file:') {
    state.kmzServerAvailable = false;
    return false;
  }
  try {
    const response = await fetch(relativeAppUrl('api/health'), { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.kmzStatus = await response.json();
    state.kmzServerAvailable = Boolean(state.kmzStatus?.ok);
    return state.kmzServerAvailable;
  } catch {
    state.kmzServerAvailable = false;
    return false;
  }
}

async function handleJourneySubmit() {
  const originText = $('#journeyOrigin').value.trim();
  const destinationText = $('#journeyDestination').value.trim();
  if (!originText || !destinationText) return;
  if (window.location.protocol === 'file:') {
    setJourneyStatus('TRB se abrió como archivo. Cierra esta pestaña y ejecuta INICIAR_TRB.bat (Windows) o INICIAR_TRB.command (Mac); así los 93 KMZ se descargan y se abren sin CORS.', true);
    return;
  }
  const searchId = ++state.plannerSearchId;
  const button = $('#journeySubmitButton');
  button.disabled = true;
  button.textContent = 'Calculando…';
  $('#journeyResults').classList.add('hidden');
  setJourneyStatus('Buscando las direcciones…');
  try {
    const origin = await geocodeAddress(originText, $('#journeyOrigin'));
    const destination = await geocodeAddress(destinationText, $('#journeyDestination'));
    if (searchId !== state.plannerSearchId) return;
    if (haversine(origin.lat, origin.lng, destination.lat, destination.lng) < 120) throw new Error('El origen y el destino están prácticamente en el mismo lugar');

    state.plannerOrigin = origin;
    state.plannerDestination = destination;
    let lastStatusAt = 0;
    const plans = await calculateMultimodalPlans(origin, destination, ({ completed, total }) => {
      if (searchId !== state.plannerSearchId) return;
      const now = Date.now();
      if (completed === total || now - lastStatusAt > 200) {
        lastStatusAt = now;
        setJourneyStatus(`Buscando rutas cercanas y combinaciones: ${completed} de ${total}`);
      }
    });
    if (searchId !== state.plannerSearchId) return;
    if (!plans.some(plan => planCategory(plan) === 'transit')) {
      throw new Error('No encontré transporte en los datos disponibles para esos puntos. Se conservarán las opciones activas como respaldo.');
    }
    state.plannerAllPlans = plans;
    state.plannerPlans = plans;
    renderJourneyResults();
    setJourneyStatus('');
    refineRecommendedWalking();
  } catch (error) {
    if (searchId !== state.plannerSearchId) return;
    const fallbackPlans = state.plannerOrigin && state.plannerDestination
      ? findJourneyPlans(state.plannerOrigin, state.plannerDestination)
      : [];
    if (fallbackPlans.length) {
      const orderedFallback = fallbackPlans.sort(compareMultimodalPlans);
      state.plannerAllPlans = orderedFallback;
      state.plannerPlans = orderedFallback;
      state.plannerDiagnostics = { engine: 'fallback', loadedCount: state.routes.length, totalCount: state.routes.length, errorCount: 0, errors: [] };
      renderJourneyResults();
      setJourneyStatus(`Los KMZ no pudieron procesarse (${error.message || 'error desconocido'}). TRB muestra una alternativa de respaldo para que el trayecto no quede vacío.`, true);
      refineRecommendedWalking();
    } else {
      state.plannerPlans = [];
      renderJourneyResults();
      setJourneyStatus(error.message || 'No fue posible calcular la ruta', true);
    }
  } finally {
    if (searchId === state.plannerSearchId) {
      button.disabled = false;
      button.textContent = 'Buscar mejor ruta';
    }
  }
}

function usePlannerLocation() {
  if (!navigator.geolocation) return toast('Tu navegador no permite usar ubicación');
  const button = $('#journeyLocateButton');
  button.textContent = '…';
  navigator.geolocation.getCurrentPosition(position => {
    state.plannerCurrentPosition = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
    $('#journeyOrigin').value = 'Mi ubicación';
    $('#journeyOrigin').dataset.selectedLocation = JSON.stringify({ ...state.plannerCurrentPosition, label: 'Mi ubicación', source: 'device' });
    button.textContent = '⌖';
    toast('Origen establecido con tu ubicación');
  }, error => {
    button.textContent = '⌖';
    const messages = { 1: 'Debes permitir el acceso a tu ubicación', 2: 'No se pudo determinar tu ubicación', 3: 'La ubicación tardó demasiado' };
    toast(messages[error.code] || 'No se pudo acceder a la ubicación');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function swapJourneyFields() {
  const origin = $('#journeyOrigin');
  const destination = $('#journeyDestination');
  [origin.value, destination.value] = [destination.value, origin.value];
  const originSelected = origin.dataset.selectedLocation || '';
  origin.dataset.selectedLocation = destination.dataset.selectedLocation || '';
  destination.dataset.selectedLocation = originSelected;
}

function journeyMarkerIcon(type, label) {
  const kind = type === 'destination' ? 'destination' : type === 'transfer' ? 'transfer' : 'origin';
  const readable = kind === 'destination' ? 'Destino' : kind === 'transfer' ? 'Transbordo' : 'Origen';
  return L.divIcon({
    className: 'trb-stop-icon-wrap',
    html: `<div class="journey-marker journey-marker--${kind}" aria-label="${readable}">${trbPlaceIconHTML(kind)}<small>${escapeHTML(label)}</small></div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -22]
  });
}

function journeyMapPanelHTML(plan) {
  const routeLegs = plan.legs.filter(leg => leg.mode === 'bus');
  const routeChips = plan.legs.map(leg => {
    if (leg.mode === 'walk') return '<span class="hsl-line-chip hsl-line-chip--walk">🚶</span>';
    if (leg.mode === 'bike') return '<span class="hsl-line-chip hsl-line-chip--bike">🚲</span>';
    return `<span class="hsl-line-chip" style="--line-chip:${routeColor(leg.route)};--line-chip-text:${routeTextColor(leg.route)}">${escapeHTML(leg.route.shortName)}</span>`;
  }).join('');
  const systems = planSystems(plan);
  const sourceLabel = plan.engine === 'kmz' ? 'KMZ oficial' : plan.engine === 'active' ? 'Modo activo' : systems.length > 1 ? 'Red combinada' : 'Red TRB';
  const movingLabel = planCategory(plan) === 'bike' ? `${formatDistance(plan.bikeMeters || plan.legs[0]?.distance || 0)} en bici` : `${formatDistance(plan.walkMeters || 0)} caminando`;
  return `<div class="hsl-sidebar-shell">
      <div class="hsl-sidebar-search">
        <div class="hsl-place-box hsl-place-box--origin">${trbPlaceIconHTML('origin')}<div><small>Origen</small><strong>${escapeHTML(plan.origin.label)}</strong></div></div>
        <div class="hsl-place-divider"></div>
        <div class="hsl-place-box hsl-place-box--destination">${trbPlaceIconHTML('destination')}<div><small>Destino</small><strong>${escapeHTML(plan.destination.label)}</strong></div></div>
        <div class="hsl-search-meta"><span>Salida ahora</span><span>${movingLabel}</span></div>
      </div>
      <div class="hsl-trip-summary-card">
        <div class="hsl-trip-summary-top">
          <div><span class="eyebrow">${escapeHTML(planModeLabel(plan))}</span><h2>≈ ${plan.totalMinutes} min</h2></div>
          <div class="hsl-trip-pill"><b>${escapeHTML(sourceLabel)}</b><span>tiempo estimado</span></div>
        </div>
        <div class="hsl-trip-lines">${routeChips}</div>
        <div class="hsl-trip-stats">
          <div><small>Caminando</small><b>${formatDistance(plan.walkMeters || 0)} · ${plan.walkMinutes || 0} min</b></div>
          <div><small>En bici</small><b>${formatDistance(plan.bikeMeters || 0)} · ${plan.bikeMinutes || 0} min</b></div>
          <div><small>En transporte</small><b>${formatDistance(plan.rideMeters || 0)} · ${plan.rideMinutes || 0} min</b></div>
          <div><small>Transbordos</small><b>${plan.transfers || 0}</b></div>
        </div>
      </div>
      <div class="hsl-itinerary-card">
        <div class="operations-heading"><div><span class="eyebrow">Detalle del recorrido</span><h3>${escapeHTML(planModeLabel(plan))}</h3></div><span class="simulation-badge">Mapa activo</span></div>
        <ol class="journey-steps hsl-journey-steps">${plan.legs.map(journeyStepHTML).join('')}</ol>
      </div>
      <div class="data-caution"><span>i</span><p>Las combinaciones usan geometría KMZ oficial cuando existe y, para caminatas, bici y tramos de Transmetro, se ajustan a la red vial. Si el enrutador no responde, TRB evita dibujar una línea recta sobre edificios.</p></div>
    </div>`;
}


function routeBoundsDistanceKm(bounds) {
  if (!bounds?.length) return 0;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  bounds.forEach(point => {
    const lat = Number(point[0]), lng = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
  });
  if (!Number.isFinite(minLat)) return 0;
  return haversine(minLat, minLng, maxLat, maxLng) / 1000;
}

function fitMapToSelectedJourney(bounds, plan) {
  if (!state.map || !bounds?.length) return;
  const valid = bounds.filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
  if (!valid.length) return;
  const diagonalKm = routeBoundsDistanceKm(valid);
  const transitKm = Math.max(0, Number(plan?.rideMeters || 0) / 1000);
  const journeyKm = Math.max(diagonalKm, transitKm);
  const maxZoom = journeyKm < 0.8 ? 17 : journeyKm < 2 ? 16 : journeyKm < 5 ? 15 : journeyKm < 10 ? 14 : journeyKm < 18 ? 13 : 12;
  const desktop = window.innerWidth > 900;
  const paddingTopLeft = desktop ? [42, 42] : [24, 24];
  const paddingBottomRight = desktop ? [42, 42] : [24, 68];
  state.map.stop();
  state.map.invalidateSize({ animate: false });
  window.setTimeout(() => {
    state.map.stop();
    state.map.fitBounds(L.latLngBounds(valid), {
      paddingTopLeft,
      paddingBottomRight,
      maxZoom,
      animate: false
    });
  }, 70);
}

function drawJourneyPlan(index, options = {}) {
  const plan = state.plannerPlans[Number(index)];
  if (!plan) return;
  const drawRequestId = ++state.mapDrawRequestId;
  state.lineDrawRequestId += 1;
  const showInstructions = options.showInstructions !== false;
  state.mapSelectedPlanIndex = Number(index);
  if (showInstructions) renderMapJourneyInstructions(plan, Number(index));
  else showRouteSuggestionsPanel({ keepSelection: true });
  if ($('#mapJourneyOrigin')) $('#mapJourneyOrigin').value = plan.origin.label;
  if ($('#mapJourneyDestination')) $('#mapJourneyDestination').value = plan.destination.label;
  renderMapJourneyResults();
  state.mapRouteInitialized = true;
  showView('map');
  window.setTimeout(async () => {
    initializeMap();
    if (!state.map) return;
    await enrichPlanForMap(plan);
    if (drawRequestId !== state.mapDrawRequestId) return;
    if (showInstructions) renderMapJourneyInstructions(plan, Number(index));
    renderMapJourneyResults();
    stopDemoBusAnimation();
    if (state.routeLayer) state.map.removeLayer(state.routeLayer);
    if (state.busLayer) { state.map.removeLayer(state.busLayer); state.busLayer = null; }
    if (state.allStopsLayer && state.map.hasLayer(state.allStopsLayer)) state.map.removeLayer(state.allStopsLayer);
    const group = L.layerGroup();
    const bounds = [];
    const color = mapPlanRouteColor(plan);

    if (plan.engine === 'active') {
      const leg = plan.legs[0];
      const points = Array.isArray(leg.geometry) && leg.geometry.length > 1 ? leg.geometry : [];
      if (leg.mode === 'bike') {
        drawTransitPath(group, points, '#00a6d6', { weight: 7, opacity: 1, dashArray: '12 7', className: 'trb-bike-line' })
          ?.bindPopup(`<strong>Recorrido en bicicleta</strong><br>${formatDistance(leg.distance)} · ≈ ${plan.totalMinutes} min`);
      } else {
        drawWalkingPath(group, points, { color: '#4d6178', weight: 6 })
          ?.bindPopup(`<strong>Caminata completa</strong><br>${formatDistance(leg.distance)} · ≈ ${plan.totalMinutes} min`);
      }
      bounds.push(...points);
    } else if (plan.engine === 'kmz') {
      const fullPath = (plan.fullPath || plan.legs[1]?.fullPath || []).map(([lng, lat]) => [lat, lng]);
      const ridePath = ((plan.ridePath && plan.ridePath.length ? plan.ridePath : plan.fullPath) || []).map(([lng, lat]) => [lat, lng]);
      if (fullPath.length > 1) {
        drawTransitPath(group, fullPath, '#8db5ff', { weight: 4, opacity: .35, dashArray: '8 7', className: 'trb-transit-line trb-transit-line--ghost' })
          ?.bindPopup(`<strong>Recorrido completo ${escapeHTML(plan.route.shortName)}</strong><br>${escapeHTML(plan.route.operator)}`);
        // El trazado completo se muestra como referencia, pero el zoom se calcula con el tramo realmente utilizado.
      }
      if (ridePath.length > 1) {
        drawTransitPath(group, ridePath, color, { weight: 9, opacity: 1 })
          ?.bindPopup(`<strong>Tramo en bus</strong><br>${formatDistance(plan.rideMeters)} · ≈ ${plan.rideMinutes} min`);
        addDirectionArrows(group, ridePath, color);
        const midIndex = Math.max(0, Math.floor(ridePath.length / 2));
        L.marker(ridePath[midIndex], { pane: 'routeStops', icon: routeLabelIcon(plan.route.shortName, color), interactive: false, zIndexOffset: 760 }).addTo(group);
        bounds.push(...ridePath);
      }
      const board = { lat: plan.boardPoint.coordinates[1], lng: plan.boardPoint.coordinates[0], label: 'Punto para tomar el bus' };
      const alight = { lat: plan.alightPoint.coordinates[1], lng: plan.alightPoint.coordinates[0], label: 'Punto para bajarse' };
      [
        { leg: plan.legs[0], from: plan.origin, to: board },
        { leg: plan.legs[2], from: alight, to: plan.destination }
      ].forEach(segment => {
        const points = Array.isArray(segment.leg.geometry) && segment.leg.geometry.length > 1 ? segment.leg.geometry : [];
        drawWalkingPath(group, points, { color: '#5f6f82', weight: 5 })?.bindPopup(`<strong>Caminata</strong><br>${formatDistance(segment.leg.distance)} · ≈ ${Math.max(1, Math.ceil((segment.leg.duration || 0) / 60))} min`);
        bounds.push(...points);
      });
      L.marker([board.lat, board.lng], { pane: 'routeStops', icon: routeTerminalIcon('↑', color), zIndexOffset: 780 }).bindPopup(`<strong>Toma ${escapeHTML(plan.route.shortName)}</strong><br>${escapeHTML(plan.route.operator)}<br>${formatDistance(plan.legs[0].distance)} desde el origen`).addTo(group);
      L.marker([alight.lat, alight.lng], { pane: 'routeStops', icon: journeyMarkerIcon('transfer', '↓'), zIndexOffset: 780 }).bindPopup(`<strong>Bájate aquí</strong><br>${formatDistance(plan.legs[2].distance)} hasta el destino`).addTo(group);

      const demoStops = rideStopObjectsFromPath((plan.ridePath && plan.ridePath.length ? plan.ridePath : plan.fullPath) || [], `kmz-${plan.route.shortName}`);
      if (demoStops.length > 1) {
        state.busLayer = L.layerGroup([], { pane: 'routeVehicles' }).addTo(state.map);
        state.currentMapRoute = { ...plan.route, colorHex: color.replace('#', '') };
        state.currentRouteStops = demoStops;
        state.demoBuses = createDemoBuses(state.currentMapRoute, demoStops).slice(0, 4);
        updateDemoBuses(false);
        state.busTimer = window.setInterval(() => updateDemoBuses(true), 1500);
      }
    } else {
      plan.legs.forEach(leg => {
        if (leg.mode === 'walk') {
          const points = Array.isArray(leg.geometry) && leg.geometry.length > 1 ? leg.geometry : [];
          drawWalkingPath(group, points, { color: '#5f6f82', weight: 5 });
          bounds.push(...points);
          if (leg.isTransfer) L.marker([leg.to.lat, leg.to.lng], { pane: 'routeStops', icon: journeyMarkerIcon('transfer', 'T'), zIndexOffset: 600 }).bindPopup('<strong>Punto de transbordo</strong>').addTo(group);
        } else if (leg.mode === 'bike') {
          const points = Array.isArray(leg.geometry) && leg.geometry.length > 1 ? leg.geometry : [];
          drawTransitPath(group, points, '#00a6d6', { weight: 7, opacity: 1, dashArray: '12 7', className: 'trb-bike-line' });
          bounds.push(...points);
        } else {
          const points = Array.isArray(leg.geometry) && leg.geometry.length > 1 ? leg.geometry : [];
          const legColor = routeColor(leg.route);
          if (points.length > 1) {
            drawTransitPath(group, points, legColor, { weight: 8, opacity: 1 })?.bindPopup(`<strong>${escapeHTML(leg.route.shortName)}</strong><br>${escapeHTML(leg.route.longName)}<br><small>Trazado ajustado a la vía</small>`);
            addDirectionArrows(group, points, legColor);
            const midIndex = Math.max(0, Math.floor(points.length / 2));
            L.marker(points[midIndex], { pane: 'routeStops', icon: routeLabelIcon(leg.route.shortName, legColor), interactive: false, zIndexOffset: 760 }).addTo(group);
            bounds.push(...points);
          }
          const boardPoint = [leg.from.lat, leg.from.lng];
          const alightPoint = [leg.to.lat, leg.to.lng];
          L.circleMarker(boardPoint, { pane: 'routeStops', radius: 8, color: '#fff', weight: 3, fillColor: legColor, fillOpacity: 1 }).bindPopup(`<strong>Sube a ${escapeHTML(leg.route.shortName)}</strong><br>${escapeHTML(leg.from.stop?.name || leg.from.label || 'Punto de abordaje')}`).addTo(group);
          L.circleMarker(alightPoint, { pane: 'routeStops', radius: 8, color: '#fff', weight: 3, fillColor: legColor, fillOpacity: 1 }).bindPopup(`<strong>Baja de ${escapeHTML(leg.route.shortName)}</strong><br>${escapeHTML(leg.to.stop?.name || leg.to.label || 'Punto de descenso')}`).addTo(group);
          bounds.push(boardPoint, alightPoint);
        }
      });
      const mainBusLeg = plan.legs.find(leg => leg.mode === 'bus');
      const demoStops = mainBusLeg ? mainBusLeg.stops.slice(mainBusLeg.startIndex, mainBusLeg.endIndex + 1).map((stop, idx) => ({ id: `fallback-${idx}`, name: stop.name, latitude: stop.latitude, longitude: stop.longitude })) : [];
      if (demoStops.length > 1) {
        state.busLayer = L.layerGroup([], { pane: 'routeVehicles' }).addTo(state.map);
        state.currentMapRoute = { ...mainBusLeg.route, colorHex: routeColor(mainBusLeg.route).replace('#', '') };
        state.currentRouteStops = demoStops;
        state.demoBuses = createDemoBuses(state.currentMapRoute, demoStops).slice(0, 3);
        updateDemoBuses(false);
        state.busTimer = window.setInterval(() => updateDemoBuses(true), 1500);
      }
    }

    L.marker([plan.origin.lat, plan.origin.lng], { pane: 'routeStops', icon: journeyMarkerIcon('origin', 'A'), zIndexOffset: 800 }).bindPopup(`<strong>Origen</strong><br>${escapeHTML(plan.origin.label)}`).addTo(group);
    L.marker([plan.destination.lat, plan.destination.lng], { pane: 'routeStops', icon: journeyMarkerIcon('destination', 'B'), zIndexOffset: 800 }).bindPopup(`<strong>Destino</strong><br>${escapeHTML(plan.destination.label)}`).addTo(group);
    bounds.push([plan.origin.lat, plan.origin.lng], [plan.destination.lat, plan.destination.lng]);
    group.addTo(state.map);
    state.routeLayer = group;
    $('#mapRouteSelect').value = '';
    $('#mapInfoDefault').classList.add('hidden');
    $('#mapInfoContent').classList.remove('hidden');
    $('#mapInfoContent').innerHTML = journeyMapPanelHTML(plan);
    const overlayTitle = planCategory(plan) === 'walk' ? '🚶' : planCategory(plan) === 'bike' ? '🚲' : (plan.legs.find(leg => leg.mode === 'bus')?.route?.shortName || 'TRB');
    const overlaySubtitle = planModeLabel(plan);
    if ($('#app')?.classList.contains('is-route-focus')) setMapJourneyOverlay('');
    else setMapJourneyOverlay(`<div class="map-overlay__header"><span class="map-overlay__route" style="--overlay-color:${color}">${escapeHTML(overlayTitle)}</span><button class="map-overlay__close" type="button" data-map-overlay-close aria-label="Cerrar resumen">×</button></div><strong>${escapeHTML(plan.origin.label)} → ${escapeHTML(plan.destination.label)}</strong><small>${escapeHTML(overlaySubtitle)}</small><div class="map-overlay__metrics"><span><b>≈ ${plan.totalMinutes} min</b> total</span><span><b>${formatDistance(plan.walkMeters || 0)}</b> caminando</span><span><b>${formatDistance((plan.rideMeters || 0) + (plan.bikeMeters || 0))}</b> transporte / bici</span></div><div class="map-overlay__legend"><i style="--overlay-color:${color}"></i> ${escapeHTML(overlaySubtitle)}</div>`);
    const label = $('.map-demo-label');
    if (label) label.innerHTML = '<span></span> Buses, Transmetro y conexiones · tiempos estimados';
    fitMapToSelectedJourney(bounds, plan);
  }, 120);
}


function setMapPlannerStatus(message = '', error = false) {
  const status = $('#mapJourneyStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', Boolean(error));
  status.classList.toggle('is-success', Boolean(message) && !error);
}

function mapPlanRouteColor(plan) {
  const category = planCategory(plan || { legs: [] });
  if (category === 'walk') return '#52677d';
  if (category === 'bike') return '#00a6d6';
  const busLeg = plan?.legs?.find(leg => leg.mode === 'bus');
  return routeColor(busLeg?.route || plan?.route || {});
}

function formatSuggestionClock(offsetMinutes = 0) {
  const date = new Date(Date.now() + offsetMinutes * 60000);
  return date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function planInitialWalkMeters(plan = {}) {
  const firstWalk = (plan.legs || []).find(leg => leg.mode === 'walk');
  return Number(firstWalk?.distance) || 0;
}

function planWalkProfile(plan = {}) {
  const legs = plan.legs || [];
  const walkLegs = legs.filter(leg => leg.mode === 'walk');
  const firstBusIndex = legs.findIndex(leg => leg.mode === 'bus');
  const lastBusIndex = legs.map(leg => leg.mode).lastIndexOf('bus');
  let initial = 0;
  let transfer = 0;
  let final = 0;
  walkLegs.forEach((leg, index) => {
    const distance = Number(leg.distance) || 0;
    const legIndex = legs.indexOf(leg);
    if (leg.isTransfer || (firstBusIndex >= 0 && lastBusIndex >= 0 && legIndex > firstBusIndex && legIndex < lastBusIndex)) transfer += distance;
    else if (firstBusIndex < 0 || legIndex < firstBusIndex || (index === 0 && legIndex <= firstBusIndex)) initial += distance;
    else final += distance;
  });
  if (!final && lastBusIndex >= 0) {
    const afterLastBus = legs.slice(lastBusIndex + 1).filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + (Number(leg.distance) || 0), 0);
    final = afterLastBus;
  }
  return { initial, transfer, final, total: Number(plan.walkMeters) || (initial + transfer + final) };
}

function planWalkingRank(plan = {}) {
  const profile = planWalkProfile(plan);
  const transfers = Number(plan.transfers) || 0;
  // TRB v44: prioriza rutas donde el usuario camina menos para llegar al primer bus,
  // menos en los transbordos y menos después de bajarse. El tiempo total desempata.
  return (profile.initial * 2.2) + (profile.final * 1.8) + (profile.transfer * 1.55) + (profile.total * .35) + (transfers * 180);
}

function planIsReasonableDirectUrbanBus(plan = {}) {
  if (!planIsDirectOneBus(plan)) return false;
  const busLeg = (plan.legs || []).find(leg => leg.mode === 'bus');
  if (!busLeg || plannerRouteSystem(busLeg.route) !== 'sibus') return false;
  const profile = planWalkProfile(plan);
  return profile.initial <= BUS_FLEXIBLE_STOP_WALK_METERS
    && profile.final <= BUS_FLEXIBLE_DESTINATION_WALK_METERS
    && (profile.initial + profile.final) <= 1700;
}

function comparePlannerVisibleResults(a, b) {
  if (state.plannerTransportSettings?.officialTransfers) {
    const directDiff = (planIsDirectOneBus(a) ? 0 : 1) - (planIsDirectOneBus(b) ? 0 : 1);
    if (directDiff) return directDiff;
    const officialDiff = (a.officialTransfer ? 0 : 1) - (b.officialTransfer ? 0 : 1);
    if (officialDiff) return officialDiff;
  }
  const aCategory = planCategory(a || { legs: [] });
  const bCategory = planCategory(b || { legs: [] });
  if (aCategory === 'transit' && bCategory === 'transit') {
    // TRB v56: si un bus urbano directo pasa a 4-10 min caminando, no lo mandes
    // debajo de alternativas con otro bus. Esa regla no aplica para Transmetro.
    const directUrbanDiff = (planIsReasonableDirectUrbanBus(a) ? 0 : 1) - (planIsReasonableDirectUrbanBus(b) ? 0 : 1);
    if (directUrbanDiff) return directUrbanDiff;
    const aProfile = planWalkProfile(a);
    const bProfile = planWalkProfile(b);
    const aRank = planWalkingRank(a);
    const bRank = planWalkingRank(b);
    if (Math.abs(aRank - bRank) > 90) return aRank - bRank;
    if (Math.abs(aProfile.initial - bProfile.initial) > 60) return aProfile.initial - bProfile.initial;
    if (Math.abs(aProfile.final - bProfile.final) > 60) return aProfile.final - bProfile.final;
    if (Math.abs(aProfile.transfer - bProfile.transfer) > 60) return aProfile.transfer - bProfile.transfer;
    return (a.transfers || 0) - (b.transfers || 0)
      || (aProfile.total || 0) - (bProfile.total || 0)
      || (a.totalMinutes || 0) - (b.totalMinutes || 0);
  }
  return compareMultimodalPlans(a, b);
}

function transportSettingAllowsFilter(filter) {
  const settings = ensurePlannerTransportSettings();
  if (settings.officialTransfers === true && ['walk', 'bike'].includes(filter)) return false;
  if (filter === 'buses') return settings.buses !== false;
  if (filter === 'transmetro') return settings.transmetro !== false;
  if (filter === 'combined') return settings.buses !== false || settings.transmetro !== false;
  if (filter === 'bike') return settings.bike !== false;
  if (filter === 'walk') return settings.walk !== false;
  return true;
}


function planIsTransmetroOnlyTransit(plan = {}) {
  return planCategory(plan || { legs: [] }) === 'transit'
    && planSystems(plan || { legs: [] }).length === 1
    && planSystems(plan || { legs: [] })[0] === 'transmetro';
}

function planIsTransmetroNetworkPlan(plan = {}) {
  return planIsTransmetroOnlyTransit(plan);
}

function planIsOfficialTransmetroConnection(plan = {}) {
  return Boolean(plan?.officialTransfer) && planSystems(plan || { legs: [] }).includes('transmetro');
}

function planIsOfficialTransmetroAllyConnection(plan = {}) {
  if (!planIsOfficialTransmetroConnection(plan)) return false;
  return planSystems(plan || { legs: [] }).includes('sibus');
}

function planTransportAllowed(plan) {
  const settings = ensurePlannerTransportSettings();
  const category = planCategory(plan || { legs: [] });
  if (category === 'transit' && (Number(plan?.transfers) || 0) > 2) return false;
  const systems = planSystems(plan || { legs: [] });

  if (settings.officialTransfers === true) {
    if (category !== 'transit') return false;

    // TRB v50: activar “Transbordos oficiales” no borra las conexiones internas
    // Transmetro + alimentador. Si Transmetro está activo, esas alternativas siguen
    // apareciendo siempre. El modo oficial solo AGREGA conexiones Transmetro ↔
    // empresas aliadas, incluso cuando el switch Bus esté apagado.
    const allowedByOfficialMode = planIsDirectOneBus(plan)
      || Boolean(plan?.officialTransfer)
      || planIsTransmetroNetworkPlan(plan);
    if (!allowedByOfficialMode) return false;

    if (planIsTransmetroNetworkPlan(plan)) return settings.transmetro !== false;
    if (planIsOfficialTransmetroAllyConnection(plan)) return settings.transmetro !== false;
    if (planIsOfficialTransmetroConnection(plan)) return settings.transmetro !== false;
  }

  if (category === 'walk') return settings.walk !== false;
  if (category === 'bike') return settings.bike !== false;
  if (!systems.length) return true;
  return systems.every(system => {
    if (system === 'sibus') return settings.buses !== false;
    if (system === 'transmetro') return settings.transmetro !== false;
    return true;
  });
}

function planFilterMatches(plan, filter) {
  if (!planTransportAllowed(plan)) return false;
  if (!filter || filter === 'all') return true;
  if (filter === 'transmetro' && state.plannerTransportSettings?.officialTransfers === true) {
    const systems = planSystems(plan || { legs: [] });
    // En modo Transmetro, deja pasar tanto Transmetro puro/alimentador como
    // Transmetro ↔ empresas aliadas oficiales. No depende del switch Bus.
    if (systems.includes('transmetro') && (planIsTransmetroNetworkPlan(plan) || planIsOfficialTransmetroConnection(plan))) return true;
  }
  return plannerFilterKey(plan) === filter;
}

function planIsDirectOneBus(plan = {}) {
  const transitLegs = (plan.legs || []).filter(leg => leg.mode === 'bus');
  return planCategory(plan || { legs: [] }) === 'transit' && transitLegs.length === 1 && (Number(plan.transfers) || 0) === 0;
}

function plannerVisibleIndexedPlans(filter = state.plannerFilter) {
  let items = state.plannerAllPlans
    .map((plan, index) => ({ plan, index }))
    .filter(item => planFilterMatches(item.plan, filter))
    .sort((a, b) => comparePlannerVisibleResults(a.plan, b.plan));

  // TRB v50: la ruta directa debe quedar primero, pero no debe esconder
  // Transmetro + alimentador ni Transmetro ↔ aliados cuando el usuario activó
  // Transbordos oficiales. Esa opción filtra/agrega, no reemplaza la red Transmetro.
  return items;
}

function firstVisiblePlannerIndex(filter = state.plannerFilter) {
  const preferred = filter || 'all';
  const bestIndexForFilter = currentFilter => plannerVisibleIndexedPlans(currentFilter)[0]?.index ?? -1;
  let index = bestIndexForFilter(preferred);
  if (index >= 0) return { filter: preferred, index };
  const order = ['all', 'buses', 'transmetro', 'combined', 'bike', 'walk'];
  for (const next of order) {
    index = bestIndexForFilter(next);
    if (index >= 0) return { filter: next, index };
  }
  return { filter: preferred, index: -1 };
}

function planSegmentStripHTML(plan) {
  const total = Math.max(1, plan.legs.reduce((sum, leg) => sum + Math.max(1, Math.ceil((leg.duration || 60) / 60)), 0));
  return plan.legs.map(leg => {
    const minutes = Math.max(1, Math.ceil((leg.duration || 60) / 60));
    const flex = Math.max(.7, minutes / total * 8);
    if (leg.mode === 'walk') return `<span class="route-strip-segment is-walk" style="flex:${flex}">🚶 ${minutes}</span>`;
    if (leg.mode === 'bike') return `<span class="route-strip-segment is-bike" style="flex:${flex}">🚲 ${minutes}</span>`;
    const isTransmetro = plannerRouteSystem(leg.route) === 'transmetro';
    return `<span class="route-strip-segment is-transit ${isTransmetro ? 'is-transmetro' : 'is-bus'} transit-line-link" role="button" tabindex="0" ${transitLineDataAttributes(leg.route)} style="--segment-color:${routeColor(leg.route)};--segment-text-color:${routeTextColor(leg.route)};flex:${flex}" title="Ver la línea completa ${escapeHTML(leg.route.shortName)}">${isTransmetro ? 'T' : '🚌'} ${escapeHTML(leg.route.shortName)}</span>`;
  }).join('');
}

function updateRouteSuggestionModes() {
  const ids = { all: '#routeModeAllTime', buses: '#routeModeBusTime', transmetro: '#routeModeTransmetroTime', combined: '#routeModeCombinedTime', bike: '#routeModeBikeTime' };
  Object.entries(ids).forEach(([filter, selector]) => {
    const plans = plannerVisibleIndexedPlans(filter).map(item => item.plan);
    const node = $(selector);
    if (node) node.textContent = plans.length ? `${Math.min(...plans.map(plan => plan.totalMinutes))} min` : '—';
    const button = $(`[data-plan-filter="${filter}"]`);
    if (button) {
      const transportAllowed = transportSettingAllowsFilter(filter);
      button.disabled = !transportAllowed;
      button.classList.toggle('is-transport-disabled', !transportAllowed);
      button.classList.toggle('has-no-options', transportAllowed && !plans.length);
    }
  });
  $$('[data-plan-filter]').forEach(button => {
    const active = button.dataset.planFilter === state.plannerFilter;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderPlannerTransportSettings();
}

function plannerActiveTransportSummary() {
  const settings = ensurePlannerTransportSettings();
  const active = [];
  if (settings.buses !== false) active.push('Bus');
  if (settings.transmetro !== false) active.push('Transmetro');
  if (settings.walk !== false) active.push('Caminar');
  if (settings.bike !== false) active.push('Bici');
  if (settings.officialTransfers === true) active.push('Especiales');
  return active.length ? active.join(' + ') : 'sin transporte activo';
}

function renderMapJourneyResults() {
  const container = $('#mapJourneyResults');
  if (!container) return;
  state.plannerAllPlans = state.plannerAllPlans.length ? state.plannerAllPlans : state.plannerPlans;
  updateRouteSuggestionModes();
  const indexed = plannerVisibleIndexedPlans(state.plannerFilter);
  if (!indexed.length) {
    const loadingMessage = 'Calculando rutas según tus Ajustes…';
    const emptyMessage = state.plannerTransportSettings?.officialTransfers
      ? 'No encontré ruta directa ni transbordo oficial para esos puntos. Desactiva “Transbordos oficiales” para ver todas las combinaciones.'
      : 'No hay opciones con los ajustes actuales. Abre Ajustes y activa Bus, Transmetro, Caminar o Bicicleta.';
    container.innerHTML = `<div class="route-suggestion-empty ${state.plannerLoading ? 'is-loading' : ''}">${state.plannerLoading ? loadingMessage : emptyMessage}</div>`;
    container.classList.remove('hidden');
    return;
  }
  container.classList.remove('hidden');
  const activeTransportSummary = plannerActiveTransportSummary();
  container.innerHTML = `<div class="route-suggestion-heading route-suggestion-heading--hsl"><div><b>Opciones de ruta</b><small>${indexed.length} alternativa${indexed.length === 1 ? '' : 's'} según Ajustes · ${escapeHTML(activeTransportSummary)}</small></div><span>Salida ahora</span></div>` + indexed.map(({ plan, index }, visibleIndex) => {
    const selected = Number(state.mapSelectedPlanIndex) === index;
    const color = mapPlanRouteColor(plan);
    const systems = planSystems(plan);
    const detail = planCategory(plan) === 'walk'
      ? `${formatDistance(plan.walkMeters)} caminando`
      : planCategory(plan) === 'bike'
        ? `${formatDistance(plan.bikeMeters || plan.legs[0]?.distance || 0)} en bicicleta`
        : `${systems.length > 1 ? 'Bus + Transmetro' : systems.includes('transmetro') ? 'Solo Transmetro' : 'Solo buses'} · ${plan.transfers || 0} transbordo${plan.transfers === 1 ? '' : 's'}${plan.shortBusConnector ? ' · bus conector corto' : ''} · inicio ${Math.ceil(planInitialWalkMeters(plan) / WALK_SPEED_MPS / 60)} min · camina ${plan.walkMinutes || 0} min${plan.officialTransfer ? ` · oficial ${formatCurrency(plan.officialTransfer.totalWeekday)}/${formatCurrency(plan.officialTransfer.totalHoliday)}` : ''}`;
    return `<button class="route-suggestion-card ${selected ? 'is-selected' : ''} ${plan.officialTransfer ? 'is-official-transfer' : ''}" type="button" data-map-plan-index="${index}" style="--suggestion-color:${color}" aria-pressed="${selected}">
      ${visibleIndex === 0 ? '<span class="route-suggestion-best">Recomendada</span>' : ''}
      <span class="route-suggestion-time"><b>${formatSuggestionClock(0)} – ${formatSuggestionClock(plan.totalMinutes)}</b><strong>${plan.totalMinutes} min</strong></span>
      <span class="route-suggestion-strip">${planSegmentStripHTML(plan)}</span>
      ${officialTransferBadgeHTML(plan)}
      <span class="route-suggestion-footer"><span><b>${escapeHTML(planModeLabel(plan))}</b><small>${escapeHTML(detail)}</small></span><i>›</i></span>
    </button>`;
  }).join('') + '<p class="route-suggestion-note">Tiempos aproximados: no incluyen espera, tráfico ni disponibilidad real de bicicletas.</p>';
}

function activatePlannerFilter(filter) {
  state.plannerFilter = filter || 'all';
  const next = firstVisiblePlannerIndex(state.plannerFilter);
  if (next.index < 0) {
    clearSelectedJourneyFromMap();
    renderMapJourneyResults();
    return;
  }
  state.plannerFilter = next.filter;
  state.mapSelectedPlanIndex = next.index;
  renderMapJourneyResults();
  drawJourneyPlan(next.index, { showInstructions: false });
}

function savePlannerTransportSettings() {
  state.plannerTransportSettings = normalizePlannerTransportSettings(state.plannerTransportSettings);
  storage.set('trb-transport-settings', JSON.stringify(state.plannerTransportSettings));
}

function renderPlannerTransportSettings() {
  ensurePlannerTransportSettings();
  $$('[data-transport-toggle]').forEach(button => {
    const key = button.dataset.transportToggle;
    const active = state.plannerTransportSettings?.[key] !== false;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    const mark = button.querySelector('i');
    if (button.classList.contains('official-transfer-switch')) {
      button.setAttribute('aria-label', `Transbordos oficiales ${active ? 'activados' : 'desactivados'}`);
      if (mark) mark.textContent = '';
    } else if (mark) {
      mark.textContent = active ? '✓' : '';
    }
  });
}

function applyPlannerTransportSettings(redraw = true) {
  state.plannerTransportSettings = normalizePlannerTransportSettings(state.plannerTransportSettings);
  savePlannerTransportSettings();
  renderPlannerTransportSettings();
  if (!state.plannerAllPlans.length) { updateRouteSuggestionModes(); return; }
  if (!transportSettingAllowsFilter(state.plannerFilter)) state.plannerFilter = 'all';
  const currentVisible = state.mapSelectedPlanIndex >= 0 && planFilterMatches(state.plannerAllPlans[state.mapSelectedPlanIndex], state.plannerFilter);
  if (!currentVisible) {
    const next = firstVisiblePlannerIndex(state.plannerFilter);
    state.plannerFilter = next.filter;
    state.mapSelectedPlanIndex = next.index;
  }
  renderMapJourneyResults();
  if (redraw) {
    if (state.mapSelectedPlanIndex >= 0) drawJourneyPlan(state.mapSelectedPlanIndex, { showInstructions: false });
    else clearSelectedJourneyFromMap();
  }
}

function toggleTransportSetting(key) {
  const settings = ensurePlannerTransportSettings();
  if (!settings || !(key in settings)) return;
  settings[key] = settings[key] === false;
  state.plannerTransportSettings = normalizePlannerTransportSettings(settings);
  // TRB v59: ya no hay pestañas "Todas/Buses/Transmetro" visibles.
  // Las combinaciones se controlan únicamente desde Ajustes.
  state.plannerFilter = 'all';
  applyPlannerTransportSettings(true);
}

function toggleMapSettingsPanel(open = null) {
  const panel = $('#mapSettingsPanel');
  const button = $('#mapSettingsButton');
  if (!panel) return;
  const shouldOpen = open === null ? panel.classList.contains('hidden') : Boolean(open);
  panel.classList.toggle('hidden', !shouldOpen);
  button?.setAttribute('aria-expanded', String(shouldOpen));
}

function clearPlannerInput(inputId) {
  const input = $(`#${inputId}`);
  if (!input) return;
  input.value = '';
  delete input.dataset.selectedLocation;
  closeLocationSuggestions(input);
  if (inputId === 'mapJourneyOrigin') {
    if (state.map && state.mapPickerOriginLayer) state.map.removeLayer(state.mapPickerOriginLayer);
    state.mapPickerOriginLayer = null;
  }
  if (inputId === 'mapJourneyDestination') {
    if (state.map && state.mapPickerDestinationLayer) state.map.removeLayer(state.mapPickerDestinationLayer);
    state.mapPickerDestinationLayer = null;
  }
  input.focus();
}

function swapHomeJourneyFields() {
  const origin = $('#homeJourneyOrigin');
  const destination = $('#homeJourneyDestination');
  if (!origin || !destination) return;
  [origin.value, destination.value] = [destination.value, origin.value];
  const originSelected = origin.dataset.selectedLocation || '';
  origin.dataset.selectedLocation = destination.dataset.selectedLocation || '';
  if (originSelected) destination.dataset.selectedLocation = originSelected;
  else delete destination.dataset.selectedLocation;
  if (!origin.dataset.selectedLocation) delete origin.dataset.selectedLocation;
  closeLocationSuggestions();
}

function setMapPickMode(target = null) {
  state.mapPickTarget = target;
  const hint = $('#mapPickHint');
  const mapElement = $('#map');
  if (hint) {
    hint.textContent = target === 'origin' ? 'Toca el mapa para elegir el origen.' : target === 'destination' ? 'Toca el mapa para elegir el destino.' : 'Toca el mapa para elegir el punto.';
    hint.classList.toggle('hidden', !target);
  }
  mapElement?.classList.toggle('is-picking', Boolean(target));
  $('#mapJourneyPickOrigin')?.classList.toggle('is-active', target === 'origin');
  $('#mapJourneyPickDestination')?.classList.toggle('is-active', target === 'destination');
  if (target) setMapPlannerStatus(`Selecciona ${target === 'origin' ? 'el origen' : 'el destino'} tocando el mapa.`);
}

function replaceMapPickerLayer(type, lat, lng) {
  initializeMap();
  if (!state.map) return;
  const key = type === 'origin' ? 'mapPickerOriginLayer' : 'mapPickerDestinationLayer';
  if (state[key]) state.map.removeLayer(state[key]);
  const label = type === 'origin' ? 'A' : 'B';
  const marker = L.marker([lat, lng], { pane: 'routeStops', icon: journeyMarkerIcon(type, label), zIndexOffset: 850 })
    .bindPopup(`<strong>${type === 'origin' ? 'Origen elegido' : 'Destino elegido'}</strong><br>${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  state[key] = L.layerGroup([marker]).addTo(state.map);
}

function chooseMapPoint(type, lat, lng) {
  const input = type === 'origin' ? $('#mapJourneyOrigin') : $('#mapJourneyDestination');
  if (!input) return;
  input.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  input.dataset.selectedLocation = JSON.stringify({ lat, lng, label: input.value, source: 'map' });
  closeLocationSuggestions(input);
  replaceMapPickerLayer(type, lat, lng);
  setMapPickMode(null);
  setMapPlannerStatus(`${type === 'origin' ? 'Origen' : 'Destino'} elegido en el mapa.`, false);
}

function startMapPointPick(type) {
  initializeMap();
  setMapPickMode(type);
}

function swapMapJourneyFields() {
  const origin = $('#mapJourneyOrigin');
  const destination = $('#mapJourneyDestination');
  if (!origin || !destination) return;
  [origin.value, destination.value] = [destination.value, origin.value];
  const originSelected = origin.dataset.selectedLocation || '';
  origin.dataset.selectedLocation = destination.dataset.selectedLocation || '';
  destination.dataset.selectedLocation = originSelected;
  closeLocationSuggestions();
  if (state.map && state.mapPickerOriginLayer) state.map.removeLayer(state.mapPickerOriginLayer);
  if (state.map && state.mapPickerDestinationLayer) state.map.removeLayer(state.mapPickerDestinationLayer);
  state.mapPickerOriginLayer = null;
  state.mapPickerDestinationLayer = null;
}

function showCurrentPositionOnMap(position, zoom = 16) {
  initializeMap();
  if (!state.map) return;
  const latitude = position.coords.latitude;
  const longitude = position.coords.longitude;
  if (state.userLayer) state.map.removeLayer(state.userLayer);
  state.userLayer = L.layerGroup([
    L.circle([latitude, longitude], { radius: position.coords.accuracy || 30, color: '#1463e6', weight: 2, fillColor: '#1463e6', fillOpacity: .08 }),
    L.circleMarker([latitude, longitude], { pane: 'routeStops', radius: 9, color: '#fff', weight: 4, fillColor: '#1463e6', fillOpacity: 1 }).bindPopup('<strong>Estás aquí</strong>')
  ]).addTo(state.map);
  state.map.setView([latitude, longitude], zoom);
}

function useMapPlannerLocation() {
  if (!navigator.geolocation) return setMapPlannerStatus('Tu navegador no permite usar ubicación.', true);
  const buttons = [$('#mapJourneyUseLocation'), $('#mapLocateFloating')].filter(Boolean);
  buttons.forEach(button => { button.disabled = true; button.classList.add('is-loading'); });
  navigator.geolocation.getCurrentPosition(position => {
    state.plannerCurrentPosition = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy };
    $('#mapJourneyOrigin').value = 'Mi ubicación';
    $('#journeyOrigin').value = 'Mi ubicación';
    showCurrentPositionOnMap(position);
    setMapPlannerStatus('Tu ubicación quedó establecida como origen.');
    buttons.forEach(button => { button.disabled = false; button.classList.remove('is-loading'); });
  }, error => {
    const messages = { 1: 'Debes permitir el acceso a tu ubicación.', 2: 'No se pudo determinar tu ubicación.', 3: 'La ubicación tardó demasiado.' };
    setMapPlannerStatus(messages[error.code] || 'No se pudo acceder a tu ubicación.', true);
    buttons.forEach(button => { button.disabled = false; button.classList.remove('is-loading'); });
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

async function handleMapJourneySubmit() {
  closeLocationSuggestions();
  const originText = $('#mapJourneyOrigin')?.value.trim() || '';
  const destinationText = $('#mapJourneyDestination')?.value.trim() || '';
  if (!originText || !destinationText) {
    setMapPlannerStatus('Escribe el origen y el destino, o elígelos sobre el mapa.', true);
    return;
  }
  $('#journeyOrigin').value = originText;
  $('#journeyDestination').value = destinationText;
  const button = $('#mapJourneySubmit');
  state.plannerTransportSettings = normalizePlannerTransportSettings(state.plannerTransportSettings);
  savePlannerTransportSettings();
  if (button) { button.disabled = true; button.textContent = 'Calculando…'; }
  if (isMobileLayout()) {
    clearSelectedJourneyFromMap({ resetSelection: true });
    setRouteFocusMode(false, 'default');
  } else {
    setRouteFocusMode(true, 'suggestions');
  }
  setMapPlannerStatus('Buscando rutas de buses, Transmetro y conexiones entre ambas redes…');
  state.plannerLoading = true;
  state.plannerPlans = [];
  state.plannerAllPlans = [];
  state.mapSelectedPlanIndex = -1;
  renderMapJourneyResults();
  const searchId = ++state.plannerSearchId;
  try {
    const origin = await geocodeAddress(originText, $('#mapJourneyOrigin'));
    const destination = await geocodeAddress(destinationText, $('#mapJourneyDestination'));
    if (searchId !== state.plannerSearchId) return;
    if (haversine(origin.lat, origin.lng, destination.lat, destination.lng) < 120) throw new Error('El origen y el destino están prácticamente en el mismo lugar.');
    state.plannerOrigin = origin;
    state.plannerDestination = destination;
    setMapPlannerStatus('Buscando rutas rápidas según tus Ajustes…');
    const plans = await calculateMultimodalPlans(origin, destination, () => {});
    if (searchId !== state.plannerSearchId) return;
    if (!plans.length) throw new Error('No encontré una combinación adecuada para esos puntos.');
    state.plannerLoading = false;
    state.plannerAllPlans = plans;
    state.plannerPlans = plans;
    state.plannerFilter = 'all';
    const firstVisible = firstVisiblePlannerIndex('all');
    state.plannerFilter = firstVisible.filter;
    if (isMobileLayout()) {
      state.mapSelectedPlanIndex = -1;
      setRouteFocusMode(false, 'default');
      renderJourneyResults();
      renderMapJourneyResults();
    } else {
      state.mapSelectedPlanIndex = firstVisible.index >= 0 ? firstVisible.index : 0;
      renderJourneyResults();
      renderMapJourneyResults();
      drawJourneyPlan(state.mapSelectedPlanIndex, { showInstructions: false });
    }
    const busCount = plans.filter(plan => plannerFilterKey(plan) === 'buses').length;
    const transmetroCount = plans.filter(plan => plannerFilterKey(plan) === 'transmetro').length;
    const combinedCount = plans.filter(plan => plannerFilterKey(plan) === 'combined').length;
    const officialCount = plans.filter(plan => plan.officialTransfer).length;
    setMapPlannerStatus(`Rutas listas según tus Ajustes${officialCount ? ` · especiales incluidos` : ''}.`);
  } catch (error) {
    state.plannerLoading = false;
    state.plannerAllPlans = [];
    state.plannerPlans = [];
    renderMapJourneyResults();
    setMapPlannerStatus(error.message || 'No se pudo calcular el viaje.', true);
  } finally {
    state.plannerLoading = false;
    if (button) { button.disabled = false; button.textContent = 'Buscar rutas'; }
  }
}


function copyLocationInput(source, target) {
  if (!source || !target) return;
  target.value = source.value;
  if (source.dataset.selectedLocation) target.dataset.selectedLocation = source.dataset.selectedLocation;
  else delete target.dataset.selectedLocation;
}

async function handleHomeJourneySubmit() {
  const origin = $('#homeJourneyOrigin');
  const destination = $('#homeJourneyDestination');
  if (!origin?.value.trim() || !destination?.value.trim()) return;
  copyLocationInput(origin, $('#journeyOrigin'));
  copyLocationInput(destination, $('#journeyDestination'));
  copyLocationInput(origin, $('#mapJourneyOrigin'));
  copyLocationInput(destination, $('#mapJourneyDestination'));
  showView('map');
  setRouteFocusMode(false, 'default');
  window.setTimeout(() => handleMapJourneySubmit(), 140);
}

function useHomeJourneyLocation() {
  const input = $('#homeJourneyOrigin');
  const button = $('#homeJourneyLocate');
  if (!navigator.geolocation) return toast('Tu navegador no permite usar ubicación');
  if (button) button.textContent = '…';
  navigator.geolocation.getCurrentPosition(position => {
    const location = { lat: position.coords.latitude, lng: position.coords.longitude, label: 'Mi ubicación', source: 'gps', accuracy: position.coords.accuracy || 0 };
    input.value = location.label;
    input.dataset.selectedLocation = JSON.stringify(location);
    state.plannerCurrentPosition = location;
    if (button) button.textContent = '⌖';
    toast('Ubicación lista como origen');
  }, error => {
    if (button) button.textContent = '⌖';
    const messages = { 1: 'Debes permitir el acceso a tu ubicación', 2: 'No se pudo determinar tu ubicación', 3: 'La ubicación tardó demasiado' };
    toast(messages[error.code] || 'No se pudo acceder a la ubicación');
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

function favoritePlaceKey(kind) {
  return kind === 'work' ? 'trb-favorite-work' : 'trb-favorite-home';
}

function getSavedPlace(kind) {
  try { return JSON.parse(storage.get(favoritePlaceKey(kind), 'null')); } catch { return null; }
}

function renderSavedPlaces() {
  const home = getSavedPlace('home');
  const work = getSavedPlace('work');
  const homeLabel = $('#homePlaceLabel');
  const workLabel = $('#workPlaceLabel');
  if (homeLabel) homeLabel.textContent = home?.label ? `Casa · ${home.label}` : 'Agregar casa';
  if (workLabel) workLabel.textContent = work?.label ? `Trabajo · ${work.label}` : 'Agregar trabajo';
}

function openFavoritePlaceEditor(kind = 'home') {
  state.favoritePlaceEditing = kind === 'work' ? 'work' : 'home';
  const modal = $('#favoritePlaceModal');
  const input = $('#favoritePlaceInput');
  const saved = getSavedPlace(state.favoritePlaceEditing);
  $('#favoritePlaceTitle').textContent = state.favoritePlaceEditing === 'work' ? 'Agregar trabajo' : 'Agregar casa';
  $('#favoritePlaceStatus').textContent = '';
  input.value = saved?.label || '';
  if (saved) input.dataset.selectedLocation = JSON.stringify(saved); else delete input.dataset.selectedLocation;
  modal.classList.remove('hidden');
  window.setTimeout(() => input.focus(), 80);
}

function closeFavoritePlaceEditor() {
  $('#favoritePlaceModal')?.classList.add('hidden');
  closeLocationSuggestions($('#favoritePlaceInput'));
  state.favoritePlaceEditing = null;
}

async function saveFavoritePlace() {
  const input = $('#favoritePlaceInput');
  const status = $('#favoritePlaceStatus');
  const kind = state.favoritePlaceEditing || 'home';
  if (!input?.value.trim()) return;
  status.textContent = 'Buscando el lugar…';
  try {
    const location = await geocodeAddress(input.value.trim(), input);
    const saved = { lat: location.lat, lng: location.lng, label: location.label || input.value.trim(), source: location.source || 'search', approximate: Boolean(location.approximate) };
    storage.set(favoritePlaceKey(kind), JSON.stringify(saved));
    renderSavedPlaces();
    closeFavoritePlaceEditor();
    toast(kind === 'work' ? 'Trabajo guardado' : 'Casa guardada');
  } catch (error) {
    status.textContent = error.message || 'No se pudo guardar el lugar.';
  }
}

function useFavoritePlace(kind) {
  const saved = getSavedPlace(kind);
  if (!saved) {
    openFavoritePlaceEditor(kind);
    return;
  }
  const input = $('#homeJourneyDestination');
  input.value = saved.label;
  input.dataset.selectedLocation = JSON.stringify(saved);
  input.focus();
  toast(`${kind === 'work' ? 'Trabajo' : 'Casa'} seleccionado como destino`);
}

async function loadData() {
  const embeddedData = window.TRB_EMBEDDED_DATA || null;
  const embeddedCatalog = window.TRB_EMBEDDED_CATALOG || null;
  const dataPromise = embeddedData
    ? Promise.resolve(embeddedData)
    : fetch('data/transit_data.json').then(response => {
        if (!response.ok) throw new Error(`No se pudo cargar el catálogo principal (${response.status})`);
        return response.json();
      });
  const catalogPromise = embeddedCatalog
    ? Promise.resolve(embeddedCatalog)
    : fetch('data/trb_catalogo_rutas.json').then(response => {
        if (!response.ok) throw new Error(`No se pudo cargar el catálogo KMZ (${response.status})`);
        return response.json();
      });
  const [data, routeCatalog] = await Promise.all([dataPromise, catalogPromise]);
  await detectKmzServer();
  state.data = data;
  state.routeCatalog = routeCatalog;
  state.routes = (state.data.routes || []).map(route => ({ ...route, system: 'transmetro', operator: route.operator || 'Transmetro' }));
  state.operators = (state.data.operators || []).map(operator => ({
    ...operator,
    routes: (operator.routes || []).map(route => {
      const coloredRoute = { ...route, operator: operator.name };
      const color = routeColor(coloredRoute);
      return {
        ...route,
        operator: operator.name,
        colorHex: color.replace('#', ''),
        textColorHex: readableRouteTextColor(color).replace('#', ''),
        companyPalette: ROUTE_OPERATOR_PALETTES[normalizeOperatorKey(operator.name)] || route.companyPalette || []
      };
    })
  }));
  state.officialRoutes = state.operators.flatMap(operator => operator.routes.map(route => ({ ...route, operator: operator.name })));
  state.stops = state.data.stops || [];
  state.stopsById = new Map(state.stops.map(stop => [String(stop.id), stop]));
  state.routeCatalogValidation = window.TRBRouteEngine?.validateCatalog
    ? window.TRBRouteEngine.validateCatalog(routeCatalog)
    : { valid: false, routeCount: routeCatalog?.rutas?.length || 0, errors: ['Motor no cargado'] };
  state.routeEngineReady = Boolean(window.JSZip && window.TRBRouteEngine && state.routeCatalogValidation.valid && state.routeCatalogValidation.routeCount === 93);
  if (!state.routeEngineReady) console.warn('TRB: el motor KMZ no quedó listo', engineReadyMessage(), state.routeCatalogValidation);
}

function buildNavigation() {
  $$('[data-nav]').forEach(nav => {
    nav.innerHTML = NAV_ITEMS.map(item => `
      <button class="nav-button ${item.id === state.currentView ? 'is-active' : ''}" data-view-target="${item.id}" type="button">
        <span class="nav-button__icon">${item.icon}</span><span>${item.label}</span>
      </button>`).join('');
  });
}

function showView(view, options = {}) {
  const visibleView = options.visibleView || view;
  const navView = options.navView || view;
  const preserveNetwork = Boolean(options.preserveNetwork);
  const hashView = options.hashView || navView;
  if (visibleView !== 'map' && $('#app')?.classList.contains('is-route-focus')) exitRouteFocusMode();
  if (!preserveNetwork && state.networkExplorerMode) closeNetworkExplorer({ preserveMap: false });
  state.currentView = navView;
  const app = $('#app');
  app?.classList.toggle('is-home-view', visibleView === 'home');
  app?.classList.toggle('is-map-view', visibleView === 'map');
  app?.classList.toggle('is-assistant-view', visibleView === 'assistant');
  app?.classList.toggle('is-more-view', visibleView === 'more');
  $$('.view').forEach(el => el.classList.toggle('is-active', el.dataset.view === visibleView));
  $$('[data-view-target]').forEach(el => el.classList.toggle('is-active', el.dataset.viewTarget === navView));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (visibleView === 'map') {
    setTimeout(() => initializeMap(), 60);
    setTimeout(() => state.map?.invalidateSize({ animate: false }), 360);
  }
  if (visibleView === 'home') renderSavedPlaces();
  if (navView === 'favorites') renderFavorites();
  history.replaceState(null, '', `#${hashView}`);
}

function renderFacts() {
  const container = $('#factsGrid');
  if (!container) return;
  container.innerHTML = state.data.facts.map(fact => `
    <article class="fact-card">
      <div class="fact-card__icon">${fact.id === 'realtime' ? '⌁' : fact.id.includes('fare') ? '$' : '▦'}</div>
      <div class="fact-card__value">${escapeHTML(fact.value)}</div>
      <div class="fact-card__title">${escapeHTML(fact.title)}</div>
      <div class="fact-card__detail">${escapeHTML(fact.detail)}</div>
    </article>`).join('');
}

function renderFeatured() {
  const container = $('#featuredRoutes');
  if (!container) return;
  const priorities = ['C1-4132', 'A7-4112', 'C11-4168', 'B18-4175 A', 'PT1-4101'];
  const featured = priorities.map(code => state.officialRoutes.find(r => r.code === code)).filter(Boolean);
  container.innerHTML = featured.map(route => `<div class="compact-route" data-official-route-id="${escapeHTML(route.id)}" role="button" tabindex="0" style="${routeColorStyle(route)}"><span class="route-code">${escapeHTML(route.code)}</span><div><div class="compact-route__name">${escapeHTML(route.name)}</div><div class="compact-route__meta">${escapeHTML(route.operator)}</div></div><span>›</span></div>`).join('');
}

function compactRouteHTML(route) {
  return `<div class="compact-route" data-route-id="${escapeHTML(route.id)}" role="button" tabindex="0" style="--route-color:${routeColor(route)}">
    <span class="route-code">${escapeHTML(route.shortName)}</span>
    <div><div class="compact-route__name">${escapeHTML(route.longName)}</div><div class="compact-route__meta">${route.stopIds.length} paraderos de referencia</div></div>
    <span>›</span>
  </div>`;
}

function routeCardHTML(route) {
  const isFavorite = state.favorites.has(String(route.id));
  return `<article class="route-card" data-route-id="${escapeHTML(route.id)}" style="--route-color:${routeColor(route)}" tabindex="0">
    <div class="route-card__head">
      <span class="route-code">${escapeHTML(route.shortName)}</span>
      <button class="favorite-button ${isFavorite ? 'is-favorite' : ''}" data-favorite-id="${escapeHTML(route.id)}" type="button" aria-label="${isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}">${isFavorite ? '♥' : '♡'}</button>
    </div>
    <h3>${escapeHTML(route.longName)}</h3>
    <p>${routeType(route) === 'troncal' ? 'Ruta troncal' : routeType(route) === 'universitaria' ? 'Corredor universitario' : 'Ruta alimentadora'}</p>
    <div class="route-card__footer">${route.stopIds.length} paraderos · Datos de referencia</div>
  </article>`;
}

function transmetroRouteGroupLabel(type = '') {
  if (type === 'troncal') return 'Troncales';
  if (type === 'universitaria') return 'Corredor universitario';
  return 'Alimentadores';
}

function transmetroRouteGroupDescription(type = '', count = 0) {
  const amount = `${count} ${count === 1 ? 'ruta' : 'rutas'}`;
  if (type === 'troncal') return `${amount} principales del sistema Transmetro`;
  if (type === 'universitaria') return `${amount} del corredor universitario`;
  return `${amount} alimentadoras de barrios y sectores`;
}

function transmetroRoutesByServiceType(routes = []) {
  const groups = { troncal: [], alimentadora: [], universitaria: [] };
  routes.forEach(route => {
    const type = routeType(route);
    if (type === 'troncal') groups.troncal.push(route);
    else if (type === 'universitaria') groups.universitaria.push(route);
    else groups.alimentadora.push(route);
  });
  return groups;
}

function transmetroGroupedCatalogHTML(routes = [], options = {}) {
  const groups = transmetroRoutesByServiceType(routes);
  const order = ['troncal', 'alimentadora', 'universitaria'];
  return order.map(type => {
    const items = groups[type] || [];
    if (!items.length) return '';
    const open = options.query || type !== 'universitaria' ? ' open' : '';
    return `<details class="operator-group transmetro-service-group is-${type}"${open}>
      <summary><span class="operator-folder transmetro-folder">${type === 'troncal' ? 'T' : type === 'universitaria' ? 'U' : 'A'}</span><span><b>${transmetroRouteGroupLabel(type)}</b><small>${transmetroRouteGroupDescription(type, items.length)}</small></span><span class="operator-chevron">⌄</span></summary>
      <div class="routes-grid transmetro-service-routes">${items.map(routeCardHTML).join('')}</div>
    </details>`;
  }).join('');
}

function officialRouteRowHTML(route) {
  return `<button class="official-route-row" type="button" data-official-route-id="${escapeHTML(route.id)}">
    <span class="official-route-code" style="${routeColorStyle(route, '--official-color', '--official-text-color')}">${escapeHTML(route.code)}</span>
    <span class="official-route-copy"><b>${escapeHTML(route.name)}</b><small>Trazado KMZ publicado por el AMB</small></span>
    <span class="official-route-arrow">›</span>
  </button>`;
}

function renderRoutes() {
  const query = normalize($('#routeSearch').value);
  const catalog = $('#routeTypeFilter').value;
  const container = $('#routesGrid');
  if (catalog === 'transmetro') {
    const filtered = state.routes.filter(route => !query || normalize(`${route.shortName} ${route.longName} ${routeType(route)} transmetro`).includes(query));
    container.className = 'operators-catalog transmetro-service-catalog';
    container.innerHTML = transmetroGroupedCatalogHTML(filtered, { query }) || '<div class="empty-state"><span>⌕</span><h3>No encontramos esa ruta</h3><p>Prueba con otro código, troncal o alimentador.</p></div>';
    $('#routesCount').textContent = filtered.length;
    $('#routesEmpty').classList.toggle('hidden', filtered.length > 0);
    return;
  }

  let count = 0;
  const groups = state.operators.map((operator, index) => {
    const operatorMatch = normalize(operator.name).includes(query);
    const routes = operator.routes.filter(route => !query || operatorMatch || normalize(`${route.code} ${route.name}`).includes(query));
    count += routes.length;
    if (!routes.length) return '';
    const open = query || index === 0 ? ' open' : '';
    return `<details class="operator-group"${open}>
      <summary><span class="operator-folder" style="${routeColorStyle({...routes[0], operator: operator.name})}">▰</span><span><b>${escapeHTML(operator.name)}</b><small>${routes.length} ${routes.length === 1 ? 'ruta' : 'rutas'}</small></span><span class="operator-chevron">⌄</span></summary>
      <div class="operator-routes">${routes.map(route => officialRouteRowHTML({...route, operator: operator.name})).join('')}</div>
    </details>`;
  }).join('');
  container.className = 'operators-catalog';
  container.innerHTML = groups;
  $('#routesCount').textContent = count;
  $('#routesEmpty').classList.toggle('hidden', count > 0);
}

function openOfficialRoute(routeId) {
  const route = state.officialRoutes.find(item => item.id === routeId);
  if (!route) return;
  state.selectedRoute = null;
  $('#routeDrawerContent').innerHTML = `
    <span class="drawer-route-code" style="${routeColorStyle(route)}">${escapeHTML(route.code)}</span>
    <span class="eyebrow">${escapeHTML(route.operator)}</span>
    <h2 class="drawer-title">${escapeHTML(route.name)}</h2>
    <p>Esta ruta está publicada dentro de la empresa ${escapeHTML(route.operator)} en el catálogo del Área Metropolitana de Barranquilla.</p>
    <div class="drawer-actions">
      <button class="button button--primary" data-show-official-map="${escapeHTML(route.id)}">Ver trazado en TRB</button>
      <a class="button button--secondary" href="${escapeHTML(route.kmzUrl)}" target="_blank" rel="noopener noreferrer">Abrir KMZ oficial ↗</a>
    </div>
    <div class="notice notice--info"><div class="notice__icon">i</div><div><strong>Fuente oficial</strong><p>El recorrido se intentará cargar desde el archivo KMZ publicado por el AMB. Los buses que aparezcan sobre la línea son únicamente una simulación visual.</p></div></div>`;
  $('#routeDrawerBackdrop').classList.remove('hidden');
  $('#routeDrawer').classList.add('is-open');
  $('#routeDrawer').setAttribute('aria-hidden', 'false');
}

function renderFavorites() {
  const favorites = state.routes.filter(route => state.favorites.has(String(route.id)));
  $('#favoritesGrid').innerHTML = favorites.map(routeCardHTML).join('');
  $('#favoritesEmpty').classList.toggle('hidden', favorites.length > 0);
}

function toggleFavorite(routeId) {
  const id = String(routeId);
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
    toast('Ruta eliminada de favoritos');
  } else {
    state.favorites.add(id);
    toast('Ruta guardada en favoritos');
  }
  storage.set('trb-favorites', JSON.stringify([...state.favorites]));
  renderRoutes();
  if (state.currentView === 'favorites') renderFavorites();
  if ($('#routeDrawer').classList.contains('is-open') && state.selectedRoute) renderDrawer(state.selectedRoute);
}

function openRoute(routeId) {
  const route = state.routes.find(r => String(r.id) === String(routeId));
  if (!route) return;
  state.selectedRoute = route;
  renderDrawer(route);
  $('#routeDrawerBackdrop').classList.remove('hidden');
  $('#routeDrawer').classList.add('is-open');
  $('#routeDrawer').setAttribute('aria-hidden', 'false');
}

function renderDrawer(route) {
  const stops = route.stopIds.map(id => state.stopsById.get(String(id))).filter(Boolean);
  const favorite = state.favorites.has(String(route.id));
  $('#routeDrawerContent').innerHTML = `
    <span class="drawer-route-code" style="--route-color:${routeColor(route)}">${escapeHTML(route.shortName)}</span>
    <h2 class="drawer-title">${escapeHTML(route.longName)}</h2>
    <p>${escapeHTML(route.dataNote || 'Información de referencia.')}</p>
    <div class="drawer-actions">
      <button class="button button--primary" data-show-route-map="${escapeHTML(route.id)}">Ver en mapa</button>
      <button class="button button--secondary" data-favorite-id="${escapeHTML(route.id)}">${favorite ? '♥ Guardada' : '♡ Guardar'}</button>
    </div>
    <div class="notice notice--warning"><div class="notice__icon">!</div><div><strong>Recorrido aproximado</strong><p>La línea conecta la secuencia de paraderos disponible; no equivale a una geometría oficial actualizada.</p></div></div>
    <span class="eyebrow">Secuencia disponible</span><h2>${stops.length} paraderos</h2>
    <ol class="drawer-stop-list" style="--route-color:${routeColor(route)}">
      ${stops.map(stop => `<li>${escapeHTML(stop.name)}</li>`).join('')}
    </ol>`;
}

function closeDrawer() {
  $('#routeDrawerBackdrop').classList.add('hidden');
  $('#routeDrawer').classList.remove('is-open');
  $('#routeDrawer').setAttribute('aria-hidden', 'true');
}

function populateMapSelect() {
  const select = $('#mapRouteSelect');
  const officialGroups = state.operators.map(operator => `<optgroup label="${escapeHTML(operator.name)}">${operator.routes.map(route => `<option value="official::${escapeHTML(route.id)}">${escapeHTML(route.code)} · ${escapeHTML(route.name)}</option>`).join('')}</optgroup>`).join('');
  const transmetro = `<optgroup label="Transmetro · referencia histórica">${state.routes.map(route => `<option value="transmetro::${escapeHTML(route.id)}">${escapeHTML(route.shortName)} · ${escapeHTML(route.longName)}</option>`).join('')}</optgroup>`;
  select.insertAdjacentHTML('beforeend', officialGroups + transmetro);
}


function explorerRouteValue(route, system = state.routeExplorerSystem) {
  return system === 'transmetro' ? `transmetro::${route.id}` : `official::${route.id}`;
}

function explorerRouteColor(route, system = state.routeExplorerSystem) {
  return routeColor(route);
}

function explorerRouteCode(route, system = state.routeExplorerSystem) {
  return system === 'transmetro' ? route.shortName : route.code;
}

function explorerRouteName(route, system = state.routeExplorerSystem) {
  return system === 'transmetro' ? route.longName : route.name;
}

function explorerRouteMeta(route, system = state.routeExplorerSystem) {
  if (system === 'transmetro') {
    const type = routeType(route);
    return `${type === 'troncal' ? 'Troncal' : type === 'universitaria' ? 'Universitaria' : 'Alimentadora'} · ${route.stopIds.length} paraderos`;
  }
  return `${route.operator || ''} · KMZ oficial AMB`;
}

function currentExplorerOperator() {
  const select = $('#mapOperatorSelect');
  if (!select) return null;
  return state.operators.find(operator => operator.name === select.value) || state.operators[0] || null;
}

function getExplorerRoutes() {
  const query = normalize(state.routeExplorerQuery);
  if (state.routeExplorerSystem === 'transmetro') {
    return state.routes.filter(route => !query || normalize(`${route.shortName} ${route.longName} transmetro`).includes(query));
  }
  if (query) {
    return state.officialRoutes.filter(route => normalize(`${route.code} ${route.name} ${route.operator}`).includes(query));
  }
  const operator = currentExplorerOperator();
  return operator ? operator.routes.map(route => ({ ...route, operator: operator.name })) : [];
}

function updateExplorerTabs() {
  $$('[data-map-system]').forEach(button => {
    const active = button.dataset.mapSystem === state.routeExplorerSystem;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('#mapOperatorField')?.classList.toggle('is-hidden', state.routeExplorerSystem === 'transmetro');
}

function populateExplorerOperators() {
  const select = $('#mapOperatorSelect');
  if (!select) return;
  const previous = select.value;
  select.innerHTML = state.operators.map(operator => `<option value="${escapeHTML(operator.name)}">${escapeHTML(operator.name)} · ${operator.routes.length} ${operator.routes.length === 1 ? 'ruta' : 'rutas'}</option>`).join('');
  if (state.operators.some(operator => operator.name === previous)) select.value = previous;
}

function renderMapRouteExplorer({ preserveRoute = true } = {}) {
  const routeSelect = $('#mapRouteQuickSelect');
  const list = $('#mapRouteQuickList');
  const status = $('#mapRouteSelectionStatus');
  if (!routeSelect || !list) return;
  updateExplorerTabs();
  const routes = getExplorerRoutes();
  const previous = preserveRoute ? state.routeExplorerSelectedValue : '';
  routeSelect.innerHTML = `<option value="">${routes.length ? 'Selecciona una ruta' : 'No hay rutas para mostrar'}</option>` + routes.map(route => {
    const value = explorerRouteValue(route);
    return `<option value="${escapeHTML(value)}">${escapeHTML(explorerRouteCode(route))} · ${escapeHTML(explorerRouteName(route))}</option>`;
  }).join('');
  if (previous && routes.some(route => explorerRouteValue(route) === previous)) routeSelect.value = previous;

  if (!routes.length) {
    list.innerHTML = `<div class="map-route-empty"><span>⌕</span><b>No encontramos rutas</b><small>Cambia la empresa o borra la búsqueda.</small></div>`;
    if (status) status.textContent = 'No hay rutas que coincidan con la búsqueda.';
    return;
  }

  list.innerHTML = routes.map(route => {
    const value = explorerRouteValue(route);
    const active = value === state.routeExplorerSelectedValue;
    const color = explorerRouteColor(route);
    return `<button class="map-route-quick-card ${active ? 'is-active' : ''}" type="button" data-explorer-route="${escapeHTML(value)}" style="--route-choice-color:${color}" aria-pressed="${active ? 'true' : 'false'}">
      <span class="map-route-quick-code">${escapeHTML(explorerRouteCode(route))}</span>
      <span class="map-route-quick-copy"><b>${escapeHTML(explorerRouteName(route))}</b><small>${escapeHTML(explorerRouteMeta(route))}</small></span>
      <span class="map-route-quick-arrow">${active ? '✓' : '›'}</span>
    </button>`;
  }).join('');
  if (status && !state.routeExplorerSelectedValue) {
    status.textContent = state.routeExplorerSystem === 'transmetro'
      ? `${routes.length} rutas de Transmetro disponibles. Toca una para mostrarla.`
      : state.routeExplorerQuery
        ? `${routes.length} coincidencias encontradas entre las 23 empresas.`
        : `${routes.length} rutas de ${currentExplorerOperator()?.name || 'la empresa'} disponibles.`;
  }
}

function setMapRouteExplorerSystem(system, { keepQuery = false } = {}) {
  state.routeExplorerSystem = system === 'transmetro' ? 'transmetro' : 'sibus';
  storage.set('trb-map-route-system', state.routeExplorerSystem);
  state.routeExplorerSelectedValue = '';
  if (!keepQuery) {
    state.routeExplorerQuery = '';
    if ($('#mapRouteQuickSearch')) $('#mapRouteQuickSearch').value = '';
  }
  renderMapRouteExplorer({ preserveRoute: false });
}

function activateExplorerRoute(value) {
  if (!value) return;
  state.routeExplorerSelectedValue = value;
  $('#mapRouteSelect').value = value;
  $('#mapRouteQuickSelect').value = value;
  const status = $('#mapRouteSelectionStatus');
  if (value.startsWith('official::')) {
    const route = state.officialRoutes.find(item => item.id === value.slice('official::'.length));
    if (!route) return;
    state.routeExplorerSystem = 'sibus';
    const operatorSelect = $('#mapOperatorSelect');
    if (operatorSelect && state.operators.some(operator => operator.name === route.operator)) operatorSelect.value = route.operator;
    if (status) status.textContent = `Mostrando ${route.code} · ${route.name} (${route.operator}).`;
    renderMapRouteExplorer();
    drawOfficialRoute(route);
    return;
  }
  if (value.startsWith('transmetro::')) {
    const route = state.routes.find(item => String(item.id) === value.slice('transmetro::'.length));
    if (!route) return;
    state.routeExplorerSystem = 'transmetro';
    if (status) status.textContent = `Mostrando ${route.shortName} · ${route.longName} (Transmetro).`;
    renderMapRouteExplorer();
    drawRoute(route);
  }
}

function syncMapRouteExplorer(value, operatorName = '') {
  if (!value) return;
  state.routeExplorerSelectedValue = value;
  state.routeExplorerSystem = value.startsWith('transmetro::') ? 'transmetro' : 'sibus';
  storage.set('trb-map-route-system', state.routeExplorerSystem);
  if (operatorName && $('#mapOperatorSelect')) $('#mapOperatorSelect').value = operatorName;
  updateExplorerTabs();
  renderMapRouteExplorer();
  const quickSelect = $('#mapRouteQuickSelect');
  if (quickSelect && [...quickSelect.options].some(option => option.value === value)) quickSelect.value = value;
  if ($('#mapRouteSelect')) $('#mapRouteSelect').value = value;
}

function initializeMapRouteExplorer() {
  $('#mapTransmetroCount').textContent = state.routes.length;
  $('#mapSibusCount').textContent = state.officialRoutes.length;
  populateExplorerOperators();
  updateExplorerTabs();
  renderMapRouteExplorer({ preserveRoute: false });
}


function getMapLibreMap() {
  if (state.mapLibreMap) return state.mapLibreMap;
  const layer = state.baseMapLayer;
  const candidate = layer?.getMaplibreMap?.() || layer?._glMap || layer?._maplibreMap || null;
  if (candidate) state.mapLibreMap = candidate;
  return candidate;
}

const MAPLIBRE_ROUTE_SOURCE = 'trb-route-geojson';
const MAPLIBRE_ROUTE_LAYERS = ['trb-route-casing', 'trb-route-main'];

function clearMapLibreRoute() {
  state.mapLibreRoutePending = null;
  const glMap = getMapLibreMap();
  if (!glMap) return;
  try {
    MAPLIBRE_ROUTE_LAYERS.forEach(id => { if (glMap.getLayer(id)) glMap.removeLayer(id); });
    if (glMap.getSource(MAPLIBRE_ROUTE_SOURCE)) glMap.removeSource(MAPLIBRE_ROUTE_SOURCE);
  } catch (error) {
    console.warn('TRB: no se pudo limpiar la capa GeoJSON de MapLibre', error);
  }
}

function pathsToFeatureCollection(paths = [], properties = {}) {
  return {
    type: 'FeatureCollection',
    features: paths.filter(path => Array.isArray(path.coordinates) && path.coordinates.length > 1).map((path, index) => ({
      type: 'Feature',
      properties: {
        ...properties,
        name: path.name || `Tramo ${index + 1}`,
        direction: path.direction || 'recorrido',
        distanceMeters: Number(path.distanceMeters) || 0,
        priority: index
      },
      geometry: { type: 'LineString', coordinates: path.coordinates }
    }))
  };
}

function drawMapLibreRoute(featureCollection, color) {
  const glMap = getMapLibreMap();
  if (!glMap || !featureCollection?.features?.length) return false;
  const render = () => {
    try {
      clearMapLibreRoute();
      glMap.addSource(MAPLIBRE_ROUTE_SOURCE, { type: 'geojson', data: featureCollection, lineMetrics: true });
      const firstLabel = (glMap.getStyle()?.layers || []).find(layer => layer.type === 'symbol')?.id;
      glMap.addLayer({
        id: 'trb-route-casing', type: 'line', source: MAPLIBRE_ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 12, 17, 18],
          'line-opacity': 0.98
        }
      }, firstLabel);
      glMap.addLayer({
        id: 'trb-route-main', type: 'line', source: MAPLIBRE_ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': color,
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4, 13, 7, 17, 11],
          'line-opacity': ['case', ['>', ['get', 'priority'], 1], 0.66, 0.96]
        }
      }, firstLabel);
      state.mapLibreRoutePending = null;
      return true;
    } catch (error) {
      console.warn('TRB: MapLibre no pudo dibujar la ruta GeoJSON; se usará Leaflet como respaldo', error);
      return false;
    }
  };
  if (glMap.isStyleLoaded?.()) return render();
  state.mapLibreRoutePending = { featureCollection, color };
  const retry = () => {
    const pending = state.mapLibreRoutePending;
    if (pending && glMap.isStyleLoaded?.()) drawMapLibreRoute(pending.featureCollection, pending.color);
  };
  glMap.once?.('style.load', retry);
  glMap.once?.('load', retry);
  // Mientras la hoja de estilo termina de cargar, el llamador dibuja una línea Leaflet visible.
  return false;
}


function networkEngineConfig() {
  return {
    maxWalkMeters: 2400,
    minRideMeters: 300,
    busMetersPerMinute: 250,
    walkMetersPerMinute: 80,
    walkDistanceFactor: 1.18,
    localKmzBase: 'kmz/',
    allowRemoteFallback: !state.kmzServerAvailable,
    fetchTimeoutMs: 45000
  };
}

function clearNetworkOverview() {
  if (state.map && state.networkOverviewLayer && state.map.hasLayer(state.networkOverviewLayer)) state.map.removeLayer(state.networkOverviewLayer);
  state.networkOverviewLayer = null;
}

function networkRouteValue(route, system = state.networkExplorerSystem) {
  return system === 'transmetro' ? `transmetro::${route.id}` : `official::${route.id}`;
}

function renderNetworkBrowseList() {
  const list = $('#networkBrowseList');
  const status = $('#networkBrowseStatus');
  if (!list) return;
  const query = normalize(state.networkRouteQuery || '');
  $$('[data-network-system]').forEach(button => {
    const active = button.dataset.networkSystem === state.networkExplorerSystem;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const title = $('#networkBrowseTitle');
  const subtitle = $('#networkBrowseSubtitle');
  if (state.networkExplorerSystem === 'transmetro') {
    if (title) title.textContent = 'Rutas de Transmetro';
    if (subtitle) subtitle.textContent = 'Separadas por troncales y alimentadores. Toca una ruta para dejar únicamente su recorrido en el mapa.';
    const routes = state.routes.filter(route => !query || normalize(`${route.shortName} ${route.longName} ${routeType(route)} transmetro`).includes(query));
    const groups = transmetroRoutesByServiceType(routes);
    const order = ['troncal', 'alimentadora', 'universitaria'];
    list.innerHTML = order.map(type => {
      const items = groups[type] || [];
      if (!items.length) return '';
      const open = query || type !== 'universitaria' ? ' open' : '';
      return `<details class="network-company-group network-transmetro-group is-${type}"${open}>
        <summary><span class="network-company-icon is-transmetro">${type === 'troncal' ? 'T' : type === 'universitaria' ? 'U' : 'A'}</span><span><b>${transmetroRouteGroupLabel(type)}</b><small>${transmetroRouteGroupDescription(type, items.length)}</small></span><i>⌄</i></summary>
        <div class="network-company-routes">${items.map(route => `<button type="button" data-network-route="${escapeHTML(networkRouteValue(route, 'transmetro'))}" style="--network-route-color:${routeColor(route)}"><span>${escapeHTML(route.shortName)}</span><span><b>${escapeHTML(route.longName)}</b><small>${routeType(route) === 'troncal' ? 'Ruta troncal' : routeType(route) === 'universitaria' ? 'Corredor universitario' : 'Ruta alimentadora'} · ${route.stopIds.length} paraderos</small></span><i>›</i></button>`).join('')}</div>
      </details>`;
    }).join('') || '<div class="network-empty"><b>No encontramos rutas de Transmetro</b><small>Prueba con otro código o nombre.</small></div>';
    if (status) status.textContent = `${routes.length} rutas de Transmetro disponibles, separadas en troncales y alimentadores.`;
    return;
  }
  if (title) title.textContent = 'Rutas';
  if (subtitle) subtitle.textContent = 'Selecciona una empresa y luego una ruta para mostrar únicamente ese recorrido.';
  let count = 0;
  const groups = state.operators.map((operator, index) => {
    const operatorMatch = normalize(operator.name).includes(query);
    const routes = operator.routes.filter(route => !query || operatorMatch || normalize(`${route.code} ${route.name}`).includes(query));
    count += routes.length;
    if (!routes.length) return '';
    const firstRoute = { ...routes[0], operator: operator.name };
    return `<details class="network-company-group" ${query || index < 2 ? 'open' : ''}><summary><span class="network-company-icon" style="${routeColorStyle(firstRoute, '--network-company-color', '--network-company-text-color')}">▰</span><span><b>${escapeHTML(operator.name)}</b><small>${routes.length} ${routes.length === 1 ? 'ruta' : 'rutas'}</small></span><i>⌄</i></summary><div class="network-company-routes">${routes.map(route => { const coloredRoute = { ...route, operator: operator.name }; return `<button type="button" data-network-route="official::${escapeHTML(route.id)}" style="${routeColorStyle(coloredRoute, '--network-route-color', '--network-route-text-color')}"><span>${escapeHTML(route.code)}</span><span><b>${escapeHTML(route.name)}</b><small>Recorrido KMZ oficial AMB</small></span><i>›</i></button>`; }).join('')}</div></details>`;
  }).join('');
  list.innerHTML = groups || '<div class="network-empty"><b>No encontramos rutas</b><small>Prueba con otro código o empresa.</small></div>';
  if (status) status.textContent = `${count} rutas encontradas entre ${state.operators.length} empresas.`;
}

function clearMapForRouteSelection() {
  initializeMap();
  state.transmetroDrawRequestId += 1;
  state.networkOverviewRequestId += 1;
  clearNetworkOverview();
  stopDemoBusAnimation();
  clearMapLibreRoute();
  if (state.map && state.routeLayer && state.map.hasLayer(state.routeLayer)) state.map.removeLayer(state.routeLayer);
  state.routeLayer = null;
  if (state.map && state.busLayer && state.map.hasLayer(state.busLayer)) state.map.removeLayer(state.busLayer);
  state.busLayer = null;
  if (state.map && state.allStopsLayer && state.map.hasLayer(state.allStopsLayer)) state.map.removeLayer(state.allStopsLayer);
  if (state.map && state.liveVehicleLayer && state.map.hasLayer(state.liveVehicleLayer)) state.map.removeLayer(state.liveVehicleLayer);
  state.currentMapRoute = null;
  state.currentRouteStops = [];
  state.currentRoutePath = [];
  state.demoBuses = [];
  setMapJourneyOverlay('');
  $('#mapInfoDefault')?.classList.remove('hidden');
  $('#mapInfoContent')?.classList.add('hidden');
  if ($('#mapInfoContent')) $('#mapInfoContent').innerHTML = '';
  const label = $('.map-demo-label');
  if (label) label.innerHTML = '<span></span> Selecciona una ruta para verla';
  state.map?.setView([10.9878, -74.7889], 12, { animate: false });
}

async function drawNetworkOverview(system = state.networkExplorerSystem) {
  initializeMap();
  if (!state.map) return;
  const requestId = ++state.networkOverviewRequestId;
  clearNetworkOverview();
  stopDemoBusAnimation();
  clearMapLibreRoute();
  if (state.routeLayer && state.map.hasLayer(state.routeLayer)) state.map.removeLayer(state.routeLayer);
  state.routeLayer = null;
  if (state.busLayer && state.map.hasLayer(state.busLayer)) state.map.removeLayer(state.busLayer);
  state.busLayer = null;
  if (state.allStopsLayer && state.map.hasLayer(state.allStopsLayer)) state.map.removeLayer(state.allStopsLayer);
  setMapJourneyOverlay('');
  const status = $('#networkBrowseStatus');
  if (status) status.textContent = system === 'transmetro' ? 'Dibujando toda la red de Transmetro…' : 'Cargando los recorridos KMZ de las 23 empresas…';
  const group = L.layerGroup();
  const renderer = L.canvas({ padding: .5 });
  const bounds = [];
  if (system === 'transmetro') {
    state.routes.forEach(route => {
      const points = route.stopIds.map(id => state.stopsById.get(String(id))).filter(Boolean).map(stop => [stop.latitude, stop.longitude]).filter(point => point.every(Number.isFinite));
      if (points.length < 2) return;
      L.polyline(points, { color: routeColor(route), weight: 3.2, opacity: .72, interactive: false, renderer }).addTo(group);
      bounds.push(...points);
    });
  } else {
    const items = await loadOfficialPlannerRouteData(networkEngineConfig());
    if (requestId !== state.networkOverviewRequestId || !state.networkExplorerMode || state.networkExplorerSystem !== system) return;
    items.forEach(item => {
      const sampled = sampleCoordinates(item.route._pathCoordinates || [], 180).map(([lng, lat]) => [lat, lng]).filter(point => point.every(Number.isFinite));
      if (sampled.length < 2) return;
      L.polyline(sampled, { color: routeColor(item.route), weight: 2.4, opacity: .48, interactive: false, renderer }).addTo(group);
      bounds.push(...sampled);
    });
  }
  if (requestId !== state.networkOverviewRequestId) return;
  group.addTo(state.map);
  state.networkOverviewLayer = group;
  if (bounds.length) state.map.fitBounds(L.latLngBounds(bounds), { padding: [34, 34], animate: false, maxZoom: 13 });
  if (status) status.textContent = system === 'transmetro'
    ? `${state.routes.length} rutas de Transmetro visibles. Selecciona una en la lista.`
    : `${state.officialRoutes.length} rutas de buses visibles. Selecciona una empresa y una ruta.`;
  const label = $('.map-demo-label');
  if (label) label.innerHTML = `<span></span> ${system === 'transmetro' ? 'Red Transmetro' : 'Red de buses'} · Selecciona una ruta`;
}

function openNetworkExplorer(system = 'sibus') {
  state.networkExplorerMode = true;
  state.networkExplorerSystem = system === 'transmetro' ? 'transmetro' : 'sibus';
  state.networkReturnSystem = null;
  state.networkRouteQuery = '';
  const app = $('#app');
  app?.classList.add('is-network-browse');
  app?.classList.remove('is-network-route-selected');
  $('#networkBrowsePanel')?.classList.remove('hidden');
  if ($('#networkRouteSearch')) $('#networkRouteSearch').value = '';
  showView('map', { navView: 'routes', hashView: 'routes', preserveNetwork: true });
  setRouteFocusMode(false, 'default');
  renderNetworkBrowseList();
  window.setTimeout(clearMapForRouteSelection, 120);
}

function closeNetworkExplorer({ preserveMap = false } = {}) {
  state.networkExplorerMode = false;
  state.networkReturnSystem = null;
  state.networkOverviewRequestId += 1;
  clearNetworkOverview();
  $('#app')?.classList.remove('is-network-browse', 'is-network-route-selected');
  $('#networkBrowsePanel')?.classList.add('hidden');
  if (!preserveMap && state.map) {
    stopDemoBusAnimation();
    clearMapLibreRoute();
    if (state.routeLayer && state.map.hasLayer(state.routeLayer)) state.map.removeLayer(state.routeLayer);
    state.routeLayer = null;
    if (state.busLayer && state.map.hasLayer(state.busLayer)) state.map.removeLayer(state.busLayer);
    state.busLayer = null;
    if (state.allStopsLayer && state.map.hasLayer(state.allStopsLayer)) state.map.removeLayer(state.allStopsLayer);
    setMapJourneyOverlay('');
  }
}

function setNetworkSystem(system) {
  state.networkExplorerSystem = system === 'transmetro' ? 'transmetro' : 'sibus';
  state.networkRouteQuery = '';
  $('#app')?.classList.remove('is-network-route-selected');
  $('#networkBrowsePanel')?.classList.remove('hidden');
  if ($('#networkRouteSearch')) $('#networkRouteSearch').value = '';
  renderNetworkBrowseList();
  clearMapForRouteSelection();
}

function openNetworkRoute(value) {
  if (!value) return;
  state.networkReturnSystem = state.networkExplorerSystem;
  clearNetworkOverview();
  $('#app')?.classList.add('is-network-route-selected');
  setRouteFocusMode(true, 'line');
  state.lineReturnPlanIndex = -1;
  state.lineReturnMode = 'default';
  if (value.startsWith('official::')) {
    const route = state.officialRoutes.find(item => item.id === value.slice('official::'.length));
    if (route) drawOfficialRoute(route);
    return;
  }
  if (value.startsWith('transmetro::')) {
    const route = state.routes.find(item => String(item.id) === value.slice('transmetro::'.length));
    if (route) drawRoute(route);
  }
}

function initializeMap() {
  const mapElement = $('#map');
  if (!mapElement) return false;
  if (!window.L) {
    renderMapUnavailable('Leaflet no respondió; se necesita como capa de interacción de TRB.');
    return false;
  }
  if (state.mapUnavailableRendered) {
    mapElement.innerHTML = '';
    state.mapUnavailableRendered = false;
  }
  if (!state.map) {
    try {
      state.map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 9 }).setView([10.9878, -74.7889], 12);
      L.control.zoom({ position: 'bottomright' }).addTo(state.map);
      state.map.createPane('routeCasing'); state.map.getPane('routeCasing').style.zIndex = 410;
      state.map.createPane('routeMain'); state.map.getPane('routeMain').style.zIndex = 420;
      state.map.createPane('routeStops'); state.map.getPane('routeStops').style.zIndex = 430;
      state.map.createPane('routeVehicles'); state.map.getPane('routeVehicles').style.zIndex = 440;

      const attachTiles = (url, attribution, isFallback = false) => {
        if (state.baseMapLayer && state.map.hasLayer(state.baseMapLayer)) state.map.removeLayer(state.baseMapLayer);
        state.mapLibreMap = null;
        state.mapEngine = 'leaflet-raster';
        let errors = 0;
        const layer = L.tileLayer(url, { maxZoom: 19, crossOrigin: true, updateWhenIdle: true, keepBuffer: 3, attribution });
        layer.on('tileerror', event => {
          errors += 1;
          console.warn('TRB: no se pudo cargar un mosaico', event?.tile?.src || event);
          if (errors >= 6 && !isFallback && !state.baseMapFallbackUsed) {
            state.baseMapFallbackUsed = true;
            setMapRuntimeStatus('El mapa vectorial no respondió. Cambiando al respaldo ráster…', 'warning');
            attachTiles('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', '&copy; OpenStreetMap contributors &copy; CARTO', true);
          } else if (errors >= 8 && isFallback) {
            setMapRuntimeStatus('Las calles no están cargando, pero todavía puedes visualizar las rutas y puntos.', 'warning');
          }
        });
        layer.on('load', () => { errors = 0; clearMapBootPlaceholder(); });
        layer.addTo(state.map);
        state.baseMapLayer = layer;
      };

      const attachMapLibre = () => {
        if (!window.maplibregl || typeof L.maplibreGL !== 'function') return false;
        try {
          const vectorLayer = L.maplibreGL({
            style: 'maps/trb-map-style.json',
            interactive: false,
            attributionControl: {
              customAttribution: '<a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · Datos <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>'
            }
          });
          vectorLayer.addTo(state.map);
          state.baseMapLayer = vectorLayer;
          state.mapEngine = 'maplibre';
          state.mapLibreMap = vectorLayer.getMaplibreMap?.() || vectorLayer._glMap || null;
          const glMap = getMapLibreMap();
          let ready = false;
          const fallback = reason => {
            if (ready || state.mapEngine !== 'maplibre') return;
            console.warn('TRB: activando mapa de respaldo', reason);
            try { state.map.removeLayer(vectorLayer); } catch (_) {}
            state.baseMapFallbackUsed = true;
            setMapRuntimeStatus('MapLibre no pudo completar la carga. Usando mapa de respaldo…', 'warning');
            attachTiles('https://tile.openstreetmap.org/{z}/{x}/{y}.png', '&copy; OpenStreetMap contributors');
          };
          if (glMap) {
            glMap.on('load', () => {
              ready = true;
              clearMapBootPlaceholder();
              setMapRuntimeStatus('', 'info');
              const pending = state.mapLibreRoutePending;
              if (pending) drawMapLibreRoute(pending.featureCollection, pending.color);
            });
            glMap.on('error', event => {
              const message = event?.error?.message || '';
              if (!ready && /style|source|webgl|failed|network/i.test(message)) fallback(message);
            });
          }
          window.setTimeout(() => {
            if (!ready && !(getMapLibreMap()?.isStyleLoaded?.())) fallback('tiempo de carga agotado');
          }, 14000);
          return true;
        } catch (error) {
          console.warn('TRB: no se pudo iniciar MapLibre', error);
          return false;
        }
      };

      if (!attachMapLibre()) {
        setMapRuntimeStatus('MapLibre no está disponible. Usando el mapa de respaldo.', 'warning');
        attachTiles('https://tile.openstreetmap.org/{z}/{x}/{y}.png', '&copy; OpenStreetMap contributors');
      }
      drawAllStops();
      startLiveVehiclePolling();
      state.map.on('click', event => {
        if (!state.mapPickTarget) return;
        chooseMapPoint(state.mapPickTarget, event.latlng.lat, event.latlng.lng);
      });
      clearMapBootPlaceholder();
    } catch (error) {
      console.error('TRB: error inicializando el mapa', error);
      state.map = null;
      renderMapUnavailable(error.message || String(error));
      return false;
    }
  }
  requestAnimationFrame(() => {
    state.map?.invalidateSize({ animate: false });
    getMapLibreMap()?.resize?.();
    setTimeout(() => { state.map?.invalidateSize({ animate: false }); getMapLibreMap()?.resize?.(); }, 180);
    setTimeout(() => { state.map?.invalidateSize({ animate: false }); getMapLibreMap()?.resize?.(); }, 650);
  });
  return true;
}
function drawAllStops() {
  if (!state.map) return;
  if (state.allStopsLayer) state.map.removeLayer(state.allStopsLayer);
  const layer = L.layerGroup();
  state.stops.forEach(stop => {
    if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return;
    L.circleMarker([stop.latitude, stop.longitude], {
      radius: 4, weight: 1, color: '#fff', fillColor: '#1463e6', fillOpacity: .80
    }).bindPopup(`<strong>${escapeHTML(stop.name)}</strong><br><small>Paradero de referencia</small>`).addTo(layer);
  });
  state.allStopsLayer = layer;
}

function showRouteOnMap(routeId) {
  const route = state.routes.find(r => String(r.id) === String(routeId));
  if (!route) return;
  showView('map');
  setTimeout(() => {
    initializeMap();
    state.mapRouteInitialized = true;
    $('#mapRouteSelect').value = `transmetro::${route.id}`;
    drawRoute(route);
  }, 100);
}

function stopMarkerIcon(number, color, isTerminal = false) {
  return L.divIcon({
    className: 'trb-stop-icon-wrap',
    html: `<div class="trb-stop-marker ${isTerminal ? 'is-terminal' : ''}" style="--marker-color:${color}">${number}</div>`,
    iconSize: isTerminal ? [34, 34] : [28, 28],
    iconAnchor: isTerminal ? [17, 17] : [14, 14],
    popupAnchor: [0, -15]
  });
}

function trbBusIconSVG(className = 'trb-bus-svg') {
  return `<svg class="${className}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <rect x="7" y="5" width="18" height="20" rx="4"></rect>
    <path d="M10 9h12v6H10z"></path>
    <circle cx="11.5" cy="22.5" r="2.1"></circle>
    <circle cx="20.5" cy="22.5" r="2.1"></circle>
    <path d="M9 17h14"></path>
  </svg>`;
}

function trbPlaceIconHTML(type = 'origin') {
  return `<span class="trb-place-icon is-${type}" aria-hidden="true"></span>`;
}

function busMarkerIcon(bus, color) {
  return L.divIcon({
    className: 'trb-bus-icon-wrap',
    html: `<div class="trb-bus-marker" style="--bus-color:${color}" title="${escapeHTML(bus.id)}">${trbBusIconSVG()}<small>SIM</small></div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
    popupAnchor: [0, -22]
  });
}

function liveVehicleMarkerIcon(vehicle) {
  const color = routeFamilyColor(vehicle.routeCode || vehicle.route_id || 'TRB');
  const bearing = Number(vehicle.bearing || 0);
  return L.divIcon({
    className: 'trb-live-bus-icon-wrap',
    html: `<div class="trb-live-bus-marker" style="--live-bus-color:${color};--live-bearing:${bearing}deg">${trbBusIconSVG('trb-bus-svg trb-bus-svg--live')}<small>EN VIVO</small></div>`,
    iconSize: [54, 54],
    iconAnchor: [27, 27],
    popupAnchor: [0, -24]
  });
}

function renderLiveVehicles(vehicles = []) {
  if (!state.map || !window.L) return;
  if (!state.liveVehicleLayer) state.liveVehicleLayer = L.layerGroup([], { pane: 'routeVehicles' }).addTo(state.map);
  state.liveVehicleLayer.clearLayers();
  state.liveVehicles = vehicles;
  vehicles.forEach(vehicle => {
    const lat = Number(vehicle.lat);
    const lng = Number(vehicle.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const updated = vehicle.updatedAt ? new Date(vehicle.updatedAt * 1000) : null;
    const age = updated ? Math.max(0, Math.round((Date.now() - updated.getTime()) / 1000)) : null;
    const popup = `<strong>${escapeHTML(vehicle.routeCode || 'Bus TRB')}</strong><br><span>${escapeHTML(vehicle.vehicleId || vehicle.driverId || 'Vehículo')}</span><br><small>Ubicación real${age === null ? '' : ` · hace ${age} s`}</small>`;
    L.marker([lat, lng], {
      pane: 'routeVehicles',
      icon: liveVehicleMarkerIcon(vehicle),
      zIndexOffset: 1200
    }).bindPopup(popup).addTo(state.liveVehicleLayer);
  });
}

async function refreshLiveVehicles() {
  if (window.location.protocol === 'file:') return;
  try {
    const response = await fetch(relativeAppUrl('api/vehicles?active_seconds=180'), { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const payload = await response.json();
    renderLiveVehicles(Array.isArray(payload.vehicles) ? payload.vehicles : []);
  } catch (_) {}
}

function startLiveVehiclePolling() {
  if (state.liveVehicleTimer) return;
  refreshLiveVehicles();
  state.liveVehicleTimer = window.setInterval(refreshLiveVehicles, 5000);
}

function routeSeed(value) {
  return String(value).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function createDemoBuses(route, stops) {
  const count = Math.max(3, Math.min(6, Math.round(stops.length / 10) + 2));
  const seed = routeSeed(route.id);
  return Array.from({ length: count }, (_, index) => ({
    id: `TRB-${route.shortName.replace(/[^A-Z0-9]/gi, '')}-${String(index + 1).padStart(2, '0')}`,
    progress: ((index + 0.45) / count + (seed % 13) / 100) % 1,
    speed: 0.0012 + ((seed + index * 7) % 5) * 0.00016,
    marker: null,
    nextStopIndex: 0,
    status: 'En recorrido'
  }));
}

function pathMetrics(stops) {
  const segments = [];
  let total = 0;
  for (let index = 0; index < stops.length - 1; index++) {
    const a = stops[index], b = stops[index + 1];
    const distance = haversine(a.latitude, a.longitude, b.latitude, b.longitude);
    segments.push({ index, distance, start: total, end: total + distance });
    total += distance;
  }
  return { segments, total };
}

function positionAtProgress(stops, metrics, progress) {
  if (!stops.length) return null;
  if (stops.length === 1 || !metrics.total) return { lat: stops[0].latitude, lng: stops[0].longitude, nextStopIndex: 0 };
  const target = ((progress % 1) + 1) % 1 * metrics.total;
  const segment = metrics.segments.find(item => target <= item.end) || metrics.segments[metrics.segments.length - 1];
  const ratio = segment.distance ? (target - segment.start) / segment.distance : 0;
  const a = stops[segment.index], b = stops[segment.index + 1];
  return {
    lat: a.latitude + (b.latitude - a.latitude) * ratio,
    lng: a.longitude + (b.longitude - a.longitude) * ratio,
    nextStopIndex: Math.min(segment.index + 1, stops.length - 1),
    segmentRatio: ratio
  };
}

function updateDemoBuses(advance = false) {
  if (!state.map || !state.busLayer || !state.currentRouteStops.length) return;
  const movementPath = state.currentRoutePath.length > 1 ? state.currentRoutePath : state.currentRouteStops;
  const metrics = pathMetrics(movementPath);
  state.demoBuses.forEach((bus, index) => {
    if (advance) bus.progress = (bus.progress + bus.speed) % 1;
    const position = positionAtProgress(movementPath, metrics, bus.progress);
    if (!position) return;
    let nearestStopIndex = 0;
    let nearestStopDistance = Infinity;
    state.currentRouteStops.forEach((candidate, stopIndex) => {
      const distance = haversine(position.lat, position.lng, candidate.latitude, candidate.longitude);
      if (distance < nearestStopDistance) { nearestStopDistance = distance; nearestStopIndex = stopIndex; }
    });
    bus.nextStopIndex = nearestStopIndex;
    bus.status = position.segmentRatio > .93 ? 'Próximo a parada' : index % 3 === 0 ? 'Servicio regular' : 'En recorrido';
    const stop = state.currentRouteStops[bus.nextStopIndex];
    const popup = `<strong>${escapeHTML(bus.id)}</strong><br><span>Bus de demostración</span><br><small>Próximo: ${escapeHTML(stop?.name || '—')}</small>`;
    if (!bus.marker) {
      bus.marker = L.marker([position.lat, position.lng], { pane: 'routeVehicles', icon: busMarkerIcon(bus, routeColor(state.currentMapRoute)), zIndexOffset: 900 })
        .bindPopup(popup)
        .addTo(state.busLayer);
    } else {
      bus.marker.setLatLng([position.lat, position.lng]);
      bus.marker.setPopupContent(popup);
    }
  });
  renderBusList();
}

function renderBusList() {
  const list = $('#demoBusList');
  if (!list || !state.currentRouteStops.length) return;
  list.innerHTML = state.demoBuses.map((bus, index) => {
    const stop = state.currentRouteStops[bus.nextStopIndex];
    return `<button class="demo-bus-row" type="button" data-demo-bus-index="${index}">
      <span class="demo-bus-row__icon">${trbBusIconSVG('trb-bus-svg trb-bus-svg--row')}</span>
      <span class="demo-bus-row__body"><b>${escapeHTML(bus.id)}</b><small>${escapeHTML(bus.status)} · Próximo: ${escapeHTML(stop?.name || '—')}</small></span>
      <span class="demo-chip">SIM</span>
    </button>`;
  }).join('');
}

function renderMapRoutePanel(route, stops, color, routeMetrics = {}) {
  $('#mapInfoDefault').classList.add('hidden');
  $('#mapInfoContent').classList.remove('hidden');
  const distance = Number(routeMetrics.distance) || segmentDistance(stops, 0, Math.max(0, stops.length - 1));
  const duration = Math.max(1, Math.ceil((Number(routeMetrics.duration) || distance / 9.3) / 60));
  const firstStop = stops[0]?.name || 'Inicio del recorrido';
  const lastStop = stops[stops.length - 1]?.name || 'Final del recorrido';
  $('#mapInfoContent').innerHTML = `
    ${lineInfoBackHeaderHTML(route.shortName)}
    <div class="map-route-summary">
      <span class="route-code" style="--route-color:${color};--route-text-color:${routeTextColor(route)}">${escapeHTML(route.shortName)}</span>
      <div><span class="eyebrow">${escapeHTML(route.operator || 'Transmetro')}</span><h2>${escapeHTML(route.longName)}</h2><p>Solo esta línea está visible en el mapa.</p></div>
    </div>
    <div class="hsl-route-timeline"><span class="hsl-route-terminal" style="--timeline-color:${color}">A</span><div><b>${escapeHTML(firstStop)}</b><small>Inicio del recorrido</small></div><span class="hsl-route-line" style="--timeline-color:${color}"></span><span class="hsl-route-terminal" style="--timeline-color:${color}">B</span><div><b>${escapeHTML(lastStop)}</b><small>Final del recorrido</small></div></div>
    <div class="status-table route-metrics-table"><div><span>Distancia</span><b>${formatRouteDistance(distance)}</b></div><div><span>Duración estimada</span><b>≈ ${duration} min</b></div><div><span>Paraderos</span><b>${stops.length}</b></div></div>
    <div class="data-caution"><span>i</span><p>${routeMetrics.precise ? 'El recorrido fue ajustado a la red vial usando la secuencia de paraderos disponible.' : 'No respondió el ajuste vial; se muestra la secuencia de paraderos como referencia.'} Los vehículos son una simulación visual, no GPS real.</p></div>
    <section class="operations-section">
      <div class="operations-heading"><div><span class="eyebrow">Vehículos incluidos</span><h3>Buses sobre la ruta</h3></div><span class="simulation-badge">Simulación</span></div>
      <div id="demoBusList" class="demo-bus-list"></div>
    </section>
    <section class="operations-section operations-section--stops">
      <div class="operations-heading"><div><span class="eyebrow">Secuencia disponible</span><h3>${stops.length} paraderos</h3></div></div>
      <ol class="map-stop-sequence" style="--sequence-color:${color}">
        ${stops.map((stop, index) => `<li><button type="button" data-map-stop-index="${index}"><span>${index + 1}</span><b>${escapeHTML(stop.name)}</b></button></li>`).join('')}
      </ol>
    </section>`;
}


function parseKmlCoordinates(text) {
  return text.trim().split(/\s+/).map(item => {
    const [lng, lat] = item.split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }).filter(Boolean);
}


function officialDrawablePaths(paths = []) {
  return (Array.isArray(paths) ? paths : []).filter(path =>
    Array.isArray(path.coordinates) &&
    path.coordinates.filter(coord => Array.isArray(coord) && coord.length >= 2 && Number.isFinite(Number(coord[0])) && Number.isFinite(Number(coord[1]))).length > 1
  );
}

function latLngPointsFromOfficialPath(path) {
  return (path?.coordinates || [])
    .map(([lng, lat]) => [Number(lat), Number(lng)])
    .filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function officialPathDistanceMeters(path) {
  const explicit = Number(path?.distanceMeters);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (window.TRBRouteEngine?.lineDistanceMeters && Array.isArray(path?.coordinates)) return window.TRBRouteEngine.lineDistanceMeters(path.coordinates);
  const points = latLngPointsFromOfficialPath(path);
  return points.slice(1).reduce((sum, point, index) => sum + haversine(points[index][0], points[index][1], point[0], point[1]), 0);
}

function officialPathLabel(path, index) {
  return path?.direction || path?.name || `Tramo ${index + 1}`;
}

function buildOfficialGeometricStops(paths = [], maximumTotal = 96) {
  const drawable = officialDrawablePaths(paths);
  if (!drawable.length) return [];
  const maxPerPath = Math.max(8, Math.ceil(maximumTotal / drawable.length));
  const stops = [];
  drawable.forEach((path, pathIndex) => {
    const indexes = sampleCoordinateIndexes(path.coordinates.length, maxPerPath);
    const pathLabel = officialPathLabel(path, pathIndex);
    indexes.forEach((coordIndex, sampleIndex) => {
      const coord = path.coordinates[coordIndex];
      if (!coord) return;
      const [lng, lat] = coord.map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const isStart = sampleIndex === 0;
      const isEnd = sampleIndex === indexes.length - 1;
      const terminalName = isStart ? 'Inicio' : isEnd ? 'Final' : `Punto ${sampleIndex + 1}`;
      stops.push({
        id: `kmz-${pathIndex}-${sampleIndex}`,
        name: drawable.length > 1 ? `${pathLabel} · ${terminalName}` : terminalName === 'Punto ' + (sampleIndex + 1) ? `Punto ${sampleIndex + 1} del recorrido` : `${terminalName} del recorrido`,
        latitude: lat,
        longitude: lng,
        pathIndex,
        sampleIndex,
        isPathStart: isStart,
        isPathEnd: isEnd,
        isRouteStart: pathIndex === 0 && isStart,
        isRouteEnd: pathIndex === drawable.length - 1 && isEnd
      });
    });
  });
  return stops;
}

function buildOfficialMovementPath(paths = [], maximumPerPath = 420) {
  const movement = [];
  officialDrawablePaths(paths).forEach(path => {
    const indexes = sampleCoordinateIndexes(path.coordinates.length, maximumPerPath);
    indexes.forEach(coordIndex => {
      const coord = path.coordinates[coordIndex];
      if (!coord) return;
      const [lng, lat] = coord.map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const previous = movement[movement.length - 1];
      if (previous && haversine(previous.latitude, previous.longitude, lat, lng) < 1) return;
      movement.push({ latitude: lat, longitude: lng });
    });
  });
  return movement;
}


function routeLayerLatLngPointsFromLeg(leg = {}) {
  if (Array.isArray(leg.geometry) && leg.geometry.length > 1) {
    return leg.geometry
      .map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point.lat), Number(point.lng)])
      .filter(point => point.every(Number.isFinite));
  }
  const lngLatPath = Array.isArray(leg.ridePath) && leg.ridePath.length > 1 ? leg.ridePath : Array.isArray(leg.path) && leg.path.length > 1 ? leg.path : [];
  if (lngLatPath.length > 1) {
    return lngLatPath
      .map(point => Array.isArray(point) ? [Number(point[1]), Number(point[0])] : [Number(point.lat), Number(point.lng)])
      .filter(point => point.every(Number.isFinite));
  }
  const fallback = fallbackBusLegGeometry(leg);
  if (fallback.length > 1) return fallback;
  const start = leg.from && Number.isFinite(Number(leg.from.lat)) && Number.isFinite(Number(leg.from.lng)) ? [Number(leg.from.lat), Number(leg.from.lng)] : null;
  const end = leg.to && Number.isFinite(Number(leg.to.lat)) && Number.isFinite(Number(leg.to.lng)) ? [Number(leg.to.lat), Number(leg.to.lng)] : null;
  return start && end ? [start, end] : [];
}

function rideStopObjectsFromLatLngPath(path, prefix = 'ride') {
  const coords = Array.isArray(path) && path.length > 1 ? sampleCoordinates(path, 24) : [];
  return coords.map(([lat, lng], index, all) => ({
    id: `${prefix}-${index}`,
    name: index === 0 ? 'Inicio del tramo mostrado' : index === all.length - 1 ? 'Fin del tramo mostrado' : `Punto ${index + 1}`,
    latitude: lat,
    longitude: lng
  }));
}

async function drawTransitLegDetails(route, leg, reference = {}, system = plannerRouteSystem(route)) {
  const requestId = ++state.lineDrawRequestId;
  state.mapDrawRequestId += 1;
  setRouteFocusMode(true, 'line');
  setMapJourneyOverlay('');
  showView('map');
  initializeMap();
  if (!state.map) return;
  stopDemoBusAnimation();
  clearMapLibreRoute();
  if (state.routeLayer) { state.map.removeLayer(state.routeLayer); state.routeLayer = null; }
  if (state.busLayer) { state.map.removeLayer(state.busLayer); state.busLayer = null; }
  if (state.allStopsLayer && state.map.hasLayer(state.allStopsLayer)) state.map.removeLayer(state.allStopsLayer);
  if (state.liveVehicleLayer && state.map.hasLayer(state.liveVehicleLayer)) state.map.removeLayer(state.liveVehicleLayer);

  try { await ensureBusLegGeometry(leg); } catch {}
  if (requestId !== state.lineDrawRequestId) return;
  const points = routeLayerLatLngPointsFromLeg(leg);
  const color = routeColor(leg.route || route);
  const code = leg.route?.shortName || route.shortName || route.code || reference.code || 'Ruta';
  const operator = leg.route?.operator || route.operator || (system === 'transmetro' ? 'Transmetro' : 'Bus urbano');
  $('#mapInfoDefault')?.classList.add('hidden');
  $('#mapInfoContent')?.classList.remove('hidden');
  if ($('#mapInfoContent')) $('#mapInfoContent').innerHTML = `${lineInfoBackHeaderHTML(code)}<div class="map-route-summary"><span class="route-code" style="--route-color:${color};--route-text-color:${readableRouteTextColor(color)}">${escapeHTML(code)}</span><div><span class="eyebrow">${escapeHTML(operator)}</span><h2>Tramo usado en esta alternativa</h2><p>Solo se muestra el pedazo de ruta que tomas en este viaje, no la línea completa.</p></div></div><div class="route-loading"><span></span><p>Dibujando solo el tramo seleccionado…</p></div>`;

  if (points.length < 2) {
    if ($('#mapInfoContent')) $('#mapInfoContent').innerHTML = `${lineInfoBackHeaderHTML(code)}<div class="notice notice--warning"><div class="notice__icon">!</div><div><strong>No se pudo aislar el tramo</strong><p>TRB no encontró geometría suficiente para este tramo. Vuelve a la alternativa e intenta otra ruta.</p></div></div>`;
    return;
  }
  const group = L.layerGroup();
  drawTransitPath(group, points, color, { weight: 9, opacity: 1, className: 'trb-transit-line trb-selected-leg-line' })
    ?.bindPopup(`<strong>${escapeHTML(code)}</strong><br>${escapeHTML(operator)} · tramo seleccionado`);
  addDirectionArrows(group, points, color);
  const boardPoint = leg.from && Number.isFinite(Number(leg.from.lat)) ? [Number(leg.from.lat), Number(leg.from.lng)] : points[0];
  const alightPoint = leg.to && Number.isFinite(Number(leg.to.lat)) ? [Number(leg.to.lat), Number(leg.to.lng)] : points[points.length - 1];
  L.marker(boardPoint, { pane: 'routeStops', icon: routeTerminalIcon('↑', color), zIndexOffset: 780 })
    .bindPopup(`<strong>Sube a ${escapeHTML(code)}</strong><br>${escapeHTML(leg.from?.stop?.name || leg.from?.label || 'Punto del recorrido')}`).addTo(group);
  L.marker(alightPoint, { pane: 'routeStops', icon: routeTerminalIcon('↓', color), zIndexOffset: 780 })
    .bindPopup(`<strong>Bájate de ${escapeHTML(code)}</strong><br>${escapeHTML(leg.to?.stop?.name || leg.to?.label || 'Punto del recorrido')}`).addTo(group);
  const mid = points[Math.floor(points.length / 2)];
  if (mid) L.marker(mid, { pane: 'routeStops', icon: routeLabelIcon(code, color), interactive: false, zIndexOffset: 760 }).addTo(group);
  group.addTo(state.map);
  state.routeLayer = group;
  state.busLayer = L.layerGroup([], { pane: 'routeVehicles' }).addTo(state.map);
  state.currentMapRoute = { ...(leg.route || route), id: leg.route?.id || route.id || code, shortName: code, longName: leg.route?.longName || route.name || '', colorHex: color.replace('#', ''), operator };
  state.currentRouteStops = rideStopObjectsFromLatLngPath(points, `leg-${code}`);
  state.currentRoutePath = points.map(([latitude, longitude]) => ({ latitude, longitude }));
  state.demoBuses = createDemoBuses(state.currentMapRoute, state.currentRouteStops).slice(0, 3);
  updateDemoBuses(false);
  state.busTimer = window.setInterval(() => updateDemoBuses(true), 1500);
  const rideDistance = points.slice(1).reduce((sum, point, index) => sum + haversine(points[index][0], points[index][1], point[0], point[1]), 0);
  if ($('#mapInfoContent')) $('#mapInfoContent').innerHTML = `${lineInfoBackHeaderHTML(code)}<div class="map-route-summary"><span class="route-code" style="--route-color:${color};--route-text-color:${readableRouteTextColor(color)}">${escapeHTML(code)}</span><div><span class="eyebrow">${escapeHTML(operator)}</span><h2>Tramo usado en esta alternativa</h2><p>Se limpió cualquier ruta anterior: ahora solo ves este bus y el bus de demostración corre solo sobre este tramo.</p></div></div><div class="hsl-route-timeline"><span class="hsl-route-terminal" style="--timeline-color:${color}">↑</span><div><b>Subir</b><small>${escapeHTML(leg.from?.stop?.name || leg.from?.label || 'Punto del recorrido')}</small></div><span class="hsl-route-line" style="--timeline-color:${color}"></span><span class="hsl-route-terminal" style="--timeline-color:${color}">↓</span><div><b>Bajar</b><small>${escapeHTML(leg.to?.stop?.name || leg.to?.label || 'Punto del recorrido')}</small></div></div><div class="status-table route-metrics-table"><div><span>Tramo mostrado</span><b>${formatRouteDistance(rideDistance)} · ≈ ${Math.max(1, Math.ceil((leg.duration || rideDistance / BUS_SPEED_MPS) / 60))} min</b></div></div><section class="operations-section"><div class="operations-heading"><div><span class="eyebrow">Vehículos incluidos</span><h3>Buses solo sobre el tramo</h3></div><span class="simulation-badge">Simulación</span></div><div id="demoBusList" class="demo-bus-list"></div></section>`;
  renderBusList();
  setMapJourneyOverlay(`<div class="map-overlay__header"><span class="map-overlay__route" style="--overlay-color:${color}">${escapeHTML(code)}</span><button class="map-overlay__close" type="button" data-map-overlay-close aria-label="Cerrar resumen">×</button></div><strong>Solo tramo usado</strong><small>${escapeHTML(operator)} · ${formatRouteDistance(rideDistance)}</small><div class="map-overlay__legend"><i style="--overlay-color:${color}"></i> La ruta anterior fue limpiada</div>`);
  fitMapToSelectedJourney(points.concat([boardPoint, alightPoint]), { rideMeters: rideDistance });
}

async function drawOfficialRoute(route) {
  const officialRequestId = ++state.lineDrawRequestId;
  state.transmetroDrawRequestId += 1;
  state.currentRoutePath = [];
  syncMapRouteExplorer(`official::${route.id}`, route.operator);
  initializeMap();
  if (!state.map) return;
  stopDemoBusAnimation();
  clearMapLibreRoute();
  if (state.routeLayer) { state.map.removeLayer(state.routeLayer); state.routeLayer = null; }
  if (state.busLayer) { state.map.removeLayer(state.busLayer); state.busLayer = null; }
  if (state.allStopsLayer && state.map.hasLayer(state.allStopsLayer)) state.map.removeLayer(state.allStopsLayer);
  $('#mapInfoDefault').classList.add('hidden');
  $('#mapInfoContent').classList.remove('hidden');
  setMapJourneyOverlay(`<div class="map-overlay__loading"><span></span><b>Cargando ${escapeHTML(route.code)}</b><small>Preparando la geometría del recorrido…</small></div>`);
  $('#mapInfoContent').innerHTML = `${lineInfoBackHeaderHTML(route.code)}<div class="map-route-summary"><span class="route-code" style="${routeColorStyle(route)}">${escapeHTML(route.code)}</span><div><span class="eyebrow">${escapeHTML(route.operator)}</span><h2>${escapeHTML(route.name)}</h2><p>Cargando el recorrido para dibujarlo en el mapa…</p></div></div><div class="route-loading"><span></span><p>TRB usa geometría JSON del servidor local y conserva JSZip como respaldo.</p></div>`;
  try {
    const catalogRoute = state.routeCatalog?.rutas?.find(item => item.id === route.catalogId || (item.empresa === route.operator && item.ruta === route.code));
    if (!catalogRoute) throw new Error('La ruta no aparece en data/trb_catalogo_rutas.json');
    if (!window.TRBRouteEngine) throw new Error('No se cargó trb_motor_rutas.js');
    const loaded = await loadOfficialGeometry(route, catalogRoute);
    if (officialRequestId !== state.lineDrawRequestId) return;
    const color = routeColor(route);
    const group = L.layerGroup();
    const allBounds = [];
    const orderedPaths = officialDrawablePaths(loaded.paths);
    const sortedPaths = orderedPaths.slice().sort((a, b) => (officialPathDistanceMeters(b) || b.coordinates.length) - (officialPathDistanceMeters(a) || a.coordinates.length));
    if (!orderedPaths.length) throw new Error('El KMZ no contiene puntos dibujables');
    const officialGeoJSON = loaded.geojson || pathsToFeatureCollection(orderedPaths, { routeId: route.id, code: route.code, operator: route.operator });
    drawMapLibreRoute(officialGeoJSON, color);

    // TRB v45: siempre se dibuja una capa Leaflet visible encima del mapa.
    // Algunas rutas oficiales, como COOLITORAL A4-4109, vienen en varios LineString dentro del KMZ;
    // si se confiaba solo en MapLibre, una parte podía quedar sin puntos, flechas o buses de referencia.
    orderedPaths.forEach((path, index) => {
      const points = latLngPointsFromOfficialPath(path);
      if (points.length < 2) return;
      const line = drawTransitPath(group, points, color, { weight: index === 0 ? 8 : 7, opacity: 1, className: 'trb-transit-line trb-official-visible-line' });
      line?.bindPopup(`<strong>${escapeHTML(route.code)}</strong><br>${escapeHTML(route.operator)} · ${escapeHTML(officialPathLabel(path, index))}<br>${formatRouteDistance(officialPathDistanceMeters(path))}`);
      addDirectionArrows(group, points, color);
      const mid = points[Math.floor(points.length / 2)];
      if (mid) L.marker(mid, { pane: 'routeStops', icon: routeLabelIcon(route.code, color), interactive: false, zIndexOffset: 640 }).addTo(group);
      allBounds.push(...points);
    });
    if (!allBounds.length) throw new Error('El KMZ no contiene puntos dibujables');

    const primary = sortedPaths[0] || orderedPaths[0];
    const totalDistanceMeters = orderedPaths.reduce((sum, path) => sum + officialPathDistanceMeters(path), 0);
    const geometricStops = buildOfficialGeometricStops(orderedPaths, 120);
    const dotEvery = Math.max(1, Math.ceil(geometricStops.length / 42));
    geometricStops.forEach((point, index) => {
      const isTerminal = point.isRouteStart || point.isRouteEnd;
      if (!isTerminal && index % dotEvery !== 0 && !point.isPathStart && !point.isPathEnd) return;
      if (isTerminal) {
        const label = point.isRouteStart ? 'A' : 'B';
        L.marker([point.latitude, point.longitude], { pane: 'routeStops', icon: routeTerminalIcon(label, color), zIndexOffset: 700 })
          .bindPopup(`<strong>${escapeHTML(point.name)}</strong><br>${escapeHTML(route.code)}`).addTo(group);
      } else {
        L.circleMarker([point.latitude, point.longitude], { pane: 'routeStops', radius: point.isPathStart || point.isPathEnd ? 5.2 : 4.2, color, weight: 2.5, fillColor: '#fff', fillOpacity: 1 })
          .bindPopup(`<strong>${escapeHTML(point.name)}</strong><br><small>Punto geométrico, no paradero oficial</small>`).addTo(group);
      }
    });

    group.addTo(state.map);
    state.routeLayer = group;
    state.busLayer = L.layerGroup([], { pane: 'routeVehicles' }).addTo(state.map);
    state.currentMapRoute = { id: route.id, shortName: route.code, longName: route.name, colorHex: color.replace('#', ''), operator: route.operator };
    state.currentRouteStops = geometricStops;
    state.currentRoutePath = buildOfficialMovementPath(orderedPaths);
    state.demoBuses = createDemoBuses(state.currentMapRoute, geometricStops);
    updateDemoBuses(false);
    state.busTimer = window.setInterval(() => updateDemoBuses(true), 1500);

    fitMapToSelectedJourney(allBounds, { rideMeters: totalDistanceMeters || officialPathDistanceMeters(primary) || 0 });
    const metricRows = loaded.metrics.directions.map((item, index) => `<div><span>${escapeHTML(item.direction || item.name || `Tramo ${index + 1}`)}</span><b>${formatDistance(item.distanceMeters)} · ≈ ${item.durationMinutes} min</b></div>`).join('');
    $('#mapInfoContent').innerHTML = `${lineInfoBackHeaderHTML(route.code)}<div class="map-route-summary"><span class="route-code" style="${routeColorStyle(route)}">${escapeHTML(route.code)}</span><div><span class="eyebrow">${escapeHTML(route.operator)}</span><h2>${escapeHTML(route.name)}</h2><p>Recorrido completo dibujado desde todos los segmentos del KMZ, con puntos, sentido y buses de prueba.</p></div></div>
      <div class="hsl-route-timeline"><span class="hsl-route-terminal" style="--timeline-color:${color}">A</span><div><b>Inicio del recorrido completo</b><small>${formatRouteDistance(totalDistanceMeters || officialPathDistanceMeters(primary))} · ${orderedPaths.length} tramo${orderedPaths.length === 1 ? '' : 's'} del KMZ</small></div><span class="hsl-route-line" style="--timeline-color:${color}"></span><span class="hsl-route-terminal" style="--timeline-color:${color}">B</span><div><b>Final del recorrido completo</b><small>${geometricStops.length} puntos geométricos disponibles</small></div></div>
      <div class="data-caution"><span>i</span><p>La línea sólida muestra todos los tramos disponibles en el KMZ oficial. Los puntos intermedios son referencias geométricas; los buses son simulados y no corresponden a GPS real.</p></div>
      <div class="status-table route-metrics-table">${metricRows}</div>
      <section class="operations-section"><div class="operations-heading"><div><span class="eyebrow">Vehículos incluidos</span><h3>Buses sobre la ruta completa</h3></div><span class="simulation-badge">Simulación</span></div><div id="demoBusList" class="demo-bus-list"></div></section>
      <section class="operations-section"><div class="operations-heading"><div><span class="eyebrow">Secuencia geométrica</span><h3>${geometricStops.length} puntos</h3></div></div><ol class="map-stop-sequence" style="--sequence-color:${color}">${geometricStops.slice(0, 65).map((point,index)=>`<li><button type="button" data-map-stop-index="${index}"><span>${index+1}</span><b>${escapeHTML(point.name)}</b></button></li>`).join('')}${geometricStops.length > 65 ? `<li class="sequence-more">+ ${geometricStops.length - 65} puntos adicionales visibles en el mapa</li>` : ''}</ol></section>
      <p class="muted-copy">Fuente utilizada: ${escapeHTML(loaded.source)}</p>`;
    renderBusList();
    setMapJourneyOverlay(routeMapOverlayHTML(route, color, loaded.metrics, loaded.source, geometricStops.length));
    const label = $('.map-demo-label');
    if (label) label.innerHTML = '<span></span> Recorrido KMZ visible · Buses simulados';
  } catch (error) {
    console.error('TRB: error al abrir geometría de ruta', route, error);
    setMapJourneyOverlay('');
    $('#mapInfoContent').innerHTML = `${lineInfoBackHeaderHTML(route.code)}<div class="map-route-summary"><span class="route-code" style="${routeColorStyle(route)}">${escapeHTML(route.code)}</span><div><span class="eyebrow">${escapeHTML(route.operator)}</span><h2>${escapeHTML(route.name)}</h2><p>No se pudo dibujar el recorrido.</p></div></div><div class="notice notice--warning"><div class="notice__icon">!</div><div><strong>No se obtuvo la geometría</strong><p>${escapeHTML(error.message || String(error))}</p></div></div><p class="muted-copy">Inicia TRB con <code>INICIAR_TRB.bat</code>. La nueva versión usa <code>/api/route-geometry</code>, que descarga, valida y convierte el KMZ antes de enviarlo al mapa.</p><a class="button button--primary official-map-link" href="${escapeHTML(route.kmzUrl)}" target="_blank" rel="noopener noreferrer">Abrir archivo oficial ↗</a>`;
  }
}

async function buildPreciseTransmetroGeometry(route, stops) {
  const cacheKey = String(route.id);
  const cached = state.transmetroGeometryCache.get(cacheKey);
  if (cached?.geometry?.length > 1) return cached;
  const points = stops
    .map(stop => ({ lat: Number(stop.latitude), lng: Number(stop.longitude) }))
    .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .filter((point, index, all) => index === 0 || haversine(point.lat, point.lng, all[index - 1].lat, all[index - 1].lng) > 3);
  if (points.length < 2) throw new Error('La ruta no tiene suficientes paraderos para ajustar el recorrido.');
  const geometry = [];
  let distance = 0;
  let duration = 0;
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(points.length, start + 24);
    const chunk = points.slice(start, end);
    const routed = await networkRoute('car', chunk);
    const chunkGeometry = Array.isArray(routed.geometry) ? routed.geometry : [];
    chunkGeometry.forEach((point, index) => {
      const previous = geometry[geometry.length - 1];
      if (index === 0 && previous && haversine(previous[0], previous[1], point[0], point[1]) < 2) return;
      geometry.push(point);
    });
    distance += Number(routed.distance) || 0;
    duration += Number(routed.duration) || 0;
    start = end - 1;
  }
  if (geometry.length < 2) throw new Error('El enrutador no devolvió una geometría válida.');
  const result = { geometry, distance, duration, precise: true };
  state.transmetroGeometryCache.set(cacheKey, result);
  return result;
}

async function drawRoute(route) {
  const routeLineRequestId = ++state.lineDrawRequestId;
  syncMapRouteExplorer(`transmetro::${route.id}`);
  initializeMap();
  if (!state.map) return;
  const requestId = ++state.transmetroDrawRequestId;
  const demoLabel = $('.map-demo-label');
  if (demoLabel) demoLabel.innerHTML = '<span></span> Ajustando Transmetro a la red vial…';
  stopDemoBusAnimation();
  clearMapLibreRoute();
  if (state.routeLayer) { state.map.removeLayer(state.routeLayer); state.routeLayer = null; }
  if (state.busLayer) { state.map.removeLayer(state.busLayer); state.busLayer = null; }
  if (state.allStopsLayer && state.map.hasLayer(state.allStopsLayer)) state.map.removeLayer(state.allStopsLayer);
  if (state.liveVehicleLayer && state.map.hasLayer(state.liveVehicleLayer)) state.map.removeLayer(state.liveVehicleLayer);

  const color = routeColor(route);
  const stops = route.stopIds.map(id => state.stopsById.get(String(id))).filter(stop => stop && Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude));
  const fallbackPoints = stops.map(stop => [stop.latitude, stop.longitude]);
  $('#mapInfoDefault')?.classList.add('hidden');
  $('#mapInfoContent')?.classList.remove('hidden');
  if ($('#mapInfoContent')) $('#mapInfoContent').innerHTML = `${lineInfoBackHeaderHTML(route.shortName)}<div class="map-route-summary"><span class="route-code" style="--route-color:${color};--route-text-color:${routeTextColor(route)}">${escapeHTML(route.shortName)}</span><div><span class="eyebrow">Transmetro</span><h2>${escapeHTML(route.longName)}</h2><p>Ajustando el recorrido para que siga las calles…</p></div></div><div class="route-loading"><span></span><p>Procesando la secuencia de paraderos sobre la red vial.</p></div>`;
  setMapJourneyOverlay(`<div class="map-overlay__loading"><span></span><b>Preparando ${escapeHTML(route.shortName)}</b><small>Ajustando el recorrido a las calles…</small></div>`);

  // Vista previa inmediata: la ruta nunca desaparece mientras responde el enrutador vial.
  if (fallbackPoints.length > 1) {
    const previewGroup = L.layerGroup();
    drawTransitPath(previewGroup, fallbackPoints, color, { weight: 7, opacity: .78, dashArray: '9 7', className: 'trb-transit-line trb-transmetro-preview' });
    previewGroup.addTo(state.map);
    state.routeLayer = previewGroup;
    fitMapToSelectedJourney(fallbackPoints, { rideMeters: fallbackPoints.slice(1).reduce((sum, point, index) => sum + haversine(fallbackPoints[index][0], fallbackPoints[index][1], point[0], point[1]), 0) });
  }

  let routeMetrics = { geometry: fallbackPoints, distance: 0, duration: 0, precise: false };
  try {
    routeMetrics = await buildPreciseTransmetroGeometry(route, stops);
  } catch (error) {
    console.warn('TRB: no se pudo ajustar Transmetro a la red vial', route.shortName, error);
  }
  if (requestId !== state.transmetroDrawRequestId || routeLineRequestId !== state.lineDrawRequestId) return;

  const points = routeMetrics.geometry?.length > 1 ? routeMetrics.geometry : fallbackPoints;
  if (state.routeLayer && state.map.hasLayer(state.routeLayer)) state.map.removeLayer(state.routeLayer);
  state.routeLayer = null;
  const group = L.layerGroup();
  if (points.length > 1) {
    const geojson = pathsToFeatureCollection([{ name: route.longName, direction: 'recorrido', coordinates: points.map(([lat, lng]) => [lng, lat]) }], { routeId: route.id, code: route.shortName, precise: routeMetrics.precise });
    const mapLibreDrewRoute = drawMapLibreRoute(geojson, color);
    if (!mapLibreDrewRoute) drawTransitPath(group, points, color, { weight: 8, opacity: 1 })?.bindPopup(`<strong>${escapeHTML(route.shortName)}</strong><br>${escapeHTML(route.longName)}`);
    addDirectionArrows(group, points, color);
  }
  stops.forEach((stop, index) => {
    const terminal = index === 0 || index === stops.length - 1;
    if (terminal) {
      L.marker([stop.latitude, stop.longitude], { pane: 'routeStops', icon: routeTerminalIcon(index === 0 ? 'A' : 'B', color), zIndexOffset: 700 })
        .bindPopup(`<strong>${escapeHTML(stop.name)}</strong><br><small>${escapeHTML(route.shortName)} · ${index === 0 ? 'Inicio' : 'Final'}</small>`).addTo(group);
    } else {
      L.circleMarker([stop.latitude, stop.longitude], { pane: 'routeStops', radius: 4.5, color, weight: 2.5, fillColor: '#fff', fillOpacity: 1 })
        .bindPopup(`<strong>${index + 1}. ${escapeHTML(stop.name)}</strong><br><small>${escapeHTML(route.shortName)} · ${escapeHTML(route.longName)}</small>`).addTo(group);
    }
  });
  group.addTo(state.map);
  state.routeLayer = group;
  state.busLayer = L.layerGroup().addTo(state.map);
  state.currentMapRoute = route;
  state.currentRouteStops = stops;
  state.currentRoutePath = points.map(([latitude, longitude]) => ({ latitude, longitude }));
  state.demoBuses = createDemoBuses(route, stops);

  const routedDistance = Number(routeMetrics.distance) || points.slice(1).reduce((sum, point, index) => sum + haversine(points[index][0], points[index][1], point[0], point[1]), 0);
  const routedDuration = Number(routeMetrics.duration) || routedDistance / 9.3;
  renderMapRoutePanel(route, stops, color, { distance: routedDistance, duration: routedDuration, precise: routeMetrics.precise });
  updateDemoBuses(false);
  state.busTimer = window.setInterval(() => updateDemoBuses(true), 1800);
  setMapJourneyOverlay(`<div class="map-overlay__header"><span class="map-overlay__route" style="--overlay-color:${color}">${escapeHTML(route.shortName)}</span><button class="map-overlay__close" type="button" data-map-overlay-close aria-label="Cerrar resumen">×</button></div><strong>${escapeHTML(route.longName)}</strong><small>${routeMetrics.precise ? 'Recorrido ajustado a la red vial' : 'Recorrido de referencia'}</small><div class="map-overlay__metrics"><span><b>${formatRouteDistance(routedDistance)}</b> recorrido</span><span><b>≈ ${Math.max(1, Math.ceil(routedDuration / 60))} min</b> estimado</span><span><b>${stops.length}</b> paraderos</span></div><div class="map-overlay__legend"><i style="--overlay-color:${color}"></i> Solo esta ruta está visible</div>`);
  if (demoLabel) demoLabel.innerHTML = `<span></span> ${routeMetrics.precise ? 'Recorrido ajustado a las calles' : 'Recorrido de referencia'} · Solo una ruta`;
  if (points.length) fitMapToSelectedJourney(points, { rideMeters: routedDistance });
}

function stopDemoBusAnimation() {
  if (state.busTimer) window.clearInterval(state.busTimer);
  state.busTimer = null;
  state.demoBuses = [];
}

function clearMap() {
  state.lineDrawRequestId += 1;
  if (state.networkExplorerMode) closeNetworkExplorer({ preserveMap: true });
  exitRouteFocusMode();
  if (!state.map) return;
  stopDemoBusAnimation();
  clearMapLibreRoute();
  if (state.routeLayer) { state.map.removeLayer(state.routeLayer); state.routeLayer = null; }
  if (state.busLayer) { state.map.removeLayer(state.busLayer); state.busLayer = null; }
  if (state.userLayer) { state.map.removeLayer(state.userLayer); state.userLayer = null; }
  if (state.mapPickerOriginLayer) { state.map.removeLayer(state.mapPickerOriginLayer); state.mapPickerOriginLayer = null; }
  if (state.mapPickerDestinationLayer) { state.map.removeLayer(state.mapPickerDestinationLayer); state.mapPickerDestinationLayer = null; }
  setMapPickMode(null);
  if (state.allStopsLayer && state.map.hasLayer(state.allStopsLayer)) state.map.removeLayer(state.allStopsLayer);
  state.currentMapRoute = null;
  state.currentRouteStops = [];
  state.currentRoutePath = [];
  setMapJourneyOverlay('');
  const demoLabel = $('.map-demo-label');
  if (demoLabel) demoLabel.innerHTML = '<span></span> Buses simulados · Sin GPS oficial';
  $('#mapRouteSelect').value = '';
  state.routeExplorerSelectedValue = '';
  if ($('#mapRouteQuickSelect')) $('#mapRouteQuickSelect').value = '';
  renderMapRouteExplorer({ preserveRoute: false });
  const explorerStatus = $('#mapRouteSelectionStatus');
  if (explorerStatus) explorerStatus.textContent = 'Mapa limpio. Selecciona otra ruta para mostrarla.';
  $('#mapInfoDefault').classList.remove('hidden');
  $('#mapInfoContent').classList.add('hidden');
  state.map.setView([10.9878, -74.7889], 12);
}

function locateUser() {
  if (!navigator.geolocation) return toast('Tu navegador no permite usar ubicación');
  const locateButton = $('#locateButton');
  if (locateButton) locateButton.textContent = 'Buscando…';
  navigator.geolocation.getCurrentPosition(position => {
    if (locateButton) locateButton.textContent = '⌖ Mi ubicación';
    initializeMap();
    const { latitude, longitude } = position.coords;
    state.plannerCurrentPosition = { lat: latitude, lng: longitude, accuracy: position.coords.accuracy };
    if (state.userLayer) state.map.removeLayer(state.userLayer);
    state.userLayer = L.layerGroup([
      L.circle([latitude, longitude], { radius: position.coords.accuracy || 30, color: '#1463e6', fillOpacity: .08 }),
      L.circleMarker([latitude, longitude], { radius: 8, color: '#fff', weight: 3, fillColor: '#1463e6', fillOpacity: 1 }).bindPopup('<strong>Tu ubicación</strong>')
    ]).addTo(state.map);
    state.map.setView([latitude, longitude], 15);
    const nearest = state.stops.map(stop => ({ stop, distance: haversine(latitude, longitude, stop.latitude, stop.longitude) })).sort((a,b) => a.distance - b.distance).slice(0, 8);
    $('#mapInfoDefault').classList.add('hidden');
    $('#mapInfoContent').classList.remove('hidden');
    $('#mapInfoContent').innerHTML = `<span class="eyebrow">Cerca de ti</span><h2>Paraderos próximos</h2><p>Distancia aproximada en línea recta.</p><ul class="nearby-list">${nearest.map(item => `<li><b>${escapeHTML(item.stop.name)}</b><span>${formatDistance(item.distance)}</span></li>`).join('')}</ul>`;
  }, error => {
    if (locateButton) locateButton.textContent = '⌖ Mi ubicación';
    const messages = { 1: 'Debes permitir el acceso a tu ubicación', 2: 'No se pudo determinar tu ubicación', 3: 'La solicitud de ubicación tardó demasiado' };
    toast(messages[error.code] || 'No se pudo acceder a la ubicación');
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function formatDistance(meters) { return meters < 1000 ? `${Math.round(meters)} m` : `${(meters/1000).toFixed(1)} km`; }

function renderSources() {
  $('#dataStatusTitle').textContent = state.data.dataStatus.title;
  $('#dataStatusDetail').textContent = state.data.dataStatus.detail;
  $('#statusRoutes').textContent = `${state.data.officialRouteCount || state.officialRoutes.length} SIBUS + ${state.routes.length} Transmetro`;
  $('#statusStops').textContent = `${state.stops.length} de referencia`;
  const downloadedKmz = Number(state.kmzStatus?.available || 0);
  $('#statusMotor').textContent = !state.routeEngineReady
    ? 'Revisar configuración'
    : state.kmzServerAvailable
      ? `${downloadedKmz}/93 KMZ en caché`
      : 'Abrir con INICIAR_TRB';
  $('#statusMotor').classList.toggle('warning-text', !state.routeEngineReady || !state.kmzServerAvailable);
  $('#sourcesList').innerHTML = state.data.sources.map(source => `<div class="source-row"><span>${escapeHTML(source.kind)}</span><a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.name)} ↗</a><p>${escapeHTML(source.note)}</p></div>`).join('');
}

function setupAssistant() {
  const suggestions = ['¿Cómo planifico un viaje?', '¿Qué rutas tiene SOBUSA?', '¿Cuál es la tarifa?', '¿Hay buses en tiempo real?'];
  $('#suggestionChips').innerHTML = suggestions.map(text => `<button class="suggestion-chip" type="button" data-assistant-suggestion="${escapeHTML(text)}">${escapeHTML(text)}</button>`).join('');
  addMessage('assistant', 'Hola. Soy el asistente local de TRB. Puedo ayudarte a buscar las 93 rutas, empresas, tarifas y explicar el planificador basado en KMZ.');
}

function addMessage(role, text) {
  const messages = $('#chatMessages');
  const div = document.createElement('div');
  div.className = `message message--${role}`;
  div.innerHTML = `<div class="message__bubble">${escapeHTML(text)}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function assistantReply(input) {
  const q = normalize(input);
  if (/hola|buenas|buenos dias|buenas tardes/.test(q)) return 'Hola. Puedes preguntarme por una ruta, un sector, una tarifa o los paraderos disponibles.';
  if (/tarifa|pasaje|precio|cuanto cuesta|valor/.test(q)) return 'Según la información publicada por el AMB para 2026, la tarifa ordinaria es de $3.700 y la de domingos y festivos es de $3.800.';
  if (/tiempo real|en vivo|donde va|donde esta|ubicacion del bus|gps/.test(q)) return 'TRB no tiene acceso a posiciones oficiales en tiempo real. En el mapa puedes ver buses claramente marcados como SIMULACIÓN para probar la interfaz; no representan vehículos reales. La arquitectura queda preparada para una API oficial o GTFS-Realtime.';
  if (/cuantas rutas|cantidad de rutas/.test(q)) return `TRB organiza ${state.officialRoutes.length} rutas SIBUS dentro de ${state.operators.length} empresas, además de ${state.routes.length} rutas históricas de Transmetro.`;
  if (/cerca|cercano|mi ubicacion|cerca de mi/.test(q)) return 'Abre la pestaña Mapa y pulsa “Mi ubicación”. El cálculo se realiza dentro del navegador y te mostrará los paraderos de referencia más cercanos.';
  if (/planificar|mejor ruta|como llego|direccion|cuanto caminar|caminata/.test(q)) return 'Abre Rutas y usa “Busca la mejor ruta”. TRB analiza los 93 KMZ, calcula el punto del corredor más cercano para tomar y dejar el bus, muestra la caminata antes y después, el tramo en bus, la tarifa y el tiempo total.';

  const operatorMatch = state.operators.find(operator => q.includes(normalize(operator.name)));
  if (operatorMatch && /ruta|rutas|tiene|empresa|operador/.test(q)) return `${operatorMatch.name} tiene ${operatorMatch.routes.length} rutas: ${operatorMatch.routes.map(route => route.code).join(', ')}.`;

  const officialMatches = state.officialRoutes.filter(route => q.includes(normalize(route.code)) || q.includes(normalize(route.operator)) || normalize(`${route.code} ${route.name} ${route.operator}`).includes(q)).slice(0,5);
  if (officialMatches.length === 1) { const route=officialMatches[0]; return `La ruta ${route.code} está dentro de ${route.operator}. En Rutas puedes abrir la empresa y en Mapa intentar cargar su trazado KMZ oficial.`; }
  if (officialMatches.length > 1) return `Encontré estas rutas SIBUS: ${officialMatches.map(r=>`${r.code} (${r.operator})`).join(', ')}.`;

  const matches = state.routes.filter(route => {
    const code = normalize(route.shortName);
    const name = normalize(route.longName);
    return q.includes(code) || q.includes(name) || code.includes(q) || name.includes(q);
  }).slice(0, 5);

  if (matches.length === 1) {
    const route = matches[0];
    const stopNames = route.stopIds.map(id => state.stopsById.get(String(id))?.name).filter(Boolean);
    const preview = stopNames.slice(0, 5).join(', ');
    return `La ruta ${route.shortName} corresponde a ${route.longName}. El catálogo contiene ${stopNames.length} paraderos de referencia${preview ? `, entre ellos: ${preview}` : ''}. Puedes abrirla en la sección Rutas para ver el detalle.`;
  }
  if (matches.length > 1) return `Encontré estas rutas relacionadas: ${matches.map(r => `${r.shortName} (${r.longName})`).join(', ')}. Escribe el código exacto para ver una sola.`;

  const wordMatches = state.routes.filter(route => {
    const words = q.split(/\s+/).filter(word => word.length >= 4 && !['ruta','para','hacia','quiero','buscar','cual'].includes(word));
    const haystack = normalize(`${route.shortName} ${route.longName}`);
    return words.some(word => haystack.includes(word));
  }).slice(0, 5);
  if (wordMatches.length) return `Estas rutas podrían servirte según el nombre del sector: ${wordMatches.map(r => `${r.shortName} (${r.longName})`).join(', ')}. Recuerda que son datos de referencia y no un planificador oficial.`;

  return 'No encontré una coincidencia clara. Prueba escribiendo un código como A7-1 o U30, un sector como Miramar o Centro, o pregunta por la tarifa.';
}

function handleAssistantSubmit(text) {
  const clean = text.trim();
  if (!clean) return;
  addMessage('user', clean);
  setTimeout(() => addMessage('assistant', assistantReply(clean)), 250);
}

function setupTheme() {
  const stored = storage.get('trb-theme');
  if (stored) document.documentElement.dataset.theme = stored;
  $('#themeButton').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.documentElement.dataset.theme = dark ? 'light' : 'dark';
    storage.set('trb-theme', dark ? 'light' : 'dark');
  });
}

function setupPWA() {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./service-worker.js?v=33').catch(error => console.warn('TRB: service worker', error));
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); state.deferredPrompt = event; $('#installButton').classList.remove('hidden');
  });
  $('#installButton').addEventListener('click', async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null; $('#installButton').classList.add('hidden');
  });
}

function setupConnectivity() {
  const refresh = () => $('#offlineBanner').classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', refresh); window.addEventListener('offline', refresh); refresh();
}

function toast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.add('hidden'), 2500);
}

function bindEvents() {
  document.addEventListener('click', event => {
    const retryMap = event.target.closest('[data-retry-map]');
    if (retryMap) {
      state.mapUnavailableRendered = false;
      const mapElement = $('#map');
      if (mapElement) mapElement.innerHTML = '<div id="mapBootPlaceholder" class="map-boot-placeholder"><span class="map-boot-spinner"></span><strong>Reintentando mapa…</strong><small>Recarga la página si el bloqueo continúa.</small></div>';
      initializeMap();
      return;
    }
    const networkOpen = event.target.closest('[data-open-network]');
    if (networkOpen) { openNetworkExplorer(networkOpen.dataset.openNetwork); return; }
    const networkRoute = event.target.closest('[data-network-route]');
    if (networkRoute) { openNetworkRoute(networkRoute.dataset.networkRoute); return; }
    const favoriteUse = event.target.closest('[data-use-favorite-place]');
    if (favoriteUse) { useFavoritePlace(favoriteUse.dataset.useFavoritePlace); return; }
    const favoriteEdit = event.target.closest('[data-edit-favorite-place]');
    if (favoriteEdit) { openFavoritePlaceEditor(favoriteEdit.dataset.editFavoritePlace); return; }
    const navTarget = event.target.closest('[data-view-target]')?.dataset.viewTarget;
    if (navTarget) {
      if (navTarget === 'routes') openNetworkExplorer('sibus');
      else showView(navTarget);
      return;
    }
    const goTarget = event.target.closest('[data-go]')?.dataset.go;
    if (goTarget) {
      if (goTarget === 'routes') openNetworkExplorer('sibus');
      else showView(goTarget);
      return;
    }

    const favorite = event.target.closest('[data-favorite-id]');
    if (favorite) { event.stopPropagation(); toggleFavorite(favorite.dataset.favoriteId); return; }

    const transitLine = event.target.closest('[data-transit-line-code]');
    if (transitLine) {
      event.preventDefault();
      event.stopPropagation();
      openTransitLineDetails({
        id: transitLine.dataset.transitLineId,
        code: transitLine.dataset.transitLineCode,
        operator: transitLine.dataset.transitLineOperator,
        system: transitLine.dataset.transitLineSystem,
        planIndex: transitLine.dataset.transitPlanIndex ?? transitLine.closest('[data-map-plan-index]')?.dataset.mapPlanIndex ?? state.mapSelectedPlanIndex,
        legIndex: transitLine.dataset.transitLegIndex
      });
      return;
    }

    const backFromLine = event.target.closest('[data-back-from-line]');
    if (backFromLine) { returnFromTransitLine(); return; }

    const officialRoute = event.target.closest('[data-official-route-id]');
    if (officialRoute) { openOfficialRoute(officialRoute.dataset.officialRouteId); return; }

    const routeCard = event.target.closest('[data-route-id]');
    if (routeCard) { openRoute(routeCard.dataset.routeId); return; }

    const officialMapButton = event.target.closest('[data-show-official-map]');
    if (officialMapButton) {
      const route = state.officialRoutes.find(item => item.id === officialMapButton.dataset.showOfficialMap);
      if (route) { closeDrawer(); showView('map'); setTimeout(() => { $('#mapRouteSelect').value = `official::${route.id}`; drawOfficialRoute(route); }, 100); }
      return;
    }

    const officialPoint = event.target.closest('[data-official-point-lat]');
    if (officialPoint && state.map) { state.map.setView([Number(officialPoint.dataset.officialPointLat), Number(officialPoint.dataset.officialPointLng)], Math.max(state.map.getZoom(), 16)); return; }

    const mapButton = event.target.closest('[data-show-route-map]');
    if (mapButton) { closeDrawer(); showRouteOnMap(mapButton.dataset.showRouteMap); return; }

    const demoBus = event.target.closest('[data-demo-bus-index]');
    if (demoBus) {
      const bus = state.demoBuses[Number(demoBus.dataset.demoBusIndex)];
      if (bus?.marker) { state.map.setView(bus.marker.getLatLng(), Math.max(state.map.getZoom(), 15)); bus.marker.openPopup(); }
      return;
    }

    const mapStop = event.target.closest('[data-map-stop-index]');
    if (mapStop) {
      const stop = state.currentRouteStops[Number(mapStop.dataset.mapStopIndex)];
      if (stop) state.map.setView([stop.latitude, stop.longitude], Math.max(state.map.getZoom(), 16));
      return;
    }

    const overlayClose = event.target.closest('[data-map-overlay-close]');
    if (overlayClose) { setMapJourneyOverlay(''); return; }

    const journeyMap = event.target.closest('[data-journey-map-index]');
    if (journeyMap) { drawJourneyPlan(journeyMap.dataset.journeyMapIndex); return; }

    const mapPlan = event.target.closest('[data-map-plan-index]');
    if (mapPlan) { drawJourneyPlan(mapPlan.dataset.mapPlanIndex); return; }

    const suggestion = event.target.closest('[data-assistant-suggestion]');
    if (suggestion) { handleAssistantSubmit(suggestion.dataset.assistantSuggestion); return; }
  });

  document.addEventListener('keydown', event => {
    const transitLine = event.target.closest?.('[data-transit-line-code]');
    if (transitLine && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openTransitLineDetails({ id: transitLine.dataset.transitLineId, code: transitLine.dataset.transitLineCode, operator: transitLine.dataset.transitLineOperator, system: transitLine.dataset.transitLineSystem, planIndex: transitLine.closest('[data-map-plan-index]')?.dataset.mapPlanIndex ?? state.mapSelectedPlanIndex });
      return;
    }
    const route = event.target.closest?.('[data-route-id]');
    if (route && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openRoute(route.dataset.routeId); }
    if (event.key === 'Escape') closeDrawer();
  });

  $('#homeJourneyForm')?.addEventListener('submit', event => { event.preventDefault(); handleHomeJourneySubmit(); });
  $('#homeJourneyLocate')?.addEventListener('click', useHomeJourneyLocation);
  $('#homeJourneySwap')?.addEventListener('click', swapHomeJourneyFields);
  document.addEventListener('click', event => {
    const clearButton = event.target.closest?.('[data-clear-input]');
    if (clearButton) { event.preventDefault(); clearPlannerInput(clearButton.dataset.clearInput); return; }
  });
  $('#networkBrowseBack')?.addEventListener('click', () => { closeNetworkExplorer(); showView('home'); });
  $('#networkRouteSearch')?.addEventListener('input', event => { state.networkRouteQuery = event.target.value; renderNetworkBrowseList(); });
  $$('[data-network-system]').forEach(button => button.addEventListener('click', () => setNetworkSystem(button.dataset.networkSystem)));
  $('#favoritePlaceClose')?.addEventListener('click', closeFavoritePlaceEditor);
  $('#favoritePlaceCancel')?.addEventListener('click', closeFavoritePlaceEditor);
  $('#favoritePlaceSave')?.addEventListener('click', saveFavoritePlace);
  $('#favoritePlaceModal')?.addEventListener('click', event => { if (event.target.id === 'favoritePlaceModal') closeFavoritePlaceEditor(); });
  $('#journeyForm').addEventListener('submit', event => { event.preventDefault(); handleJourneySubmit(); });
  $('#journeyLocateButton').addEventListener('click', usePlannerLocation);
  $('#journeySwapButton').addEventListener('click', swapJourneyFields);
  $('#mapJourneyForm').addEventListener('submit', event => { event.preventDefault(); handleMapJourneySubmit(); });
  $('#routeFocusExit').addEventListener('click', exitRouteFocusMode);
  $('#mapJourneyInstructions').addEventListener('click', event => {
    if (event.target.closest('[data-back-to-suggestions]')) { showRouteSuggestionsPanel(); return; }
    if (event.target.closest('[data-instruction-previous]')) { changeInstructionPlan(-1); return; }
    if (event.target.closest('[data-instruction-next]')) { changeInstructionPlan(1); return; }
    const dot = event.target.closest('[data-instruction-plan]');
    if (dot) drawJourneyPlan(Number(dot.dataset.instructionPlan), { showInstructions: true });
  });
  $('#routeSuggestionModes').addEventListener('click', event => { const button = event.target.closest('[data-plan-filter]'); if (!button || button.disabled) return; activatePlannerFilter(button.dataset.planFilter); });
  $('#mapSettingsButton')?.addEventListener('click', () => toggleMapSettingsPanel());
  $('#mapSettingsClose')?.addEventListener('click', () => toggleMapSettingsPanel(false));
  $('#mapSettingsPanel')?.addEventListener('click', event => { const button = event.target.closest('[data-transport-toggle]'); if (button) toggleTransportSetting(button.dataset.transportToggle); });
  renderPlannerTransportSettings();
  $('#mapJourneyUseLocation')?.addEventListener('click', useMapPlannerLocation);
  $('#mapLocateFloating')?.addEventListener('click', useMapPlannerLocation);
  $('#mapJourneySwap').addEventListener('click', swapMapJourneyFields);
  $('#mapJourneyPickOrigin').addEventListener('click', () => startMapPointPick('origin'));
  $('#mapJourneyPickDestination').addEventListener('click', () => startMapPointPick('destination'));
  $('#routeSearch').addEventListener('input', renderRoutes);
  $('#routeTypeFilter').addEventListener('change', renderRoutes);
  $$('[data-map-system]').forEach(button => button.addEventListener('click', () => setMapRouteExplorerSystem(button.dataset.mapSystem)));
  $('#mapOperatorSelect').addEventListener('change', () => {
    state.routeExplorerSelectedValue = '';
    renderMapRouteExplorer({ preserveRoute: false });
  });
  $('#mapRouteQuickSearch').addEventListener('input', event => {
    state.routeExplorerQuery = event.target.value;
    renderMapRouteExplorer({ preserveRoute: false });
  });
  $('#mapRouteQuickSelect').addEventListener('change', event => activateExplorerRoute(event.target.value));
  $('#mapRouteQuickList').addEventListener('click', event => {
    const button = event.target.closest('[data-explorer-route]');
    if (button) activateExplorerRoute(button.dataset.explorerRoute);
  });
  $('#openRoutesCatalogButton').addEventListener('click', () => {
    openNetworkExplorer(state.routeExplorerSystem === 'transmetro' ? 'transmetro' : 'sibus');
    setTimeout(() => $('#networkRouteSearch')?.focus(), 120);
  });
  $('#mapRouteSelect').addEventListener('change', event => {
    const value = event.target.value;
    if (value.startsWith('official::')) {
      const route = state.officialRoutes.find(r => r.id === value.slice('official::'.length));
      if (route) drawOfficialRoute(route);
    } else if (value.startsWith('transmetro::')) {
      const route = state.routes.find(r => String(r.id) === value.slice('transmetro::'.length));
      if (route) drawRoute(route);
    } else clearMap();
  });
  $('#locateButton')?.addEventListener('click', locateUser);
  $('#clearMapButton')?.addEventListener('click', clearMap);
  $('#closeDrawer').addEventListener('click', closeDrawer);
  $('#routeDrawerBackdrop').addEventListener('click', closeDrawer);
  $('#assistantForm').addEventListener('submit', event => {
    event.preventDefault();
    const input = $('#assistantInput'); handleAssistantSubmit(input.value); input.value = '';
  });
}

async function init() {
  try {
    await loadData();
    buildNavigation();
    renderFacts(); renderFeatured(); renderRoutes(); populateMapSelect(); initializeMapRouteExplorer(); renderSources(); setupAssistant();
    setupTheme(); setupPWA(); setupConnectivity(); bindEvents(); setupLocationAutocomplete(); updatePlaceSearchStatus(); renderSavedPlaces();
    const hash = location.hash.replace('#','');
    if (hash === 'routes') {
      openNetworkExplorer('sibus');
    } else {
      showView([...NAV_ITEMS.map(i => i.id), 'favorites'].includes(hash) ? hash : 'home');
    }
  } catch (error) {
    document.body.innerHTML = `<main style="max-width:760px;margin:80px auto;padding:24px;font-family:system-ui"><h1>No se pudo abrir TRB</h1><p>${escapeHTML(error.message)}</p><p>Abre el proyecto mediante un servidor local o súbelo a un hosting estático; no uses doble clic sobre <code>index.html</code>.</p></main>`;
  }
}

window.addEventListener('resize', () => state.map?.invalidateSize({ animate: false }));
window.addEventListener('orientationchange', () => setTimeout(() => state.map?.invalidateSize({ animate: false }), 250));
document.addEventListener('DOMContentLoaded', init);
