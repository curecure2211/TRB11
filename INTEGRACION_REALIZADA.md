# Resumen de integración

## Archivos modificados

- `index.html`
  - carga JSZip local;
  - carga el motor antes de `app.js`;
  - actualiza los textos del planificador para las 93 rutas.
- `app.js`
  - carga `trb_catalogo_rutas.json`;
  - usa `findBestRoutesDetailed` en la interfaz de origen/destino;
  - muestra todos los datos solicitados;
  - dibuja el recorrido completo y el tramo utilizado;
  - conserva el planificador anterior como respaldo;
  - usa el motor también al abrir una ruta KMZ desde el mapa.
- `styles.css`
  - añade la cuadrícula de métricas y estilos responsive para resultados KMZ.
- `service-worker.js`
  - cachea el motor, catálogo y JSZip;
  - evita devolver HTML cuando falla un KMZ.
- `README.md`
  - nuevas instrucciones de ejecución y prueba.

## Archivos añadidos

- `trb_motor_rutas.js`
- `data/trb_catalogo_rutas.json`
- `data/trb_catalogo_rutas.csv`
- `vendor/jszip.min.js`
- `serve_trb.py`
- `tools/generar_tiempos_trb.html`
- `tests/test_route_engine.js`
- `tests/test_project.py`
- `kmz/` como caché local

## Correcciones del motor original

- busca el punto más cercano sobre cada segmento, no solamente el vértice más cercano;
- calcula la distancia exacta a lo largo del trazado entre abordaje y descenso;
- prueba el sentido inverso cuando el KML no identifica el sentido;
- agrupa líneas fragmentadas del KML;
- intenta varias fuentes de KMZ;
- añade timeout, validación de ZIP/KML y errores por ruta;
- devuelve geometría completa y geometría del tramo para el mapa;
- evita cualquier dependencia de `routequilla_referencia.json`;
- expone un resultado detallado con rutas cargadas y errores.
