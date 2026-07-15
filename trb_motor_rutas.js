/*
 * TRB Route Engine
 * Motor local para leer los 93 KMZ del AMB, calcular puntos de abordaje y
 * descenso sobre la geometría, distancias, caminatas y tiempos aproximados.
 *
 * Requiere JSZip 3.x disponible como globalThis.JSZip.
 */
(function (global) {
  'use strict';

  const DEFAULT_CONFIG = Object.freeze({
    busMetersPerMinute: 250,      // 15 km/h promedio operacional aproximado
    walkMetersPerMinute: 80,      // 4,8 km/h
    walkDistanceFactor: 1.18,     // aproxima la red peatonal frente a línea recta
    maxWalkMeters: 2200,
    minRideMeters: 300,
    concurrency: 5,
    fetchTimeoutMs: 22000,
    localKmzBase: 'kmz/',
    allowRemoteFallback: true
  });

  const routeCache = new Map();

  function toLngLat(point) {
    if (Array.isArray(point) && point.length >= 2) {
      const lng = Number(point[0]);
      const lat = Number(point[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
    }
    if (point && Number.isFinite(Number(point.lng)) && Number.isFinite(Number(point.lat))) {
      return [Number(point.lng), Number(point.lat)];
    }
    if (point && Number.isFinite(Number(point.lon)) && Number.isFinite(Number(point.lat))) {
      return [Number(point.lon), Number(point.lat)];
    }
    throw new TypeError('Coordenada inválida. Usa [lng, lat] o {lat, lng}.');
  }

  function haversineMeters(a, b) {
    const [lng1, lat1] = toLngLat(a);
    const [lng2, lat2] = toLngLat(b);
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180;
    const p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function lineDistanceMeters(coords, startIndex = 0, endIndex = coords.length - 1) {
    if (!Array.isArray(coords) || coords.length < 2) return 0;
    let total = 0;
    const start = Math.max(0, Math.min(startIndex, coords.length - 1));
    const end = Math.max(start, Math.min(endIndex, coords.length - 1));
    for (let index = start; index < end; index += 1) total += haversineMeters(coords[index], coords[index + 1]);
    return total;
  }

  function parseCoordinateText(text) {
    return String(text || '')
      .trim()
      .split(/\s+/)
      .map(token => token.split(',').slice(0, 2).map(Number))
      .filter(pair => pair.length === 2 && pair.every(Number.isFinite));
  }

  function stripTags(text) {
    return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function inferDirection(text) {
    const value = String(text || '').toLowerCase();
    if (/\b(regreso|retorno|vuelta|sentido\s*2|return)\b/.test(value)) return 'regreso';
    if (/\b(ida|sentido\s*1|outbound)\b/.test(value)) return 'ida';
    return 'desconocido';
  }

  function parseKmlLinesWithDom(kmlText) {
    const doc = new global.DOMParser().parseFromString(kmlText, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('No se pudo interpretar el KML.');
    const placemarks = Array.from(doc.getElementsByTagNameNS('*', 'Placemark'));
    const lines = [];
    placemarks.forEach((placemark, placemarkIndex) => {
      const name = placemark.getElementsByTagNameNS('*', 'name')[0]?.textContent?.trim() || `trazado-${placemarkIndex + 1}`;
      const description = placemark.getElementsByTagNameNS('*', 'description')[0]?.textContent || '';
      const direction = inferDirection(`${name} ${description}`);
      Array.from(placemark.getElementsByTagNameNS('*', 'LineString')).forEach((lineString, lineIndex) => {
        const node = lineString.getElementsByTagNameNS('*', 'coordinates')[0];
        const coordinates = parseCoordinateText(node?.textContent);
        if (coordinates.length > 1) lines.push({ name, direction, coordinates, placemarkIndex, lineIndex });
      });
      Array.from(placemark.getElementsByTagNameNS('*', 'Track')).forEach((track, trackIndex) => {
        const coordinates = Array.from(track.getElementsByTagNameNS('*', 'coord'))
          .map(node => String(node.textContent || '').trim().split(/\s+/).slice(0, 2).map(Number))
          .filter(pair => pair.length === 2 && pair.every(Number.isFinite));
        if (coordinates.length > 1) lines.push({ name, direction, coordinates, placemarkIndex, lineIndex: `track-${trackIndex}` });
      });
    });
    if (!lines.length) {
      Array.from(doc.getElementsByTagNameNS('*', 'LineString')).forEach((lineString, index) => {
        const node = lineString.getElementsByTagNameNS('*', 'coordinates')[0];
        const coordinates = parseCoordinateText(node?.textContent);
        if (coordinates.length > 1) lines.push({ name: `trazado-${index + 1}`, direction: 'desconocido', coordinates });
      });
      Array.from(doc.getElementsByTagNameNS('*', 'Track')).forEach((track, index) => {
        const coordinates = Array.from(track.getElementsByTagNameNS('*', 'coord'))
          .map(node => String(node.textContent || '').trim().split(/\s+/).slice(0, 2).map(Number))
          .filter(pair => pair.length === 2 && pair.every(Number.isFinite));
        if (coordinates.length > 1) lines.push({ name: `track-${index + 1}`, direction: 'desconocido', coordinates });
      });
    }
    return lines;
  }

  function parseKmlLinesWithRegex(kmlText) {
    const text = String(kmlText || '');
    const lines = [];
    const placemarkRegex = /<(?:\w+:)?Placemark\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Placemark>/gi;
    let placemarkMatch;
    let placemarkIndex = 0;
    while ((placemarkMatch = placemarkRegex.exec(text))) {
      const block = placemarkMatch[1];
      const name = stripTags((block.match(/<(?:\w+:)?name\b[^>]*>([\s\S]*?)<\/(?:\w+:)?name>/i) || [])[1]) || `trazado-${placemarkIndex + 1}`;
      const description = stripTags((block.match(/<(?:\w+:)?description\b[^>]*>([\s\S]*?)<\/(?:\w+:)?description>/i) || [])[1]);
      const direction = inferDirection(`${name} ${description}`);
      const lineRegex = /<(?:\w+:)?LineString\b[^>]*>[\s\S]*?<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>[\s\S]*?<\/(?:\w+:)?LineString>/gi;
      let lineMatch;
      let lineIndex = 0;
      while ((lineMatch = lineRegex.exec(block))) {
        const coordinates = parseCoordinateText(lineMatch[1]);
        if (coordinates.length > 1) lines.push({ name, direction, coordinates, placemarkIndex, lineIndex });
        lineIndex += 1;
      }
      placemarkIndex += 1;
    }
    if (!lines.length) {
      const globalRegex = /<(?:\w+:)?LineString\b[^>]*>[\s\S]*?<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>[\s\S]*?<\/(?:\w+:)?LineString>/gi;
      let match;
      let index = 0;
      while ((match = globalRegex.exec(text))) {
        const coordinates = parseCoordinateText(match[1]);
        if (coordinates.length > 1) lines.push({ name: `trazado-${index + 1}`, direction: 'desconocido', coordinates });
        index += 1;
      }
    }
    if (!lines.length) {
      const trackRegex = /<(?:\w+:)?Track\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Track>/gi;
      let trackMatch;
      let trackIndex = 0;
      while ((trackMatch = trackRegex.exec(text))) {
        const coordinates = [];
        const coordRegex = /<(?:\w+:)?coord\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coord>/gi;
        let coordMatch;
        while ((coordMatch = coordRegex.exec(trackMatch[1]))) {
          const pair = String(coordMatch[1] || '').trim().split(/\s+/).slice(0, 2).map(Number);
          if (pair.length === 2 && pair.every(Number.isFinite)) coordinates.push(pair);
        }
        if (coordinates.length > 1) lines.push({ name: `track-${trackIndex + 1}`, direction: 'desconocido', coordinates });
        trackIndex += 1;
      }
    }
    return lines;
  }

  function parseKmlLines(kmlText) {
    const lines = typeof global.DOMParser === 'function'
      ? parseKmlLinesWithDom(kmlText)
      : parseKmlLinesWithRegex(kmlText);
    if (!lines.length) throw new Error('El KML no contiene geometrías LineString utilizables.');
    return lines;
  }

  function endpointCandidate(chain, line, mode) {
    const chainStart = chain[0];
    const chainEnd = chain[chain.length - 1];
    const lineStart = line[0];
    const lineEnd = line[line.length - 1];
    const candidates = [
      { mode: 'append', reverse: false, distance: haversineMeters(chainEnd, lineStart) },
      { mode: 'append', reverse: true, distance: haversineMeters(chainEnd, lineEnd) },
      { mode: 'prepend', reverse: false, distance: haversineMeters(chainStart, lineEnd) },
      { mode: 'prepend', reverse: true, distance: haversineMeters(chainStart, lineStart) }
    ];
    return candidates.sort((a, b) => a.distance - b.distance)[0];
  }

  function mergeLine(chain, line, candidate) {
    let next = candidate.reverse ? line.slice().reverse() : line.slice();
    if (candidate.mode === 'append') {
      if (haversineMeters(chain[chain.length - 1], next[0]) < 5) next = next.slice(1);
      return chain.concat(next);
    }
    if (haversineMeters(next[next.length - 1], chain[0]) < 5) next = next.slice(0, -1);
    return next.concat(chain);
  }

  function stitchLineGroups(lines, toleranceMeters = 60) {
    const pending = lines
      .filter(line => Array.isArray(line) && line.length > 1)
      .map(line => line.slice())
      .sort((a, b) => lineDistanceMeters(b) - lineDistanceMeters(a));
    const groups = [];
    while (pending.length) {
      let chain = pending.shift();
      while (pending.length) {
        let best = null;
        pending.forEach((line, index) => {
          const candidate = endpointCandidate(chain, line);
          if (!best || candidate.distance < best.distance) best = { ...candidate, index };
        });
        if (!best || best.distance > toleranceMeters) break;
        chain = mergeLine(chain, pending.splice(best.index, 1)[0], best);
      }
      groups.push(chain);
    }
    return groups.sort((a, b) => lineDistanceMeters(b) - lineDistanceMeters(a));
  }

  function buildDirectionPaths(lines) {
    const byDirection = {
      ida: lines.filter(item => item.direction === 'ida').map(item => item.coordinates),
      regreso: lines.filter(item => item.direction === 'regreso').map(item => item.coordinates),
      desconocido: lines.filter(item => item.direction === 'desconocido').map(item => item.coordinates)
    };
    const paths = [];
    stitchLineGroups(byDirection.ida).forEach((coordinates, index) => paths.push({ direction: index ? `ida-${index + 1}` : 'ida', coordinates }));
    stitchLineGroups(byDirection.regreso).forEach((coordinates, index) => paths.push({ direction: index ? `regreso-${index + 1}` : 'regreso', coordinates }));
    const unknownGroups = stitchLineGroups(byDirection.desconocido);
    if (!paths.length && unknownGroups.length === 1) {
      paths.push({ direction: 'desconocido', coordinates: unknownGroups[0] });
    } else if (!paths.length && unknownGroups.length >= 2) {
      unknownGroups.forEach((coordinates, index) => paths.push({ direction: index === 0 ? 'ida' : index === 1 ? 'regreso' : `alternativa-${index + 1}`, coordinates, inferred: true }));
    } else {
      unknownGroups.forEach((coordinates, index) => paths.push({ direction: `alternativa-${index + 1}`, coordinates, inferred: true }));
    }
    return paths.filter(path => path.coordinates.length > 1 && lineDistanceMeters(path.coordinates) >= 100);
  }

  async function extractKmlFromKmz(arrayBuffer) {
    if (!global.JSZip) throw new Error('JSZip no está disponible. Comprueba vendor/jszip.min.js.');
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('El archivo recibido no es un KMZ/ZIP válido.');
    let zip;
    try { zip = await global.JSZip.loadAsync(arrayBuffer); }
    catch (error) { throw new Error(`KMZ dañado o ilegible: ${error.message || error}`); }
    const file = Object.values(zip.files).find(item => !item.dir && /\.kml$/i.test(item.name));
    if (!file) throw new Error('El KMZ no contiene un archivo KML.');
    return file.async('text');
  }

  function summarizePaths(paths, config = DEFAULT_CONFIG) {
    const directions = paths.map(path => {
      const distanceMeters = Math.round(lineDistanceMeters(path.coordinates));
      return {
        direction: path.direction,
        distanceMeters,
        distanceKm: Number((distanceMeters / 1000).toFixed(2)),
        durationMinutes: Math.ceil(distanceMeters / config.busMetersPerMinute),
        coordinatesCount: path.coordinates.length
      };
    });
    const durations = directions.map(item => item.durationMinutes).filter(Number.isFinite);
    return {
      directions,
      averageDurationMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      minDurationMinutes: durations.length ? Math.min(...durations) : null,
      maxDurationMinutes: durations.length ? Math.max(...durations) : null
    };
  }

  function encodeUrlSpaces(value) {
    return String(value || '').replace(/ /g, '%20');
  }

  function routeSources(route, config = DEFAULT_CONFIG) {
    const sources = [];
    const add = value => {
      const normalized = encodeUrlSpaces(value);
      if (normalized && !sources.includes(normalized)) sources.push(normalized);
    };
    (route.kmzCandidates || []).forEach(add);
    add(route.localKmz);
    if (route.kmz) {
      if (/^https?:\/\//i.test(route.kmz)) add(route.kmz);
      else add(`${String(config.localKmzBase || 'kmz/').replace(/\/?$/, '/')}${String(route.kmz).replace(/^\/?(?:kmz\/)?/, '')}`);
    }
    if (config.allowRemoteFallback !== false) {
      add(route.url_oficial);
      add(route.url);
    }
    return sources;
  }

  async function fetchArrayBuffer(url, config) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), config.fetchTimeoutMs) : null;
    try {
      const response = await global.fetch(url, { signal: controller?.signal, cache: 'force-cache', headers: { Accept: 'application/vnd.google-earth.kmz, application/zip, application/octet-stream;q=0.9, */*;q=0.5' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 4) throw new Error('archivo vacío');
      return buffer;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`tiempo de espera agotado (${Math.round(config.fetchTimeoutMs / 1000)} s)`);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function loadKmzRoute(route, overrides = {}) {
    const config = { ...DEFAULT_CONFIG, ...overrides };
    const sources = routeSources(route, config);
    if (!sources.length) throw new Error(`La ruta ${route.ruta || route.id || ''} no tiene KMZ configurado.`);
    const cacheKey = `${route.id || route.ruta || sources[0]}::${sources.join('|')}`;
    if (routeCache.has(cacheKey)) return routeCache.get(cacheKey);
    const promise = (async () => {
      const errors = [];
      for (const source of sources) {
        try {
          const kml = await extractKmlFromKmz(await fetchArrayBuffer(source, config));
          const paths = buildDirectionPaths(parseKmlLines(kml));
          if (!paths.length) throw new Error('no contiene recorridos válidos');
          return { route, source, paths, metrics: summarizePaths(paths, config) };
        } catch (error) {
          errors.push(`${source}: ${error.message || error}`);
        }
      }
      throw new Error(`No se pudo abrir el KMZ de ${route.empresa || ''} ${route.ruta || route.id || ''}. ${errors.join(' | ')}`);
    })();
    routeCache.set(cacheKey, promise);
    try { return await promise; }
    catch (error) { routeCache.delete(cacheKey); throw error; }
  }

  function projectPointToSegment(point, a, b) {
    const [pointLng, pointLat] = toLngLat(point);
    const [aLng, aLat] = toLngLat(a);
    const [bLng, bLat] = toLngLat(b);
    const R = 6371000;
    const lat0 = pointLat * Math.PI / 180;
    const scaleX = Math.cos(lat0) * Math.PI / 180 * R;
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
    return {
      t,
      coordinates: [pointLng + x / scaleX, pointLat + y / scaleY],
      distanceMeters: Math.hypot(x, y),
      segmentLengthMeters: Math.sqrt(lengthSq)
    };
  }

  function nearestPointOnPath(coords, point) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    let best = null;
    let distanceBefore = 0;
    for (let index = 0; index < coords.length - 1; index += 1) {
      const projected = projectPointToSegment(point, coords[index], coords[index + 1]);
      const segmentLength = haversineMeters(coords[index], coords[index + 1]);
      const candidate = {
        ...projected,
        segmentIndex: index,
        distanceAlongMeters: distanceBefore + segmentLength * projected.t
      };
      if (!best || candidate.distanceMeters < best.distanceMeters) best = candidate;
      distanceBefore += segmentLength;
    }
    return best;
  }

  function slicePathBetween(coords, start, end) {
    const result = [start.coordinates];
    for (let index = start.segmentIndex + 1; index <= end.segmentIndex; index += 1) result.push(coords[index]);
    const last = result[result.length - 1];
    if (!last || haversineMeters(last, end.coordinates) > 1) result.push(end.coordinates);
    return result;
  }

  function estimateTripOnPath(path, origin, destination, overrides = {}) {
    const config = { ...DEFAULT_CONFIG, ...overrides };
    const board = nearestPointOnPath(path.coordinates, origin);
    const alight = nearestPointOnPath(path.coordinates, destination);
    if (!board || !alight) return null;
    const totalPathDistance = lineDistanceMeters(path.coordinates);
    const isClosedPath = haversineMeters(path.coordinates[0], path.coordinates[path.coordinates.length - 1]) <= 1000;
    const wrapsPath = alight.distanceAlongMeters <= board.distanceAlongMeters;
    if (wrapsPath && !isClosedPath) return null;
    const busDistance = wrapsPath
      ? totalPathDistance - board.distanceAlongMeters + alight.distanceAlongMeters
      : alight.distanceAlongMeters - board.distanceAlongMeters;
    if (busDistance < config.minRideMeters) return null;
    const walkBefore = board.distanceMeters * config.walkDistanceFactor;
    const walkAfter = alight.distanceMeters * config.walkDistanceFactor;
    if (walkBefore > config.maxWalkMeters || walkAfter > config.maxWalkMeters) return null;
    const busMinutes = Math.max(1, Math.ceil(busDistance / config.busMetersPerMinute));
    const walkBeforeMinutes = Math.max(1, Math.ceil(walkBefore / config.walkMetersPerMinute));
    const walkAfterMinutes = Math.max(1, Math.ceil(walkAfter / config.walkMetersPerMinute));
    return {
      direction: path.direction,
      boardPoint: {
        coordinates: board.coordinates,
        walkDistance: Math.round(walkBefore),
        walkMinutes: walkBeforeMinutes,
        segmentIndex: board.segmentIndex,
        distanceAlongMeters: Math.round(board.distanceAlongMeters)
      },
      alightPoint: {
        coordinates: alight.coordinates,
        walkDistance: Math.round(walkAfter),
        walkMinutes: walkAfterMinutes,
        segmentIndex: alight.segmentIndex,
        distanceAlongMeters: Math.round(alight.distanceAlongMeters)
      },
      walkBeforeDistance: Math.round(walkBefore),
      walkBeforeMinutes,
      walkAfterDistance: Math.round(walkAfter),
      walkAfterMinutes,
      totalWalkDistance: Math.round(walkBefore + walkAfter),
      totalWalkMinutes: walkBeforeMinutes + walkAfterMinutes,
      busDistance: Math.round(busDistance),
      busMinutes,
      totalMinutes: walkBeforeMinutes + busMinutes + walkAfterMinutes,
      fullPath: path.coordinates,
      ridePath: wrapsPath
        ? [board.coordinates]
            .concat(path.coordinates.slice(board.segmentIndex + 1))
            .concat(path.coordinates.slice(0, alight.segmentIndex + 1))
            .concat([alight.coordinates])
        : slicePathBetween(path.coordinates, board, alight)
    };
  }

  function addRouteOption(options, option, penalty = 0) {
    if (!option) return;
    options.push({
      ...option,
      totalMinutes: option.totalMinutes + penalty,
      scorePenalty: penalty,
      directionPenaltyMinutes: penalty
    });
  }

  function estimateTripOnLoadedRoute(loaded, origin, destination, overrides = {}) {
    const options = [];
    loaded.paths.forEach(path => {
      const normal = estimateTripOnPath(path, origin, destination, overrides);
      addRouteOption(options, normal, 0);

      // TRB v58: algunos KMZ traen el LineString con el orden contrario o sin
      // dirección confiable. Evaluamos también el trazado inverso para evitar
      // que el plan mande al usuario a una calzada/sentido que no corresponde.
      // Si el tramo original tiene dirección conocida, el inverso recibe una
      // pequeña penalización; solo gana cuando realmente mejora caminata/recorrido.
      const reversePath = { ...path, direction: `${path.direction || 'recorrido'}-ajustada`, coordinates: path.coordinates.slice().reverse(), directionAdjusted: true };
      const reversed = estimateTripOnPath(reversePath, origin, destination, overrides);
      const penalty = (path.direction === 'desconocido' || path.direction.startsWith('alternativa') || path.inferred) ? 0 : 4;
      addRouteOption(options, reversed, penalty);
    });
    return options.sort((a, b) => a.totalMinutes - b.totalMinutes || a.totalWalkDistance - b.totalWalkDistance || a.busDistance - b.busDistance)[0] || null;
  }

  async function mapWithConcurrency(items, worker, concurrency = 5, onProgress, signal) {
    const results = new Array(items.length);
    let cursor = 0;
    let completed = 0;
    async function run() {
      while (true) {
        if (signal?.aborted) return;
        const index = cursor++;
        if (index >= items.length) return;
        try { results[index] = await worker(items[index], index); }
        catch (error) { results[index] = { error: error instanceof Error ? error.message : String(error), route: items[index] }; }
        completed += 1;
        if (typeof onProgress === 'function') onProgress({ completed, total: items.length, item: items[index], result: results[index] });
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, run));
    return results;
  }

  async function processCatalog(catalog, options = {}) {
    const config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    const routes = Array.isArray(catalog?.rutas) ? catalog.rutas : [];
    const results = await mapWithConcurrency(routes, async route => {
      const loaded = await loadKmzRoute(route, config);
      return { ...route, duracion_estimada: loaded.metrics, fuente_kmz_usada: loaded.source };
    }, options.concurrency || config.concurrency, options.onProgress, options.signal);
    return {
      ...catalog,
      generatedAt: new Date().toISOString(),
      modelo_tiempo: { bus_metros_por_minuto: config.busMetersPerMinute, caminata_metros_por_minuto: config.walkMetersPerMinute },
      rutas: results.map((result, index) => result?.error ? { ...routes[index], error: result.error } : result)
    };
  }

  async function findBestRoutesDetailed(catalog, origin, destination, options = {}) {
    const config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    const routes = Array.isArray(catalog?.rutas) ? catalog.rutas : [];
    const loadedResults = await mapWithConcurrency(routes, route => loadKmzRoute(route, config), options.concurrency || config.concurrency, options.onProgress, options.signal);
    const errors = loadedResults.filter(item => item?.error).map(item => ({ route: item.route, error: item.error }));
    const candidates = loadedResults
      .filter(item => item && !item.error)
      .map(loaded => {
        const trip = estimateTripOnLoadedRoute(loaded, origin, destination, config);
        return trip ? { route: loaded.route, source: loaded.source, metrics: loaded.metrics, ...trip } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.totalMinutes - b.totalMinutes || a.totalWalkDistance - b.totalWalkDistance || a.busDistance - b.busDistance);

    const unique = [];
    const seen = new Set();
    candidates.forEach(candidate => {
      const key = candidate.route.id || `${candidate.route.empresa}::${candidate.route.ruta}`;
      if (!seen.has(key)) { seen.add(key); unique.push(candidate); }
    });
    const selected = unique.slice(0, options.limit || 7).map((item, index) => ({ ...item, isOptimal: index === 0 }));
    return { options: selected, errors, loadedCount: loadedResults.length - errors.length, totalCount: routes.length };
  }

  async function findBestRoutes(catalog, origin, destination, options = {}) {
    return (await findBestRoutesDetailed(catalog, origin, destination, options)).options;
  }

  function validateCatalog(catalog) {
    const routes = Array.isArray(catalog?.rutas) ? catalog.rutas : [];
    const errors = [];
    const ids = new Set();
    routes.forEach((route, index) => {
      if (!route.id) errors.push(`Ruta #${index + 1}: falta id`);
      if (!route.empresa) errors.push(`Ruta ${route.id || index + 1}: falta empresa`);
      if (!route.ruta) errors.push(`Ruta ${route.id || index + 1}: falta código`);
      if (!route.kmz && !route.url_oficial && !route.url) errors.push(`Ruta ${route.id || index + 1}: falta fuente KMZ`);
      if (ids.has(route.id)) errors.push(`ID duplicado: ${route.id}`);
      ids.add(route.id);
    });
    return { valid: errors.length === 0, routeCount: routes.length, errors };
  }

  function downloadJson(data, filename = 'trb_rutas_con_tiempos.json') {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const api = Object.freeze({
    DEFAULT_CONFIG,
    haversineMeters,
    lineDistanceMeters,
    parseKmlLines,
    buildDirectionPaths,
    summarizePaths,
    routeSources,
    loadKmzRoute,
    nearestPointOnPath,
    estimateTripOnPath,
    estimateTripOnLoadedRoute,
    processCatalog,
    findBestRoutes,
    findBestRoutesDetailed,
    validateCatalog,
    downloadJson,
    clearCache: () => routeCache.clear()
  });

  global.TRBRouteEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
