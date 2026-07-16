# TRB v62 - buses simulados e icono circular azul

Cambios:

- Se agregó `assets/trb-bus-reference.png` como icono circular azul de bus.
- Los buses simulados del mapa ahora usan ese icono pequeño, sin cuadro exterior ni etiqueta SIM encima del mapa.
- Se corrigió un problema donde el bus de demostración podía usar una ruta anterior guardada en memoria y aparecer fuera del tramo visible.
- Al cambiar de alternativa, se limpia la ruta y la trayectoria usada por los buses simulados.
- En rutas combinadas, el bus simulado se mueve sobre el tramo de bus que se está mostrando, no sobre una línea vieja ni sobre toda la ruta completa.
- Se actualizó caché a v62.

Archivos que debes reemplazar en GitHub:

- `app.js`
- `styles.css`
- `index.html`
- `service-worker.js`
- `manifest.webmanifest`
- `VERSION.txt`
- `assets/trb-bus-reference.png`
- `CAMBIOS_BUS_SIMULADO_ICONO_V62.md`
