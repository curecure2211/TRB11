# TRB — Corrección mapa y trayectos v10

## Problemas corregidos

1. El navegador podía seguir mostrando una versión antigua de `app.js` y `styles.css` por la caché PWA.
2. El mapa mezclaba CARTO y OpenStreetMap cuando fallaban algunos mosaicos, produciendo cuadrados de distinto color o áreas que parecían no cargar.
3. Si no se procesaba ningún KMZ, el planificador podía quedar sin resultado en vez de usar el catálogo de respaldo.
4. Los recursos externos del mapa podían quedar cacheados de manera inconsistente.

## Cambios

- Caché PWA actualizada a `trb-web-v10-map-and-route-fix`.
- HTML, CSS, JavaScript, JSZip y motor cargados con versión `v=10`.
- El lanzador abre `http://127.0.0.1:8080/?v=10` para evitar la versión anterior.
- Mapa base único de OpenStreetMap; ya no superpone dos proveedores.
- Los mosaicos externos no se almacenan en el service worker.
- Mensaje visible cuando el proveedor del mapa no responde.
- Respaldo automático de rutas si los KMZ no pueden descargarse o procesarse.
- Caminata y tramo en bus permanecen dibujados en la vista del planificador.

## Primera prueba

1. Cierra todas las pestañas anteriores de TRB.
2. Descomprime el ZIP en una carpeta nueva.
3. Ejecuta `INICIAR_TRB.bat`.
4. Espera a que se abra una dirección terminada en `?v=10`.
5. Pulsa `Ctrl + Shift + R` una vez.
6. Busca origen y destino, abre una opción y pulsa `Ver recorrido en el mapa`.

## Si aún aparece la versión antigua

En Chrome:

1. Abre TRB.
2. Pulsa `F12`.
3. Ve a `Application` → `Storage`.
4. Pulsa `Clear site data`.
5. Recarga con `Ctrl + Shift + R`.
