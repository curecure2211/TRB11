# Pruebas realizadas

## Estructura y catálogos

- 23 empresas presentes.
- 93 rutas presentes.
- IDs y enlaces del catálogo validados.
- orden de scripts HTML comprobado.

## Motor de rutas

- JSZip disponible.
- cálculo de ruta directa.
- orden de opciones por tiempo.
- sentidos de ida y regreso.
- recorrido circular.
- distancias y tiempos aproximados.
- errores de KMZ controlados.

## Servidor de geometría

Se probó un KMZ sintético con dos sentidos:

- validación ZIP/KMZ;
- extracción del KML;
- lectura de dos `LineString`;
- clasificación ida/regreso;
- cálculo de distancia;
- cálculo de límites geográficos;
- respuesta JSON del endpoint `/api/route-geometry`.

## Comandos ejecutados

```bash
node --check app.js
node --check trb_motor_rutas.js
python -m py_compile serve_trb.py
python tests/test_project.py
node tests/test_route_engine.js
python tests/test_server_geometry.py
```

Todos pasaron correctamente.

## Limitación del entorno de prueba

El navegador automatizado del entorno bloqueó la apertura de direcciones localhost. Por eso no se realizó una prueba visual automatizada completa dentro de Chromium. La API local, la conversión de geometrías, la sintaxis y las pruebas unitarias sí fueron verificadas.


## Validaciones v32

- Sintaxis de `app.js` validada con Node.js.
- 21 pruebas de Python superadas.
- Prueba de ejecución aislada del motor: combinación Bus corto → Transmetro generada y clasificada como `combined`.
- Verificación de filtros Buses, Transmetro, Rutas combinadas y Bici.

## TRB v33

- Portada suministrada instalada en `assets/trb-home-hero.jpg`.
- Dimensiones verificadas: 1672 × 941 px.
- Texto y logotipos visibles sin recorte en escritorio.
- Proporción 16:9 aplicada en tablet y móvil.
- Caché PWA y URL del servidor actualizadas a v33.
