# Fuentes y licencias

## Fuentes oficiales usadas por TRB

- Portal de Transporte del Área Metropolitana de Barranquilla: https://www.ambq.gov.co/transporte/
- Directorio de rutas KMZ: https://www.ambq.gov.co/ruta-de-buses/
- Portal oficial SIBUS: https://sibusoficial.ambq.gov.co/
- Tarifas publicadas para 2026: https://www.ambq.gov.co/desde-el-19-de-enero-de-2026-regira-nuevo-valor-del-pasaje-de-bus-en-barranquilla/
- Paraderos de Transmetro en Datos Abiertos Colombia: https://www.datos.gov.co/Transporte/Paraderos-del-Sistema/hxy3-94yh

El catálogo `data/trb_catalogo_rutas.json` contiene 23 empresas y 93 enlaces a KMZ del AMB. Las copias descargadas se guardan en `kmz/` y se usan únicamente para el prototipo y sus pruebas.

## Fuente comunitaria de respaldo

- ColombiaGTFS — Barranquilla/Transmetro: https://github.com/ColombiaInfo/ColombiaGTFS/tree/master/Barranquilla%20-%20Transmetro

El feed comunitario histórico conserva las funciones anteriores de rutas/paraderos y solo actúa como respaldo si el motor KMZ no puede iniciarse. Puede estar desactualizado y no representa posiciones en tiempo real.

## Software y mapas

- OpenStreetMap contributors: https://www.openstreetmap.org/copyright
- Leaflet: https://leafletjs.com/
- JSZip: https://stuk.github.io/jszip/ — licencia MIT
- Nominatim/OpenStreetMap: geocodificación puntual de direcciones.

## Uso de servicios externos

El cálculo principal de buses se realiza localmente con los KMZ de TRB. No utiliza RutaQuilla. Nominatim solo convierte una dirección escrita en coordenadas. Para producción debe utilizarse un geocodificador propio o un proveedor con SLA y políticas de uso adecuadas.

## Marca

TRB es un prototipo independiente. No se presenta como aplicación oficial del Área Metropolitana de Barranquilla, SIBUS o Transmetro.


## Mapa vectorial TRB v17

- `hsl-map-style`: estilo de referencia aportado por el usuario, licencia AGPL-3.0-only. Se incluye una copia de la licencia en `maps/HSL_STYLE_LICENSE_AGPL-3.0.md`.
- MapLibre GL JS: renderizador abierto para estilos vectoriales.
- OpenFreeMap: proveedor predeterminado de teselas vectoriales, fuentes y sprites.
- OpenMapTiles: esquema de datos vectoriales.
- OpenStreetMap: datos cartográficos, ODbL.

La interfaz no utiliza el logotipo HSL ni datos de transporte de Helsinki.


## MapLibre GL JS y puente Leaflet

TRB incluye localmente MapLibre GL JS 5.24.0 y `@maplibre/maplibre-gl-leaflet` 0.1.3 dentro de `vendor/maplibre/`. Sus licencias se conservan junto a los archivos. Esto evita depender de un CDN para iniciar el motor cartográfico.

## Buscador de lugares v23

- Photon: geocodificador abierto para datos de OpenStreetMap, licencia Apache-2.0. TRB usa un endpoint configurable mediante `TRB_PHOTON_URL` y mantiene caché local de consultas.
- OpenStreetMap: nombres, direcciones y puntos de interés bajo ODbL, con atribución visible en el mapa.
- El servidor público de Photon se usa solamente para volumen moderado. Para producción con tráfico alto debe configurarse una instancia propia o proveedor compatible.
- Nominatim público se usa únicamente como búsqueda final activada por el usuario; no se utiliza para autocompletado.
