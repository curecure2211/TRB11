'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');

global.JSZip = require(path.join(__dirname, '..', 'vendor', 'jszip.min.js'));
const engine = require(path.join(__dirname, '..', 'trb_motor_rutas.js'));

function kmlLine(name, coordinates, description = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark>
  <name>${name}</name><description>${description}</description><LineString><coordinates>
  ${coordinates.map(([lng, lat]) => `${lng},${lat},0`).join(' ')}
  </coordinates></LineString></Placemark></Document></kml>`;
}

async function kmz(kml) {
  const zip = new global.JSZip();
  zip.file('doc.kml', kml);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

(async () => {
  const direct = await kmz(kmlLine('Recorrido principal', [
    [-74.8200, 10.9800], [-74.8050, 10.9800], [-74.7900, 10.9800], [-74.7750, 10.9800], [-74.7600, 10.9800]
  ]));
  const detour = await kmz(kmlLine('Recorrido alternativo', [
    [-74.8200, 10.9810], [-74.8100, 10.9950], [-74.7900, 11.0050], [-74.7700, 10.9950], [-74.7600, 10.9810]
  ]));
  const gxTrackKml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark><name>Track</name><gx:Track><gx:coord>-74.82 10.98 0</gx:coord><gx:coord>-74.80 10.98 0</gx:coord><gx:coord>-74.78 10.98 0</gx:coord></gx:Track></Placemark></kml>`;
  const track = await kmz(gxTrackKml);
  const circular = await kmz(kmlLine('Ruta circular ida', [
    [-74.8200, 10.9800], [-74.8000, 10.9800], [-74.8000, 11.0000], [-74.8200, 11.0000], [-74.8200, 10.9800]
  ]));
  const buffers = new Map([
    ['kmz/TEST/DIRECTA.kmz', direct],
    ['kmz/TEST/DETOUR.kmz', detour],
    ['kmz/TEST/DAMAGED.kmz', new Uint8Array([1, 2, 3, 4])],
    ['kmz/TEST/TRACK.kmz', track],
    ['kmz/TEST/CIRCULAR.kmz', circular]
  ]);
  global.fetch = async url => {
    const key = String(url).replace(/%20/g, ' ');
    if (!buffers.has(key)) return new Response('missing', { status: 404 });
    return new Response(buffers.get(key), { status: 200, headers: { 'content-type': 'application/vnd.google-earth.kmz' } });
  };

  const catalog = {
    rutas: [
      { id: 'directa', empresa: 'TEST', ruta: 'DIRECTA', kmz: 'TEST/DIRECTA.kmz' },
      { id: 'detour', empresa: 'TEST', ruta: 'DETOUR', kmz: 'TEST/DETOUR.kmz' },
      { id: 'damaged', empresa: 'TEST', ruta: 'DAMAGED', kmz: 'TEST/DAMAGED.kmz' },
      { id: 'missing', empresa: 'TEST', ruta: 'MISSING', kmz: 'TEST/MISSING.kmz' }
    ]
  };

  const trackLoaded = await engine.loadKmzRoute({ id: 'track', empresa: 'TEST', ruta: 'TRACK', kmz: 'TEST/TRACK.kmz' }, { localKmzBase: 'kmz/' });
  assert.equal(trackLoaded.paths.length, 1, 'El parser debe aceptar gx:Track');

  const validation = engine.validateCatalog(catalog);
  assert.equal(validation.valid, true);
  assert.equal(validation.routeCount, 4);

  const origin = { lat: 10.9794, lng: -74.8195 };
  const destination = { lat: 10.9806, lng: -74.7605 };
  const result = await engine.findBestRoutesDetailed(catalog, origin, destination, {
    limit: 5,
    concurrency: 2,
    config: { maxWalkMeters: 1000, localKmzBase: 'kmz/', fetchTimeoutMs: 3000 }
  });
  assert.equal(result.loadedCount, 2);
  assert.equal(result.errors.length, 2);
  assert.ok(result.options.length >= 2);
  assert.equal(result.options[0].route.id, 'directa');
  assert.ok(result.options[0].busDistance > 5000);
  assert.ok(result.options[0].walkBeforeDistance < 200);
  assert.ok(result.options[0].walkAfterDistance < 200);
  assert.ok(result.options[0].ridePath.length >= 2);
  assert.ok(result.options[0].totalMinutes <= result.options[1].totalMinutes);

  engine.clearCache();
  const reverse = await engine.findBestRoutesDetailed({ rutas: [catalog.rutas[0]] }, destination, origin, {
    config: { maxWalkMeters: 1000, localKmzBase: 'kmz/' }
  });
  assert.equal(reverse.options.length, 1, 'Una geometría sin sentido explícito debe poder evaluarse a la inversa');
  assert.match(reverse.options[0].direction, /inversa/);

  engine.clearCache();
  const middle = await engine.findBestRoutesDetailed({ rutas: [catalog.rutas[0], catalog.rutas[1]] },
    { lat: 10.9798, lng: -74.8052 }, { lat: 10.9802, lng: -74.7752 },
    { config: { maxWalkMeters: 800, localKmzBase: 'kmz/' } });
  assert.ok(middle.options.length >= 1);
  assert.equal(middle.options[0].route.id, 'directa');
  assert.ok(middle.options[0].busDistance > 2500 && middle.options[0].busDistance < 4000);

  engine.clearCache();
  const farAway = await engine.findBestRoutesDetailed({ rutas: [catalog.rutas[0]] },
    { lat: 11.1000, lng: -74.9500 }, { lat: 11.1200, lng: -74.9300 },
    { config: { maxWalkMeters: 1000, localKmzBase: 'kmz/' } });
  assert.equal(farAway.options.length, 0, 'No debe sugerir una ruta cuando ambos puntos están demasiado lejos');

  engine.clearCache();
  const circularResult = await engine.findBestRoutesDetailed({ rutas: [{ id: 'circular', empresa: 'TEST', ruta: 'CIRCULAR', kmz: 'TEST/CIRCULAR.kmz' }] },
    { lat: 10.9998, lng: -74.8195 }, { lat: 10.9802, lng: -74.8195 },
    { config: { maxWalkMeters: 500, localKmzBase: 'kmz/' } });
  assert.equal(circularResult.options.length, 1, 'Debe permitir continuar por el cierre de una ruta circular');
  assert.ok(circularResult.options[0].ridePath.length >= 3);

  console.log('OK: 6 escenarios; JSZip, ordenamiento, sentidos, rutas circulares, distancias y errores controlados.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
