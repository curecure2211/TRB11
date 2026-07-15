# TRB — planificador web con mapa de recorridos

Esta versión cambia por completo la forma en que TRB muestra las rutas en el mapa.

El navegador ya no necesita abrir y descomprimir cada KMZ para dibujar una ruta. El servidor local:

1. descarga el KMZ oficial;
2. comprueba que sea válido;
3. extrae las líneas del KML;
4. identifica ida, regreso y otros trazados;
5. convierte el recorrido a JSON;
6. entrega la geometría al mapa mediante `/api/route-geometry`.

Esto evita la mayoría de los problemas de CORS, caché y archivos KMZ que antes dejaban el mapa sin recorrido.

## Apariencia del mapa

La visualización utiliza un lenguaje similar al de los grandes planificadores de transporte, sin copiar los mapas ni los recursos gráficos privados de HSL:

- mapa base claro basado en OpenStreetMap;
- línea de bus gruesa con borde blanco;
- color consistente para cada empresa;
- terminales A y B;
- flechas que muestran el sentido del recorrido;
- puntos intermedios sobre la geometría;
- buses de simulación sobre la línea;
- tarjeta flotante con código, empresa, distancia y tiempo estimado;
- caminatas punteadas y tramo de bus resaltado en los resultados del planificador.


## Filtros de viaje v32

El panel de sugerencias separa las opciones en **Buses**, **Transmetro**, **Rutas combinadas** y **Bici**. Las rutas combinadas conectan buses SIBUS/AMB con Transmetro en ambos sentidos y priorizan recorridos de bus cortos cuando sirven como alimentadores. Al cambiar de filtro, el mapa cambia automáticamente a la primera alternativa de esa categoría.

## Abrir en Windows

1. Descomprime completamente el ZIP.
2. Haz doble clic en **`INICIAR_TRB.bat`**.
3. La primera ejecución prepara las 93 rutas. Puede tardar varios minutos.
4. TRB se abrirá automáticamente en el navegador.
5. No cierres la ventana negra mientras estés usando la aplicación.

Después de preparar las rutas puedes utilizar **`INICIAR_TRB_RAPIDO.bat`**.

Requisito: Python 3. Durante la instalación activa **Add Python to PATH**.

## Abrir en macOS

1. Descomprime el ZIP.
2. Haz clic derecho en **`INICIAR_TRB.command`** y selecciona **Abrir**.
3. Espera a que termine la preparación.
4. TRB se abrirá automáticamente.

## Abrir manualmente

```bash
python serve_trb.py --prepare --open
```

Después de la primera preparación:

```bash
python serve_trb.py --open --auto-prefetch
```

La dirección local es:

```text
http://127.0.0.1:8080
```

No abras `index.html` con doble clic. El mapa de recorridos necesita el servidor local.

## API local incluida

Estado del servidor y de los archivos:

```text
GET /api/health
GET /api/kmz-status
GET /api/network-route?mode=walk|bike|car&points=lng,lat;lng,lat
```

Preparar faltantes en segundo plano:

```text
GET /api/prefetch
```

Obtener la geometría procesada de una ruta:

```text
GET /api/route-geometry?route_id=COOASOATLAN__C1-4132
```

La respuesta contiene los trazados, sentidos, coordenadas, distancia, duración estimada y límites geográficos.

## Cómo comprobar el recorrido

1. Abre TRB con el lanzador.
2. Entra en **Mapa**.
3. Selecciona una empresa y una ruta.
4. Espera el mensaje “Preparando la geometría del recorrido”.
5. Debes ver la línea completa, terminales A/B, flechas de sentido y buses simulados.
6. Pulsa cualquier punto o bus para abrir su información.

También puedes buscar origen y destino en **Rutas** y pulsar **Ver recorrido en el mapa**.

## Archivos generados en tu computador

- `kmz/`: archivos originales descargados.
- `route_geometry/`: geometrías JSON ya procesadas.
- `kmz_errors.json`: rutas que no pudieron descargarse o convertirse.

No elimines `route_geometry/` si quieres que las rutas abran más rápido posteriormente.

## Límites

- Los buses son simulados, no posiciones GPS reales.
- Los puntos intermedios de un KMZ no son necesariamente paraderos oficiales.
- Los tiempos no incluyen espera, tráfico ni frecuencia real.
- El mapa base requiere conexión a internet; la línea de la ruta puede seguir cargándose desde la caché local.

## Pruebas técnicas

```bash
node --check app.js
node --check trb_motor_rutas.js
python -m py_compile serve_trb.py
python tests/test_project.py
node tests/test_route_engine.js
python tests/test_server_geometry.py
```


## Mapa interactivo v11

La pestaña **Mapa** incorpora búsqueda de origen y destino, selección de puntos tocando el mapa, ubicación actual, resultados ordenados y colores por familia de ruta. El recorrido se sigue calculando con los 93 KMZ del catálogo local.

## Versión web pública v12

