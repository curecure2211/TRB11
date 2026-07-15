# Cambios del mapa de TRB

## Problema corregido

La versión anterior dependía de que el navegador descargara y descomprimiera directamente los KMZ. Cuando el archivo no estaba local, el servidor remoto bloqueaba la petición, la caché conservaba una respuesta fallida o JSZip no lograba procesar el contenido, el panel mostraba información pero no aparecía la línea.

## Solución

Se añadió una capa de procesamiento en `serve_trb.py`:

- endpoint `/api/route-geometry`;
- descarga controlada del KMZ;
- validación ZIP/KML;
- extracción de `LineString` y `gx:Track`;
- detección de ida y regreso;
- cálculo de distancia y duración;
- caché JSON en `route_geometry/`;
- respuesta de error estructurada cuando una ruta no existe o está dañada.

## Visualización añadida

- mapa base claro;
- línea principal con borde blanco;
- ramales y sentidos secundarios diferenciados;
- terminales A y B;
- flechas de dirección;
- puntos geométricos intermedios;
- buses simulados colocados sobre el trazado;
- resumen flotante sobre el mapa;
- ajuste automático de zoom;
- panel lateral con línea temporal de inicio y final;
- resultado de viaje con caminatas punteadas y bus resaltado.

## Archivos modificados

- `serve_trb.py`
- `app.js`
- `styles.css`
- `index.html`
- `service-worker.js`
- `README.md`
- `tests/test_server_geometry.py`

## Importante

No se utilizan tiles, logotipos, código ni recursos privados de HSL. Se reproduce únicamente una forma clara y familiar de presentar recorridos, usando OpenStreetMap y componentes propios de TRB.
