# TRB v17 · MapLibre + estilo inspirado en HSL

## Integración realizada

- Se procesó el paquete `hsl-map-style-master.zip` proporcionado por el usuario.
- Se eliminaron fuentes, rutas, paraderos, zonas tarifarias y elementos propios de Helsinki/HSL.
- Se creó `maps/trb-map-style.json` con centro en Barranquilla.
- El estilo usa el esquema OpenMapTiles y el proveedor OpenFreeMap para cobertura mundial, incluida Colombia.
- La base vectorial se renderiza con MapLibre GL dentro del mapa existente de TRB.
- Leaflet se conserva para controles, marcadores, paraderos y como respaldo si WebGL/MapLibre no están disponibles.
- Las geometrías KMZ ahora se exponen también como GeoJSON y las líneas oficiales se dibujan en MapLibre con borde blanco.
- Se conserva un mapa ráster de respaldo para navegadores sin WebGL o redes que bloqueen las teselas vectoriales.

## Licencias y atribución

- Adaptación del estilo HSL: AGPL-3.0-only.
- Datos cartográficos: OpenStreetMap, ODbL.
- Esquema: OpenMapTiles.
- Hosting vectorial predeterminado: OpenFreeMap.
- Renderizador: MapLibre GL JS.