La carpeta también incluye configuración de despliegue para Render y Docker. Consulta `PUBLICAR_EN_INTERNET.md`.

La carga del mapa ahora tiene proveedores alternativos, diagnóstico visible y recalcula su tamaño al abrir la pestaña para evitar el lienzo vacío.


## Mapa vectorial v17

La página usa MapLibre con `maps/trb-map-style.json`, una adaptación para Barranquilla del lenguaje visual del estilo HSL. Los KMZ oficiales se convierten a GeoJSON en `serve_trb.py` y se dibujan con color por familia de ruta. Consulte `CAMBIOS_MAPLIBRE_HSL_V17.md`.

## Selector de rutas v18

La vista **Mapa** permite elegir entre **34 rutas de Transmetro** y **93 rutas oficiales de 23 empresas**. El selector incluye sistema, empresa, ruta, búsqueda instantánea y tarjetas de color que abren el recorrido seleccionado.

## Sugerencia de ruta multimodal v19

La pestaña **Mapa** reúne en el panel izquierdo alternativas a pie, en bicicleta, Transmetro, buses de las 23 empresas y combinaciones con transbordo. Las sugerencias se ordenan por duración estimada y pueden filtrarse por modo.

Los tiempos no incluyen espera, tráfico ni disponibilidad real de bicicletas.


## Flujo de instrucciones HSL v20

Al buscar una ruta, TRB entra en modo de viaje de pantalla completa. El panel muestra sugerencias y, al elegir una, cambia a instrucciones paso a paso.


## Precisión de rutas v20

La v20 usa el trazado KMZ oficial para buses SIBUS, ajusta los tramos de Transmetro a la red vial y calcula caminatas/bicicleta por calles reales. La aplicación evita dibujar líneas rectas cuando el enrutador no responde. Los resultados siguen siendo estimados y deben validarse con información operativa oficial antes de uso comercial.


## Búsqueda inteligente y zoom proporcional v21

La v21 completa nombres mientras escribes usando lugares destacados, estaciones, paraderos y búsquedas recientes. En Instrucciones puedes cambiar de alternativa con flechas y puntos. Cada selección recalcula el encuadre del mapa según el tamaño del tramo realmente usado, de modo que rutas cortas se acercan más y rutas largas se muestran completas.


## Rutas cercanas y combinaciones ampliadas v22

La v22 corrige búsquedas que solo devolvían caminar o bicicleta. La geocodificación descarta resultados administrativos genéricos, la red KMZ se muestrea aproximadamente cada 140 m y el planificador ejecuta una segunda pasada con radios de acceso y salida ampliados. También admite combinaciones de hasta dos transbordos y conserva el trazado real de cada ruta.


## Buscador inteligente de lugares v23

La lista predictiva combina resultados locales, paraderos y búsqueda Photon/OpenStreetMap mediante el servidor de TRB. Reconoce direcciones, barrios, universidades, colegios, hospitales, clínicas, centros comerciales, parques, playas y otros puntos de interés. La búsqueda final conserva un respaldo independiente y los resultados se guardan en caché. Para producción con tráfico alto puede configurarse `TRB_PHOTON_URL` con una instancia propia o un proveedor compatible.


## Información de línea y prioridad de rutas v24

- Los códigos de bus dentro de sugerencias e instrucciones son interactivos.
- Al pulsar una línea, el mapa elimina las demás geometrías y muestra únicamente su recorrido completo.
- El panel izquierdo cambia a una ficha tipo HSL con empresa, código, sentidos, distancia, duración y secuencia.
- La flecha superior devuelve al usuario a la sugerencia o instrucciones que estaba consultando.
- Las opciones de un solo bus aparecen antes que caminar, bicicleta y rutas con transbordo.
- Las rutas directas con hasta 15 minutos totales de caminata reciben la máxima prioridad.
- Las rutas con uno o dos transbordos quedan al final, ordenadas después por duración.


## Búsqueda amplia y GPS (v25)

- El buscador usa Photon/OpenStreetMap por defecto y puede combinar Google Places configurando `TRB_GOOGLE_PLACES_API_KEY` en el servidor.
- Para recibir GPS reales configura `TRB_DRIVER_TOKEN`, abre `/driver.html` en el teléfono del conductor y usa HTTPS.
- La web principal consulta `/api/vehicles` cada cinco segundos y muestra los vehículos activos.


## Direcciones exactas y Google (v26)

TRB reconoce formatos colombianos como `Carrera 53 No. 64 - 28`, `Cra 53 #64-28` y errores frecuentes como `carreara`. Para ampliar la cobertura con Google, haga doble clic en `CONFIGURAR_BUSCADOR_GOOGLE.bat`, pegue su clave y luego abra `INICIAR_TRB.bat`. La clave queda en `.env.local` y no se envía al navegador.

## Portada de Inicio v33

La pantalla de Inicio usa la nueva imagen promocional suministrada como portada principal. El contenido se muestra completo en escritorio y conserva proporción 16:9 en pantallas pequeñas.
